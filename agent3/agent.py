import os
import json
import time
import logging
import asyncio
from datetime import datetime
from typing import List, Dict, Optional, TypedDict, Annotated
from contextlib import asynccontextmanager

import redis
import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks, Path
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from web3 import Web3, HTTPProvider

from langgraph.graph import StateGraph, END, START

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
SIGNER_ADDRESS = os.getenv('SIGNER_ADDRESS', USER_ADDRESS_TO_MONITOR) # Default to USER_ADDRESS_TO_MONITOR if not set
API_PORT = int(os.getenv('API_PORT', 8765))

# --- Pydantic Models ---
class StakeInfo(BaseModel):
    userId: str
    stakedAmount: float
    collateralAmount: float # This will now be dynamically adjusted by credit score for the SIGNER_ADDRESS
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
    userDebt: float # Specific to USER_ADDRESS_TO_MONITOR context
    stakers: List[StakeInfo] # General stakers list
    debts: List[DebtInfo] # Specific to USER_ADDRESS_TO_MONITOR context
    status: str
    rewardsPot: float
    apy: float
    lpTokenSupply: float
    userStake: Optional[StakeInfo] # Specific to SIGNER_ADDRESS context, with dynamic collateral
    lastUpdated: datetime

class UserData(BaseModel):
    id: str
    name: str
    tokenBalance: float
    lpTokenBalances: Dict[str, float]
    lastUpdated: datetime
    creditScore: Optional[int] = None # Added field for credit score

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

class CreditScoreFactors(BaseModel):
    totalStaked: float = 0.0
    totalDebt: float = 0.0
    numPoolsStakedIn: int = 0
    debtToStakeRatio: Optional[float] = None
    hasActiveDebt: bool = False

class CreditScoreResponse(BaseModel):
    userId: str
    creditScore: int = Field(..., ge=0, le=1000)
    factorsConsidered: CreditScoreFactors
    lastCalculated: datetime

# --- LangGraph Credit Scoring State ---
class CreditScoringState(TypedDict):
    user_id: str
    raw_staked_amount: float
    raw_debt_amount: float
    num_pools_staked_in: int
    num_active_debts: int # Number of distinct active debts
    score: int
    factors: List[str] # For human-readable explanation (optional)
    final_factors_summary: Optional[CreditScoreFactors]

# --- LangGraph Credit Scoring Functions ---
def collect_user_data(state: CreditScoringState) -> CreditScoringState:
    """Collect and validate user financial data"""
    logger.info(f"Collecting data for user: {state['user_id']}")
    
    # Validate input data
    if state['raw_staked_amount'] < 0:
        state['raw_staked_amount'] = 0
    if state['raw_debt_amount'] < 0:
        state['raw_debt_amount'] = 0
    if state['num_pools_staked_in'] < 0:
        state['num_pools_staked_in'] = 0
    if state['num_active_debts'] < 0:
        state['num_active_debts'] = 0
    
    factors = []
    factors.append(f"Total staked: {state['raw_staked_amount']:.2f} tokens")
    factors.append(f"Total debt: {state['raw_debt_amount']:.2f} tokens")
    factors.append(f"Pools staked in: {state['num_pools_staked_in']}")
    factors.append(f"Active debts: {state['num_active_debts']}")
    
    state['factors'] = factors
    logger.info(f"Data collection complete: {factors}")
    return state

def calculate_base_score(state: CreditScoringState) -> CreditScoringState:
    """Calculate base credit score from staking and debt data"""
    logger.info("Calculating base credit score")
    
    base_score = 500  # Start with neutral score
    
    # Positive factors
    # Staking amount contribution (up to 200 points)
    staking_factor = min(state['raw_staked_amount'] / 1000.0, 1.0)  # Normalize to max 1000 tokens
    staking_points = int(staking_factor * 200)
    base_score += staking_points
    
    # Pool diversification (up to 100 points)
    diversification_points = min(state['num_pools_staked_in'] * 25, 100)
    base_score += diversification_points
    
    # Negative factors
    # Debt penalty (up to -300 points)
    if state['raw_debt_amount'] > 0:
        debt_factor = min(state['raw_debt_amount'] / 500.0, 1.0)  # Normalize to max 500 tokens
        debt_penalty = int(debt_factor * 300)
        base_score -= debt_penalty
    
    # Multiple active debts penalty
    if state['num_active_debts'] > 1:
        multiple_debt_penalty = (state['num_active_debts'] - 1) * 50
        base_score -= multiple_debt_penalty
    
    # Ensure score stays within bounds
    base_score = max(0, min(1000, base_score))
    
    state['score'] = base_score
    state['factors'].append(f"Base score calculated: {base_score}")
    
    logger.info(f"Base score calculated: {base_score}")
    return state

def apply_risk_adjustments(state: CreditScoringState) -> CreditScoringState:
    """Apply risk-based adjustments to the credit score"""
    logger.info("Applying risk adjustments")
    
    current_score = state['score']
    
    # Debt-to-stake ratio risk
    if state['raw_staked_amount'] > 0 and state['raw_debt_amount'] > 0:
        debt_to_stake_ratio = state['raw_debt_amount'] / state['raw_staked_amount']
        
        if debt_to_stake_ratio > 0.8:  # High risk
            risk_penalty = int(current_score * 0.2)  # 20% penalty
            current_score -= risk_penalty
            state['factors'].append(f"High debt-to-stake ratio penalty: -{risk_penalty}")
        elif debt_to_stake_ratio > 0.5:  # Medium risk
            risk_penalty = int(current_score * 0.1)  # 10% penalty
            current_score -= risk_penalty
            state['factors'].append(f"Medium debt-to-stake ratio penalty: -{risk_penalty}")
    
    # No staking penalty (if user has debt but no stake)
    if state['raw_staked_amount'] == 0 and state['raw_debt_amount'] > 0:
        no_stake_penalty = 150  # Fixed penalty
        current_score -= no_stake_penalty
        state['factors'].append(f"No staking with active debt penalty: -{no_stake_penalty}")
    
    # Bonus for good behavior (high stake, no debt)
    if state['raw_staked_amount'] > 100 and state['raw_debt_amount'] == 0:
        good_behavior_bonus = 50
        current_score += good_behavior_bonus
        state['factors'].append(f"Good behavior bonus: +{good_behavior_bonus}")
    
    # Ensure score stays within bounds
    current_score = max(0, min(1000, current_score))
    
    state['score'] = current_score
    state['factors'].append(f"Final score after risk adjustments: {current_score}")
    
    logger.info(f"Risk adjustments applied, final score: {current_score}")
    return state

def finalize_credit_score(state: CreditScoringState) -> CreditScoringState:
    """Finalize the credit score and create summary factors"""
    logger.info("Finalizing credit score")
    
    # Calculate debt-to-stake ratio for summary
    debt_to_stake_ratio = None
    if state['raw_staked_amount'] > 0:
        debt_to_stake_ratio = state['raw_debt_amount'] / state['raw_staked_amount']
    
    # Create final factors summary
    factors_summary = CreditScoreFactors(
        totalStaked=state['raw_staked_amount'],
        totalDebt=state['raw_debt_amount'],
        numPoolsStakedIn=state['num_pools_staked_in'],
        debtToStakeRatio=debt_to_stake_ratio,
        hasActiveDebt=state['num_active_debts'] > 0
    )
    
    state['final_factors_summary'] = factors_summary
    state['factors'].append("Credit score calculation completed")
    
    logger.info(f"Credit score finalized: {state['score']} for user {state['user_id']}")
    return state

# --- Create LangGraph workflow ---
def create_credit_scoring_workflow() -> StateGraph:
    """Create and configure the credit scoring workflow"""
    workflow = StateGraph(CreditScoringState)
    
    # Add nodes
    workflow.add_node("collect_data", collect_user_data)
    workflow.add_node("calculate_base", calculate_base_score)
    workflow.add_node("apply_adjustments", apply_risk_adjustments)
    workflow.add_node("finalize", finalize_credit_score)
    
    # Add edges
    workflow.add_edge(START, "collect_data")
    workflow.add_edge("collect_data", "calculate_base")
    workflow.add_edge("calculate_base", "apply_adjustments")
    workflow.add_edge("apply_adjustments", "finalize")
    workflow.add_edge("finalize", END)
    
    return workflow.compile()

# Initialize the credit scoring workflow
credit_scoring_workflow = create_credit_scoring_workflow()

# --- LiquidityPoolService (Handles Blockchain Interaction) ---
class LiquidityPoolService:
    def __init__(self):
        self.pools_data: List[Dict] = [] # This is a cache
        self.user_data_cache: Dict[str, Dict] = {} # Cache for UserData objects
        self.last_fetch_time: Optional[datetime] = None
        self.redis_client: Optional[redis.Redis] = None
        self.w3: Optional[Web3] = None
        self.pool_factory_contract = None
        self.staking_token_contract = None
        self.LIQUIDITY_POOL_ABI: Optional[list] = None
        self._initialize_connections()
        self._load_contracts()

    def _initialize_connections(self):
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
        try:
            with open('../truffle-project/build/contracts/PoolFactory.json') as f:
                POOL_FACTORY_ABI = json.load(f)['abi']
            with open('../truffle-project/build/contracts/LiquidityPool.json') as f:
                self.LIQUIDITY_POOL_ABI = json.load(f)['abi']
            with open('../truffle-project/build/contracts/ERC20.json') as f:
                ERC20_ABI = json.load(f)['abi']
            
            if POOL_FACTORY_ADDRESS and STAKING_TOKEN_ADDRESS and self.w3 and self.LIQUIDITY_POOL_ABI:
                self.pool_factory_contract = self.w3.eth.contract(address=Web3.to_checksum_address(POOL_FACTORY_ADDRESS), abi=POOL_FACTORY_ABI)
                self.staking_token_contract = self.w3.eth.contract(address=Web3.to_checksum_address(STAKING_TOKEN_ADDRESS), abi=ERC20_ABI)
                logger.info("Contracts initialized successfully")
            else:
                missing = [item for item, val in [("Factory Address", POOL_FACTORY_ADDRESS), ("Token Address", STAKING_TOKEN_ADDRESS), ("Web3", self.w3), ("LP ABI", self.LIQUIDITY_POOL_ABI)] if not val]
                raise ValueError(f"Missing critical components for contract initialization: {', '.join(missing)}")
        except FileNotFoundError as e:
            logger.error(f"Contract ABI file not found: {e}")
            raise
        except Exception as e:
            logger.error(f"Contract initialization failed: {e}")
            raise

    async def calculate_user_credit_score(self, user_address: str) -> Optional[CreditScoreResponse]:
        """Calculate credit score for a user using LangGraph workflow"""
        try:
            # Gather user data from all pools
            total_staked = 0.0
            total_debt = 0.0
            pools_staked_in = 0
            active_debts = 0
            
            for pool in self.pools_data:
                # Check stake in this pool
                stake_info = await self._get_user_stake_info(pool['id'], user_address)
                if stake_info and stake_info['stakedAmount'] > 0:
                    total_staked += stake_info['stakedAmount']
                    pools_staked_in += 1
                
                # Check debt in this pool (only for USER_ADDRESS_TO_MONITOR context)
                if user_address.lower() == USER_ADDRESS_TO_MONITOR.lower():
                    pool_debt = pool.get('userDebt', 0)
                    if pool_debt > 0:
                        total_debt += pool_debt
                        active_debts += 1
            
            # Create initial state for LangGraph
            initial_state = CreditScoringState(
                user_id=user_address,
                raw_staked_amount=total_staked,
                raw_debt_amount=total_debt,
                num_pools_staked_in=pools_staked_in,
                num_active_debts=active_debts,
                score=0,
                factors=[],
                final_factors_summary=None
            )
            
            # Run the LangGraph workflow
            result = await asyncio.get_event_loop().run_in_executor(
                None, credit_scoring_workflow.invoke, initial_state
            )
            
            # Create response
            credit_response = CreditScoreResponse(
                userId=user_address,
                creditScore=result['score'],
                factorsConsidered=result['final_factors_summary'],
                lastCalculated=datetime.now()
            )
            
            # Cache the result
            if self.redis_client:
                try:
                    cache_key = f"agent3:credit_score:{user_address}"
                    self.redis_client.setex(
                        cache_key, 
                        300,  # 5 minutes cache
                        json.dumps(credit_response.model_dump(), default=str)
                    )
                except Exception as e:
                    logger.warning(f"Failed to cache credit score: {e}")
            
            logger.info(f"Credit score calculated for {user_address}: {result['score']}")
            return credit_response
            
        except Exception as e:
            logger.error(f"Error calculating credit score for {user_address}: {e}")
            return None

    async def get_cached_credit_score(self, user_address: str) -> Optional[CreditScoreResponse]:
        """Get cached credit score if available"""
        if not self.redis_client:
            return None
        
        try:
            cache_key = f"agent3:credit_score:{user_address}"
            cached_data = self.redis_client.get(cache_key)
            if cached_data:
                data = json.loads(cached_data)
                return CreditScoreResponse(**data)
        except Exception as e:
            logger.warning(f"Failed to retrieve cached credit score: {e}")
        
        return None

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
                    user_stake = None
                    
                    if USER_ADDRESS_TO_MONITOR:
                        user_debt = pool_contract.functions.getActiveDebtAmount(USER_ADDRESS_TO_MONITOR).call()
                        user_debts = pool_contract.functions.getUserDebts(USER_ADDRESS_TO_MONITOR).call()
                        stake_info = await self._get_user_stake_info(pool_address, USER_ADDRESS_TO_MONITOR)
                        if stake_info and stake_info['stakedAmount'] > 0:
                            stakers.append(stake_info)

                    # Get user stake info for SIGNER_ADDRESS (always include, even if 0)
                    if SIGNER_ADDRESS:
                        user_stake = await self._get_user_stake_info(pool_address, SIGNER_ADDRESS)
                        
                        # Apply dynamic collateral adjustment based on credit score
                        if user_stake and user_stake['stakedAmount'] > 0:
                            credit_score_response = await self.get_cached_credit_score(SIGNER_ADDRESS)
                            if not credit_score_response:
                                credit_score_response = await self.calculate_user_credit_score(SIGNER_ADDRESS)
                            
                            if credit_score_response:
                                # Adjust collateral based on credit score
                                # Higher credit score = higher collateral multiplier
                                credit_multiplier = credit_score_response.creditScore / 1000.0  # 0.0 to 1.0
                                base_collateral = user_stake['stakedAmount']
                                adjusted_collateral = base_collateral * (1.0 + credit_multiplier)
                                user_stake['collateralAmount'] = adjusted_collateral
                                
                        logger.info(f"Fetched stake for pool {pool_address[:8]}...: {user_stake}")

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
                        'userStake': user_stake,  # Include user stake info
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
            
            stake_info = {
                'userId': user_address,
                'stakedAmount': float(Web3.from_wei(stake[0], 'ether')),
                'collateralAmount': float(Web3.from_wei(stake[1], 'ether')),
                'lpTokensMinted': float(Web3.from_wei(stake[2], 'ether')),
                'stakeTimestamp': stake[3]
            }
            
            logger.debug(f"Fetched stake for {user_address} in pool {pool_address[:8]}...: {stake_info}")
            return stake_info
            
        except Exception as e:
            logger.error(f"Error fetching stake info for {user_address} in pool {pool_address}: {e}")
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

            # Calculate credit score
            credit_score_response = await self.calculate_user_credit_score(user_address)
            credit_score = credit_score_response.creditScore if credit_score_response else None

            user_data = {
                'id': user_address,
                'name': f"User ({user_address[:6]}...)",
                'tokenBalance': float(Web3.from_wei(token_balance, 'ether')),
                'lpTokenBalances': lp_token_balances,
                'lastUpdated': datetime.now(),
                'creditScore': credit_score
            }
            
            self.user_data_cache[user_address] = user_data
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
    description="API for DeFi liquidity pool monitoring and optimization with LangGraph credit scoring",
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
        "last_fetch": service.last_fetch_time,
        "signer_address": SIGNER_ADDRESS,
        "langgraph_enabled": True
    }

@app.get("/pools", response_model=PoolsResponse)
async def get_pools(sort_by: str = "liquidity_asc"):
    """
    Get all pools ordered by liquidity (ascending by default) with user stake information
    
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

@app.get("/user/{address}/credit-score", response_model=CreditScoreResponse)
async def get_user_credit_score(address: str):
    """Get credit score for a specific user using LangGraph workflow"""
    # Check cache first
    cached_score = await service.get_cached_credit_score(address)
    if cached_score:
        return cached_score
    
    # Calculate new score
    credit_score = await service.calculate_user_credit_score(address)
    if not credit_score:
        raise HTTPException(status_code=404, detail="Unable to calculate credit score for user")
    
    return credit_score

@app.post("/user/{address}/credit-score/refresh", response_model=CreditScoreResponse)
async def refresh_user_credit_score(address: str):
    """Force refresh credit score calculation for a user"""
    # Clear cache
    if service.redis_client:
        try:
            cache_key = f"agent3:credit_score:{address}"
            service.redis_client.delete(cache_key)
        except Exception as e:
            logger.warning(f"Failed to clear cache: {e}")
    
    # Recalculate
    credit_score = await service.calculate_user_credit_score(address)
    if not credit_score:
        raise HTTPException(status_code=404, detail="Unable to calculate credit score for user")
    
    return credit_score

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
        "monitoredUser": USER_ADDRESS_TO_MONITOR,
        "signerAddress": SIGNER_ADDRESS,
        "langGraphEnabled": True,
        "creditScoringWorkflow": "active"
    }

@app.get("/credit-score/test")
async def test_credit_scoring():
    """Test endpoint to verify LangGraph credit scoring workflow"""
    try:
        # Test with sample data
        test_state = CreditScoringState(
            user_id="0x1234567890abcdef",
            raw_staked_amount=500.0,
            raw_debt_amount=100.0,
            num_pools_staked_in=2,
            num_active_debts=1,
            score=0,
            factors=[],
            final_factors_summary=None
        )
        
        # Run workflow
        result = await asyncio.get_event_loop().run_in_executor(
            None, credit_scoring_workflow.invoke, test_state
        )
        
        return {
            "status": "success",
            "test_result": {
                "user_id": result['user_id'],
                "final_score": result['score'],
                "factors": result['factors'],
                "factors_summary": result['final_factors_summary']
            },
            "workflow_status": "operational"
        }
        
    except Exception as e:
        logger.error(f"Credit scoring test failed: {e}")
        raise HTTPException(status_code=500, detail=f"Credit scoring workflow test failed: {str(e)}")

@app.get("/health")
async def health_check():
    """Comprehensive health check"""
    health_status = {
        "status": "healthy",
        "timestamp": datetime.now(),
        "services": {
            "api": "healthy",
            "redis": "healthy" if service.redis_client else "unavailable",
            "web3": "healthy" if (service.w3 and service.w3.is_connected()) else "unavailable",
            "langgraph": "healthy",
            "credit_scoring": "operational"
        },
        "data": {
            "pools_loaded": len(service.pools_data),
            "last_fetch": service.last_fetch_time,
            "cache_entries": 0
        }
    }
    
    # Check Redis cache entries
    if service.redis_client:
        try:
            keys = service.redis_client.keys("agent3:*")
            health_status["data"]["cache_entries"] = len(keys)
        except Exception:
            health_status["services"]["redis"] = "error"
    
    # Test credit scoring workflow
    try:
        test_state = CreditScoringState(
            user_id="health_check",
            raw_staked_amount=100.0,
            raw_debt_amount=0.0,
            num_pools_staked_in=1,
            num_active_debts=0,
            score=0,
            factors=[],
            final_factors_summary=None
        )
        result = credit_scoring_workflow.invoke(test_state)
        if result['score'] > 0:
            health_status["services"]["credit_scoring"] = "operational"
        else:
            health_status["services"]["credit_scoring"] = "warning"
    except Exception as e:
        health_status["services"]["credit_scoring"] = "error"
        health_status["errors"] = [f"Credit scoring test failed: {str(e)}"]
    
    return health_status

if __name__ == "__main__":
    uvicorn.run(
        "agent:app",
        host="0.0.0.0",
        port=API_PORT,
        reload=True,
        log_level="info"
    )