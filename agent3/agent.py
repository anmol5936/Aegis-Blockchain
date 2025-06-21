import os
import json
import time
import logging
import asyncio
from datetime import datetime
from typing import List, Dict, Optional
from contextlib import asynccontextmanager

import redis
import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from web3 import Web3, HTTPProvider

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Environment variables
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
ETH_PROVIDER_URL = os.getenv('ETH_PROVIDER_URL', 'http://127.0.0.1:7545')
POOL_FACTORY_ADDRESS = os.getenv('VITE_POOL_FACTORY_ADDRESS')
STAKING_TOKEN_ADDRESS = os.getenv('VITE_STAKING_TOKEN_ADDRESS')
FETCH_INTERVAL_SECONDS = int(os.getenv('AGENT3_FETCH_INTERVAL_SECONDS', 60))
USER_ADDRESS_TO_MONITOR = os.getenv('AGENT3_USER_ADDRESS_TO_MONITOR', '0x6f6a29CD4b0fd655866c5f1A7fE3Fba89EfF7356')
API_PORT = int(os.getenv('API_PORT', 8765))

# Pydantic Models
class StakeInfo(BaseModel):
    userId: str
    stakedAmount: float
    collateralAmount: float
    lpTokensMinted: float
    stakeTimestamp: int

class DebtInfo(BaseModel):
    user: str
    merchantAddress: str
    amount: float
    timestamp: int
    isRepaid: bool

class PoolData(BaseModel):
    id: str
    regionName: str
    totalLiquidity: float
    totalDebt: float
    userDebt: float
    stakers: List[StakeInfo]
    debts: List[DebtInfo]
    status: str
    rewardsPot: float
    apy: float
    lpTokenSupply: float
    lastUpdated: datetime

class UserData(BaseModel):
    id: str
    name: str
    tokenBalance: float
    lpTokenBalances: Dict[str, float]
    lastUpdated: datetime

class PoolsResponse(BaseModel):
    pools: List[PoolData]
    totalPools: int
    lastFetchTime: datetime
    sortedBy: str

class OptimizationRecommendation(BaseModel):
    recommendedPoolId: str
    recommendedPoolName: str
    reason: str
    maxLiquidity: float
    potentialApy: float

class LiquidityPoolService:
    def __init__(self):
        self.pools_data: List[Dict] = []
        self.user_data: Dict[str, Dict] = {}
        self.last_fetch_time: Optional[datetime] = None
        self.redis_client: Optional[redis.Redis] = None
        self.w3: Optional[Web3] = None
        self.pool_factory_contract = None
        self.staking_token_contract = None
        self._initialize_connections()
        self._load_contracts()

    def _initialize_connections(self):
        """Initialize Redis and Web3 connections"""
        try:
            self.redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=0, decode_responses=True)
            self.redis_client.ping()
            logger.info(f"Redis connected to {REDIS_HOST}:{REDIS_PORT}")
        except redis.exceptions.ConnectionError as e:
            logger.error(f"Redis connection failed: {e}")
            self.redis_client = None

        try:
            self.w3 = Web3(HTTPProvider(ETH_PROVIDER_URL))
            if not self.w3.is_connected():
                raise ConnectionError("Failed to connect to Ethereum provider")
            logger.info(f"Web3 connected to {ETH_PROVIDER_URL}")
        except Exception as e:
            logger.error(f"Web3 connection failed: {e}")
            self.w3 = None

    def _load_contracts(self):
        """Load contract ABIs and initialize contracts"""
        try:
            POOL_FACTORY_ABI = json.load(open('../truffle-project/build/contracts/PoolFactory.json'))['abi']
            LIQUIDITY_POOL_ABI = json.load(open('../truffle-project/build/contracts/LiquidityPool.json'))['abi']
            ERC20_ABI = json.load(open('../truffle-project/build/contracts/ERC20.json'))['abi']
            
            self.LIQUIDITY_POOL_ABI = LIQUIDITY_POOL_ABI
            
            if POOL_FACTORY_ADDRESS and STAKING_TOKEN_ADDRESS and self.w3:
                self.pool_factory_contract = self.w3.eth.contract(
                    address=Web3.to_checksum_address(POOL_FACTORY_ADDRESS), 
                    abi=POOL_FACTORY_ABI
                )
                self.staking_token_contract = self.w3.eth.contract(
                    address=Web3.to_checksum_address(STAKING_TOKEN_ADDRESS), 
                    abi=ERC20_ABI
                )
                logger.info("Contracts initialized successfully")
            else:
                raise ValueError("Missing contract addresses or Web3 connection")
                
        except FileNotFoundError as e:
            logger.error(f"Contract ABI file not found: {e}")
            raise
        except Exception as e:
            logger.error(f"Contract initialization failed: {e}")
            raise

    async def fetch_pools_data(self) -> List[Dict]:
        """Fetch all pools data from blockchain"""
        if not self.pool_factory_contract or not self.w3:
            logger.error("Contracts not initialized")
            return []

        try:
            pool_addresses = self.pool_factory_contract.functions.getPools().call()
            pools_data = []

            for pool_address in pool_addresses:
                if not Web3.is_checksum_address(pool_address):
                    continue

                pool_contract = self.w3.eth.contract(address=pool_address, abi=self.LIQUIDITY_POOL_ABI)
                
                try:
                    # Fetch pool data
                    region = pool_contract.functions.regionName().call()
                    total_liquidity = pool_contract.functions.totalLiquidity().call()
                    status = pool_contract.functions.getPoolStatus().call()
                    rewards_pot = pool_contract.functions.rewardsPot().call()
                    apy = pool_contract.functions.apy().call()
                    lp_token_supply = pool_contract.functions.lpTokenSupply().call()
                    total_debt = pool_contract.functions.getTotalDebt().call()

                    # User-specific data
                    user_debt = 0
                    user_debts = []
                    stakers = []
                    
                    if USER_ADDRESS_TO_MONITOR:
                        user_debt = pool_contract.functions.getActiveDebtAmount(USER_ADDRESS_TO_MONITOR).call()
                        user_debts = pool_contract.functions.getUserDebts(USER_ADDRESS_TO_MONITOR).call()
                        stake_info = await self._get_user_stake_info(pool_address, USER_ADDRESS_TO_MONITOR)
                        if stake_info and stake_info['stakedAmount'] > 0:
                            stakers.append(stake_info)

                    pool_data = {
                        'id': pool_address,
                        'regionName': region or f"Pool {pool_address[:8]}...",
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
                        'apy': apy / 100,
                        'lpTokenSupply': float(Web3.from_wei(lp_token_supply, 'ether')),
                        'lastUpdated': datetime.now()
                    }
                    pools_data.append(pool_data)
                    
                except Exception as e:
                    logger.error(f"Error fetching pool {pool_address}: {e}")

            self.pools_data = pools_data
            self.last_fetch_time = datetime.now()
            
            # Cache in Redis
            if self.redis_client:
                try:
                    self.redis_client.set("agent3:pools_data", json.dumps(pools_data, default=str))
                    self.redis_client.set("agent3:last_fetch_time", self.last_fetch_time.isoformat())
                except Exception as e:
                    logger.warning(f"Redis caching failed: {e}")

            logger.info(f"Fetched {len(pools_data)} pools successfully")
            return pools_data
            
        except Exception as e:
            logger.error(f"Error fetching pools data: {e}")
            return []

    async def _get_user_stake_info(self, pool_address: str, user_address: str) -> Optional[Dict]:
        """Get user stake information for a specific pool"""
        try:
            pool_contract = self.w3.eth.contract(address=Web3.to_checksum_address(pool_address), abi=self.LIQUIDITY_POOL_ABI)
            stake = pool_contract.functions.getStake(user_address).call()
            
            return {
                'userId': user_address,
                'stakedAmount': float(Web3.from_wei(stake[0], 'ether')),
                'collateralAmount': float(Web3.from_wei(stake[1], 'ether')),
                'lpTokensMinted': float(Web3.from_wei(stake[2], 'ether')),
                'stakeTimestamp': stake[3]
            }
        except Exception as e:
            logger.error(f"Error fetching stake info: {e}")
            return None

    async def fetch_user_data(self, user_address: str) -> Optional[Dict]:
        """Fetch user token balances and LP positions"""
        if not self.staking_token_contract or not user_address:
            return None

        try:
            token_balance = self.staking_token_contract.functions.balanceOf(user_address).call()
            lp_token_balances = {}

            for pool in self.pools_data:
                stake_info = await self._get_user_stake_info(pool['id'], user_address)
                if stake_info:
                    lp_token_balances[pool['id']] = stake_info['lpTokensMinted']

            user_data = {
                'id': user_address,
                'name': f"User ({user_address[:6]}...)",
                'tokenBalance': float(Web3.from_wei(token_balance, 'ether')),
                'lpTokenBalances': lp_token_balances,
                'lastUpdated': datetime.now()
            }
            
            self.user_data[user_address] = user_data
            return user_data
            
        except Exception as e:
            logger.error(f"Error fetching user data: {e}")
            return None

    def get_optimization_recommendation(self) -> Optional[Dict]:
        """Get pool optimization recommendation"""
        if not self.pools_data:
            return None

        # Find pool with highest liquidity
        best_pool = max(self.pools_data, key=lambda x: x.get('totalLiquidity', 0))
        
        return {
            'recommendedPoolId': best_pool['id'],
            'recommendedPoolName': best_pool['regionName'],
            'reason': 'Highest liquidity pool for better stability and lower slippage',
            'maxLiquidity': best_pool['totalLiquidity'],
            'potentialApy': best_pool['apy']
        }

# Initialize service
service = LiquidityPoolService()

# Background task for periodic data fetching
async def periodic_fetch():
    """Background task to fetch data periodically"""
    while True:
        try:
            await service.fetch_pools_data()
            if USER_ADDRESS_TO_MONITOR:
                await service.fetch_user_data(USER_ADDRESS_TO_MONITOR)
            await asyncio.sleep(FETCH_INTERVAL_SECONDS)
        except Exception as e:
            logger.error(f"Error in periodic fetch: {e}")
            await asyncio.sleep(FETCH_INTERVAL_SECONDS)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background task
    task = asyncio.create_task(periodic_fetch())
    # Initial data fetch
    await service.fetch_pools_data()
    if USER_ADDRESS_TO_MONITOR:
        await service.fetch_user_data(USER_ADDRESS_TO_MONITOR)
    
    yield
    
    # Cleanup
    task.cancel()

# FastAPI app
app = FastAPI(
    title="Liquidity Pool Optimizer API",
    description="API for DeFi liquidity pool monitoring and optimization",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "message": "Liquidity Pool Optimizer API is running",
        "version": "1.0.0",
        "timestamp": datetime.now(),
        "pools_count": len(service.pools_data),
        "last_fetch": service.last_fetch_time
    }

@app.get("/pools", response_model=PoolsResponse)
async def get_pools(sort_by: str = "liquidity_asc"):
    """
    Get all pools ordered by liquidity (ascending by default)
    
    Parameters:
    - sort_by: 'liquidity_asc', 'liquidity_desc', 'apy_desc', 'apy_asc'
    """
    if not service.pools_data:
        raise HTTPException(status_code=503, detail="Pool data not available. Service may be starting up.")

    pools = service.pools_data.copy()
    
    # Sort pools based on parameter
    if sort_by == "liquidity_asc":
        pools.sort(key=lambda x: x.get('totalLiquidity', 0))
    elif sort_by == "liquidity_desc":
        pools.sort(key=lambda x: x.get('totalLiquidity', 0), reverse=True)
    elif sort_by == "apy_desc":
        pools.sort(key=lambda x: x.get('apy', 0), reverse=True)
    elif sort_by == "apy_asc":
        pools.sort(key=lambda x: x.get('apy', 0))
    
    return PoolsResponse(
        pools=pools,
        totalPools=len(pools),
        lastFetchTime=service.last_fetch_time or datetime.now(),
        sortedBy=sort_by
    )

@app.get("/pools/{pool_id}", response_model=PoolData)
async def get_pool_details(pool_id: str):
    """Get detailed information for a specific pool"""
    pool = next((p for p in service.pools_data if p['id'].lower() == pool_id.lower()), None)
    if not pool:
        raise HTTPException(status_code=404, detail="Pool not found")
    return pool

@app.get("/pools/best/liquidity", response_model=PoolData)
async def get_highest_liquidity_pool():
    """Get the pool with highest liquidity"""
    if not service.pools_data:
        raise HTTPException(status_code=503, detail="Pool data not available")
    
    best_pool = max(service.pools_data, key=lambda x: x.get('totalLiquidity', 0))
    return best_pool

@app.get("/pools/best/apy", response_model=PoolData)
async def get_highest_apy_pool():
    """Get the pool with highest APY"""
    if not service.pools_data:
        raise HTTPException(status_code=503, detail="Pool data not available")
    
    best_pool = max(service.pools_data, key=lambda x: x.get('apy', 0))
    return best_pool

@app.get("/user/{address}", response_model=UserData)
async def get_user_data(address: str):
    """Get user data including token balances and LP positions"""
    user_data = await service.fetch_user_data(address)
    if not user_data:
        raise HTTPException(status_code=404, detail="User data not found or invalid address")
    return user_data

@app.get("/optimization/recommendation", response_model=OptimizationRecommendation)
async def get_optimization_recommendation():
    """Get pool optimization recommendation"""
    recommendation = service.get_optimization_recommendation()
    if not recommendation:
        raise HTTPException(status_code=503, detail="Optimization data not available")
    return recommendation

@app.post("/refresh")
async def refresh_data(background_tasks: BackgroundTasks):
    """Manually trigger data refresh"""
    background_tasks.add_task(service.fetch_pools_data)
    if USER_ADDRESS_TO_MONITOR:
        background_tasks.add_task(service.fetch_user_data, USER_ADDRESS_TO_MONITOR)
    return {"message": "Data refresh initiated"}

@app.get("/stats")
async def get_stats():
    """Get API statistics and service health"""
    total_liquidity = sum(pool.get('totalLiquidity', 0) for pool in service.pools_data)
    total_debt = sum(pool.get('totalDebt', 0) for pool in service.pools_data)
    active_pools = len([p for p in service.pools_data if p.get('status') == 'ACTIVE'])
    
    return {
        "totalPools": len(service.pools_data),
        "activePools": active_pools,
        "totalLiquidity": total_liquidity,
        "totalDebt": total_debt,
        "lastFetchTime": service.last_fetch_time,
        "redisConnected": service.redis_client is not None,
        "web3Connected": service.w3 is not None and service.w3.is_connected(),
        "monitoredUser": USER_ADDRESS_TO_MONITOR
    }

if __name__ == "__main__":
    uvicorn.run(
        "agent:app",
        host="0.0.0.0",
        port=API_PORT,
        reload=True,
        log_level="info"
    )