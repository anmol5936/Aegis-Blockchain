import os
import json
import time
import logging
import threading
import redis
import aiohttp
import asyncio
from confluent_kafka import Producer, Consumer, KafkaError
from dotenv import load_dotenv
from web3 import Web3, HTTPProvider
from typing import Dict, Optional, List, Any
import httpx
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
import uuid
import uvicorn

load_dotenv()

# Pydantic Models
class DistributedStakeRequest(BaseModel):
    amount: str

class StakeRequest(BaseModel):
    poolId: str
    amount: str

class CreatePoolRequest(BaseModel):
    regionName: str

class RepayDebtRequest(BaseModel):
    pass

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

# Environment variables
AGENT3_API_URL = os.getenv('AGENT3_API_URL', 'http://localhost:8001')
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
        self.bank_statuses: Dict[str, str] = {}
        self.bank_status_lock = threading.Lock()
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

        self.signer_address = os.getenv('SIGNER_ADDRESS', self.signer_address)
        self.signer_private_key = os.getenv('SIGNER_PRIVATE_KEY')
        if not self.signer_address or not self.signer_private_key:
            raise ValueError("Signer address or private key not set in .env")
        self.token_decimals = self.staking_token_contract.functions.decimals().call()
        logger.info(f"Staking token decimals: {self.token_decimals}")
        eth_balance = self.w3.eth.get_balance(self.signer_address)
        token_balance = self.staking_token_contract.functions.balanceOf(self.signer_address).call()
        logger.info(f"Signer ETH balance: {self.w3.from_wei(eth_balance, 'ether')} ETH, Token balance: {token_balance / 10**self.token_decimals}")

    def get_specific_bank_status(self, bank_id: str) -> str:
        with self.bank_status_lock:
            return self.bank_statuses.get(bank_id, "unknown")

    def set_bank_status(self, bank_id: str, status: str) -> bool:
        with self.bank_status_lock:
            previous_status = self.bank_statuses.get(bank_id, "unknown")
            new_status = status.lower()
            self.bank_statuses[bank_id] = new_status
            logger.info(f"Bank status updated for {bank_id}: {new_status}")
            return previous_status != "up" and new_status == "up"

    def delivery_report(self, err, msg):
        if err is not None:
            logger.error(f'Message delivery failed for topic {msg.topic()}: {err}')
        else:
            logger.info(f'Message delivered to {msg.topic()} [{msg.partition()}] at offset {msg.offset}')

    def _approve_tokens(self, spender_address: str, amount: int, tx_id: str) -> Optional[str]:
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
            eth_balance = self.w3.eth.get_balance(self.signer_address)
            min_eth_required = self.w3.to_wei(0.01, 'ether')
            if eth_balance < min_eth_required:
                logger.error(f"Insufficient ETH balance for {tx_id}: {self.w3.from_wei(eth_balance, 'ether')} ETH < {self.w3.from_wei(min_eth_required, 'ether')} ETH")
                return None

            current_allowance = self.staking_token_contract.functions.allowance(self.signer_address, spender_address).call()
            if current_allowance >= amount:
                logger.info(f"Sufficient allowance already exists for {tx_id}: {current_allowance} >= {amount}")
                return "0x0"

            tx = self.staking_token_contract.functions.approve(spender_address, amount).build_transaction({
                'from': self.signer_address,
                'nonce': self.w3.eth.get_transaction_count(self.signer_address),
                'gasPrice': self.w3.eth.gas_price,
            })
            gas_estimate = self.w3.eth.estimate_gas(tx)
            tx['gas'] = int(gas_estimate * 1.2)
            logger.debug(f"Gas estimate for {tx_id}: {gas_estimate}, using {tx['gas']} with gas price {self.w3.from_wei(tx['gasPrice'], 'gwei')} Gwei")

            signed_tx = self.w3.eth.account.sign_transaction(tx, private_key=self.signer_private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            logger.info(f"Approval transaction sent for {tx_id}: {tx_hash.hex()}")

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
            pool_contract = self.w3.eth.contract(address=pool_id, abi=LIQUIDITY_POOL_ABI)
            logger.debug(f"Instantiated LiquidityPool contract at {pool_id}")

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

            if not hasattr(pool_contract.functions, 'stake'):
                logger.error(f"Contract at {pool_id} does not have stake function in ABI")
                return None

            logger.info(f"Retrieved LiquidityPool contract at {pool_id}")
            return pool_contract
        except ValueError as e:
            logger.error(f"Invalid pool_id format: {pool_id}: {e}")
            return None
        except Exception as e:
            logger.error(f"Error fetching LiquidityPool for {pool_id}: {e}", exc_info=True)
            return None

    def _send_blockchain_transaction(self, contract_function, function_args: dict, tx_id: str) -> Optional[str]:
        if not self.w3 or not self.signer_address or not self.signer_private_key:
            logger.error(f"Web3, signer address, or private key not initialized for {tx_id}")
            return None

        try:
            eth_balance = self.w3.eth.get_balance(self.signer_address)
            min_eth_required = self.w3.to_wei(0.1, 'ether')
            if eth_balance < min_eth_required:
                logger.error(f"Insufficient ETH balance for {tx_id}: {self.w3.from_wei(eth_balance, 'ether')} ETH < {self.w3.from_wei(min_eth_required, 'ether')} ETH")
                return None

            function_name = contract_function.fn_name
            logger.debug(f"Building transaction for function: {function_name} with args: {function_args}")

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
                tx = contract_function(
                    Web3.to_checksum_address(function_args['poolAddress']),
                    function_args['lpTokens']
                ).build_transaction({
                    'from': self.signer_address,
                    'nonce': self.w3.eth.get_transaction_count(self.signer_address),
                    'gasPrice': self.w3.eth.gas_price,
                })
            elif function_name == 'repayDebt' and 'debtIndex' in function_args and 'amount' in function_args:
                tx = contract_function(
                    function_args['debtIndex'],
                    function_args['amount']
                ).build_transaction({
                    'from': self.signer_address,
                    'nonce': self.w3.eth.get_transaction_count(self.signer_address),
                    'gasPrice': self.w3.eth.gas_price,
                })
            else:
                logger.error(f"Unsupported function {function_name} or invalid parameters for {tx_id}: {function_args}")
                return None

            gas_estimate = self.w3.eth.estimate_gas(tx)
            tx['gas'] = int(gas_estimate * 1.2)
            logger.debug(f"Gas estimate for {tx_id}: {gas_estimate}, using {tx['gas']} with gas price {self.w3.from_wei(tx['gasPrice'], 'gwei')} Gwei")

            signed_tx = self.w3.eth.account.sign_transaction(tx, private_key=self.signer_private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            logger.info(f"Transaction sent for {tx_id}: {tx_hash.hex()}")

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

    def _check_and_repay_debts(self, bank_id: str) -> Dict:
        if not self.pool_factory_contract or not self.w3 or not self.staking_token_contract:
            logger.error("PoolFactory, Web3, or staking token contract not initialized")
            return {"transaction_hashes": [], "status": "error", "message": "Blockchain components not initialized"}

        try:
            tx_id = f"repay_all_{bank_id}_{time.time()}"
            user_balance = self.staking_token_contract.functions.balanceOf(self.signer_address).call()
            logger.info(f"User balance for {tx_id}: {user_balance / (10 ** self.token_decimals)} tokens")
            if user_balance == 0:
                logger.error(f"Insufficient token balance for {tx_id}")
                return {"transaction_hashes": [], "status": "error", "message": "Insufficient token balance for repayment"}

            pool_addresses = self.pool_factory_contract.functions.getPools().call()
            logger.info(f"Fetched pool addresses for {tx_id}: {pool_addresses}")
            if not pool_addresses:
                logger.info(f"No pools found for {tx_id}")
                return {"transaction_hashes": [], "status": "success", "message": "No debts to repay"}

            total_debt_wei = 0
            pool_debts = {}
            for pool_id in pool_addresses:
                pool_id = Web3.to_checksum_address(pool_id)
                pool_contract = self._get_liquidity_pool_contract(pool_id)
                if not pool_contract:
                    logger.warning(f"Skipping invalid pool {pool_id} for {tx_id}")
                    continue

                user_debts = pool_contract.functions.getUserDebts(self.signer_address).call()
                unpaid_debts = [(i, debt) for i, debt in enumerate(user_debts) if len(debt) > 4 and not debt[4]]
                if unpaid_debts:
                    pool_debts[pool_id] = unpaid_debts
                    total_debt_wei += sum(debt[2] for _, debt in unpaid_debts)
                    logger.info(f"Pool {pool_id} has {len(unpaid_debts)} unpaid debts for {tx_id}")

            if not pool_debts:
                logger.info(f"No unpaid debts found across all pools for {tx_id}")
                return {"transaction_hashes": [], "status": "success", "message": "No debts to repay"}

            if user_balance < total_debt_wei:
                logger.error(f"Insufficient balance {user_balance} for total debt {total_debt_wei} in {tx_id}")
                return {"transaction_hashes": [], "status": "error", "message": "Insufficient token balance to cover all debts"}

            approval_hashes = []
            for pool_id in pool_debts:
                current_allowance = self.staking_token_contract.functions.allowance(self.signer_address, pool_id).call()
                pool_debt_wei = sum(debt[2] for _, debt in pool_debts[pool_id])
                if current_allowance < pool_debt_wei:
                    logger.info(f"Approving {pool_debt_wei / (10 ** self.token_decimals)} tokens for pool {pool_id} in {tx_id}")
                    approve_tx_hash = self._approve_tokens(pool_id, pool_debt_wei, f"approve_{pool_id}_{tx_id}")
                    if approve_tx_hash is None:
                        logger.error(f"Failed to approve tokens for pool {pool_id} in {tx_id}")
                        return {"transaction_hashes": [], "status": "error", "message": f"Failed to approve tokens for pool {pool_id}"}
                    if approve_tx_hash != "0x0":
                        logger.info(f"Approval successful for pool {pool_id}: {approve_tx_hash} in {tx_id}")
                        approval_hashes.append(approve_tx_hash)
                        receipt = self.w3.eth.wait_for_transaction_receipt(self.w3.to_bytes(hexstr=approve_tx_hash), timeout=120)
                        if receipt.status != 1:
                            logger.error(f"Approval transaction failed for pool {pool_id}: {receipt} in {tx_id}")
                            return {"transaction_hashes": [], "status": "error", "message": f"Approval transaction failed for pool {pool_id}"}

            transaction_hashes = []
            all_successful = True
            for pool_id, unpaid_debts in pool_debts.items():
                pool_contract = self._get_liquidity_pool_contract(pool_id)
                if not pool_contract:
                    logger.error(f"Failed to get pool contract for {pool_id} in {tx_id}")
                    all_successful = False
                    continue

                for debt_index, debt in unpaid_debts:
                    debt_amount_wei = debt[2]
                    try:
                        tx_hash = self._send_blockchain_transaction(
                            pool_contract.functions.repayDebt,
                            {"debtIndex": debt_index, "amount": debt_amount_wei},
                            f"repay_{pool_id}_{debt_index}_{tx_id}"
                        )
                        if tx_hash:
                            logger.info(f"Repay transaction confirmed for debt {debt_index} in pool {pool_id}: {tx_hash} in {tx_id}")
                            transaction_hashes.append(tx_hash)
                        else:
                            logger.error(f"Repay transaction failed for debt {debt_index} in pool {pool_id} in {tx_id}")
                            all_successful = False
                    except Exception as e:
                        logger.error(f"Repay transaction failed for debt {debt_index} in pool {pool_id}: {e} in {tx_id}")
                        all_successful = False

            if not transaction_hashes:
                logger.error(f"No repayment transactions were successful for {tx_id}")
                return {"transaction_hashes": [], "status": "error", "message": "No repayment transactions were successful"}

            status = "success" if all_successful else "partial_success"
            message = "All debts repaid successfully" if all_successful else "Some debt repayments failed"
            logger.info(f"Repay operation completed with status: {status} for {tx_id}")
            return {
                "transaction_hashes": transaction_hashes,
                "approval_hashes": approval_hashes,
                "status": status,
                "message": message
            }

        except Exception as e:
            logger.error(f"Debt repayment failed for {tx_id}: {e}", exc_info=True)
            return {"transaction_hashes": [], "status": "error", "message": f"Debt repayment failed: {str(e)}"}

    def _listen_for_bank_status(self):
        logger.info(f"Starting bank status listener on topic: {BANK_SERVER_TOPIC}")
        try:
            while True:
                msg = self.bank_status_consumer.poll(timeout=1.0)
                if msg is None:
                    continue
                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        continue
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
                            transitioned_to_up = self.set_bank_status(bank_id, status)
                            if transitioned_to_up:
                                logger.info(f"Bank {bank_id} transitioned to UP. Checking for user debts.")
                                # Run debt check and repayment in a separate thread to avoid blocking
                                debt_repay_thread = threading.Thread(
                                    target=self._check_and_repay_debts_wrapper,
                                    args=(bank_id,),
                                    daemon=True,
                                    name=f"DebtRepay_{bank_id}_{time.time()}"
                                )
                                debt_repay_thread.start()
                                logger.info(f"Started debt repayment thread for bank {bank_id}")
                        else:
                            logger.warning(f"Bank status message missing 'bank_id' or 'status' field: {data}")
                    except Exception as e:
                        logger.error(f"Error processing bank_status message: {e}")
        except Exception as e:
            logger.error(f"Exception in _listen_for_bank_status: {e}", exc_info=True)
        finally:
            self.bank_status_consumer.close()

    def _check_and_repay_debts_wrapper(self, bank_id: str):
        result = self._check_and_repay_debts(bank_id)
        logger.info(f"Debt repayment result for bank {bank_id}: {result}")

    def _listen_for_recovery_updates(self):
        logger.info(f"Starting recovery status listener on topic: {RECOVERY_STATUS_UPDATE_TOPIC}")
        try:
            while True:
                msg = self.recovery_status_consumer.poll(timeout=1.0)
                if msg is None:
                    continue
                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        continue
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
                selected_bank = transaction_data.get('selected_bank')
                user_id = transaction_data.get('user_id')

                if not selected_bank:
                    logger.warning(f"Transaction {tx_id} for user {user_id} missing 'selected_bank'. Re-queueing.")
                    self.redis_client.rpush(TRANSACTION_REQUESTS_QUEUE, message_json)
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
                    logger.info(f"Bank '{selected_bank}' is DOWN. Queuing for recovery and attempting fallback for tx {tx_id} of user {user_id}.")
                    recovery_payload = transaction_data.copy()
                    recovery_payload['method'] = 'bank_account'
                    recovery_payload['recovery_id'] = tx_id
                    self.redis_client.lpush(RECOVERY_PAYMENTS_QUEUE, json.dumps(recovery_payload))
                    logger.info(f"Tx {tx_id} for bank '{selected_bank}' (user {user_id}) queued to {RECOVERY_PAYMENTS_QUEUE} because bank is down.")

                    logger.info(f"Attempting blockchain fallback for tx {tx_id} of user {user_id} as bank '{selected_bank}' is down.")
                    effective_pool_id = primary_fallback_pool_from_request
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
                    merchant_address = "0xae6fE3971850928c94C8638cC1E83dA4F155cB47"
                    amount = transaction_data.get("amount")

                    if not all([pool_id_for_fallback, merchant_address, amount]):
                        logger.error(f"Missing critical params for fallback (tx {tx_id}, user {user_id}). PoolID: {pool_id_for_fallback}, Merchant: {merchant_address}, Amount: {amount}. Data: {transaction_data}")
                        continue

                    try:
                        if not Web3.is_address(pool_id_for_fallback):
                            logger.error(f"Invalid primary_pool_id_for_fallback: {pool_id_for_fallback} for tx {tx_id}")
                            continue
                        pool_id_for_fallback = Web3.to_checksum_address(pool_id_for_fallback)
                        merchant_address = Web3.to_checksum_address(merchant_address)
                        decimals = self.staking_token_contract.functions.decimals().call()
                        amount_wei = int(float(amount) * 10**decimals)

                        pool_contract_for_fallback = self._get_liquidity_pool_contract(pool_id_for_fallback)
                        if not pool_contract_for_fallback:
                            logger.error(f"Failed to get LiquidityPool contract instance for fallback pool {pool_id_for_fallback} (tx {tx_id}, user {user_id}). Skipping fallback.")
                            continue

                        user_balance = self.staking_token_contract.functions.balanceOf(self.signer_address).call()
                        if user_balance < amount_wei:
                            logger.error(f"Insufficient token balance for tx {tx_id}: {user_balance / 10**decimals} tokens, required: {amount_wei / 10**decimals} tokens")
                            continue

                        current_allowance = self.staking_token_contract.functions.allowance(self.signer_address, pool_id_for_fallback).call()
                        if current_allowance < amount_wei:
                            logger.info(f"Insufficient allowance for tx {tx_id}: {current_allowance / 10**decimals} tokens, approving {amount_wei / 10**decimals} tokens")
                            approve_tx_hash = self._approve_tokens(pool_id_for_fallback, amount_wei, tx_id)
                            if approve_tx_hash is None:
                                logger.error(f"Failed to approve tokens for tx {tx_id}")
                                continue
                            logger.info(f"Token approval successful for tx {tx_id}: {approve_tx_hash}")

                        params_for_lp_fallback = {
                            'merchantAddress': merchant_address,
                            'amount': amount_wei
                        }
                        logger.info(f"Calling fallbackPay on LiquidityPool {pool_id_for_fallback} for tx {tx_id} (user {user_id}) with params: {params_for_lp_fallback}")

                        try:
                            pool_contract_for_fallback.functions.fallbackPay(merchant_address, amount_wei).call({'from': self.signer_address})
                            logger.debug(f"FallbackPay simulation successful for tx {tx_id}")
                        except Exception as e:
                            logger.error(f"FallbackPay simulation failed for tx {tx_id}: {e}")
                            continue

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

                elif specific_bank_status == "unknown":
                    logger.warning(f"Bank status for '{selected_bank}' is '{specific_bank_status}' for tx {tx_id} (user {user_id}). Re-queueing to {TRANSACTION_REQUESTS_QUEUE}.")
                    self.redis_client.rpush(TRANSACTION_REQUESTS_QUEUE, message_json)
                    time.sleep(5)

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
            return asyncio.run(main_async_wrapper())
        except RuntimeError as e:
            if "cannot call run while another loop is running" in str(e) or \
               "There is no current event loop in thread" in str(e):
                logger.info("Attempting Agent 3 call with a new event loop due to RuntimeError.")
                new_loop = asyncio.new_event_loop()
                asyncio.set_event_loop(new_loop)
                try:
                    return new_loop.run_until_complete(main_async_wrapper())
                finally:
                    new_loop.close()
            else:
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
                message_tuple = self.redis_client.blpop([RECOVERY_PAYMENTS_QUEUE], timeout=5)
                if not message_tuple:
                    continue

                _, message_json = message_tuple
                logger.info(f"Dequeued recovery payment: {message_json}")
                recovery_data = json.loads(message_json)

                rec_id = recovery_data.get("recovery_id") or recovery_data.get("transaction_id", "N/A")
                method = recovery_data.get("method", "").lower()
                selected_bank = recovery_data.get("selected_bank")

                if not selected_bank:
                    logger.warning(f"Recovery payment {rec_id} missing 'selected_bank'. Re-queueing.")
                    self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                    time.sleep(5)
                    continue

                specific_bank_status = self.get_specific_bank_status(selected_bank)
                logger.info(f"Processing recovery {rec_id} for bank '{selected_bank}' (method: {method}). Bank status: {specific_bank_status}")

                if method == "blockchain":
                    pool_id = recovery_data.get("pool_id_for_unstake")
                    lp_tokens = recovery_data.get("lp_tokens_to_unstake")
                    if not all([pool_id, lp_tokens]):
                        logger.error(f"Missing params for blockchain unstake (rec {rec_id}). Data: {recovery_data}")
                        self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                        time.sleep(1)
                        continue

                    if self.pool_factory_contract:
                        try:
                            lp_tokens_val = float(lp_tokens)
                            lp_tokens_wei = self.w3.to_wei(lp_tokens_val, 'ether')
                            tx_hash = self._send_blockchain_transaction(
                                self.pool_factory_contract.functions.unstakeFromPool,
                                {"poolAddress": Web3.to_checksum_address(pool_id), "lpTokens": lp_tokens_wei},
                                rec_id
                            )
                            if tx_hash:
                                logger.info(f"Blockchain unstake transaction {rec_id} initiated with hash: {tx_hash}")
                            else:
                                logger.error(f"Blockchain unstake transaction {rec_id} failed to send. Re-queueing.")
                                self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                        except ValueError as e:
                            logger.error(f"Invalid pool_id or lp_tokens format for blockchain unstake rec {rec_id}: {e}. Re-queueing.")
                            self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                        except Exception as e:
                            logger.error(f"Blockchain unstake transaction failed for rec {rec_id}: {e}. Re-queueing.", exc_info=True)
                            self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                    else:
                        logger.error(f"PoolFactory contract not initialized for blockchain unstake rec {rec_id}. Re-queueing.")
                        self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                    self.kafka_producer.poll(0)
                    self.kafka_producer.flush(timeout=1.0)
                    continue

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

                else:
                    logger.warning(f"Bank status for '{selected_bank}' is UNKNOWN for recovery tx {rec_id} (method: {method}). Re-queueing to {RECOVERY_PAYMENTS_QUEUE}.")
                    self.redis_client.rpush(RECOVERY_PAYMENTS_QUEUE, message_json)
                    time.sleep(10)

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
    pass

class InitiatePaymentRequest(BaseModel):
    userId: str
    merchantId: str
    amount: float
    selectedBank: Optional[str] = None
    userGeoLocation: Optional[Dict] = None
    primaryFallbackPoolId: Optional[str] = None

class FallbackPayRequest(BaseModel):
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

        pool_contract = agent._get_liquidity_pool_contract(pool_id)
        if not pool_contract:
            logger.error(f"No valid LiquidityPool found for poolId: {pool_id}")
            raise HTTPException(status_code=400, detail=f"No valid LiquidityPool found for poolId: {pool_id}")

        pool_address = pool_contract.address
        approve_tx_hash = agent._approve_tokens(pool_address, amount_wei, tx_id)
        if approve_tx_hash is None:
            logger.error(f"Failed to approve tokens for {tx_id}")
            raise HTTPException(status_code=500, detail="Failed to approve tokens for staking")
        if approve_tx_hash != "0x0":
            logger.info(f"Approval successful for {tx_id}: {approve_tx_hash}")

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

@app.post("/stakeInPoolDistributed")
async def stake_in_pool_distributed_endpoint(
    request: DistributedStakeRequest, 
    agent: TransactionRouterRecoveryAgent = Depends(get_agent)
):
    logger.info(f"Received distributed stake request: {request.dict()}")
    
    if not agent.staking_token_contract or not agent.w3:
        logger.error("Web3 or staking token contract not initialized")
        raise HTTPException(status_code=500, detail="Service unavailable: Blockchain components not initialized")

    try:
        total_amount = float(request.amount)
        
        pools_data = await get_all_pools()
        if not pools_data or not pools_data.get('pools'):
            raise HTTPException(status_code=400, detail="No pools available for staking")
        
        pools = pools_data['pools']
        active_pools = [pool for pool in pools if pool.get('status') == 'ACTIVE']
        
        if not active_pools:
            raise HTTPException(status_code=400, detail="No active pools available for staking")
        
        distribution = calculate_inverse_liquidity_distribution(active_pools, total_amount)
        
        results = []
        failed_stakes = []
        
        for pool_id, amount in distribution.items():
            try:
                stake_request = StakeRequest(poolId=pool_id, amount=str(amount))
                result = await stake_in_pool_endpoint(stake_request, agent)
                results.append({
                    "poolId": pool_id,
                    "amount": amount,
                    "transaction_hash": result["transaction_hash"],
                    "status": result["status"]
                })
                logger.info(f"Successfully staked {amount} in pool {pool_id}")
                
            except Exception as e:
                logger.error(f"Failed to stake in pool {pool_id}: {e}")
                failed_stakes.append({
                    "poolId": pool_id,
                    "amount": amount,
                    "error": str(e)
                })
        
        response = {
            "total_amount_distributed": total_amount,
            "successful_stakes": results,
            "failed_stakes": failed_stakes,
            "distribution_strategy": "inverse_liquidity"
        }
        
        if failed_stakes:
            logger.warning(f"Some stakes failed: {failed_stakes}")
            response["status"] = "partial_success"
        else:
            response["status"] = "success"
            
        return response
        
    except ValueError as e:
        logger.error(f"Invalid amount format: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid amount: {e}")
    except Exception as e:
        logger.error(f"Distributed stake failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Distributed stake failed: {str(e)}")

async def get_all_pools() -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get("http://localhost:8765/pools")
            response.raise_for_status()
            return response.json()
    except Exception as e:
        logger.error(f"Failed to fetch pools: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch pool data")

def calculate_inverse_liquidity_distribution(pools: List[Dict], total_amount: float) -> Dict[str, float]:
    pool_liquidities = {pool['id']: pool['totalLiquidity'] for pool in pools}
    min_liquidity = min(pool_liquidities.values())
    base_liquidity = max(min_liquidity * 0.1, 1.0)
    
    inverse_weights = {pool_id: 1.0 / (liquidity + base_liquidity) for pool_id, liquidity in pool_liquidities.items()}
    total_weight = sum(inverse_weights.values())
    normalized_weights = {pool_id: weight / total_weight for pool_id, weight in inverse_weights.items()}
    
    distribution = {pool_id: round(total_amount * weight, 6) for pool_id, weight in normalized_weights.items()}
    
    logger.info(f"Distribution calculated: {distribution}")
    for pool_id, amount in distribution.items():
        liquidity = pool_liquidities[pool_id]
        logger.info(f"Pool {pool_id}: Liquidity={liquidity}, Allocation={amount}")
    
    return distribution

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
    return await asyncio.get_event_loop().run_in_executor(None, agent._check_and_repay_debts, "manual")

@app.post("/fallbackPay")
async def fallback_pay_endpoint(request: FallbackPayRequest, agent: TransactionRouterRecoveryAgent = Depends(get_agent)):
    logger.info(f"Received API request for /fallbackPay: {request.dict()}")
    if not agent.staking_token_contract or not agent.w3:
        logger.error("Web3 or staking token contract not initialized")
        raise HTTPException(status_code=500, detail="Service unavailable: Blockchain components not initialized")

    notifications = []
    successful_transactions = []
    
    try:
        amount_float = float(request.amount)
        if amount_float <= 0:
            raise ValueError("Amount must be positive")
        
        decimals = agent.staking_token_contract.functions.decimals().call()
        amount_wei = int(amount_float * 10**decimals)
        merchant_address = Web3.to_checksum_address(request.merchantAddress)
        
        # Fetch pools from localhost:8765/pools
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get("http://localhost:8765/pools", timeout=10.0)
                response.raise_for_status()
                pools_data = response.json()
                pools = pools_data.get("pools", [])
                logger.info(f"Fetched {len(pools)} pools from API")
        except Exception as e:
            logger.error(f"Failed to fetch pools from API: {e}")
            notifications.append({"id": str(int(time.time() * 1000)), "message": "Failed to fetch pools data", "type": "error"})
            raise HTTPException(status_code=500, detail="Failed to fetch pools data")
        
        # Filter pools that have userStake and sort by collateralAmount in descending order
        valid_pools = []
        for pool in pools:
            if pool.get("userStake") and pool["userStake"].get("collateralAmount", 0) > 0:
                valid_pools.append(pool)
        
        if not valid_pools:
            logger.error("No pools with available collateral found")
            notifications.append({"id": str(int(time.time() * 1000)), "message": "No pools with available collateral", "type": "error"})
            raise HTTPException(status_code=400, detail="No pools with available collateral found")
        
        # Sort pools by collateralAmount in descending order
        valid_pools.sort(key=lambda x: x["userStake"]["collateralAmount"], reverse=True)
        logger.info(f"Found {len(valid_pools)} valid pools, sorted by collateral amount")
        
        # Calculate total available collateral
        total_collateral = sum(pool["userStake"]["collateralAmount"] for pool in valid_pools)
        logger.info(f"Total available collateral: {total_collateral}, Required amount: {amount_float}")
        
        # Check if total amount exceeds available collateral
        if amount_float > total_collateral:
            error_msg = f"Can't fallback: amount ({amount_float}) is higher than total collateral available ({total_collateral})"
            logger.error(error_msg)
            notifications.append({"id": str(int(time.time() * 1000)), "message": error_msg, "type": "error"})
            raise HTTPException(status_code=400, detail=error_msg)
        
        # Check total user token balance once
        user_balance = agent.staking_token_contract.functions.balanceOf(agent.signer_address).call()
        if user_balance < amount_wei:
            logger.error(f"Insufficient token balance: {user_balance / 10**decimals} tokens")
            notifications.append({"id": str(int(time.time() * 1000)), "message": "Insufficient token balance", "type": "error"})
            raise HTTPException(status_code=400, detail="Insufficient token balance for fallback payment")
        
        remaining_amount = amount_float
        remaining_amount_wei = amount_wei
        
        # Process each pool until remaining amount is covered
        for pool in valid_pools:
            if remaining_amount <= 0:
                break
                
            pool_id = pool["id"]
            pool_address = Web3.to_checksum_address(pool_id)
            collateral_amount = pool["userStake"]["collateralAmount"]
            
            # Calculate payment amount for this pool
            payment_amount = min(remaining_amount, collateral_amount)
            payment_amount_wei = int(payment_amount * 10**decimals)
            
            tx_id = f"fallback_{pool_address}_{time.time()}"
            logger.info(f"Processing pool {pool_address} with payment amount: {payment_amount}")
            
            try:
                # Get LiquidityPool contract
                pool_contract = agent._get_liquidity_pool_contract(pool_address)
                if not pool_contract:
                    logger.warning(f"No valid LiquidityPool found for poolAddress: {pool_address}, skipping")
                    notifications.append({"id": str(int(time.time() * 1000)), "message": f"Invalid pool contract for {pool_address[:10]}...", "type": "warning"})
                    continue
                
                # Check if the function exists in the contract
                try:
                    # Try to get the function to verify it exists
                    func = pool_contract.functions.fallbackPay
                    logger.info(f"Function executeOriginalFallbackPay found for pool {pool_address}")
                except AttributeError as e:
                    logger.error(f"Function executeOriginalFallbackPay not found in pool {pool_address}: {e}")
                    notifications.append({"id": str(int(time.time() * 1000)), "message": f"Function not found in pool {pool_address[:10]}...", "type": "warning"})
                    continue
                
                # Check token allowance for this pool
                current_allowance = agent.staking_token_contract.functions.allowance(agent.signer_address, pool_address).call()
                if current_allowance < payment_amount_wei:
                    logger.info(f"Insufficient allowance for {tx_id}: {current_allowance / 10**decimals} tokens")
                    notifications.append({"id": str(int(time.time() * 1000)), "message": f"Approving tokens for pool {pool_address[:10]}...", "type": "info"})
                    approve_tx_hash = agent._approve_tokens(pool_address, payment_amount_wei, tx_id)
                    if approve_tx_hash is None:
                        logger.error(f"Failed to approve tokens for {tx_id}, skipping pool")
                        continue
                    if approve_tx_hash != "0x0":
                        logger.info(f"Approval successful for {tx_id}: {approve_tx_hash}")
                        notifications.append({"id": str(int(time.time() * 1000)), "message": f"Token approval confirmed for pool: {approve_tx_hash[:10]}...", "type": "success"})
                
                # Simulate fallbackPay to catch issues
                try:
                    pool_contract.functions.fallbackPay(merchant_address, payment_amount_wei).call({"from": agent.signer_address})
                    logger.debug(f"FallbackPay simulation successful for {tx_id}")
                except Exception as e:
                    logger.warning(f"FallbackPay simulation failed for {tx_id}: {e}, skipping pool")
                    continue
                
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
                tx = pool_contract.functions.fallbackPay(merchant_address, payment_amount_wei).build_transaction(tx_params)
                
                # Estimate and set gas limit
                gas_estimate = agent.w3.eth.estimate_gas(tx)
                tx['gas'] = int(gas_estimate * 1.2)
                logger.debug(f"Gas estimate for {tx_id}: {gas_estimate}, using {tx['gas']}")
                
                # Sign and send transaction
                signed_tx = agent.w3.eth.account.sign_transaction(tx, private_key=agent.signer_private_key)
                tx_hash = agent.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
                logger.info(f"Fallback transaction sent for {tx_id}: {tx_hash.hex()}")
                notifications.append({"id": str(int(time.time() * 1000)), "message": f"Transaction sent to pool {pool_address[:10]}...: {tx_hash.hex()[:10]}...", "type": "info"})
                
                # Wait for confirmation
                receipt = agent.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
                if receipt.status == 1:
                    logger.info(f"Fallback transaction confirmed for {tx_id}: {tx_hash.hex()}")
                    notifications.append({"id": str(int(time.time() * 1000)), "message": f"Successfully sent {payment_amount} tokens to pool {pool_address[:10]}...", "type": "success"})
                    
                    # Record successful transaction
                    successful_transactions.append({
                        "pool_address": pool_address,
                        "amount": payment_amount,
                        "transaction_hash": tx_hash.hex(),
                        "gas_used": receipt.gasUsed
                    })
                    
                    # Update remaining amount
                    remaining_amount -= payment_amount
                    remaining_amount_wei -= payment_amount_wei
                    
                    logger.info(f"Remaining amount after pool {pool_address}: {remaining_amount}")
                    
                else:
                    logger.warning(f"Fallback transaction failed for {tx_id}: {receipt}")
                    notifications.append({"id": str(int(time.time() * 1000)), "message": f"Transaction failed for pool {pool_address[:10]}...", "type": "warning"})
                    continue
                    
            except Exception as e:
                logger.error(f"Error processing pool {pool_address}: {str(e)}, error type: {type(e).__name__}, continuing with next pool")
                notifications.append({"id": str(int(time.time() * 1000)), "message": f"Error with pool {pool_address[:10]}...: {str(e)}", "type": "warning"})
                continue
        
        # Check if all amount was processed
        if remaining_amount > 0.001:  # Small tolerance for floating point precision
            logger.warning(f"Could not process full amount. Remaining: {remaining_amount}")
            notifications.append({"id": str(int(time.time() * 1000)), "message": f"Partially completed. Remaining amount: {remaining_amount:.6f}", "type": "warning"})
        
        if not successful_transactions:
            logger.error("No successful transactions were completed")
            notifications.append({"id": str(int(time.time() * 1000)), "message": "No transactions could be completed", "type": "error"})
            raise HTTPException(status_code=500, detail="No fallback payments could be processed")
        
        total_processed = sum(tx["amount"] for tx in successful_transactions)
        total_gas_used = sum(tx["gas_used"] for tx in successful_transactions)
        
        return {
            "success": True,
            "total_amount_processed": total_processed,
            "remaining_amount": remaining_amount,
            "transactions_count": len(successful_transactions),
            "transactions": successful_transactions,
            "total_gas_used": total_gas_used,
            "status": "completed" if remaining_amount <= 0.001 else "partially_completed",
            "notifications": notifications
        }
        
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
        redis_message = {
            "transaction_id": transaction_id,
            "user_id": request.userId,
            "merchant_address": request.merchantId,
            "amount": request.amount,
            "selected_bank": request.selectedBank,
            "user_geo_location": request.userGeoLocation,
            "primary_pool_id_for_fallback": request.primaryFallbackPoolId,
            "timestamp": time.time()
        }
        message_json = json.dumps(redis_message)

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
        "bank_statuses": agent.bank_statuses.copy(),
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    run_fastapi_server()