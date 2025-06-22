import os
import json
import time
import logging
import asyncio
from contextlib import asynccontextmanager
from typing import List, Dict
from datetime import datetime, timedelta

import requests
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from confluent_kafka import Producer
from dotenv import load_dotenv

# Import bank_activity_predictor using absolute import for script execution
from bank_activity_predictor import get_daily_activity_schedule

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

KAFKA_BROKER_URL = os.getenv('KAFKA_BROKER_URL', 'localhost:9092')
BANK_SERVER_TOPIC = os.getenv('BANK_SERVER_TOPIC', 'bank_server')
BANK_SIMULATOR_URL = os.getenv('BANK_SIMULATOR_URL', 'http://localhost:5000/api/status')
MONITORED_BANKS = ["SBI", "Axis Bank", "ICICI Bank"]
AGENT1_PORT = int(os.getenv('AGENT1_PORT', 8001)) # Port for Agent 1's API
FETCH_INTERVAL_SECONDS = int(os.getenv('AGENT1_FETCH_INTERVAL_SECONDS', 5)) # Reduced for more frequent updates

# --- Pydantic Models ---
class BankStatusMessage(BaseModel):
    bank_id: str
    status: str
    timestamp: str

class BankActivityHour(BaseModel):
    hour: int
    isActive: bool

class BankActivityScheduleResponse(BaseModel):
    schedule: List[BankActivityHour]
    lastUpdated: str

# --- Enhanced Bank Activity Logic ---
def get_enhanced_daily_activity_schedule(day_offset: int = 0) -> List[Dict]:
    """
    Enhanced bank activity schedule that provides more realistic bank operating hours
    and can be influenced by real bank status data.
    
    Returns List[Dict] instead of List[BankActivityHour] to avoid Pydantic validation issues.
    """
    try:
        # Try to get data from bank_activity_predictor first
        schedule = get_daily_activity_schedule(day_offset=day_offset)
        
        # If we get data, convert BankActivityHour objects to dictionaries
        if schedule:
            return [{"hour": hour_obj.hour, "isActive": hour_obj.isActive} for hour_obj in schedule]
    except Exception as e:
        logger.warning(f"Could not get schedule from bank_activity_predictor: {e}")
    
    # Fallback: Create a realistic banking schedule as dictionaries
    current_time = datetime.now() + timedelta(days=day_offset)
    current_hour = current_time.hour
    
    # Define typical banking hours (9 AM to 5 PM are most active)
    banking_hours = {
        0: False,   # 12 AM - 1 AM
        1: False,   # 1 AM - 2 AM
        2: False,   # 2 AM - 3 AM
        3: False,   # 3 AM - 4 AM
        4: False,   # 4 AM - 5 AM
        5: False,   # 5 AM - 6 AM
        6: True,    # 6 AM - 7 AM (Early banking)
        7: True,    # 7 AM - 8 AM
        8: True,    # 8 AM - 9 AM
        9: True,    # 9 AM - 10 AM (Peak hours)
        10: True,   # 10 AM - 11 AM (Peak hours)
        11: True,   # 11 AM - 12 PM (Peak hours)
        12: True,   # 12 PM - 1 PM (Peak hours)
        13: True,   # 1 PM - 2 PM (Peak hours)
        14: True,   # 2 PM - 3 PM (Peak hours)
        15: True,   # 3 PM - 4 PM (Peak hours)
        16: True,   # 4 PM - 5 PM (Peak hours)
        17: True,   # 5 PM - 6 PM
        18: False,  # 6 PM - 7 PM
        19: False,  # 7 PM - 8 PM
        20: False,  # 8 PM - 9 PM
        21: False,  # 9 PM - 10 PM
        22: False,  # 10 PM - 11 PM
        23: False,  # 11 PM - 12 AM
    }
    
    # Add some dynamic behavior based on current time
    schedule = []
    for hour in range(24):
        is_active = banking_hours[hour]
        
        # Add some variation: if it's currently this hour, make it more likely to be active
        if hour == current_hour and not is_active:
            # 30% chance to be active even during off hours (for ATMs, online banking, etc.)
            import random
            is_active = random.random() < 0.3
        
        # Return as dictionary instead of BankActivityHour object
        schedule.append({"hour": hour, "isActive": is_active})
    
    return schedule

# --- Bank Server Monitor Agent Logic ---
class BankServerMonitorAgent:
    def __init__(self):
        self.producer_conf = {'bootstrap.servers': KAFKA_BROKER_URL}
        self.producer = Producer(self.producer_conf)
        logger.info(f"BankServerMonitorAgent Kafka Producer configured for brokers: {KAFKA_BROKER_URL}")

    def delivery_report(self, err, msg):
        if err is not None:
            logger.error(f'Message delivery failed for {msg.key()}: {err}')
        else:
            logger.info(f'Message for bank {msg.key().decode("utf-8")} delivered to {msg.topic()} [{msg.partition()}] at offset {msg.offset()}')

    def fetch_all_bank_statuses(self) -> Dict[str, str]:
        try:
            response = requests.get(BANK_SIMULATOR_URL)
            response.raise_for_status()
            data = response.json()
            statuses = {}
            if 'banks' in data:
                for bank_id in MONITORED_BANKS:
                    if bank_id in data['banks']:
                        simulator_status = data['banks'][bank_id].get('status', 'inactive').lower()
                        statuses[bank_id] = "up" if simulator_status == "active" else "down"
                    else:
                        logger.warning(f"Bank ID {bank_id} not found in simulator response. Defaulting to 'down'.")
                        statuses[bank_id] = "down"
            else:
                logger.error("Bank simulator response does not contain 'banks' key.")
            return statuses
        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching bank statuses from simulator: {e}")
            return {bank_id: "down" for bank_id in MONITORED_BANKS}
        except json.JSONDecodeError:
            logger.error("Error decoding JSON from bank simulator response.")
            return {bank_id: "down" for bank_id in MONITORED_BANKS}

    def publish_bank_status(self, bank_id: str, status: str):
        message = BankStatusMessage(
            bank_id=bank_id,
            status=status,
            timestamp=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        )
        try:
            self.producer.produce(
                BANK_SERVER_TOPIC,
                key=bank_id.encode('utf-8'),
                value=message.model_dump_json().encode('utf-8'),
                callback=self.delivery_report
            )
            logger.debug(f"Published bank status: {message.model_dump_json()}")
        except Exception as e:
            logger.error(f"Error publishing bank status for {bank_id}: {e}")

    async def run_monitoring_loop(self):
        logger.info("BankServerMonitorAgent monitoring loop started.")
        try:
            while True:
                all_bank_statuses = self.fetch_all_bank_statuses()
                if not all_bank_statuses:
                    logger.warning("No bank statuses fetched. Retrying in next cycle.")
                else:
                    for bank_id, status in all_bank_statuses.items():
                        logger.info(f"Fetched status for {bank_id}: {status}")
                        self.publish_bank_status(bank_id, status)
                    self.producer.poll(0) # Process Kafka callbacks

                self.producer.flush() # Ensure messages are sent
                await asyncio.sleep(FETCH_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            logger.info("BankServerMonitorAgent monitoring loop was cancelled.")
        except Exception as e:
            logger.error(f"An unexpected error occurred in BankServerMonitorAgent monitoring loop: {e}", exc_info=True)
        finally:
            self.producer.flush()
            logger.info("BankServerMonitorAgent monitoring loop shut down.")

# --- FastAPI Application ---
bank_monitor_agent = BankServerMonitorAgent()
monitoring_task = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global monitoring_task
    logger.info("Agent 1 FastAPI application starting up...")
    # Start the bank monitoring loop as a background task
    monitoring_task = asyncio.create_task(bank_monitor_agent.run_monitoring_loop())
    yield
    logger.info("Agent 1 FastAPI application shutting down...")
    if monitoring_task:
        monitoring_task.cancel()
        try:
            await monitoring_task
        except asyncio.CancelledError:
            logger.info("Monitoring task successfully cancelled.")
    logger.info("Agent 1 shutdown complete.")

app = FastAPI(
    title="Agent 1: Bank Server Monitor & Activity API",
    description="Monitors bank server statuses and provides bank activity information.",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all origins for simplicity
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/", summary="Health Check")
async def root():
    return {
        "message": "Agent 1: Bank Server Monitor & Activity API is running.",
        "kafka_broker": KAFKA_BROKER_URL,
        "kafka_topic": BANK_SERVER_TOPIC,
        "bank_simulator_url": BANK_SIMULATOR_URL,
        "monitoring_status": "active" if monitoring_task and not monitoring_task.done() else "inactive",
        "current_time": datetime.now().isoformat()
    }

@app.get("/bank-activity-schedule", response_model=BankActivityScheduleResponse, summary="Get Bank Activity Schedule")
async def get_activity_schedule(day_offset: int = 0):
    """
    Provides the bank's activity schedule for a given day.
    - `day_offset`: 0 for today, 1 for tomorrow, -1 for yesterday, etc.
    """
    try:
        # Get schedule as list of dictionaries
        schedule_dicts = get_enhanced_daily_activity_schedule(day_offset=day_offset)
        
        # Create response with proper data structure
        response = BankActivityScheduleResponse(
            schedule=schedule_dicts,  # Pydantic will convert these dicts to BankActivityHour objects
            lastUpdated=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        )
        return response
    except Exception as e:
        logger.error(f"Error generating bank activity schedule: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate bank activity schedule.")
    
# Add debug endpoint to test the schedule generation
@app.get("/debug/current-time")
async def get_current_time():
    """Debug endpoint to check current time and banking hours logic"""
    now = datetime.now()
    return {
        "current_time": now.isoformat(),
        "current_hour": now.hour,
        "is_typical_banking_hour": 9 <= now.hour <= 17,
        "sample_schedule": get_enhanced_daily_activity_schedule()[:5]  # First 5 hours
    }

if __name__ == '__main__':
    logger.info(f"Starting Agent 1 API server on port {AGENT1_PORT}")
    uvicorn.run(app, host="0.0.0.0", port=AGENT1_PORT)