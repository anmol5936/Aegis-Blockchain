import os
import json
import time
import random
import logging
import requests # Added for fetching bank status
from confluent_kafka import Producer
from dotenv import load_dotenv

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

KAFKA_BROKER_URL = os.getenv('KAFKA_BROKER_URL', 'localhost:9092')
BANK_SERVER_TOPIC = os.getenv('BANK_SERVER_TOPIC', 'bank_server')
# BANK_ID is no longer a single ID, but we'll fetch from a list of banks
BANK_SIMULATOR_URL = os.getenv('BANK_SIMULATOR_URL', 'http://localhost:5000/api/status') # URL for the bank simulator
MONITORED_BANKS = ["SBI", "Axis Bank", "ICICI Bank"] # Banks to monitor, these should match names in bank simulator

class BankServerMonitorAgent:
    def __init__(self):
        self.producer_conf = {'bootstrap.servers': KAFKA_BROKER_URL}
        self.producer = Producer(self.producer_conf)
        # self.bank_status = "down" # No longer a single status, fetched per bank
        logging.info(f"BankServerMonitorAgent initialized. Kafka Broker: {KAFKA_BROKER_URL}, Topic: {BANK_SERVER_TOPIC}, Simulator URL: {BANK_SIMULATOR_URL}")

    def delivery_report(self, err, msg):
        """ Called once for each message produced to indicate delivery result.
            Triggered by poll() or flush(). """
        if err is not None:
            logging.error(f'Message delivery failed for {msg.key() if msg.key() else "unknown bank"}: {err}')
        else:
            logging.info(f'Message for bank {msg.key().decode("utf-8") if msg.key() else "unknown bank"} delivered to {msg.topic()} [{msg.partition()}] at offset {msg.offset()}')

    def fetch_all_bank_statuses(self):
        """ Fetches status for all monitored banks from the simulator. """
        try:
            response = requests.get(BANK_SIMULATOR_URL)
            response.raise_for_status()  # Raise an exception for HTTP errors
            data = response.json()
            #The simulator returns status like: {"banks": {"SBI": {"status": "active", ...}, ...}}
            # We need to parse this to get individual bank statuses
            statuses = {}
            if 'banks' in data:
                for bank_id in MONITORED_BANKS:
                    if bank_id in data['banks']:
                        # Simulator status is "active" or "inactive", convert to "up" or "down"
                        simulator_status = data['banks'][bank_id].get('status', 'inactive').lower()
                        statuses[bank_id] = "up" if simulator_status == "active" else "down"
                    else:
                        logging.warning(f"Bank ID {bank_id} not found in simulator response. Defaulting to 'down'.")
                        statuses[bank_id] = "down" # Default if bank not in response
            else:
                logging.error("Bank simulator response does not contain 'banks' key.")
            return statuses
        except requests.exceptions.RequestException as e:
            logging.error(f"Error fetching bank statuses from simulator: {e}")
            # Return a default "down" status for all monitored banks in case of error
            return {bank_id: "down" for bank_id in MONITORED_BANKS}
        except json.JSONDecodeError:
            logging.error(f"Error decoding JSON from bank simulator response.")
            return {bank_id: "down" for bank_id in MONITORED_BANKS}


    def publish_bank_status(self, bank_id, status):
        """ Publishes the status for a specific bank to Kafka. """
        message = {
            "bank_id": bank_id,
            "status": status,
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        }
        try:
            self.producer.produce(
                BANK_SERVER_TOPIC,
                key=bank_id.encode('utf-8'), # Use bank_id as key for partitioning
                value=json.dumps(message).encode('utf-8'),
                callback=self.delivery_report
            )
            # self.producer.poll(0) # Trigger delivery report callbacks - better to poll after loop
            logging.info(f"Published bank status: {message}")
        except Exception as e:
            logging.error(f"Error publishing bank status for {bank_id}: {e}")

    def start(self):
        logging.info("BankServerMonitorAgent started.")
        try:
            while True:
                all_bank_statuses = self.fetch_all_bank_statuses()
                if not all_bank_statuses:
                    logging.warning("No bank statuses fetched. Retrying in next cycle.")
                else:
                    for bank_id, status in all_bank_statuses.items():
                        logging.info(f"Fetched status for {bank_id}: {status}")
                        self.publish_bank_status(bank_id, status)

                    self.producer.poll(0) # Trigger delivery report callbacks after producing all messages for this cycle

                # Flush messages every few iterations or after a certain time
                # For this agent, flushing after each message is fine given the low frequency
                self.producer.flush() # Ensure all messages for this cycle are sent
                time.sleep(random.randint(2, 3))  # Sleep for 15-30 seconds (reduced for more frequent updates)
        except KeyboardInterrupt:
            logging.info("BankServerMonitorAgent stopped by user.")
        except Exception as e:
            logging.error(f"An unexpected error occurred in BankServerMonitorAgent: {e}", exc_info=True)
        finally:
            # Wait for all messages in the Producer queue to be delivered.
            self.producer.flush()
            logging.info("BankServerMonitorAgent shut down.")

if __name__ == '__main__':
    agent = BankServerMonitorAgent()
    agent.start() 
