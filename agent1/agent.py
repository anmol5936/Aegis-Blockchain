import os
import json
import time
import random
import logging
from confluent_kafka import Producer
from dotenv import load_dotenv

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

KAFKA_BROKER_URL = os.getenv('KAFKA_BROKER_URL', 'localhost:9092')
BANK_SERVER_TOPIC = os.getenv('BANK_SERVER_TOPIC', 'bank_server')
BANK_ID = os.getenv('BANK_ID', 'bank_001')

class BankServerMonitorAgent:
    def __init__(self):
        self.producer_conf = {'bootstrap.servers': KAFKA_BROKER_URL}
        self.producer = Producer(self.producer_conf)
        self.bank_status = "down"  # Initial status
        logging.info(f"BankServerMonitorAgent initialized. Kafka Broker: {KAFKA_BROKER_URL}, Topic: {BANK_SERVER_TOPIC}, Bank ID: {BANK_ID}")

    def delivery_report(self, err, msg):
        """ Called once for each message produced to indicate delivery result.
            Triggered by poll() or flush(). """
        if err is not None:
            logging.error(f'Message delivery failed: {err}')
        else:
            logging.info(f'Message delivered to {msg.topic()} [{msg.partition()}] at offset {msg.offset()}')

    def simulate_bank_status(self):
        """ Simulates bank server status, randomly toggling it. """
        # Change status randomly
        if random.random() < 0.5: # Adjust probability as needed
            self.bank_status = "down" 
            logging.info(f"Bank status changed to: {self.bank_status}")
        else:
            logging.info(f"Bank status remains: {self.bank_status}")


    def publish_bank_status(self):
        """ Publishes the current bank status to Kafka. """
        message = {
            "bank_id": BANK_ID,
            "status": self.bank_status,
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        }
        try:
            self.producer.produce(
                BANK_SERVER_TOPIC,
                json.dumps(message).encode('utf-8'),
                callback=self.delivery_report
            )
            self.producer.poll(0) # Trigger delivery report callbacks
            logging.info(f"Published bank status: {message}")
        except Exception as e:
            logging.error(f"Error publishing bank status: {e}")

    def start(self):
        logging.info("BankServerMonitorAgent started.")
        try:
            while True:
                self.simulate_bank_status()
                self.publish_bank_status()
                # Flush messages every few iterations or after a certain time
                # For this agent, flushing after each message is fine given the low frequency
                self.producer.flush()
                time.sleep(random.randint(30, 60))  # Sleep for 30-60 seconds
        except KeyboardInterrupt:
            logging.info("BankServerMonitorAgent stopped by user.")
        except Exception as e:
            logging.error(f"An unexpected error occurred in BankServerMonitorAgent: {e}")
        finally:
            # Wait for all messages in the Producer queue to be delivered.
            self.producer.flush()
            logging.info("BankServerMonitorAgent shut down.")

if __name__ == '__main__':
    agent = BankServerMonitorAgent()
    agent.start()
