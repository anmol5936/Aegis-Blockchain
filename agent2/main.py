from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from web3 import Web3
import os
from dotenv import load_dotenv
import json
from typing import Optional
from fastapi.middleware.cors import CORSMiddleware
import time
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

app = FastAPI()

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load ABIs (adjust paths to your project structure)
try:
    with open("../truffle-project/build/contracts/LiquidityPool.json") as f:
        LiquidityPoolABI = json.load(f)["abi"]
    with open("../truffle-project/build/contracts/ERC20.json") as f:
        ERC20_ABI = json.load(f)["abi"]
    logger.info("ABIs loaded successfully")
except FileNotFoundError as e:
    logger.error(f"ABI file not found: {e}")
    raise Exception(f"ABI file not found: {e}")

# Environment variables
RPC_URL = "http://localhost:7545"  # Ganache or other Ethereum node
POOL_FACTORY_ADDRESS = "0xcF903862c4B2a91bE093cB718d3b4664947f6bcA"
STAKING_TOKEN_ADDRESS = "0x3c0a003CcBaE7642091A27C27e6AFb1F8Bd52C22"
SIGNER_ADDRESS = "0xCC1c0552E4b745209E61a1a82fAaB0381765FbEe"
SIGNER_PRIVATE_KEY = os.getenv("SIGNER_PRIVATE_KEY") or "0xe6d71364bc2b1ca74ea769953f1fd445d73c47f7c07ea2eebddf9e0f851c406a"

# Initialize Web3
w3 = Web3(Web3.HTTPProvider(RPC_URL))
if not w3.is_connected():
    logger.error("Failed to connect to Ethereum node")
    raise Exception("Failed to connect to Ethereum node")
else:
    logger.info(f"Connected to Ethereum node. Chain ID: {w3.eth.chain_id}")

# Convert addresses to checksum format
try:
    STAKING_TOKEN_ADDRESS = w3.to_checksum_address(STAKING_TOKEN_ADDRESS)
    SIGNER_ADDRESS = w3.to_checksum_address(SIGNER_ADDRESS)
    POOL_FACTORY_ADDRESS = w3.to_checksum_address(POOL_FACTORY_ADDRESS)
    logger.info("All addresses converted to checksum format")
except ValueError as e:
    logger.error(f"Invalid address format: {e}")
    raise Exception(f"Invalid address format: {e}")

# Initialize contracts
staking_token_contract = w3.eth.contract(address=STAKING_TOKEN_ADDRESS, abi=ERC20_ABI)

# Request models
class StakeRequest(BaseModel):
    poolAddress: str
    amount: str
    userAddress: Optional[str] = None

class RepayDebtRequest(BaseModel):
    poolAddress: str
    debtIndex: Optional[int] = None  # Make debtIndex optional
    amount: str

class FallbackPayRequest(BaseModel):
    primaryPoolAddress: str
    merchantAddress: str
    amount: str

# Utility functions
def create_notification(message: str, type: str = "info") -> dict:
    try:
        block_timestamp = w3.eth.get_block("latest").timestamp
        return {"id": str(int(block_timestamp * 1000)), "message": message, "type": type}
    except Exception as e:
        return {"id": str(int(time.time() * 1000)), "message": f"{message} (Notification ID error: {str(e)})", "type": type}

def get_gas_params():
    """Get appropriate gas parameters for the network"""
    try:
        latest_block = w3.eth.get_block('latest')
        base_fee = latest_block.get('baseFeePerGas')
        if base_fee:
            max_priority_fee = w3.to_wei(2, 'gwei')
            max_fee_per_gas = base_fee * 2 + max_priority_fee
            logger.info(f"Using EIP-1559 gas params: maxFeePerGas={max_fee_per_gas}, maxPriorityFeePerGas={max_priority_fee}")
            return {"maxFeePerGas": max_fee_per_gas, "maxPriorityFeePerGas": max_priority_fee}
        else:
            gas_price = w3.eth.gas_price
            logger.info(f"Using legacy gas price: {gas_price}")
            return {"gasPrice": gas_price}
    except Exception as e:
        logger.warning(f"Gas params error, falling back to legacy: {e}")
        try:
            gas_price = w3.eth.gas_price
            return {"gasPrice": gas_price}
        except Exception as fallback_error:
            logger.error(f"Failed to get gas price: {fallback_error}")
            return {"gasPrice": w3.to_wei(20, 'gwei')}

def parse_token_amount(amount_str: str, decimals: int) -> int:
    """Properly parse token amount to Wei equivalent"""
    try:
        amount_float = float(amount_str)
        if amount_float <= 0:
            raise ValueError("Amount must be positive")
        amount_wei = int(amount_float * (10 ** decimals))
        logger.info(f"Parsed amount: {amount_str} -> {amount_wei} wei (decimals: {decimals})")
        return amount_wei
    except (ValueError, OverflowError) as e:
        logger.error(f"Amount parsing error: {e}")
        raise ValueError(f"Invalid amount format: {str(e)}")

def sign_and_send_transaction(transaction_dict, private_key):
    """Sign and send transactions compatible with newer web3.py versions"""
    try:
        signed_txn = w3.eth.account.sign_transaction(transaction_dict, private_key)
        if hasattr(signed_txn, 'rawTransaction'):
            tx_hash = w3.eth.send_raw_transaction(signed_txn.rawTransaction)
        elif hasattr(signed_txn, 'raw_transaction'):
            tx_hash = w3.eth.send_raw_transaction(signed_txn.raw_transaction)
        else:
            tx_hash = w3.eth.send_raw_transaction(signed_txn['rawTransaction'])
        return tx_hash
    except Exception as e:
        logger.error(f"Transaction signing/sending error: {e}")
        raise e

@app.post("/stake")
async def stake_in_pool(request: StakeRequest):
    """Endpoint to stake tokens in a liquidity pool"""
    logger.info(f"Stake request received: poolAddress={request.poolAddress}, amount={request.amount}")
    
    try:
        pool_address = w3.to_checksum_address(request.poolAddress)
        if not w3.is_address(STAKING_TOKEN_ADDRESS):
            return {
                "success": False,
                "notifications": [create_notification("Invalid staking token address", "error")]
            }
        if not SIGNER_ADDRESS or not SIGNER_PRIVATE_KEY:
            return {
                "success": False,
                "notifications": [create_notification("Wallet not configured", "error")]
            }
        target_address = w3.to_checksum_address(request.userAddress) if request.userAddress else SIGNER_ADDRESS
        pool_contract = w3.eth.contract(address=pool_address, abi=LiquidityPoolABI)
        
        pool_staking_token = pool_contract.functions.stakingToken().call()
        if pool_staking_token.lower() != STAKING_TOKEN_ADDRESS.lower():
            return {
                "success": False,
                "notifications": [create_notification("Pool uses a different staking token", "error")]
            }
        
        decimals = staking_token_contract.functions.decimals().call()
        amount_wei = parse_token_amount(request.amount, decimals)
        
        user_balance = staking_token_contract.functions.balanceOf(target_address).call()
        if user_balance < amount_wei:
            return {
                "success": False,
                "notifications": [create_notification("Insufficient token balance", "error")]
            }
        
        current_allowance = staking_token_contract.functions.allowance(target_address, pool_address).call()
        notifications = []
        
        if current_allowance < amount_wei:
            notifications.append(create_notification("Insufficient token allowance. Approving tokens...", "info"))
            gas_params = get_gas_params()
            gas_estimate = staking_token_contract.functions.approve(pool_address, amount_wei).estimate_gas({"from": target_address})
            nonce = w3.eth.get_transaction_count(target_address)
            approve_tx_params = {"from": target_address, "nonce": nonce, "gas": gas_estimate + 10000, **gas_params}
            approve_tx = staking_token_contract.functions.approve(pool_address, amount_wei).build_transaction(approve_tx_params)
            
            approve_tx_hash = sign_and_send_transaction(approve_tx, SIGNER_PRIVATE_KEY)
            receipt = w3.eth.wait_for_transaction_receipt(approve_tx_hash, timeout=120)
            
            if receipt.status == 1:
                notifications.append(create_notification(f"Token approval confirmed. Hash: {approve_tx_hash.hex()[:10]}...", "success"))
            else:
                notifications.append(create_notification("Token approval failed", "error"))
                return {"success": False, "notifications": notifications}
        
        if not hasattr(pool_contract.functions, 'stake'):
            return {
                "success": False,
                "notifications": [create_notification("Pool contract does not have a stake function", "error")]
            }
        
        stake_function = pool_contract.functions.stake
        stake_function(amount_wei).call({"from": target_address})
        
        gas_estimate = stake_function(amount_wei).estimate_gas({"from": target_address})
        gas_params = get_gas_params()
        nonce = w3.eth.get_transaction_count(target_address)
        stake_tx_params = {"from": target_address, "nonce": nonce, "gas": gas_estimate + 20000, **gas_params}
        stake_tx = stake_function(amount_wei).build_transaction(stake_tx_params)
        
        stake_tx_hash = sign_and_send_transaction(stake_tx, SIGNER_PRIVATE_KEY)
        notifications.append(create_notification(f"Stake transaction sent. Hash: {stake_tx_hash.hex()[:10]}...", "info"))
        
        receipt = w3.eth.wait_for_transaction_receipt(stake_tx_hash, timeout=120)
        if receipt.status == 1:
            notifications.append(create_notification(f"Successfully staked {request.amount} tokens!", "success"))
            return {
                "success": True,
                "transactionHash": stake_tx_hash.hex(),
                "gasUsed": receipt.gasUsed,
                "notifications": notifications
            }
        else:
            notifications.append(create_notification("Stake transaction failed", "error"))
            return {"success": False, "notifications": notifications}
    
    except Exception as e:
        error_message = str(e).lower()
        if "insufficient funds" in error_message:
            error_message = "Insufficient funds for transaction"
        elif "user rejected" in error_message:
            error_message = "Transaction rejected by user"
        elif "execution reverted" in error_message:
            error_message = "Transaction reverted - check pool status and balance"
        elif "insufficient allowance" in error_message:
            error_message = "Insufficient token allowance"
        elif "invalid address" in error_message:
            error_message = "Invalid address provided"
        elif "fb8f41b2" in str(e):
            error_message = "Pool contract rejected the transaction. Check if pool is active and requirements are met."
        else:
            error_message = f"Staking failed: {str(e)}"
        return {
            "success": False,
            "notifications": [create_notification(error_message, "error")]
        }

@app.post("/fallbackPay")
async def fallback_pay(request: FallbackPayRequest):
    """Endpoint to perform fallback payment to a merchant via the pool contract"""
    logger.info(f"FallbackPay request received: poolAddress={request.primaryPoolAddress}, merchantAddress={request.merchantAddress}, amount={request.amount}")
    notifications = []
    
    try:
        pool_address = w3.to_checksum_address(request.primaryPoolAddress)
        merchant_address = w3.to_checksum_address(request.merchantAddress)
        if not SIGNER_ADDRESS or not SIGNER_PRIVATE_KEY:
            return {
                "success": False,
                "notifications": [create_notification("Wallet not configured", "error")]
            }
        
        pool_contract = w3.eth.contract(address=pool_address, abi=LiquidityPoolABI)
        decimals = staking_token_contract.functions.decimals().call()
        amount_wei = parse_token_amount(request.amount, decimals)
        
        current_allowance = staking_token_contract.functions.allowance(SIGNER_ADDRESS, pool_address).call()
        if current_allowance < amount_wei:
            notifications.append(create_notification("Insufficient token allowance. Approving tokens...", "info"))
            gas_params = get_gas_params()
            gas_estimate = staking_token_contract.functions.approve(pool_address, amount_wei).estimate_gas({"from": SIGNER_ADDRESS})
            nonce = w3.eth.get_transaction_count(SIGNER_ADDRESS)
            approve_tx_params = {"from": SIGNER_ADDRESS, "nonce": nonce, "gas": gas_estimate + 10000, **gas_params}
            approve_tx = staking_token_contract.functions.approve(pool_address, amount_wei).build_transaction(approve_tx_params)
            
            approve_tx_hash = sign_and_send_transaction(approve_tx, SIGNER_PRIVATE_KEY)
            receipt = w3.eth.wait_for_transaction_receipt(approve_tx_hash, timeout=120)
            
            if receipt.status == 1:
                notifications.append(create_notification(f"Token approval confirmed. Hash: {approve_tx_hash.hex()[:10]}...", "success"))
            else:
                notifications.append(create_notification("Token approval failed", "error"))
                return {"success": False, "notifications": notifications}
            
            new_allowance = staking_token_contract.functions.allowance(SIGNER_ADDRESS, pool_address).call()
            if new_allowance < amount_wei:
                return {
                    "success": False,
                    "notifications": [create_notification("Token approval was not sufficient", "error")]
                }
        
        gas_params = get_gas_params()
        nonce = w3.eth.get_transaction_count(SIGNER_ADDRESS)
        gas_estimate = pool_contract.functions.fallbackPay(merchant_address, amount_wei).estimate_gas({"from": SIGNER_ADDRESS})
        fallback_tx_params = {"from": SIGNER_ADDRESS, "nonce": nonce, "gas": gas_estimate + 20000, **gas_params}
        fallback_tx = pool_contract.functions.fallbackPay(merchant_address, amount_wei).build_transaction(fallback_tx_params)
        
        fallback_tx_hash = sign_and_send_transaction(fallback_tx, SIGNER_PRIVATE_KEY)
        notifications.append(create_notification(f"fallbackPay transaction sent. Hash: {fallback_tx_hash.hex()[:10]}...", "info"))
        
        receipt = w3.eth.wait_for_transaction_receipt(fallback_tx_hash, timeout=120)
        if receipt.status == 1:
            notifications.append(create_notification(f"Successfully sent fallbackPay of {request.amount} tokens!", "success"))
            return {
                "success": True,
                "transactionHash": fallback_tx_hash.hex(),
                "gasUsed": receipt.gasUsed,
                "notifications": notifications
            }
        else:
            notifications.append(create_notification("fallbackPay transaction failed", "error"))
            return {"success": False, "notifications": notifications}
    
    except Exception as e:
        error_message = str(e).lower()
        if "insufficient funds" in error_message:
            error_message = "Insufficient funds for transaction"
        elif "user rejected" in error_message:
            error_message = "Transaction rejected by user"
        elif "execution reverted" in error_message:
            error_message = "Transaction reverted - check pool status and balance"
        elif "insufficient allowance" in error_message:
            error_message = "Insufficient token allowance"
        elif "invalid address" in error_message:
            error_message = "Invalid address provided"
        else:
            error_message = f"fallbackPay failed: {str(e)}"
        return {
            "success": False,
            "notifications": [create_notification(error_message, "error")]
        }

@app.post("/repayDebt")
async def repay_debt(request: RepayDebtRequest):
    """Endpoint to repay a specific debt in a pool, with optional debt index for automation"""
    logger.info(f"RepayDebt request received: poolAddress={request.poolAddress}, debtIndex={request.debtIndex}, amount={request.amount}")
    notifications = []

    try:
        # Validate pool address
        pool_address = w3.to_checksum_address(request.poolAddress)
        logger.info(f"Pool address validated: {pool_address}")

        # Validate wallet configuration
        if not SIGNER_ADDRESS or not SIGNER_PRIVATE_KEY:
            logger.error("Wallet not configured")
            return {
                "success": False,
                "notifications": [create_notification("Wallet not configured", "error")]
            }

        # Initialize pool contract
        pool_contract = w3.eth.contract(address=pool_address, abi=LiquidityPoolABI)
        logger.info("Pool contract initialized")

        # Get token decimals
        decimals = staking_token_contract.functions.decimals().call()
        logger.info(f"Token decimals: {decimals}")

        # Convert amount to Wei
        amount_wei = parse_token_amount(request.amount, decimals)
        logger.info(f"Requested repayment amount: {request.amount} tokens ({amount_wei} wei)")

        # Fetch user debts
        user_debts = pool_contract.functions.getUserDebts(SIGNER_ADDRESS).call()
        logger.info(f"Fetched user debts: {user_debts}")

        # Find unpaid debts
        unpaid_debts = [(i, debt) for i, debt in enumerate(user_debts) if len(debt) > 4 and not debt[4]]
        unpaid_indices = [i for i, _ in unpaid_debts]
        logger.info(f"Unpaid debt indices: {unpaid_indices}")

        if not unpaid_debts:
            logger.error("No unpaid debts found")
            return {
                "success": False,
                "notifications": [create_notification("No unpaid debts found for this user", "error")]
            }

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
                return {
                    "success": False,
                    "notifications": [create_notification(
                        f"Invalid debt index {selected_debt_index}. Available unpaid debt indices: {unpaid_indices or 'none'}",
                        "error"
                    )]
                }
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
            logger.error(f"Debt tuple structure error: {e}")
            return {
                "success": False,
                "notifications": [create_notification(f"Invalid debt tuple structure: {str(e)}", "error")]
            }

        # Check if debt is already repaid
        if debt_struct["isRepaid"]:
            logger.error(f"Debt at index {selected_debt_index} already repaid")
            return {
                "success": False,
                "notifications": [create_notification(
                    f"Debt at index {selected_debt_index} is already repaid. Available unpaid debt indices: {unpaid_indices or 'none'}",
                    "error"
                )]
            }

        # Validate repayment amount
        if amount_wei > debt_struct["amount"]:
            logger.error(f"Repayment amount {amount_wei} exceeds debt {debt_struct['amount']}")
            debt_amount_tokens = debt_struct["amount"] / (10 ** decimals)
            return {
                "success": False,
                "notifications": [create_notification(
                    f"Repayment amount {request.amount} tokens exceeds debt {debt_amount_tokens} tokens",
                    "error"
                )]
            }

        # Check user token balance
        user_balance = staking_token_contract.functions.balanceOf(SIGNER_ADDRESS).call()
        logger.info(f"User balance: {user_balance} wei ({user_balance / (10 ** decimals)} tokens)")
        if user_balance < amount_wei:
            logger.error(f"Insufficient token balance: {user_balance} < {amount_wei}")
            return {
                "success": False,
                "notifications": [create_notification("Insufficient token balance for repayment", "error")]
            }

        # Check current allowance
        current_allowance = staking_token_contract.functions.allowance(SIGNER_ADDRESS, pool_address).call()
        logger.info(f"Current allowance: {current_allowance} wei ({current_allowance / (10 ** decimals)} tokens)")

        # Approve tokens if needed
        if current_allowance < amount_wei:
            logger.info("Insufficient allowance, requesting approval")
            notifications.append(create_notification("Insufficient token allowance. Approving tokens...", "info"))
            gas_params = get_gas_params()
            gas_estimate = staking_token_contract.functions.approve(pool_address, amount_wei).estimate_gas({"from": SIGNER_ADDRESS})
            nonce = w3.eth.get_transaction_count(SIGNER_ADDRESS)
            approve_tx_params = {"from": SIGNER_ADDRESS, "nonce": nonce, "gas": gas_estimate + 10000, **gas_params}
            approve_tx = staking_token_contract.functions.approve(pool_address, amount_wei).build_transaction(approve_tx_params)

            approve_tx_hash = sign_and_send_transaction(approve_tx, SIGNER_PRIVATE_KEY)
            receipt = w3.eth.wait_for_transaction_receipt(approve_tx_hash, timeout=120)
            logger.info(f"Approval receipt: status={receipt.status}, gasUsed={receipt.gasUsed}")

            if receipt.status == 1:
                notifications.append(create_notification(f"Token approval confirmed. Hash: {approve_tx_hash.hex()[:10]}...", "success"))
            else:
                notifications.append(create_notification("Token approval failed", "error"))
                return {"success": False, "notifications": notifications}

            new_allowance = staking_token_contract.functions.allowance(SIGNER_ADDRESS, pool_address).call()
            logger.info(f"New allowance after approval: {new_allowance} wei")
            if new_allowance < amount_wei:
                return {
                    "success": False,
                    "notifications": [create_notification("Token approval was not sufficient", "error")]
                }

        # Simulate repayDebt to catch issues
        try:
            pool_contract.functions.repayDebt(selected_debt_index, amount_wei).call({"from": SIGNER_ADDRESS})
            logger.info(f"RepayDebt simulation successful for index {selected_debt_index}")
        except Exception as e:
            logger.error(f"RepayDebt simulation failed: {e}")
            return {
                "success": False,
                "notifications": [create_notification(f"RepayDebt simulation failed: {str(e)}", "error")]
            }

        # Estimate gas for repayDebt transaction
        gas_estimate = pool_contract.functions.repayDebt(selected_debt_index, amount_wei).estimate_gas({"from": SIGNER_ADDRESS})
        logger.info(f"repayDebt gas estimate: {gas_estimate}")

        # Build and send repayDebt transaction
        gas_params = get_gas_params()
        nonce = w3.eth.get_transaction_count(SIGNER_ADDRESS)
        repay_tx_params = {"from": SIGNER_ADDRESS, "nonce": nonce, "gas": gas_estimate + 20000, **gas_params}
        repay_tx = pool_contract.functions.repayDebt(selected_debt_index, amount_wei).build_transaction(repay_tx_params)

        repay_tx_hash = sign_and_send_transaction(repay_tx, SIGNER_PRIVATE_KEY)
        logger.info(f"repayDebt transaction sent: {repay_tx_hash.hex()}")
        notifications.append(create_notification(f"repayDebt transaction sent. Hash: {repay_tx_hash.hex()[:10]}...", "info"))

        receipt = w3.eth.wait_for_transaction_receipt(repay_tx_hash, timeout=120)
        logger.info(f"repayDebt receipt: status={receipt.status}, gasUsed={receipt.gasUsed}")

        if receipt.status == 1:
            notifications.append(create_notification(f"Successfully repaid {request.amount} tokens for debt index {selected_debt_index}!", "success"))
            return {
                "success": True,
                "transactionHash": repay_tx_hash.hex(),
                "gasUsed": receipt.gasUsed,
                "selectedDebtIndex": selected_debt_index,  # Return selected index for client confirmation
                "notifications": notifications
            }
        else:
            notifications.append(create_notification("repayDebt transaction failed", "error"))
            return {"success": False, "notifications": notifications}

    except Exception as e:
        logger.error(f"Unexpected error in repayDebt endpoint: {e}")
        error_message = str(e).lower()
        if "insufficient funds" in error_message:
            error_message = "Insufficient funds for transaction"
        elif "user rejected" in error_message:
            error_message = "Transaction rejected by user"
        elif "execution reverted" in error_message:
            error_message = "Transaction reverted - check pool status and debt"
        elif "insufficient allowance" in error_message:
            error_message = "Insufficient token allowance"
        elif "invalid address" in error_message:
            error_message = "Invalid address provided"
        else:
            error_message = f"RepayDebt failed: {str(e)}"
        return {
            "success": False,
            "notifications": [create_notification(error_message, "error")]
        }

@app.get("/health")
async def health_check():
    try:
        chain_id = w3.eth.chain_id if w3.is_connected() else None
        latest_block = w3.eth.block_number if w3.is_connected() else None
        token_symbol = staking_token_contract.functions.symbol().call()
        return {
            "status": "healthy",
            "web3_connected": w3.is_connected(),
            "network_id": chain_id,
            "latest_block": latest_block,
            "token_contract_responsive": token_symbol is not None,
            "token_symbol": token_symbol,
            "signer_address": SIGNER_ADDRESS,
            "staking_token_address": STAKING_TOKEN_ADDRESS
        }
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}

@app.get("/token-info")
async def get_token_info():
    try:
        name = staking_token_contract.functions.name().call()
        symbol = staking_token_contract.functions.symbol().call()
        decimals = staking_token_contract.functions.decimals().call()
        total_supply = staking_token_contract.functions.totalSupply().call()
        return {
            "name": name,
            "symbol": symbol,
            "decimals": decimals,
            "totalSupply": str(total_supply),
            "address": STAKING_TOKEN_ADDRESS
        }
    except Exception as e:
        logger.error(f"Failed to fetch token info: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch token info: {str(e)}")

@app.get("/debug/signer-balance")
async def debug_signer_balance():
    try:
        eth_balance = w3.eth.get_balance(SIGNER_ADDRESS)
        ast_balance = staking_token_contract.functions.balanceOf(SIGNER_ADDRESS).call()
        decimals = staking_token_contract.functions.decimals().call()
        return {
            "signer_address": SIGNER_ADDRESS,
            "eth_balance_wei": str(eth_balance),
            "eth_balance_ether": str(w3.from_wei(eth_balance, 'ether')),
            "ast_balance_wei": str(ast_balance),
            "ast_balance_tokens": str(ast_balance / (10 ** decimals)),
            "token_decimals": decimals
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/debug/pool/{pool_address}")
async def debug_pool(pool_address: str):
    try:
        pool_address = w3.to_checksum_address(pool_address)
        pool_contract = w3.eth.contract(address=pool_address, abi=LiquidityPoolABI)
        result = {
            "pool_address": pool_address,
            "contract_code_exists": len(w3.eth.get_code(pool_address)) > 0,
            "contract_code_size": len(w3.eth.get_code(pool_address))
        }
        result["functions_tested"] = {}
        available_functions = []
        possible_functions = ['stake', 'deposit', 'stakeTokens', 'addStake', 'totalStaked', 'stakingToken', 'isActive', 'minimumStake', 'owner', 'paused']
        
        for func_name in possible_functions:
            if hasattr(pool_contract.functions, func_name):
                available_functions.append(func_name)
                if func_name in ['totalStaked', 'stakingToken', 'isActive', 'minimumStake', 'owner', 'paused']:
                    try:
                        value = getattr(pool_contract.functions, func_name)().call()
                        result["functions_tested"][f"{func_name}_value"] = str(value)
                    except Exception as e:
                        result["functions_tested"][f"{func_name}_error"] = str(e)
        
        result["available_functions"] = available_functions
        if 'stake' in available_functions:
            try:
                test_amount = 10 ** 18
                pool_contract.functions.stake(test_amount).call({"from": SIGNER_ADDRESS})
                result["functions_tested"]["stake_call_success"] = True
            except Exception as e:
                result["functions_tested"]["stake_call_error"] = str(e)
            try:
                gas_estimate = pool_contract.functions.stake(test_amount).estimate_gas({"from": SIGNER_ADDRESS})
                result["functions_tested"]["stake_gas_estimate"] = gas_estimate
            except Exception as e:
                result["functions_tested"]["stake_gas_error"] = str(e)
        
        return result
    except Exception as e:
        return {"error": str(e)}

@app.get("/debug/user-debts/{pool_address}")
async def debug_user_debts(pool_address: str):
    """Debug endpoint to fetch and inspect user debts for a given pool"""
    try:
        pool_address = w3.to_checksum_address(pool_address)
        pool_contract = w3.eth.contract(address=pool_address, abi=LiquidityPoolABI)
        decimals = staking_token_contract.functions.decimals().call()
        
        result = {
            "pool_address": pool_address,
            "signer_address": SIGNER_ADDRESS,
            "debts": []
        }
        
        user_debts = pool_contract.functions.getUserDebts(SIGNER_ADDRESS).call()
        logger.info(f"Raw user debts: {user_debts}")
        
        for index, debt in enumerate(user_debts):
            try:
                debt_struct = {
                    "index": index,
                    "user": debt[0] if len(debt) > 0 else None,
                    "merchantAddress": debt[1] if len(debt) > 1 else None,
                    "amount_wei": str(debt[2]) if len(debt) > 2 else None,
                    "amount_tokens": str(int(debt[2]) / (10 ** decimals)) if len(debt) > 2 else None,
                    "timestamp": debt[3] if len(debt) > 3 else None,
                    "isRepaid": debt[4] if len(debt) > 4 else None,
                    "raw_debt": debt
                }
                result["debts"].append(debt_struct)
            except IndexError as e:
                result["debts"].append({
                    "index": index,
                    "error": f"Invalid debt tuple structure: {str(e)}",
                    "raw_debt": debt
                })
        
        return result
    
    except Exception as e:
        logger.error(f"Failed to fetch user debts: {e}")
        return {
            "error": str(e),
            "pool_address": pool_address,
            "signer_address": SIGNER_ADDRESS
        }

@app.get("/debug/unpaid-debts/{pool_address}")
async def debug_unpaid_debts(pool_address: str):
    """Debug endpoint to fetch only unpaid user debts for a given pool"""
    try:
        pool_address = w3.to_checksum_address(pool_address)
        pool_contract = w3.eth.contract(address=pool_address, abi=LiquidityPoolABI)
        decimals = staking_token_contract.functions.decimals().call()
        
        result = {
            "pool_address": pool_address,
            "signer_address": SIGNER_ADDRESS,
            "unpaid_debts": []
        }
        
        user_debts = pool_contract.functions.getUserDebts(SIGNER_ADDRESS).call()
        logger.info(f"Raw user debts for unpaid debts: {user_debts}")
        
        for index, debt in enumerate(user_debts):
            try:
                if len(debt) > 4 and not debt[4]:  # Check if isRepaid is False
                    debt_struct = {
                        "index": index,
                        "user": debt[0],
                        "merchantAddress": debt[1],
                        "amount_wei": str(debt[2]),
                        "amount_tokens": str(int(debt[2]) / (10 ** decimals)),
                        "timestamp": debt[3],
                        "isRepaid": debt[4],
                        "raw_debt": debt
                    }
                    result["unpaid_debts"].append(debt_struct)
            except IndexError as e:
                logger.error(f"Invalid debt tuple structure at index {index}: {e}")
                result["unpaid_debts"].append({
                    "index": index,
                    "error": f"Invalid debt tuple structure: {str(e)}",
                    "raw_debt": debt
                })
        
        return result
    
    except Exception as e:
        logger.error(f"Failed to fetch unpaid debts: {e}")
        return {
            "error": str(e),
            "pool_address": pool_address,
            "signer_address": SIGNER_ADDRESS
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)