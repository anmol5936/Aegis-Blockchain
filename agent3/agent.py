import os
import json
import time
import logging
import threading # Keep for data_lock if used by non-async parts, otherwise can be removed if all access is async
import asyncio
from dotenv import load_dotenv
import redis
from web3 import Web3, HTTPProvider
from typing import List, Dict, Optional, Any # Ensure Any is imported

# FastAPI imports
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
import uvicorn
import math # For Haversine distance

load_dotenv()

# Pydantic Models
class GeoLocation(BaseModel):
    latitude: float
    longitude: float

class OptimalPoolRequest(BaseModel):
    userGeoLocation: GeoLocation
    userId: Optional[str] = None

class OptimalPoolResponse(BaseModel):
    optimalPoolId: Optional[str] = None
    regionName: Optional[str] = None
    error: Optional[str] = None
    message: Optional[str] = None

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Environment variables
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
ETH_PROVIDER_URL = os.getenv('ETH_PROVIDER_URL', 'http://127.0.0.1:7545')  # Ganache default
POOL_FACTORY_ADDRESS = os.getenv('VITE_POOL_FACTORY_ADDRESS')
STAKING_TOKEN_ADDRESS = os.getenv('VITE_STAKING_TOKEN_ADDRESS')
FETCH_INTERVAL_SECONDS = int(os.getenv('AGENT3_FETCH_INTERVAL_SECONDS', 60))
USER_ADDRESS_TO_MONITOR = os.getenv('AGENT3_USER_ADDRESS_TO_MONITOR', '0x6f6a29CD4b0fd655866c5f1A7fE3Fba89EfF7356')

# Load contract ABIs
try:
    POOL_FACTORY_ABI = json.load(open('../truffle-project/build/contracts/PoolFactory.json'))['abi']
    LIQUIDITY_POOL_ABI = json.load(open('../truffle-project/build/contracts/LiquidityPool.json'))['abi']
    ERC20_ABI = json.load(open('../truffle-project/build/contracts/ERC20.json'))['abi']
    LPERC20_ABI = json.load(open('../truffle-project/build/contracts/LPERC20.json'))['abi']
except FileNotFoundError as e:
    logger.error(f"Contract ABI file not found: {e}")
    raise

class LiquidityPoolOptimizerAgent:
    def __init__(self):
        # Initialize Redis
        try:
            self.redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=0, decode_responses=True)
            self.redis_client.ping()
            logger.info(f"Redis client connected to {REDIS_HOST}:{REDIS_PORT}")
        except redis.exceptions.ConnectionError as e:
            logger.error(f"Failed to connect to Redis: {e}")
            self.redis_client = None

        # Initialize Web3 provider
        try:
            self.w3 = Web3(HTTPProvider(ETH_PROVIDER_URL))
            if not self.w3.is_connected():
                raise ConnectionError("Failed to connect to Ethereum provider")
            logger.info(f"Connected to Ethereum provider at {ETH_PROVIDER_URL}")
        except Exception as e:
            logger.error(f"Failed to initialize Web3 provider: {e}")
            self.w3 = None

        # Initialize signer (use Ganache's first account)
        try:
            accounts = self.w3.eth.accounts
            if not accounts:
                raise ValueError("No accounts available in Ganache")
            self.signer_address = accounts[0]  # First Ganache account
            logger.info(f"Using Ganache account: {self.signer_address}")
        except Exception as e:
            logger.error(f"Failed to initialize signer: {e}")
            self.signer_address = None

        # Initialize contracts
        try:
            if not POOL_FACTORY_ADDRESS or not STAKING_TOKEN_ADDRESS:
                raise ValueError("POOL_FACTORY_ADDRESS or STAKING_TOKEN_ADDRESS not set")
            self.pool_factory_contract = self.w3.eth.contract(address=Web3.to_checksum_address(POOL_FACTORY_ADDRESS), abi=POOL_FACTORY_ABI)
            self.staking_token_contract = self.w3.eth.contract(address=Web3.to_checksum_address(STAKING_TOKEN_ADDRESS), abi=ERC20_ABI)
            logger.info(f"Contracts initialized: PoolFactory={POOL_FACTORY_ADDRESS}, StakingToken={STAKING_TOKEN_ADDRESS}")
        except Exception as e:
            logger.error(f"Failed to initialize contracts: {e}")
            self.pool_factory_contract = None
            self.staking_token_contract = None

        # In-memory storage
        self.blockchain_pools_data: List[Dict] = []
        self.user_data: Dict[str, Dict] = {} # Consider if this needs async lock if accessed by FastAPI endpoints directly
        self.data_lock = asyncio.Lock() # Use asyncio.Lock for async methods

        # Placeholder for pool region coordinates
        self.pool_region_coordinates: Dict[str, Dict[str, float]] = {
            "US-WEST": {"latitude": 36.7783, "longitude": -119.4179},  # California
            "US-EAST": {"latitude": 40.7128, "longitude": -74.0060},   # New York
            "EU-CENTRAL": {"latitude": 50.1109, "longitude": 8.6821},  # Frankfurt
            "APAC-SOUTH": {"latitude": 1.3521, "longitude": 103.8198} # Singapore
            # Add more regions as needed, ensure these match regionName from blockchain
        }
        logger.info(f"Initialized with predefined region coordinates: {self.pool_region_coordinates.keys()}")


    async def fetch_blockchain_pools(self) -> List[Dict]:
        """Fetches all liquidity pools from the blockchain."""
        if not self.pool_factory_contract:
            logger.error("PoolFactory contract not initialized")
            return []

        logger.info("Fetching blockchain pools data...")
        try:
            pool_count = self.pool_factory_contract.functions.getPoolCount().call()
            pool_addresses = self.pool_factory_contract.functions.getPools().call()
            pools_data = []

            for p_address in pool_addresses:
                if not Web3.is_checksum_address(p_address):
                    logger.warning(f"Invalid pool address: {p_address}")
                    continue

                pool_contract = self.w3.eth.contract(address=p_address, abi=LIQUIDITY_POOL_ABI)
                try:
                    region = pool_contract.functions.regionName().call()
                    total_liquidity = pool_contract.functions.totalLiquidity().call()
                    status = pool_contract.functions.getPoolStatus().call()
                    rewards_pot = pool_contract.functions.rewardsPot().call()
                    apy = pool_contract.functions.apy().call()
                    lp_token_supply = pool_contract.functions.lpTokenSupply().call()
                    total_debt = pool_contract.functions.getTotalDebt().call()

                    user_debt = pool_contract.functions.getActiveDebtAmount(USER_ADDRESS_TO_MONITOR).call() if USER_ADDRESS_TO_MONITOR else 0
                    user_debts = pool_contract.functions.getUserDebts(USER_ADDRESS_TO_MONITOR).call() if USER_ADDRESS_TO_MONITOR else []
                    stakers = []
                    if USER_ADDRESS_TO_MONITOR:
                        stake = await self.get_user_stake_info(p_address, USER_ADDRESS_TO_MONITOR)
                        if stake and stake['stakedAmount'] > 0:
                            stakers.append(stake)

                    decimals = self.staking_token_contract.functions.decimals().call()
                    pool_data = {
                        'id': p_address,
                        'regionName': region or f"UNKNOWN_REGION_{p_address[:6]}", # Ensure regionName is always present
                        'totalLiquidity': float(Web3.from_wei(total_liquidity, 'ether')),
                        'totalDebt': float(Web3.from_wei(total_debt, 'ether')),
                        'userDebt': float(Web3.from_wei(user_debt, 'ether')),
                        'stakers': stakers,
                        'debts': [
                            {
                                'user': debt[0],
                                'merchantAddress': debt[1],
                                'amount': float(Web3.from_wei(debt[2], 'ether')),
                                'timestamp': debt[3],
                                'isRepaid': debt[4]
                            } for debt in user_debts
                        ],
                        'status': {0: 'ACTIVE', 1: 'PAUSED', 2: 'INACTIVE'}.get(status, 'UNKNOWN'),
                        'rewardsPot': float(Web3.from_wei(rewards_pot, 'ether')),
                        'apy': apy / 100, # Assuming APY is stored as basis points (e.g., 500 for 5%)
                        'lpTokenSupply': float(Web3.from_wei(lp_token_supply, 'ether'))
                    }
                    pools_data.append(pool_data)
                    logger.debug(f"Fetched pool {p_address}: Region '{pool_data['regionName']}', Status '{pool_data['status']}'")
                except Exception as e:
                    logger.error(f"Error fetching details for pool {p_address}: {e}")

            async with self.data_lock: # Use async lock
                self.blockchain_pools_data = pools_data
            logger.info(f"Successfully fetched {len(pools_data)} blockchain pools")
            if self.redis_client:
                try:
                    self.redis_client.set("agent3:last_pool_fetch_timestamp", time.time())
                    self.redis_client.set("agent3:last_pool_count", len(pools_data))
                except redis.exceptions.ConnectionError as e:
                    logger.warning(f"Redis error while updating pool fetch stats: {e}")
            return pools_data
        except Exception as e:
            logger.error(f"Error fetching blockchain pools: {e}")
            return []

    async def get_user_stake_info(self, pool_address: str, user_address: str) -> Optional[Dict]:
        """Fetches user stake info for a specific pool."""
        if not user_address:
            logger.warning("No user address provided for stake info")
            return None

        pool_contract = self.w3.eth.contract(address=Web3.to_checksum_address(pool_address), abi=LIQUIDITY_POOL_ABI)
        try:
            stake = pool_contract.functions.getStake(user_address).call()
            decimals = self.staking_token_contract.functions.decimals().call()
            return {
                'userId': user_address,
                'stakedAmount': float(Web3.from_wei(stake[0], 'ether')),  # stakedAmount
                'collateralAmount': float(Web3.from_wei(stake[1], 'ether')),  # collateralAmount
                'lpTokensMinted': float(Web3.from_wei(stake[2], 'ether')),  # lpTokensMinted
                'stakeTimestamp': stake[3]  # stakeTimestamp
            }
        except Exception as e:
            logger.error(f"Error fetching stake info for {user_address} in pool {pool_address}: {e}")
            return None

    async def fetch_user_data(self, user_address: str) -> Optional[Dict]:
        """Fetches user data including token balance and LP token balances."""
        if not user_address:
            logger.warning("No user address provided for fetch_user_data")
            return None

        logger.info(f"Fetching user data for address: {user_address}")
        try:
            token_balance = self.staking_token_contract.functions.balanceOf(user_address).call()
            decimals = self.staking_token_contract.functions.decimals().call()
            pools = await self.fetch_blockchain_pools()
            lp_token_balances = {}

            for pool in pools:
                stake_info = await self.get_user_stake_info(pool['id'], user_address)
                if stake_info:
                    lp_token_balances[pool['id']] = stake_info['lpTokensMinted']

            user_data = {
                'id': user_address,
                'name': f"User ({user_address[:6]}...)",
                'tokenBalance': float(Web3.from_wei(token_balance, 'ether')),
                'lpTokenBalances': lp_token_balances
            }
            async with self.data_lock: # Use async lock
                self.user_data[user_address] = user_data
            logger.info(f"Successfully fetched user data for {user_address}")
            # logger.info(f"user_data {user_data}") # Can be verbose
            if self.redis_client:
                try:
                    self.redis_client.set(f"agent3:user_data_fetch_timestamp:{user_address}", time.time())
                except redis.exceptions.ConnectionError as e:
                    logger.warning(f"Redis error while updating user data fetch stats: {e}")
            return user_data
        except Exception as e:
            logger.error(f"Failed to fetch user data for {user_address}: {e}")
            return None

    def simple_pool_optimizer(self):
        """Analyzes pools and user data for optimization."""
        with self.data_lock:
            pools = self.blockchain_pools_data
            user_info = self.user_data.get(USER_ADDRESS_TO_MONITOR)

        if not pools:
            logger.info("Pool Optimizer: No pool data available to analyze.")
            return

        logger.info(f"Pool Optimizer: Analyzing {len(pools)} pools.")
        best_pool_by_liquidity = None
        max_liquidity = -1
        for pool in pools:
            if pool.get('totalLiquidity', 0) > max_liquidity:
                max_liquidity = pool['totalLiquidity']
                best_pool_by_liquidity = pool

        if best_pool_by_liquidity:
            logger.info(f"Optimizer: Pool with highest liquidity: {best_pool_by_liquidity.get('id')} ({best_pool_by_liquidity.get('regionName')}) with {max_liquidity} liquidity.")

        if user_info:
            logger.info(f"Optimizer: User {USER_ADDRESS_TO_MONITOR} data: Token Balance: {user_info.get('tokenBalance')}, LP Balances: {user_info.get('lpTokenBalances')}")
        else:
            logger.info(f"Optimizer: No specific data for user {USER_ADDRESS_TO_MONITOR} to analyze for optimization.")

    def simple_pool_optimizer(self):
        """Analyzes pools and user data for optimization."""
        # This method is synchronous, ensure data_lock handles this if it's called from an async context
        # For now, assuming it's called from the main async loop which handles the lock.
        # If called directly by a FastAPI endpoint, data_lock needs to be asyncio.Lock and used with `async with`.
        # However, this specific function is not directly exposed via an endpoint.
        # pools = self.blockchain_pools_data # Access directly if lock is managed by caller
        # user_info = self.user_data.get(USER_ADDRESS_TO_MONITOR)

        if not self.blockchain_pools_data: # Check if data is loaded
            logger.info("Pool Optimizer: No pool data available to analyze (yet).")
            return

        logger.info(f"Pool Optimizer: Analyzing {len(self.blockchain_pools_data)} pools.")
        best_pool_by_liquidity = None
        max_liquidity = -1
        for pool in self.blockchain_pools_data: # Iterate over the current snapshot
            if pool.get('totalLiquidity', 0) > max_liquidity and pool.get('status') == 'ACTIVE':
                max_liquidity = pool['totalLiquidity']
                best_pool_by_liquidity = pool

        if best_pool_by_liquidity:
            logger.info(f"Optimizer: Pool with highest liquidity (ACTIVE): {best_pool_by_liquidity.get('id')} ({best_pool_by_liquidity.get('regionName')}) with {max_liquidity} liquidity.")
        else:
            logger.info("Optimizer: No active pools found or no pools with liquidity.")

        current_user_data = self.user_data.get(USER_ADDRESS_TO_MONITOR) # Access current snapshot
        if current_user_data:
            logger.info(f"Optimizer: User {USER_ADDRESS_TO_MONITOR} data: Token Balance: {current_user_data.get('tokenBalance')}, LP Balances: {current_user_data.get('lpTokenBalances')}")
        else:
            logger.info(f"Optimizer: No specific data for user {USER_ADDRESS_TO_MONITOR} to analyze for optimization.")


    @staticmethod
    def calculate_haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate the great circle distance between two points on the earth (specified in decimal degrees)."""
        # Convert decimal degrees to radians
        lon1, lat1, lon2, lat2 = map(math.radians, [lon1, lat1, lon2, lat2])

        # Haversine formula
        dlon = lon2 - lon1
        dlat = lat2 - lat1
        a = math.sin(dlat / 2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2)**2
        c = 2 * math.asin(math.sqrt(a))
        r = 6371  # Radius of earth in kilometers. Use 3956 for miles
        return c * r

    async def find_closest_pool(self, user_geo: GeoLocation) -> Optional[Dict[str, Any]]:
        """Finds the closest active liquidity pool to the user's geolocation."""
        async with self.data_lock: # Ensure thread-safe access to shared data
            if not self.blockchain_pools_data:
                logger.info("find_closest_pool: No blockchain pool data available. Attempting to fetch.")
                # This direct call within a lock might be an issue if fetch_blockchain_pools also takes the lock.
                # It's better if fetch_blockchain_pools is called periodically by the background task.
                # For now, let's assume blockchain_pools_data is populated by the background task.
                # If called before first fetch, it will return None.
                pass # Data will be fetched by background task.

        if not self.blockchain_pools_data:
            logger.warning("find_closest_pool: Blockchain pool data is still empty after check.")
            return None

        min_distance = float('inf')
        closest_pool_info = None

        logger.debug(f"find_closest_pool: User location: lat={user_geo.latitude}, lon={user_geo.longitude}")
        logger.debug(f"find_closest_pool: Available pools for distance calculation: {len(self.blockchain_pools_data)}")

        for pool_data in self.blockchain_pools_data:
            if pool_data.get('status') != 'ACTIVE':
                logger.debug(f"Skipping inactive/paused pool {pool_data.get('id')}: Status {pool_data.get('status')}")
                continue

            region_name = pool_data.get('regionName')
            if not region_name:
                logger.warning(f"Pool {pool_data.get('id')} has no regionName. Skipping.")
                continue

            pool_coords = self.pool_region_coordinates.get(region_name.upper()) # Ensure case-insensitivity if needed

            if pool_coords:
                distance = self.calculate_haversine_distance(
                    user_geo.latitude, user_geo.longitude,
                    pool_coords['latitude'], pool_coords['longitude']
                )
                logger.debug(f"Pool {pool_data.get('id')} (Region: {region_name}, Coords: {pool_coords}): Distance = {distance:.2f} km")
                if distance < min_distance:
                    min_distance = distance
                    closest_pool_info = pool_data
            else:
                logger.warning(f"No coordinates found for region: {region_name} (Pool ID: {pool_data.get('id')}). Skipping this pool for distance calculation.")

        if closest_pool_info:
            logger.info(f"Closest active pool found: {closest_pool_info.get('id')} (Region: {closest_pool_info.get('regionName')}) at {min_distance:.2f} km.")
        else:
            logger.info("No suitable (active, with coordinates) pool found.")

        return closest_pool_info

    async def monitor_payments_and_update_status(self):
        """Monitors blockchain transaction statuses and updates Redis."""
        # logger.info("monitor_payments_and_update_status") # Can be too frequent
        if not self.redis_client:
            logger.warning("Redis not available for payment monitoring")
            return

        try:
            pending_tx_keys = self.redis_client.keys("pending_tx:*")
            for key in pending_tx_keys:
                try:
                    tx_info_json = self.redis_client.get(key)
                    if not tx_info_json:
                        continue
                    tx_info = json.loads(tx_info_json)
                    tx_id = tx_info.get("transaction_id")
                    tx_hash = tx_info.get("tx_hash")
                    tx_type = tx_info.get("type")

                    if tx_type == "blockchain" and tx_hash:
                        logger.info(f"Checking status of blockchain tx {tx_id} (hash: {tx_hash})")
                        try:
                            receipt = self.w3.eth.get_transaction_receipt(tx_hash)
                            if receipt:
                                if receipt['status'] == 1:
                                    logger.info(f"Transaction {tx_id} confirmed")
                                    self.redis_client.set(f"final_tx_status:{tx_id}", "confirmed_blockchain")
                                    self.redis_client.delete(key)
                                elif receipt['status'] == 0:
                                    logger.warning(f"Transaction {tx_id} failed")
                                    self.redis_client.set(f"final_tx_status:{tx_id}", "failed_blockchain")
                                    self.redis_client.delete(key)
                            else:
                                logger.debug(f"Transaction {tx_id} still pending")
                        except self.w3.exceptions.TransactionNotFound:
                            logger.debug(f"Transaction {tx_id} not found yet")
                except Exception as e:
                    logger.error(f"Error processing transaction {key}: {e}")
        except redis.exceptions.ConnectionError as e:
            logger.warning(f"Redis error in payment monitoring: {e}")
        except Exception as e:
            logger.error(f"Unexpected error in payment monitoring: {e}")

    def _ensure_redis_connection(self) -> bool:
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

    async def start(self):
        logger.info(f"LiquidityPoolOptimizerAgent started. Fetch interval: {FETCH_INTERVAL_SECONDS}s.")
        logger.info(f"Monitoring user address: {USER_ADDRESS_TO_MONITOR}")

        if not self._ensure_redis_connection():
            logger.fatal("Cannot start Agent 3: Redis connection failed on startup.")
            return

        if not self.w3 or not self.signer_address or not self.pool_factory_contract:
            logger.fatal("Cannot start Agent 3: Ethereum provider or contracts not initialized.")
            return

        try:
            loop_count = 0
            while True:
                async with self.data_lock: # Ensure data consistency during updates
                    await self.fetch_blockchain_pools()
                    if USER_ADDRESS_TO_MONITOR:
                        await self.fetch_user_data(USER_ADDRESS_TO_MONITOR)
                    else:
                        if loop_count == 0: logger.info("No specific user address configured to fetch data for.")

                    self.simple_pool_optimizer() # This is synchronous but accesses data protected by the lock

                await self.monitor_payments_and_update_status() # Accesses Redis, not shared agent state directly
                
                if loop_count % 10 == 0 : # Log less frequently for the loop completion
                    logger.info(f"Agent 3 main loop completed (iteration {loop_count}). Waiting for {FETCH_INTERVAL_SECONDS} seconds.")
                loop_count += 1
                await asyncio.sleep(FETCH_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            logger.info("Agent 3 main monitoring loop was cancelled.") # Expected on shutdown
        except KeyboardInterrupt: # Should not happen if Uvicorn handles shutdown
            logger.info("LiquidityPoolOptimizerAgent main loop stopped by user (KeyboardInterrupt).")
        except Exception as e:
            logger.error(f"An unexpected error occurred in LiquidityPoolOptimizerAgent main loop: {e}", exc_info=True)
        finally:
            logger.info("LiquidityPoolOptimizerAgent main monitoring loop shut down.")


# FastAPI Application Setup
app = FastAPI(title="Agent 3 - Liquidity Pool Optimizer API", version="1.0")
agent_instance = LiquidityPoolOptimizerAgent() # Global agent instance

def get_agent_instance(): # Dependency injector
    return agent_instance

@app.post("/findOptimalPool", response_model=OptimalPoolResponse)
async def find_optimal_pool_endpoint(request: OptimalPoolRequest, agent: LiquidityPoolOptimizerAgent = Depends(get_agent_instance)):
    logger.info(f"Received request for /findOptimalPool: UserLocation={request.userGeoLocation}, UserID={request.userId}")

    if not agent.w3 or not agent.pool_factory_contract: # Basic check
        logger.error("/findOptimalPool: Agent not fully initialized (Web3/Contracts missing).")
        raise HTTPException(status_code=503, detail="Service not fully initialized.")

    if not agent.blockchain_pools_data: # Check if initial data fetch has happened
         logger.warning("/findOptimalPool: Blockchain pool data not yet loaded. Agent might be starting.")
         # Optionally, trigger a fetch or wait, but for now, return service unavailable or try with current state.
         # This situation should be rare if the background task runs promptly.
         # For now, we proceed, and find_closest_pool will handle empty data.

    closest_pool_data = await agent.find_closest_pool(request.userGeoLocation)

    if closest_pool_data:
        logger.info(f"Optimal pool found: {closest_pool_data['id']} for user at {request.userGeoLocation}")
        return OptimalPoolResponse(
            optimalPoolId=closest_pool_data['id'],
            regionName=closest_pool_data['regionName'],
            message="Optimal pool found."
        )
    else:
        logger.warning(f"No suitable active pool found for user at {request.userGeoLocation}")
        # Consider returning 404 if no pool is found, or 200 with error message as per current OptimalPoolResponse
        return OptimalPoolResponse(
            error="No suitable active pool found or region data missing.",
            message="Could not determine optimal pool based on current data and location."
        )

@app.get("/health")
async def health_check(agent: LiquidityPoolOptimizerAgent = Depends(get_agent_instance)):
    is_redis_connected = False
    if agent.redis_client:
        try:
            agent.redis_client.ping()
            is_redis_connected = True
        except redis.exceptions.ConnectionError:
            is_redis_connected = False

    is_web3_connected = agent.w3.is_connected() if agent.w3 else False

    # Background task health (simple check: is data being populated?)
    has_pool_data = bool(agent.blockchain_pools_data)

    return {
        "status": "ok" if is_redis_connected and is_web3_connected and has_pool_data else "degraded",
        "redis_connected": is_redis_connected,
        "web3_connected": is_web3_connected,
        "initial_pool_data_loaded": has_pool_data,
        "monitored_user": USER_ADDRESS_TO_MONITOR or "None",
        "last_pool_count_from_redis": agent.redis_client.get("agent3:last_pool_count") if is_redis_connected else "N/A"
    }

@app.on_event("startup")
async def startup_event():
    logger.info("Agent 3 FastAPI server starting...")
    # Ensure Redis and Web3 are connected before starting the agent's tasks
    if not agent_instance._ensure_redis_connection(): # Use the global agent_instance
        logger.fatal("Agent 3 Startup: Redis connection failed. Background tasks may not function correctly.")
        # Depending on strictness, you might raise an error to prevent FastAPI startup
        # For now, we log and continue, background tasks will be impaired.

    if not agent_instance.w3 or not agent_instance.pool_factory_contract:
        logger.fatal("Agent 3 Startup: Web3 or contracts not initialized. Background tasks may not function correctly.")
        # Same as above, log and continue for now.

    # Start the agent's main loop as a background task
    # This task will periodically call fetch_blockchain_pools, fetch_user_data, etc.
    asyncio.create_task(agent_instance.start())
    logger.info("Agent 3's main monitoring loop (agent_instance.start()) has been scheduled in the background.")


if __name__ == '__main__':
    logger.info("Starting Agent 3 FastAPI server with Uvicorn...")
    # agent_instance is already created globally
    # The startup_event will trigger agent_instance.start()
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")