import os
import json
import time
import logging
import threading
import redis  # For Redis queue
import aiohttp # Added for Agent 3 integration
import asyncio # Added for Agent 3 integration
from confluent_kafka import Producer, Consumer, KafkaError
from dotenv import load_dotenv
from web3 import Web3, HTTPProvider
from web3.contract import Contract # Not directly used, can be removed if Contract type hint not needed
from typing import Dict, Optional # Keep Optional, Dict

load_dotenv()

# Environment variables
AGENT3_API_URL = os.getenv('AGENT3_API_URL', 'http://localhost:8001')

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('agent2.log')
    ]
)
logger = logging.getLogger(__name__)

# Environment variables
KAFKA_BROKER_URL = os.getenv('KAFKA_BROKER_URL', 'localhost:9092')
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
ETH_PROVIDER_URL = os.getenv('ETH_PROVIDER_URL', 'http://127.0.0.1:7545')
POOL_FACTORY_ADDRESS = os.getenv('VITE_POOL_FACTORY_ADDRESS')
STAKING_TOKEN_ADDRESS = os.getenv('VITE_STAKING_TOKEN_ADDRESS')

# Kafka Topics & Redis Queues
BANK_SERVER_TOPIC = os.getenv('BANK_SERVER_TOPIC', 'bank_server')
TRANSACTION_REQUESTS_QUEUE = os.getenv('TRANSACTION_REQUESTS_QUEUE', 'transaction_requests')
BANK_TX_PROCESSING_TOPIC = os.getenv('BANK_TX_PROCESSING_TOPIC', 'bank_tx_processing')
RECOVERY_PAYMENTS_QUEUE = os.getenv('RECOVERY_PAYMENTS_QUEUE', 'Recovery_payments')
CREDIT_CARD_RECOVERY_TOPIC = os.getenv('CREDIT_CARD_RECOVERY_TOPIC', 'credit_card_recovery')
BANK_RECOVERY_TOPIC = os.getenv('BANK_RECOVERY_TOPIC', 'bank_recovery')
RECOVERY_STATUS_UPDATE_TOPIC = os.getenv('RECOVERY_STATUS_UPDATE_TOPIC', 'recovery_status_update')

# Load contract ABIs
try:
    POOL_FACTORY_ABI = json.load(open('../truffle-project/build/contracts/PoolFactory.json'))['abi']
    LIQUIDITY_POOL_ABI = json.load(open('../truffle-project/build/contracts/LiquidityPool.json'))['abi']
    ERC20_ABI = json.load(open('../truffle-project/build/contracts/ERC20.json'))['abi']
    LPERC20_ABI = json.load(open('../truffle-project/build/contracts/LPERC20.json'))['abi']
except FileNotFoundError as e:
    logger.error(f"Contract ABI file not found: {e}")
    raise

class TransactionRouterRecoveryAgent:
    def __init__(self):
        print("Agent 2 script started")
        # self.current_bank_status = "unknown" # Replaced by bank_statuses dictionary
        self.bank_statuses: Dict[str, str] = {} # Stores status for each bank_id
        self.bank_status_lock = threading.Lock() # To protect access to bank_statuses

        self.validate_pool_via_factory = os.getenv('VALIDATE_POOL_VIA_FACTORY', 'true').lower() == 'true'
        logger.info(f"Pool validation via PoolFactory: {self.validate_pool_via_factory}")

        # Initialize Kafka Producer
        self.producer_conf = {'bootstrap.servers': KAFKA_BROKER_URL}
        self.kafka_producer = Producer(self.producer_conf)
        logger.info(f"Kafka Producer initialized for broker: {KAFKA_BROKER_URL}")

        # Initialize Kafka Consumers
        self.consumer_conf = {
            'bootstrap.servers': KAFKA_BROKER_URL,
            'group.id': 'agent2_main_group',
            'auto.offset.reset': 'latest'
        }
        self.bank_status_consumer = Consumer(self.consumer_conf)
        self.bank_status_consumer.subscribe([BANK_SERVER_TOPIC])
        logger.info(f"Kafka Consumer subscribed to {BANK_SERVER_TOPIC}")

        self.recovery_status_consumer = Consumer(self.consumer_conf)
        self.recovery_status_consumer.subscribe([RECOVERY_STATUS_UPDATE_TOPIC])
        logger.info(f"Kafka Consumer subscribed to {RECOVERY_STATUS_UPDATE_TOPIC}")

        # Initialize Redis
        try:
            self.redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=0, decode_responses=True)
            self.redis_client.ping()
            logger.info(f"Redis client connected to {REDIS_HOST}:{REDIS_PORT}")
        except redis.exceptions.ConnectionError as e:
            logger.error(f"Failed to connect to Redis: {str(e)}", exc_info=True)
            self.redis_client = None

        # Initialize Web3 provider
        try:
            self.w3 = Web3(HTTPProvider(ETH_PROVIDER_URL))
            logger.info(f"Attempting to connect to Ethereum provider at {ETH_PROVIDER_URL}")
            if not self.w3.is_connected():
                raise ConnectionError("Failed to connect to Ethereum provider")
            logger.info(f"Connected to Ethereum provider at {ETH_PROVIDER_URL}")
        except Exception as e:
            logger.error(f"Failed to initialize Web3 provider: {str(e)}", exc_info=True)
            self.w3 = None

        # Initialize signer
        try:
            accounts = self.w3.eth.accounts
            if not accounts:
                raise ValueError("No accounts available in Ganache")
            self.signer_address = accounts[0]
            logger.info(f"Using Ganache account: {self.signer_address}")
        except Exception as e:
            logger.error(f"Failed to initialize signer: {str(e)}", exc_info=True)
            self.signer_address = None

        # Initialize contracts
        try:
            if not POOL_FACTORY_ADDRESS or not STAKING_TOKEN_ADDRESS:
                raise ValueError("POOL_FACTORY_ADDRESS or STAKING_TOKEN_ADDRESS not set")
            self.pool_factory_contract = self.w3.eth.contract(address=Web3.to_checksum_address(POOL_FACTORY_ADDRESS), abi=POOL_FACTORY_ABI)
            self.staking_token_contract = self.w3.eth.contract(address=Web3.to_checksum_address(STAKING_TOKEN_ADDRESS), abi=ERC20_ABI)
            logger.info(f"Contracts initialized: PoolFactory={POOL_FACTORY_ADDRESS}, StakingToken={STAKING_TOKEN_ADDRESS}")
        except Exception as e:
            logger.error(f"Failed to initialize contracts: {str(e)}", exc_info=True)
            self.pool_factory_contract = None
            self.staking_token_contract = None

        self.signer_address = os.getenv('SIGNER_ADDRESS')
        self.signer_private_key = os.getenv('SIGNER_PRIVATE_KEY')
        if not self.signer_address or not self.signer_private_key:
            raise ValueError("Signer address or private key not set in .env")
        self.token_decimals = self.staking_token_contract.functions.decimals().call()
        logger.info(f"Staking token decimals: {self.token_decimals}")
        eth_balance = self.w3.eth.get_balance(self.signer_address)
        token_balance = self.staking_token_contract.functions.balanceOf(self.signer_address).call()
        logger.info(f"Signer ETH balance: {self.w3.from_wei(eth_balance, 'ether')} ETH, Token balance: {token_balance / 10**self.token_decimals}")

    def get_specific_bank_status(self, bank_id: str) -> str:
        """Gets the status for a specific bank_id, defaults to 'unknown'."""
        with self.bank_status_lock:
            return self.bank_statuses.get(bank_id, "unknown")

    def set_bank_status(self, bank_id: str, status: str):
        """Sets the status for a specific bank_id."""
        with self.bank_status_lock:
            if self.bank_statuses.get(bank_id) != status:
                self.bank_statuses[bank_id] = status.lower()
                logger.info(f"Bank status updated for {bank_id}: {status.lower()}")
            else:
                logger.debug(f"Bank status for {bank_id} remains {status.lower()}")

    def delivery_report(self, err, msg):
        if err is not None:
            logger.error(f'Message delivery failed for topic {msg.topic()}: {err}')
        else:
            logger.info(f'Message delivered to {msg.topic()} [{msg.partition()}] at offset {msg.offset}')

    def _approve_tokens(self, spender_address: str, amount: int, tx_id: str) -> Optional[str]:
        """Approve tokens for spending by the LiquidityPool."""
        missing_components = []
        if not self.staking_token_contract:
            missing_components.append("staking_token_contract")
        if not self.w3:
            missing_components.append("w3")
        if not self.signer_address:
            missing_components.append("signer_address")
        if not self.signer_private_key:
            missing_components.append("signer_private_key")
        if missing_components:
            logger.error(f"Missing components for {tx_id}: {missing_components}")
            return None

        try:
            spender_address = Web3.to_checksum_address(spender_address)
            # Check signer ETH balance
            eth_balance = self.w3.eth.get_balance(self.signer_address)
            min_eth_required = self.w3.to_wei(0.01, 'ether')
            if eth_balance < min_eth_required:
                logger.error(f"Insufficient ETH balance for {tx_id}: {self.w3.from_wei(eth_balance, 'ether')} ETH < {self.w3.from_wei(min_eth_required, 'ether')} ETH")
                return None

            # Check current allowance
            current_allowance = self.staking_token_contract.functions.allowance(self.signer_address, spender_address).call()
            if current_allowance >= amount:
                logger.info(f"Sufficient allowance already exists for {tx_id}: {current_allowance} >= {amount}")
                return "0x0"  # Dummy hash for no approval needed

            # Build transaction
            tx = self.staking_token_contract.functions.approve(spender_address, amount).build_transaction({
                'from': self.signer_address,
                'nonce': self.w3.eth.get_transaction_count(self.signer_address),
                'gasPrice': self.w3.eth.gas_price,
            })
            # Estimate gas
            gas_estimate = self.w3.eth.estimate_gas(tx)
            tx['gas'] = int(gas_estimate * 1.2)  # 20% buffer
            logger.debug(f"Gas estimate for {tx_id}: {gas_estimate}, using {tx['gas']} with gas price {self.w3.from_wei(tx['gasPrice'], 'gwei')} Gwei")

            # Sign and send transaction
            signed_tx = self.w3.eth.account.sign_transaction(tx, private_key=self.signer_private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)  # Fixed: raw_transaction
            logger.info(f"Approval transaction sent for {tx_id}: {tx_hash.hex()}")

            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            if receipt.status == 1:
                logger.info(f"Approval transaction confirmed for {tx_id}: {tx_hash.hex()}")
                return tx_hash.hex()
            else:
                logger.error(f"Approval transaction failed for {tx_id}: {receipt}")
                return None
        except ValueError as e:
            if "execution reverted" in str(e):
                logger.error(f"Approval transaction reverted for {tx_id}: {e}", exc_info=True)
            else:
                logger.error(f"Invalid transaction parameters for {tx_id}: {e}", exc_info=True)
            return None
        except Exception as e:
            logger.error(f"Failed to approve tokens for {tx_id}: {e}", exc_info=True)
            return None

    def _get_liquidity_pool_contract(self, pool_id: str) -> Optional['Web3.eth.contract.Contract']:
        if not self.w3:
            logger.error("Web3 not initialized")
            return None
        try:
            pool_id = Web3.to_checksum_address(pool_id)
            # Directly instantiate LiquidityPool contract
            pool_contract = self.w3.eth.contract(address=pool_id, abi=LIQUIDITY_POOL_ABI)
            logger.debug(f"Instantiated LiquidityPool contract at {pool_id}")

            # Optional validation via PoolFactory
            if self.validate_pool_via_factory and self.pool_factory_contract:
                try:
                    factory_pool_address = self.pool_factory_contract.functions.pools(pool_id).call()
                    if factory_pool_address == "0x0000000000000000000000000000000000000000":
                        logger.warning(f"Pool {pool_id} not registered in PoolFactory")
                    elif factory_pool_address.lower() != pool_id.lower():
                        logger.error(f"PoolFactory returned different address {factory_pool_address} for pool_id {pool_id}")
                        return None
                    logger.debug(f"Pool {pool_id} validated via PoolFactory")
                except Exception as e:
                    logger.warning(f"Failed to validate pool {pool_id} via PoolFactory: {e}")

            # Verify contract supports stake function (minimal check)
            if not hasattr(pool_contract.functions, 'stake'):
                logger.error(f"Contract at {pool_id} does not have stake function in ABI")
                return None

            # Optional: Try a safe getter to verify contract (e.g., owner or totalStaked)
            try:
                # Replace stakingToken with a known getter, or skip if none available
                # Example: pool_contract.functions.owner().call()
                logger.debug(f"Contract at {pool_id} passed minimal verification")
            except Exception as e:
                logger.warning(f"Optional contract verification failed for {pool_id}: {e}")

            logger.info(f"Retrieved LiquidityPool contract at {pool_id}")
            return pool_contract
        except ValueError as e:
            logger.error(f"Invalid pool_id format: {pool_id}: {e}")
            return None
        except Exception as e:
            logger.error(f"Error fetching LiquidityPool for {pool_id}: {e}", exc_info=True)
            return None

    def _send_blockchain_transaction(self, contract_function, function_args: dict, tx_id: str) -> Optional[str]:
        """Send a blockchain transaction for the given contract function."""
        if not self.w3 or not self.signer_address or not self.signer_private_key:
            logger.error(f"Web3, signer address, or private key not initialized for {tx_id}")
            return None

        try:
            # Check signer ETH balance
            eth_balance = self.w3.eth.get_balance(self.signer_address)
            min_eth_required = self.w3.to_wei(0.1, 'ether')  # Increased to 0.1 ETH
            if eth_balance < min_eth_required:
                logger.error(f"Insufficient ETH balance for {tx_id}: {self.w3.from_wei(eth_balance, 'ether')} ETH < {self.w3.from_wei(min_eth_required, 'ether')} ETH")
                return None

            # Get function name
            function_name = contract_function.fn_name
            logger.debug(f"Building transaction for function: {function_name} with args: {function_args}")

            # Build transaction based on function
            if function_name == 'fallbackPay' and 'merchantAddress' in function_args and 'amount' in function_args:
                tx = contract_function(function_args['merchantAddress'], function_args['amount']).build_transaction({
                    'from': self.signer_address,
                    'nonce': self.w3.eth.get_transaction_count(self.signer_address),
                    'gasPrice': self.w3.eth.gas_price,
                })
            elif function_name == 'stake' and 'amount' in function_args:
                tx = contract_function(function_args['amount']).build_transaction({
                    'from': self.signer_address,
                    'nonce': self.w3.eth.get_transaction_count(self.signer_address),
                    'gasPrice': self.w3.eth.gas_price,
                })
            elif function_name == 'createPool' and 'regionName' in function_args:
                tx = contract_function(function_args['regionName']).build_transaction({
                    'from': self.signer_address,
                    'nonce': self.w3.eth.get_transaction_count(self.signer_address),
                    'gasPrice': self.w3.eth.gas_price,
                })
            elif function_name == 'unstakeFromPool' and 'poolAddress' in function_args and 'lpTokens' in function_args:
                # Correctly call with poolAddress and lpTokens
                tx = contract_function(
                    Web3.to_checksum_address(function_args['poolAddress']),
                    function_args['lpTokens']
                ).build_transaction({
                    'from': self.signer_address,
                    'nonce': self.w3.eth.get_transaction_count(self.signer_address),
                    'gasPrice': self.w3.eth.gas_price,
                })
            else:
                logger.error(f"Unsupported function {function_name} or invalid parameters for {tx_id}: {function_args}")
                return None

            # Estimate gas
            gas_estimate = self.w3.eth.estimate_gas(tx)
            tx['gas'] = int(gas_estimate * 1.2)  # 20% buffer
            logger.debug(f"Gas estimate for {tx_id}: {gas_estimate}, using {tx['gas']} with gas price {self.w3.from_wei(tx['gasPrice'], 'gwei')} Gwei")

            # Sign and send transaction
            signed_tx = self.w3.eth.account.sign_transaction(tx, private_key=self.signer_private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            logger.info(f"Transaction sent for {tx_id}: {tx_hash.hex()}")

            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            if receipt.status == 1:
                logger.info(f"Transaction confirmed for {tx_id}: {tx_hash.hex()}")
                return tx_hash.hex()
            else:
                logger.error(f"Transaction failed for {tx_id}: {receipt}")
                return None
        except ValueError as e:
            if "execution reverted" in str(e):
                logger.error(f"Transaction reverted for {tx_id}: {e}", exc_info=True)
            else:
                logger.error(f"Invalid transaction parameters for {tx_id}: {e}", exc_info=True)
            return None
        except Exception as e:
            logger.error(f"Failed to send transaction {tx_id}: {e}", exc_info=True)
            return None

    def _listen_for_bank_status(self):
        logger.info(f"Starting bank status listener on topic: {BANK_SERVER_TOPIC}")
        try:
            while True:
                msg = self.bank_status_consumer.poll(timeout=1.0)
                if msg is None: continue
                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF: continue
                    else:
                        logger.error(f"Kafka error in bank_status_consumer: {msg.error()}")
                        time.sleep(5)
                else:
                    try:
                        data = json.loads(msg.value().decode('utf-8'))
                        logger.debug(f"Received bank status raw message: {data}")
                        bank_id = data.get("bank_id")
                        status = data.get("status")
                        if bank_id and status:
                            self.set_bank_status(bank_id, status.lower())
                        else:
                            logger.warning(f"Bank status message missing 'bank_id' or 'status' field: {data}")
                    except Exception as e:
                        logger.error(f"Error processing bank_status message: {e}")
        except Exception as e:
            logger.error(f"Exception in _listen_for_bank_status: {e}", exc_info=True)
        finally:
            self.bank_status_consumer.close()

    def _listen_for_recovery_updates(self):
        logger.info(f"Starting recovery status listener on topic: {RECOVERY_STATUS_UPDATE_TOPIC}")
        try:
            while True:
                msg = self.recovery_status_consumer.poll(timeout=1.0)
                if msg is None: continue
                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF: continue
                    else:
                        logger.error(f"Kafka error in recovery_status_consumer: {msg.error()}")
                        time.sleep(5)
                else:
                    try:
                        update_data = json.loads(msg.value().decode('utf-8'))
                        logger.info(f"Received recovery status update: {update_data}")
                        recovery_id = update_data.get("recovery_id")
                        status = update_data.get("status")
                        if recovery_id and status == "completed":
                            logger.info(f"Recovery ID {recovery_id} processed as completed based on update.")
                    except Exception as e:
                        logger.error(f"Error processing recovery_status_update message: {e}")
        except Exception as e:
            logger.error(f"Exception in _listen_for_recovery_updates: {e}", exc_info=True)
        finally:
            self.recovery_status_consumer.close()

    def process_transaction_requests(self):
        if not self.redis_client:
            logger.error("Redis client NA. Transaction processing halted.")
            return
        logger.info(f"Starting transaction_requests processor on Redis queue: {TRANSACTION_REQUESTS_QUEUE}")
        while True:
            try:
                message_tuple = self.redis_client.blpop([TRANSACTION_REQUESTS_QUEUE], timeout=5)
                if not message_tuple:
                    continue

                _, message_json = message_tuple
                logger.info(f"Dequeued transaction: {message_json}")
                transaction_data = json.loads(message_json)
                tx_id = transaction_data.get('transaction_id', 'N/A')
                selected_bank = transaction_data.get('selected_bank') # Get the specific bank for this transaction
                user_id = transaction_data.get('user_id')

                if not selected_bank:
                    logger.warning(f"Transaction {tx_id} for user {user_id} missing 'selected_bank'. Cannot determine bank status. Re-queueing.")
                    self.redis_client.rpush(TRANSACTION_REQUESTS_QUEUE, message_json) # Re-queue if no bank info
                    time.sleep(5)
                    continue

                specific_bank_status = self.get_specific_bank_status(selected_bank)
                logger.info(f"Processing tx {tx_id} for bank '{selected_bank}'. Bank status: {specific_bank_status}")

                user_geo_location_data = transaction_data.get('user_geo_location')
                primary_fallback_pool_from_request = transaction_data.get("primary_pool_id_for_fallback")

                if specific_bank_status == "up":
                    self.kafka_producer.produce(BANK_TX_PROCESSING_TOPIC, json.dumps(transaction_data).encode('utf-8'), callback=self.delivery_report)
                    logger.info(f"Tx {tx_id} for bank '{selected_bank}' routed to {BANK_TX_PROCESSING_TOPIC} for user {user_id}")
                elif specific_bank_status == "down":
                    logger.info(f"Bank '{selected_bank}' is DOWN. Attempting fallback or queuing for recovery for tx {tx_id} of user {user_id}.")

                    # Option 1: Try fallback first. If fallback is not applicable or fails, then queue for recovery.
                    # For now, let's assume if bank is down, we queue for later bank processing via RECOVERY_PAYMENTS_QUEUE
                    # and also attempt fallback. The problem description implies recovery happens after fallback if bank is still down.
                    # Let's simplify: if bank is down, we push to recovery queue. Fallback is a separate path.
                    # The user request: "suppose the payment goes to fallback and in redis transaction is store when bank goe goes up agent 2 will do that repayment"
                    # This implies that after a fallback attempt (or instead of a direct bank attempt if bank is down), it should be in Redis for Agent 2.
                    # The `RECOVERY_PAYMENTS_QUEUE` seems the right place.

                    # Add to recovery queue
                    # Ensure the recovery data has a 'method' field, if process_recovery_payments expects it.
                    # Based on process_recovery_payments, it looks for 'method' like 'bank_account'.
                    recovery_payload = transaction_data.copy() # Avoid modifying the original dict if it's re-used
                    recovery_payload['method'] = 'bank_account' # Assuming this is the method for bank payments
                    recovery_payload['recovery_id'] = tx_id # Use transaction_id as recovery_id

                    # Ensure all necessary fields for recovery are present.
                    # 'selected_bank' is already in transaction_data from initiatePayment.

                    self.redis_client.lpush(RECOVERY_PAYMENTS_QUEUE, json.dumps(recovery_payload))
                    logger.info(f"Tx {tx_id} for bank '{selected_bank}' (user {user_id}) queued to {RECOVERY_PAYMENTS_QUEUE} because bank is down.")

                    # Fallback logic (kept from original, but now bank-down also queues for later bank processing)
                    # Fallback should still be attempted as per original logic, even if we've queued for bank recovery.
                    logger.info(f"Attempting blockchain fallback for tx {tx_id} of user {user_id} as bank '{selected_bank}' is down.")
                    effective_pool_id = primary_fallback_pool_from_request  # Default
                    if user_geo_location_data:
                        logger.info(f"Attempting to get optimal pool from Agent 3 for user {user_id} with geo {user_geo_location_data}")
                        optimal_pool_from_agent3 = self.get_optimal_pool_from_agent3(user_geo_location_data)
                        if optimal_pool_from_agent3:
                            logger.info(f"Agent 3 recommended pool: {optimal_pool_from_agent3} for user {user_id}")
                            effective_pool_id = optimal_pool_from_agent3
                        else:
                            logger.warning(f"Agent 3 did not provide an optimal pool. Falling back to primary_pool_id_for_fallback: {primary_fallback_pool_from_request} for user {user_id}")
                    else:
                        logger.warning(f"No geolocation data provided for user {user_id}. Using primary_pool_id_for_fallback: {primary_fallback_pool_from_request}")

                    pool_id_for_fallback = effective_pool_id
                    # Hardcode merchant address
                    merchant_address = "0xae6fE3971850928c94C8638cC1E83dA4F155cB47"
                    amount = transaction_data.get("amount")

                    if not all([pool_id_for_fallback, merchant_address, amount]):
                        logger.error(f"Missing critical params for fallback (tx {tx_id}, user {user_id}). PoolID: {pool_id_for_fallback}, Merchant: {merchant_address}, Amount: {amount}. Data: {transaction_data}")
                        continue

                    try:
                        # Validate pool ID
                        if not Web3.is_address(pool_id_for_fallback):
                            logger.error(f"Invalid primary_pool_id_for_fallback: {pool_id_for_fallback} for tx {tx_id}")
                            continue
                        pool_id_for_fallback = Web3.to_checksum_address(pool_id_for_fallback)

                        # Validate merchant address
                        merchant_address = Web3.to_checksum_address(merchant_address)

                        # Get token decimals and convert amount
                        decimals = self.staking_token_contract.functions.decimals().call()
                        amount_wei = int(float(amount) * 10**decimals)  # Convert to Wei based on token decimals

                        # Get LiquidityPool contract instance
                        pool_contract_for_fallback = self._get_liquidity_pool_contract(pool_id_for_fallback)
                        if not pool_contract_for_fallback:
                            logger.error(f"Failed to get LiquidityPool contract instance for fallback pool {pool_id_for_fallback} (tx {tx_id}, user {user_id}). Skipping fallback.")
                            continue

                        # Check token balance
                        user_balance = self.staking_token_contract.functions.balanceOf(self.signer_address).call()
                        if user_balance < amount_wei:
                            logger.error(f"Insufficient token balance for tx {tx_id}: {user_balance / 10**decimals} tokens, required: {amount_wei / 10**decimals} tokens")
                            continue

                        # Check token allowance
                        current_allowance = self.staking_token_contract.functions.allowance(self.signer_address, pool_id_for_fallback).call()
                        if current_allowance < amount_wei:
                            logger.info(f"Insufficient allowance for tx {tx_id}: {current_allowance / 10**decimals} tokens, approving {amount_wei / 10**decimals} tokens")
                            approve_tx_hash = self._approve_tokens(pool_id_for_fallback, amount_wei, tx_id)
                            if approve_tx_hash is None:
                                logger.error(f"Failed to approve tokens for tx {tx_id}")
                                continue
                            logger.info(f"Token approval successful for tx {tx_id}: {approve_tx_hash}")

                        # Prepare parameters for fallbackPay
                        params_for_lp_fallback = {
                            'merchantAddress': merchant_address,
                            'amount': amount_wei
                        }
                        logger.info(f"Calling fallbackPay on LiquidityPool {pool_id_for_fallback} for tx {tx_id} (user {user_id}) with params: {params_for_lp_fallback}")

                        # Simulate fallbackPay to catch issues
                        try:
                            pool_contract_for_fallback.functions.fallbackPay(merchant_address, amount_wei).call({'from': self.signer_address})
                            logger.debug(f"FallbackPay simulation successful for tx {tx_id}")
                        except Exception as e:
                            logger.error(f"FallbackPay simulation failed for tx {tx_id}: {e}")
                            continue

                        # Send transaction
                        tx_hash = self._send_blockchain_transaction(
                            pool_contract_for_fallback.functions.fallbackPay,
                            params_for_lp_fallback,
                            tx_id
                        )

                        if tx_hash:
                            logger.info(f"Fallback transaction {tx_id} for user {user_id} initiated with hash: {tx_hash} via LiquidityPool {pool_id_for_fallback}")
                        else:
                            logger.error(f"Fallback transaction {tx_id} for user {user_id} failed to send via LiquidityPool {pool_id_for_fallback}")

                    except ValueError as e:
                        logger.error(f"Invalid parameter format for fallback tx {tx_id} (user {user_id}): {e}. Pool: {pool_id_for_fallback}", exc_info=True)
                    except Exception as e:
                        logger.error(f"General error during fallback process for tx {tx_id} (user {user_id}): {e}. Pool: {pool_id_for_fallback}", exc_info=True)

                # Handle unknown status for the specific bank by re-queueing to the transaction_requests queue
                elif specific_bank_status == "unknown":
                    logger.warning(f"Bank status for '{selected_bank}' is '{specific_bank_status}' for tx {tx_id} (user {user_id}). Re-queueing to {TRANSACTION_REQUESTS_QUEUE}.")
                    self.redis_client.rpush(TRANSACTION_REQUESTS_QUEUE, message_json)
                    time.sleep(5) # Wait a bit before retrying

                self.kafka_producer.poll(0)
                self.kafka_producer.flush(timeout=1.0)
            except redis.exceptions.ConnectionError as e:
                logger.error(f"Redis error in transaction_requests: {e}. Reconnecting...")
                time.sleep(10)
                self._ensure_redis_connection()
            except json.JSONDecodeError as e:
                logger.error(f"Bad JSON in transaction_requests: {message_json}, error: {e}")
            except Exception as e:
                logger.error(f"Error in process_transaction_requests for tx {tx_id}: {e}", exc_info=True)
                time.sleep(5)

    async def _fetch_optimal_pool_async(self, session, user_geo_location_data: Dict) -> Optional[str]:
        payload = {"userGeoLocation": user_geo_location_data}
        api_url = f"{AGENT3_API_URL}/findOptimalPool"
        logger.debug(f"Posting to Agent 3: URL='{api_url}', Payload='{payload}'")
        try:
            async with session.post(api_url, json=payload, timeout=10) as response:
                if response.status == 200:
                    data = await response.json()
                    logger.info(f"Agent 3 response: {data}")
                    if data.get("optimalPoolId"):
                        return data["optimalPoolId"]
                    else:
                        logger.warning(f"Agent 3 did not return an optimalPoolId: {data.get('error') or data.get('message')}")
                        return None
                else:
                    logger.error(f"Error calling Agent 3: Status {response.status}, Body: {await response.text()}")
                    return None
        except asyncio.TimeoutError:
            logger.error(f"Timeout calling Agent 3 ({api_url}) for optimal pool.")
            return None
        except aiohttp.ClientConnectorError as e:
            logger.error(f"Connection error calling Agent 3 ({api_url}): {e}")
            return None
        except Exception as e:
            logger.error(f"Exception calling Agent 3 ({api_url}): {e}", exc_info=True)
            return None

    def get_optimal_pool_from_agent3(self, user_geo_location: Optional[Dict]) -> Optional[str]:
        if not user_geo_location or not isinstance(user_geo_location, dict) or \
           "latitude" not in user_geo_location or "longitude" not in user_geo_location:
            logger.warning("Invalid or missing user_geo_location for Agent 3 query.")
            return None

        agent3_geo_payload = {
            "latitude": user_geo_location["latitude"],
            "longitude": user_geo_location["longitude"]
        }

        logger.info(f"Querying Agent 3 for optimal pool with geo-location: {agent3_geo_payload}")

        async def main_async_wrapper():
            async with aiohttp.ClientSession() as session:
                return await self._fetch_optimal_pool_async(session, agent3_geo_payload)

        try:
            # This simplified approach uses asyncio.run() which is generally fine for one-off calls
            # from a synchronous context (like the current threaded consumers).
            # It creates a new event loop to run the async task.
            return asyncio.run(main_async_wrapper())
        except RuntimeError as e:
            # This might happen if asyncio.run() is called from a thread that already has a running loop,
            # though less common with how these threads are typically structured.
            logger.error(f"RuntimeError calling Agent 3 (asyncio issue): {e}. This may indicate an event loop conflict.", exc_info=True)
            # Attempting to run in a new loop as a fallback, though the root cause might need investigation
            # if this path is frequently hit.
            # For a robust solution in complex async/sync interop, libraries like `nest_asyncio`
            # or careful loop management across threads would be needed.
            # For now, let's try with a new loop if `asyncio.run` fails due to specific RuntimeError.
            if "cannot call run while another loop is running" in str(e) or \
               "There is no current event loop in thread" in str(e): # More specific error checks
                logger.info("Attempting Agent 3 call with a new event loop due to RuntimeError.")
                new_loop = asyncio.new_event_loop()
                asyncio.set_event_loop(new_loop)
                try:
                    return new_loop.run_until_complete(main_async_wrapper())
                finally:
                    new_loop.close() # Important to close the manually created loop
            else: # Re-raise if it's a different RuntimeError
                raise
        except Exception as e:
            logger.error(f"Unexpected exception in get_optimal_pool_from_agent3: {e}", exc_info=True)
            return None


    def process_recovery_payments(self):
        if not self.redis_client:
            logger.error("Redis client NA. Recovery processing halted.")
            return
        logger.info(f"Starting recovery_payments processor on Redis queue: {RECOVERY_PAYMENTS_QUEUE}")
        while True:
            try:
                # This method processes payments that need bank interaction after potential initial failure or bank downtime.
                # It should check the specific bank's status before proceeding.

                message_tuple = self.redis_client.blpop([RECOVERY_PAYMENTS_QUEUE], timeout=5)
                if not message_tuple: continue

                _, message_json = message_tuple
                logger.info(f"Dequeued recovery payment: {message_json}")
                recovery_data = json.loads(message_json)

                rec_id = recovery_data.get("recovery_id") or recovery_data.get("transaction_id", "N/A")
                method = recovery_data.get("method", "").lower()
                selected_bank = recovery_data.get("selected_bank")

                if not selected_bank:
                    logger.warning(f"Recovery payment {rec_id} missing 'selected_bank'. Cannot process. Re-queueing.")
                    self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                    time.sleep(5)
                    continue

                specific_bank_status = self.get_specific_bank_status(selected_bank)
                logger.info(f"Processing recovery {rec_id} for bank '{selected_bank}' (method: {method}). Bank status: {specific_bank_status}")

                # Handle blockchain method separately as it's likely bank-agnostic
                if method == "blockchain":
                    pool_id = recovery_data.get("pool_id_for_unstake")
                    lp_tokens = recovery_data.get("lp_tokens_to_unstake")
                    if not all([pool_id, lp_tokens]):
                        logger.error(f"Missing params for blockchain unstake (rec {rec_id}). Data: {recovery_data}")
                        self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json) # Re-queue if params missing
                        time.sleep(1)
                        continue

                    if self.pool_factory_contract: # Check if contract is available
                        try:
                            # Ensure lp_tokens is float or int before w3.to_wei
                            lp_tokens_val = float(lp_tokens)
                            lp_tokens_wei = self.w3.to_wei(lp_tokens_val, 'ether')
                            params = {
                                # 'poolId': Web3.to_checksum_address(pool_id), # poolId is not part of unstakeFromPool in PoolFactory.sol
                                'lpTokens': lp_tokens_wei
                            }
                            # The function unstakeFromPool in PoolFactory.sol takes (address pool, uint256 lpTokens)
                            # So we need the pool_id for the first argument.
                            # Assuming pool_id here is the address of the LiquidityPool contract.
                            # Let's check the _send_blockchain_transaction, it builds based on function name and args.
                            # The original code called self.pool_factory_contract.functions.unstakeFromPool
                            # This function in PoolFactory.sol is: function unstakeFromPool(address pool, uint256 lpTokens)
                            # So, the params should be structured for this.
                            # The original code for 'blockchain' method in process_recovery_payments was trying to call unstakeFromPool on pool_factory_contract
                            # with params {'poolId': Web3.to_checksum_address(pool_id), 'lpTokens': lp_tokens_wei}
                            # This implies the contract_function itself would be `self.pool_factory_contract.functions.unstakeFromPool`
                            # and the arguments passed to it would be `(Web3.to_checksum_address(pool_id), lp_tokens_wei)`
                            # The _send_blockchain_transaction needs to be able to handle this.
                            # Let's look at _send_blockchain_transaction:
                            # elif function_name == 'unstakeFromPool' and 'lpTokens' in function_args:
                            #    tx = contract_function(function_args['lpTokens']).build_transaction(...)
                            # This is problematic if unstakeFromPool requires two args (pool_address, lpTokens)
                            # The original code for 'blockchain' recovery did this:
                            # tx_hash = self._send_blockchain_transaction(
                            #     self.pool_factory_contract.functions.unstakeFromPool, <--- This is the contract function object
                            #     params,  <-- This was {'poolId': ..., 'lpTokens': ...}
                            #     rec_id
                            # )
                            # This structure means `_send_blockchain_transaction` receives the function object and a dict of args.
                            # It then tries to call it.
                            # The issue is `unstakeFromPool` in `_send_blockchain_transaction` only uses `function_args['lpTokens']`.
                            # This needs to be fixed in `_send_blockchain_transaction` or how params are passed.
                            # For now, let's assume `_send_blockchain_transaction` is updated or we pass args directly.
                            # Given the current structure of _send_blockchain_transaction, it expects specific named args in function_args.
                            # The original code for blockchain recovery was:
                            # tx = contract_function(function_args['regionName']).build_transaction({ ... }) for createPool
                            # tx = contract_function(function_args['lpTokens']).build_transaction({ ... }) for unstakeFromPool
                            # This `unstakeFromPool` in `_send_blockchain_transaction` needs to accept `poolId` too.

                            # Let's make a minimal change here assuming _send_blockchain_transaction will be fixed later or can handle it.
                            # The most direct way is to call it as it was originally structured for this method.
                            tx_hash = self._send_blockchain_transaction(
                                self.pool_factory_contract.functions.unstakeFromPool,
                                {"poolAddress": Web3.to_checksum_address(pool_id), "lpTokens": lp_tokens_wei}, # Adjusted for clarity, but _send_blockchain_transaction needs to handle this
                                rec_id
                            )
                            if tx_hash:
                                logger.info(f"Blockchain unstake transaction {rec_id} initiated with hash: {tx_hash}")
                            else:
                                logger.error(f"Blockchain unstake transaction {rec_id} failed to send. Re-queueing.")
                                self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                        except ValueError as e: # Catch error from to_checksum_address or float conversion
                            logger.error(f"Invalid pool_id or lp_tokens format for blockchain unstake rec {rec_id}: {e}. Re-queueing.")
                            self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                        except Exception as e:
                            logger.error(f"Blockchain unstake transaction failed for rec {rec_id}: {e}. Re-queueing.", exc_info=True)
                            self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                    else:
                        logger.error(f"PoolFactory contract not initialized for blockchain unstake rec {rec_id}. Re-queueing.")
                        self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                    # After processing blockchain method, continue to next message.
                    self.kafka_producer.poll(0) # Poll after each message processing attempt
                    self.kafka_producer.flush(timeout=1.0)
                    continue # Move to the next message from queue

                # For other methods (credit_card, bank_account), check bank status
                if specific_bank_status == "up":
                    if method == "credit_card":
                        self.kafka_producer.produce(CREDIT_CARD_RECOVERY_TOPIC, json.dumps(recovery_data).encode('utf-8'), callback=self.delivery_report)
                        logger.info(f"Recovery {rec_id} (CC via bank '{selected_bank}') routed to {CREDIT_CARD_RECOVERY_TOPIC}")
                    elif method == "bank_account":
                        self.kafka_producer.produce(BANK_RECOVERY_TOPIC, json.dumps(recovery_data).encode('utf-8'), callback=self.delivery_report)
                        logger.info(f"Recovery {rec_id} (Bank '{selected_bank}') routed to {BANK_RECOVERY_TOPIC}")
                    else:
                        logger.warning(f"Unknown recovery method '{method}' for rec {rec_id} (bank '{selected_bank}'). Re-queueing.")
                        self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                        time.sleep(1)

                elif specific_bank_status == "down":
                    logger.info(f"Bank '{selected_bank}' is still DOWN for recovery tx {rec_id} (method: {method}). Re-queueing to {RECOVERY_PAYMENTS_QUEUE}.")
                    self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                    time.sleep(15)

                else: # specific_bank_status == "unknown"
                    logger.warning(f"Bank status for '{selected_bank}' is UNKNOWN for recovery tx {rec_id} (method: {method}). Re-queueing to {RECOVERY_PAYMENTS_QUEUE}.")
                    self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                    time.sleep(10)

                # This was the original position for blockchain processing.
                # if method == "blockchain":
                #     pool_id = recovery_data.get("pool_id_for_unstake")
                    lp_tokens = recovery_data.get("lp_tokens_to_unstake")
                    if not all([pool_id, lp_tokens]):
                        logger.error(f"Missing params for unstake (rec {rec_id}). Data: {recovery_data}")
                        self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                        continue
                    # Direct blockchain call
                    if self.pool_factory_contract:
                        try:
                            lp_tokens_wei = self.w3.to_wei(float(lp_tokens), 'ether')
                            params = {
                                'poolId': Web3.to_checksum_address(pool_id),
                                'lpTokens': lp_tokens_wei
                            }
                            tx_hash = self._send_blockchain_transaction(
                                self.pool_factory_contract.functions.unstakeFromPool,
                                params,
                                rec_id
                            )
                            if tx_hash:
                                logger.info(f"Unstake transaction {rec_id} initiated with hash: {tx_hash}")
                            else:
                                logger.error(f"Unstake transaction {rec_id} failed to send")
                        except ValueError as e:
                            logger.error(f"Invalid lp_tokens format for rec {rec_id}: {e}")
                        except Exception as e:
                            logger.error(f"Unstake transaction failed for rec {rec_id}: {e}", exc_info=True)
                    else:
                        logger.error(f"PoolFactory contract not initialized for rec {rec_id}")
                else:
                    logger.warning(f"Unknown recovery method '{method}' for rec {rec_id}. Re-queueing.")
                    self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)

                self.kafka_producer.poll(0)
                self.kafka_producer.flush(timeout=1.0)
            except redis.exceptions.ConnectionError as e:
                logger.error(f"Redis error in recovery_payments: {e}. Reconnecting...")
                time.sleep(10)
                self._ensure_redis_connection()
            except json.JSONDecodeError as e:
                logger.error(f"Bad JSON in recovery_payments: {message_json}, error: {e}")
            except Exception as e:
                logger.error(f"Error in process_recovery_payments: {e}", exc_info=True)
                time.sleep(5)

    def _ensure_redis_connection(self):
        if self.redis_client:
            try:
                self.redis_client.ping()
                return True
            except redis.exceptions.ConnectionError:
                logger.warning("Redis connection lost. Attempting to reconnect...")
        try:
            self.redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=0, decode_responses=True)
            self.redis_client.ping()
            logger.info("Successfully reconnected to Redis.")
            return True
        except redis.exceptions.ConnectionError as e:
            logger.error(f"Failed to reconnect to Redis: {e}")
            self.redis_client = None
            return False

    def start_all_threads(self):
        self.threads = []
        thread_map = {
            "_listen_for_bank_status": self._listen_for_bank_status,
            "_listen_for_recovery_updates": self._listen_for_recovery_updates,
            "process_transaction_requests": self.process_transaction_requests,
            "process_recovery_payments": self.process_recovery_payments,
        }
        for name, target_func in thread_map.items():
            thread = threading.Thread(target=target_func, daemon=True, name=name)
            self.threads.append(thread)
            thread.start()
            logger.info(f"Thread '{name}' started.")

        monitor = threading.Thread(target=self._monitor_threads, daemon=True, name="ThreadMonitor")
        monitor.start()
        logger.info("Thread monitor started.")

    def _monitor_threads(self):
        while True:
            time.sleep(30)
            for thread in self.threads:
                if not thread.is_alive():
                    logger.error(f"Thread '{thread.name}' is not alive. Attempting to restart.")
                    new_thread = threading.Thread(target=thread._target, daemon=True, name=thread.name)
                    try:
                        new_thread.start()
                        self.threads.remove(thread)
                        self.threads.append(new_thread)
                        logger.info(f"Thread '{thread.name}' restarted.")
                    except Exception as e:
                        logger.error(f"Failed to restart thread '{thread.name}': {e}")

    def shutdown(self):
        logger.info("Agent 2 shutting down...")
        if self.bank_status_consumer:
            self.bank_status_consumer.close()
        if self.recovery_status_consumer:
            self.recovery_status_consumer.close()
        if self.kafka_producer:
            self.kafka_producer.flush(30)
        logger.info("Agent 2 shutdown complete.")

# FastAPI Setup
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, Field
import uvicorn
from fastapi.middleware.cors import CORSMiddleware
import uuid # For generating unique transaction IDs
from typing import Optional, Dict # Ensure these are imported

class StakeRequest(BaseModel):
    poolId: str
    amount: str

class CreatePoolRequest(BaseModel):
    regionName: str

class RepayDebtRequest(BaseModel):
    poolId: str
    amount: str
    debtIndex: Optional[int] = None  # Make debtIndex optional

class InitiatePaymentRequest(BaseModel):
    userId: str
    merchantId: str
    amount: float
    selectedBank: Optional[str] = None
    userGeoLocation: Optional[Dict] = None
    primaryFallbackPoolId: Optional[str] = None

class FallbackPayRequest(BaseModel):
    primaryPoolAddress: str
    merchantAddress: str
    amount: str

app = FastAPI(title="Agent 2 - Transaction Router & Recovery Manager API", version="1.0")
agent_instance = None

def get_agent():
    global agent_instance
    if agent_instance is None:
        logger.warning("Agent instance was None, re-initializing.")
        agent_instance = TransactionRouterRecoveryAgent()
    if not agent_instance.redis_client or not agent_instance._ensure_redis_connection():
        logger.error("FastAPI: Redis not available for agent instance.")
        raise HTTPException(status_code=503, detail="Service unavailable: Redis connection failed")
    return agent_instance

@app.on_event("startup")
async def startup_event():
    global agent_instance
    logger.info("FastAPI app startup event triggered.")
    if agent_instance is None:
        agent_instance = TransactionRouterRecoveryAgent()
    if not agent_instance.redis_client:
        logger.fatal("FastAPI Startup: Redis connection failed. Agent threads will not start.")
        return
    agent_instance.start_all_threads()
    logger.info("Agent 2 services (Kafka/Redis listeners) started via FastAPI startup.")

@app.on_event("shutdown")
def shutdown_event():
    global agent_instance
    logger.info("FastAPI app shutdown event triggered.")
    if agent_instance:
        agent_instance.shutdown()
    logger.info("Agent 2 services shutdown.")

@app.post("/stakeInPool")
async def stake_in_pool_endpoint(request: StakeRequest, agent: TransactionRouterRecoveryAgent = Depends(get_agent)):
    logger.info(f"Received API request for /stakeInPool: {request.dict()}")
    if not agent.staking_token_contract or not agent.w3:
        logger.error("Web3 or staking token contract not initialized")
        raise HTTPException(status_code=500, detail="Service unavailable: Blockchain components not initialized")

    try:
        amount_wei = agent.w3.to_wei(float(request.amount), 'ether')
        pool_id = Web3.to_checksum_address(request.poolId)
        tx_id = f"stake_{request.poolId}_{time.time()}"

        # Get LiquidityPool contract
        pool_contract = agent._get_liquidity_pool_contract(pool_id)
        if not pool_contract:
            logger.error(f"No valid LiquidityPool found for poolId: {pool_id}")
            raise HTTPException(status_code=400, detail=f"No valid LiquidityPool found for poolId: {pool_id}")

        # Approve tokens if necessary
        pool_address = pool_contract.address
        approve_tx_hash = agent._approve_tokens(pool_address, amount_wei, tx_id)
        if approve_tx_hash is None:
            logger.error(f"Failed to approve tokens for {tx_id}")
            raise HTTPException(status_code=500, detail="Failed to approve tokens for staking")
        if approve_tx_hash != "0x0":  # Log non-dummy hash
            logger.info(f"Approval successful for {tx_id}: {approve_tx_hash}")

        # Stake in the LiquidityPool
        tx_hash = agent._send_blockchain_transaction(
            pool_contract.functions.stake,
            {"amount": amount_wei},
            tx_id
        )
        if tx_hash:
            logger.info(f"Stake transaction {tx_id} initiated with hash: {tx_hash}")
            return {"transaction_hash": tx_hash, "status": "pending"}
        else:
            logger.error(f"Failed to send stake transaction {tx_id}")
            raise HTTPException(status_code=500, detail="Failed to send stake transaction")
    except ValueError as e:
        logger.error(f"Invalid amount format for stake request: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Invalid amount: {e}")
    except Exception as e:
        logger.error(f"Stake transaction failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Stake transaction failed: {str(e)}")

@app.post("/createPoolOnChain")
async def create_pool_on_chain_endpoint(request: CreatePoolRequest, agent: TransactionRouterRecoveryAgent = Depends(get_agent)):
    logger.info(f"Received API request for /createPoolOnChain: {request.dict()}")
    if not agent.pool_factory_contract or not agent.w3:
        logger.error("PoolFactory or Web3 not initialized")
        raise HTTPException(status_code=500, detail="Service unavailable: Blockchain components not initialized")

    try:
        tx_hash = agent._send_blockchain_transaction(
            agent.pool_factory_contract.functions.createPool,
            {"regionName": request.regionName},
            f"create_pool_{time.time()}"
        )
        if tx_hash:
            return {"transaction_hash": tx_hash, "status": "pending"}
        else:
            raise HTTPException(status_code=500, detail="Failed to send create pool transaction")
    except Exception as e:
        logger.error(f"Create pool failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Create pool failed: {str(e)}")

@app.post("/repayDebt")
async def repay_debt_endpoint(request: RepayDebtRequest, agent: TransactionRouterRecoveryAgent = Depends(get_agent)):
    logger.info(f"Received API request for /repayDebt: {request.dict()}")
    if not agent.pool_factory_contract or not agent.w3 or not agent.staking_token_contract:
        logger.error("PoolFactory, Web3, or staking token contract not initialized")
        raise HTTPException(status_code=500, detail="Service unavailable: Blockchain components not initialized")

    try:
        amount_float = float(request.amount)
        if amount_float <= 0:
            raise ValueError("Amount must be positive")
        # Convert to Wei using token decimals
        amount_wei = int(amount_float * 10 ** agent.token_decimals)
        pool_id = Web3.to_checksum_address(request.poolId)
        tx_id = f"repay_{request.poolId}_{time.time()}"

        # Get LiquidityPool contract
        pool_contract = agent._get_liquidity_pool_contract(pool_id)
        if not pool_contract:
            logger.error(f"No valid LiquidityPool found for poolId: {pool_id}")
            raise HTTPException(status_code=400, detail=f"No valid LiquidityPool found for poolId: {pool_id}")

        # Fetch user debts
        user_debts = pool_contract.functions.getUserDebts(agent.signer_address).call()
        logger.info(f"Fetched user debts: {user_debts}")

        # Find unpaid debts
        unpaid_debts = [(i, debt) for i, debt in enumerate(user_debts) if len(debt) > 4 and not debt[4]]
        unpaid_indices = [i for i, _ in unpaid_debts]
        logger.info(f"Unpaid debt indices: {unpaid_indices}")

        if not unpaid_debts:
            logger.error("No unpaid debts found")
            raise HTTPException(status_code=400, detail="No unpaid debts found for this user")

        # Determine debt index
        selected_debt_index = request.debtIndex
        debt = None

        if selected_debt_index is None:
            # Automatic debt selection
            logger.info("No debt index provided, selecting debt automatically")
            # First, try to find an exact amount match
            exact_matches = [(i, d) for i, d in unpaid_debts if d[2] == amount_wei]
            if exact_matches:
                if len(exact_matches) > 1:
                    logger.warning(f"Multiple debts match amount {amount_wei}, selecting first one")
                selected_debt_index, debt = exact_matches[0]
                logger.info(f"Selected debt index {selected_debt_index} with exact amount match")
            else:
                # Select the most recent unpaid debt (highest timestamp)
                most_recent = max(unpaid_debts, key=lambda x: x[1][3])
                selected_debt_index, debt = most_recent
                logger.info(f"Selected most recent debt index {selected_debt_index} with timestamp {debt[3]}")
        else:
            # Validate provided debt index
            if selected_debt_index < 0 or selected_debt_index >= len(user_debts):
                logger.error(f"Invalid debt index {selected_debt_index}: {len(user_debts)} debts available")
                raise HTTPException(status_code=400, detail=f"Invalid debt index {selected_debt_index}. Available unpaid debt indices: {unpaid_indices or 'none'}")
            debt = user_debts[selected_debt_index]

        # Map debt tuple to structured format
        try:
            debt_struct = {
                "user": debt[0],
                "merchantAddress": debt[1],
                "amount": debt[2],
                "timestamp": debt[3],
                "isRepaid": debt[4]
            }
            logger.info(f"Parsed debt at index {selected_debt_index}: {debt_struct}")
        except IndexError as e:
            logger.error(f"Debt tuple structure error: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Invalid debt tuple structure: {str(e)}")

        # Check if debt is already repaid
        if debt_struct["isRepaid"]:
            logger.error(f"Debt at index {selected_debt_index} already repaid")
            raise HTTPException(status_code=400, detail=f"Debt at index {selected_debt_index} is already repaid. Available unpaid debt indices: {unpaid_indices or 'none'}")

        # Validate repayment amount
        if amount_wei > debt_struct["amount"]:
            logger.error(f"Repayment amount {amount_wei} exceeds debt {debt_struct['amount']}")
            debt_amount_tokens = debt_struct["amount"] / (10 ** agent.token_decimals)
            raise HTTPException(status_code=400, detail=f"Repayment amount {request.amount} tokens exceeds debt {debt_amount_tokens} tokens")

        # Check user token balance
        user_balance = agent.staking_token_contract.functions.balanceOf(agent.signer_address).call()
        logger.info(f"User balance: {user_balance} wei ({user_balance / (10 ** agent.token_decimals)} tokens)")
        if user_balance < amount_wei:
            logger.error(f"Insufficient token balance {user_balance} for repayment {amount_wei}")
            raise HTTPException(status_code=400, detail="Insufficient token balance for repayment")

        # Check and handle token approval
        current_allowance = agent.staking_token_contract.functions.allowance(agent.signer_address, pool_id).call()
        logger.info(f"Current allowance: {current_allowance} wei ({current_allowance / (10 ** agent.token_decimals)} tokens)")
        if current_allowance < amount_wei:
            logger.info(f"Insufficient allowance {current_allowance} for {tx_id}, approving tokens")
            approve_tx_hash = agent._approve_tokens(pool_id, amount_wei, tx_id)
            if approve_tx_hash is None:
                logger.error(f"Failed to approve tokens for {tx_id}")
                raise HTTPException(status_code=500, detail="Failed to approve tokens for repayment")
            if approve_tx_hash != "0x0":
                logger.info(f"Approval successful for {tx_id}: {approve_tx_hash}")
                # Wait for approval transaction to be mined
                receipt = agent.w3.eth.wait_for_transaction_receipt(agent.w3.to_bytes(hexstr=approve_tx_hash), timeout=120)
                if receipt.status != 1:
                    logger.error(f"Approval transaction failed for {tx_id}: {receipt}")
                    raise HTTPException(status_code=500, detail="Approval transaction failed")

        # Estimate gas
        tx = pool_contract.functions.repayDebt(selected_debt_index, amount_wei).build_transaction({
            'from': agent.signer_address,
            'nonce': agent.w3.eth.get_transaction_count(agent.signer_address),
            'gasPrice': agent.w3.eth.gas_price,
        })
        gas_estimate = agent.w3.eth.estimate_gas(tx)
        tx['gas'] = int(gas_estimate * 1.2)  # 20% buffer
        logger.debug(f"Gas estimate for {tx_id}: {gas_estimate}, using {tx['gas']} with gas price {agent.w3.from_wei(tx['gasPrice'], 'gwei')} Gwei")

        # Sign and send transaction
        signed_tx = agent.w3.eth.account.sign_transaction(tx, private_key=agent.signer_private_key)
        tx_hash = agent.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        logger.info(f"Repay transaction sent for {tx_id}: {tx_hash.hex()}")

        # Wait for confirmation
        receipt = agent.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if receipt.status == 1:
            logger.info(f"Repay transaction confirmed for {tx_id}: {tx_hash.hex()}")
            return {
                "transaction_hash": tx_hash.hex(),
                "status": "success",
                "selected_debt_index": selected_debt_index
            }
        else:
            logger.error(f"Repay transaction failed for {tx_id}: {tx}")
            raise HTTPException(status_code=500, detail="Failed to repay debt")
    except ValueError as e:
        logger.error(f"Invalid input for repay debt request: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Invalid input: {str(e)}")
    except Exception as e:
        logger.error(f"Repay debt failed: {e}", exc_info=True)
        error_message = str(e).lower()
        if "insufficient funds" in error_message:
            error_message = "Insufficient funds for transaction"
        elif "execution reverted" in error_message:
            error_message = "Transaction reverted - check pool status and debt"
        elif "insufficient allowance" in error_message:
            error_message = "Insufficient token allowance"
        elif "invalid address" in error_message:
            error_message = "Invalid address provided"
        else:
            error_message = f"Failed to repay debt: {str(e)}"
        raise HTTPException(status_code=500, detail=error_message)

@app.post("/fallbackPay")
async def fallback_pay_endpoint(request: FallbackPayRequest, agent: TransactionRouterRecoveryAgent = Depends(get_agent)):
    logger.info(f"Received API request for /fallbackPay: {request.dict()}")
    if not agent.staking_token_contract or not agent.w3:
        logger.error("Web3 or staking token contract not initialized")
        raise HTTPException(status_code=500, detail="Service unavailable: Blockchain components not initialized")

    notifications = []
    try:
        amount_float = float(request.amount)
        if amount_float <= 0:
            raise ValueError("Amount must be positive")
        decimals = agent.staking_token_contract.functions.decimals().call()
        amount_wei = int(amount_float * 10**decimals)
        pool_address = Web3.to_checksum_address(request.primaryPoolAddress)
        merchant_address = Web3.to_checksum_address(request.merchantAddress)
        tx_id = f"fallback_{pool_address}_{time.time()}"

        # Get LiquidityPool contract
        pool_contract = agent._get_liquidity_pool_contract(pool_address)
        if not pool_contract:
            logger.error(f"No valid LiquidityPool found for poolAddress: {pool_address}")
            notifications.append({"id": str(int(time.time() * 1000)), "message": "Invalid pool address", "type": "error"})
            raise HTTPException(status_code=400, detail=f"No valid LiquidityPool found for poolAddress: {pool_address}")

        # Check user token balance
        user_balance = agent.staking_token_contract.functions.balanceOf(agent.signer_address).call()
        if user_balance < amount_wei:
            logger.error(f"Insufficient token balance for {tx_id}: {user_balance / 10**decimals} tokens")
            notifications.append({"id": str(int(time.time() * 1000)), "message": "Insufficient token balance", "type": "error"})
            raise HTTPException(status_code=400, detail="Insufficient token balance for fallback payment")

        # Check token allowance
        current_allowance = agent.staking_token_contract.functions.allowance(agent.signer_address, pool_address).call()
        if current_allowance < amount_wei:
            logger.info(f"Insufficient allowance for {tx_id}: {current_allowance / 10**decimals} tokens")
            notifications.append({"id": str(int(time.time() * 1000)), "message": "Insufficient token allowance. Approving tokens...", "type": "info"})
            approve_tx_hash = agent._approve_tokens(pool_address, amount_wei, tx_id)
            if approve_tx_hash is None:
                logger.error(f"Failed to approve tokens for {tx_id}")
                notifications.append({"id": str(int(time.time() * 1000)), "message": "Failed to approve tokens", "type": "error"})
                raise HTTPException(status_code=500, detail="Failed to approve tokens for fallback payment")
            if approve_tx_hash != "0x0":
                logger.info(f"Approval successful for {tx_id}: {approve_tx_hash}")
                notifications.append({"id": str(int(time.time() * 1000)), "message": f"Token approval confirmed: {approve_tx_hash[:10]}...", "type": "success"})

        # Simulate fallbackPay to catch issues
        try:
            pool_contract.functions.fallbackPay(merchant_address, amount_wei).call({"from": agent.signer_address})
            logger.debug(f"FallbackPay simulation successful for {tx_id}")
        except Exception as e:
            logger.error(f"FallbackPay simulation failed for {tx_id}: {e}")
            notifications.append({"id": str(int(time.time() * 1000)), "message": f"FallbackPay simulation failed: {str(e)}", "type": "error"})
            raise HTTPException(status_code=400, detail=f"FallbackPay simulation failed: {str(e)}")

        # Build transaction with dynamic gas parameters
        latest_block = agent.w3.eth.get_block('latest')
        base_fee = latest_block.get('baseFeePerGas', None)
        
        # Build base transaction parameters
        tx_params = {
            'from': agent.signer_address,
            'nonce': agent.w3.eth.get_transaction_count(agent.signer_address),
        }
        
        # Choose transaction type based on EIP-1559 support
        if base_fee is not None:
            # EIP-1559 transaction (Type 2)
            max_priority_fee = agent.w3.to_wei(2, 'gwei')
            max_fee_per_gas = base_fee * 2 + max_priority_fee
            tx_params.update({
                'maxFeePerGas': max_fee_per_gas,
                'maxPriorityFeePerGas': max_priority_fee,
            })
            logger.debug(f"Using EIP-1559 transaction for {tx_id}")
        else:
            # Legacy transaction (Type 0)
            gas_price = agent.w3.eth.gas_price
            tx_params['gasPrice'] = gas_price
            logger.debug(f"Using legacy transaction for {tx_id}")
        
        # Build the transaction
        tx = pool_contract.functions.fallbackPay(merchant_address, amount_wei).build_transaction(tx_params)
        
        # Estimate and set gas limit
        gas_estimate = agent.w3.eth.estimate_gas(tx)
        tx['gas'] = int(gas_estimate * 1.2)
        logger.debug(f"Gas estimate for {tx_id}: {gas_estimate}, using {tx['gas']}")

        # Sign and send transaction
        signed_tx = agent.w3.eth.account.sign_transaction(tx, private_key=agent.signer_private_key)
        tx_hash = agent.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        logger.info(f"Fallback transaction sent for {tx_id}: {tx_hash.hex()}")
        notifications.append({"id": str(int(time.time() * 1000)), "message": f"Fallback transaction sent: {tx_hash.hex()[:10]}...", "type": "info"})

        # Wait for confirmation
        receipt = agent.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if receipt.status == 1:
            logger.info(f"Fallback transaction confirmed for {tx_id}: {tx_hash.hex()}")
            notifications.append({"id": str(int(time.time() * 1000)), "message": f"Successfully sent fallback payment of {request.amount} tokens", "type": "success"})
            return {
                "success": True,
                "transaction_hash": tx_hash.hex(),
                "gas_used": receipt.gasUsed,
                "status": "confirmed",
                "notifications": notifications
            }
        else:
            logger.error(f"Fallback transaction failed for {tx_id}: {receipt}")
            notifications.append({"id": str(int(time.time() * 1000)), "message": "Fallback transaction failed", "type": "error"})
            raise HTTPException(status_code=500, detail="Fallback transaction failed")
    except ValueError as e:
        logger.error(f"Invalid input for fallback pay request: {e}", exc_info=True)
        notifications.append({"id": str(int(time.time() * 1000)), "message": f"Invalid input: {str(e)}", "type": "error"})
        raise HTTPException(status_code=400, detail=f"Invalid input: {e}")
    except Exception as e:
        error_message = str(e).lower()
        if "insufficient funds" in error_message:
            error_message = "Insufficient funds for transaction"
        elif "execution reverted" in error_message:
            error_message = "Transaction reverted - check pool status and balance"
        elif "insufficient allowance" in error_message:
            error_message = "Insufficient token allowance"
        elif "invalid address" in error_message:
            error_message = "Invalid address provided"
        else:
            error_message = f"Fallback payment failed: {str(e)}"
        logger.error(f"Fallback transaction failed: {error_message}", exc_info=True)
        notifications.append({"id": str(int(time.time() * 1000)), "message": error_message, "type": "error"})
        raise HTTPException(status_code=500, detail=error_message)

@app.post("/initiatePayment")
async def initiate_payment_endpoint(request: InitiatePaymentRequest, agent: TransactionRouterRecoveryAgent = Depends(get_agent)):
    logger.info(f"Received API request for /initiatePayment: {request.dict()}")
    transaction_id = str(uuid.uuid4())

    if not agent.redis_client:
        logger.error(f"Redis client not available for transaction {transaction_id}")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable")

    try:
        # Construct the message for Redis
        # Ensure merchantId is treated as a string, not necessarily a checksum address yet
        # Amount is passed as float, ensure process_transaction_requests handles it (or convert to string here)
        redis_message = {
            "transaction_id": transaction_id,
            "user_id": request.userId,
            "merchant_address": request.merchantId, # This will be validated/checksummed by the consumer if it's an ETH address
            "amount": request.amount, # Keep as float or str(request.amount)
            "selected_bank": request.selectedBank,
            "user_geo_location": request.userGeoLocation,
            "primary_pool_id_for_fallback": request.primaryFallbackPoolId,
            "timestamp": time.time() # Added timestamp for better tracking
        }
        message_json = json.dumps(redis_message)

        # Push to Redis queue
        agent.redis_client.lpush(TRANSACTION_REQUESTS_QUEUE, message_json)
        logger.info(f"Transaction {transaction_id} queued to {TRANSACTION_REQUESTS_QUEUE}")

        return {"message": "Payment initiated", "transaction_id": transaction_id}

    except redis.exceptions.ConnectionError as e:
        logger.error(f"Redis connection error for transaction {transaction_id}: {e}", exc_info=True)
        raise HTTPException(status_code=503, detail="Failed to queue payment request due to Redis error")
    except Exception as e:
        logger.error(f"Error processing /initiatePayment for {transaction_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/health")
async def health_check(agent: TransactionRouterRecoveryAgent = Depends(get_agent)):
    is_redis_connected = False
    if agent.redis_client:
        try:
            agent.redis_client.ping()
            is_redis_connected = True
        except redis.exceptions.ConnectionError:
            is_redis_connected = False
    is_web3_connected = agent.w3.is_connected() if agent.w3 else False
    threads_status = {thread.name: "alive" if thread.is_alive() else "dead" for thread in getattr(agent, 'threads', [])}
    return {
        "status": "ok" if is_redis_connected and is_web3_connected else "degraded",
        "redis_connected": is_redis_connected,
        "web3_connected": is_web3_connected,
        "bank_statuses": agent.bank_statuses.copy(), # Show status for all known banks
        "active_threads": threads_status
    }

def run_fastapi_server():
    global agent_instance
    agent_instance = TransactionRouterRecoveryAgent()
    if not agent_instance.redis_client:
        logger.fatal("Cannot start FastAPI server for Agent 2: Redis connection failed on initial setup.")
        return
    if not agent_instance.w3 or not agent_instance.pool_factory_contract or not agent_instance.staking_token_contract:
        logger.fatal("Cannot start FastAPI server for Agent 2: Web3 or contracts not initialized.")
        return
    logger.info("Agent instance created. Redis and Web3 connections successful.")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")

# Add CORS middleware before running the server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust as needed for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    run_fastapi_server()