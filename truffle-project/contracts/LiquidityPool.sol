// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./IERC20.sol";
import "./LPERC20.sol";

interface IPoolFactory {
    function getPools() external view returns (address[] memory);
}

// Define Stake struct outside the contract to make it accessible to the interface
struct Stake {
    uint256 stakedAmount;
    uint256 collateralAmount;
    uint256 lpTokensMinted;
    uint256 stakeTimestamp;
}

interface ILiquidityPool {
    function getStake(address user) external view returns (Stake memory);
    function getCollateralAvailable(address user) external view returns (uint256);
    function totalLiquidity() external view returns (uint256);
    function getStakedAmount(address user) external view returns (uint256);
    function transferLiquidityToPool(address targetPool, address user, uint256 amount) external;
    function contributeLiquidityForPayment(address targetPool, address user, uint256 amount) external;
    function receiveLiquidity(uint256 amount) external; // New function
}

contract LiquidityPool {
    address public immutable factoryOwner;
    address public immutable poolFactory;
    string public regionName;
    IERC20 public stakingToken;
    LPERC20 public lpToken;
    uint256 public totalLiquidityStaked;
    PoolStatusContract public status;
    uint256 public rewardsPot;
    uint256 public apyBasisPoints = 500;
    uint256 public totalDebt;
    uint256 public constant COLLATERAL_PERCENTAGE_BP = 2000;
    uint256 public constant UNSTAKE_TIME_LOCK_DURATION = 24 hours;
    uint256 public constant BASIS_POINTS = 10000;
    mapping(address => Stake) public stakers;
    mapping(address => Debt[]) public userDebts;
    mapping(address => uint256) public debtRelatedUnstakeTimelock;

    struct Debt {
        address user;
        address merchantAddress;
        uint256 amount;
        uint256 timestamp;
        bool isRepaid;
    }

    enum PoolStatusContract { ACTIVE, PAUSED, INACTIVE }

    event Staked(address indexed user, uint256 amountStaked, uint256 lpTokensReceived);
    event Unstaked(address indexed user, uint256 amountUnstaked, uint256 lpTokensBurned);
    event FallbackPaymentMade(address indexed user, address indexed merchant, uint256 amount, address poolUsed);
    event DebtRepaid(address indexed user, uint256 amountRepaid);
    event RewardsDistributed(uint256 totalRewardsDistributed, uint256 timestamp);
    event PoolStatusChanged(PoolStatusContract newStatus);
    event ApyUpdated(uint256 newApyBasisPoints);
    event RewardsAdded(uint256 amount);

    modifier onlyFactoryOwner() {
        require(msg.sender == factoryOwner, "Not factory owner");
        _;
    }

    modifier whenActive() {
        require(status == PoolStatusContract.ACTIVE, "Pool not active");
        _;
    }

    constructor(string memory _regionName, address _factoryOwner, address _stakingTokenAddress, address _poolFactory) {
        regionName = _regionName;
        factoryOwner = _factoryOwner;
        poolFactory = _poolFactory;
        stakingToken = IERC20(_stakingTokenAddress);
        status = PoolStatusContract.ACTIVE;
        lpToken = new LPERC20(
            string(abi.encodePacked("AegisLP-", _regionName)),
            string(abi.encodePacked("ALP-", _regionName)),
            address(this)
        );
    }

    function getPoolStatus() external view returns (PoolStatusContract) {
        return status;
    }

    function totalLiquidity() external view returns (uint256) {
        return totalLiquidityStaked;
    }

    function apy() external view returns (uint256) {
        return apyBasisPoints;
    }

    function lpTokenSupply() external view returns (uint256) {
        return lpToken.totalSupply();
    }

    function getStake(address _user) external view returns (Stake memory) {
        return stakers[_user];
    }

    function getUserDebts(address _user) external view returns (Debt[] memory) {
        return userDebts[_user];
    }

    function getCollateralAvailable(address _user) external view returns (uint256) {
        uint256 totalDebt = 0;
        Debt[] memory debts = userDebts[_user];
        for (uint256 i = 0; i < debts.length; i++) {
            if (!debts[i].isRepaid) {
                totalDebt += debts[i].amount;
            }
        }
        return stakers[_user].collateralAmount > totalDebt ? stakers[_user].collateralAmount - totalDebt : 0;
    }

    function getActiveDebtAmount(address _user) external view returns (uint256) {
        uint256 tb = 0;
        Debt[] memory debts = userDebts[_user];
        for (uint256 i = 0; i < debts.length; i++) {
            if (!debts[i].isRepaid) {
                tb += debts[i].amount;
            }
        }
        return tb;
    }

    function getTotalDebt() external view returns (uint256) {
        return totalDebt;
    }

    function toggleStatus() external onlyFactoryOwner {
        if (status == PoolStatusContract.ACTIVE) {
            status = PoolStatusContract.PAUSED;
        } else if (status == PoolStatusContract.PAUSED) {
            status = PoolStatusContract.ACTIVE;
        }
        emit PoolStatusChanged(status);
    }

    function setStatus(PoolStatusContract _newStatus) external onlyFactoryOwner {
        status = _newStatus;
        emit PoolStatusChanged(status);
    }

    function setApy(uint256 _newApyBasisPoints) external onlyFactoryOwner {
        require(_newApyBasisPoints <= 5000, "APY exceeds 50%");
        apyBasisPoints = _newApyBasisPoints;
        emit ApyUpdated(_newApyBasisPoints);
    }

    function addRewardsToPot(uint256 amount) external onlyFactoryOwner {
        require(amount > 0, "Amount must be > 0");
        rewardsPot += amount;
        emit RewardsAdded(amount);
    }

    function stake(uint256 _amount) external whenActive {
        require(_amount > 0, "Amount must be > 0");
        require(stakingToken.transferFrom(msg.sender, address(this), _amount), "Token transfer failed");
        uint256 collateralAmount = (_amount * COLLATERAL_PERCENTAGE_BP) / BASIS_POINTS;
        uint256 lpTokensToMint;
        if (lpToken.totalSupply() == 0) {
            lpTokensToMint = _amount;
        } else {
            lpTokensToMint = (_amount * lpToken.totalSupply()) / totalLiquidityStaked;
        }
        Stake storage userStake = stakers[msg.sender];
        userStake.stakedAmount += _amount;
        userStake.collateralAmount += collateralAmount;
        userStake.lpTokensMinted += lpTokensToMint;
        userStake.stakeTimestamp = block.timestamp;
        totalLiquidityStaked += _amount;
        lpToken.mint(msg.sender, lpTokensToMint);
        emit Staked(msg.sender, _amount, lpTokensToMint);
    }

    function unstake(uint256 _lpTokenAmount) external whenActive {
        require(_lpTokenAmount > 0, "LP token amount must be > 0");
        Stake storage userStake = stakers[msg.sender];
        require(userStake.lpTokensMinted >= _lpTokenAmount, "Insufficient LP tokens");
        uint256 proportionBasisPoints = (_lpTokenAmount * BASIS_POINTS) / userStake.lpTokensMinted;
        uint256 stakedAmountToReturn = (userStake.stakedAmount * proportionBasisPoints) / BASIS_POINTS;
        uint256 collateralToReduce = (userStake.collateralAmount * proportionBasisPoints) / BASIS_POINTS;
        uint256 remainingCollateral = userStake.collateralAmount - collateralToReduce;
        uint256 activeDebt = this.getActiveDebtAmount(msg.sender);
        require(remainingCollateral >= activeDebt, "Insufficient collateral");
        userStake.stakedAmount -= stakedAmountToReturn;
        userStake.collateralAmount -= collateralToReduce;
        userStake.lpTokensMinted -= _lpTokenAmount;
        totalLiquidityStaked -= stakedAmountToReturn;
        lpToken.burn(msg.sender, _lpTokenAmount);
        require(stakingToken.transfer(msg.sender, stakedAmountToReturn), "Token transfer failed");
        emit Unstaked(msg.sender, stakedAmountToReturn, _lpTokenAmount);
    }

    function getTotalCollateralAcrossPools(address user) public view returns (uint256) {
        uint256 totalCollateral = stakers[user].collateralAmount;
        address[] memory allPools = IPoolFactory(poolFactory).getPools();
        for (uint256 i = 0; i < allPools.length; i++) {
            if (allPools[i] != address(this)) {
                try ILiquidityPool(allPools[i]).getStake(user) returns (Stake memory userStakeInPool) {
                    totalCollateral += userStakeInPool.collateralAmount;
                } catch {
                    continue;
                }
            }
        }
        return totalCollateral;
    }

    function redistributeFundsFromPools(address user, uint256 requiredAmount, uint256 currentPoolAvailable) internal returns (uint256 redistributedAmount) {
        uint256 stillNeeded = requiredAmount - currentPoolAvailable;
        redistributedAmount = currentPoolAvailable;
        address[] memory allPools = IPoolFactory(poolFactory).getPools();
        for (uint256 i = 0; i < allPools.length; i++) {
            if (stillNeeded == 0) break;
            address poolAddress = allPools[i];
            if (poolAddress == address(this)) continue;
            try ILiquidityPool(poolAddress).getCollateralAvailable(user) returns (uint256 poolCollateral) {
                try ILiquidityPool(poolAddress).totalLiquidity() returns (uint256 poolLiquidity) {
                    uint256 canTakeFromPool = poolCollateral > stillNeeded ? stillNeeded : poolCollateral;
                    if (poolLiquidity >= canTakeFromPool && canTakeFromPool > 0) {
                        try ILiquidityPool(poolAddress).transferLiquidityToPool(address(this), user, canTakeFromPool) {
                            redistributedAmount += canTakeFromPool;
                            stillNeeded -= canTakeFromPool;
                        } catch {
                            continue;
                        }
                    }
                } catch {
                    continue;
                }
            } catch {
                continue;
            }
        }
        return redistributedAmount;
    }

    function addLiquidityFromNewPools(address user, uint256 requiredAmount, uint256 currentAvailable) internal returns (uint256 totalAvailable) {
        uint256 stillNeeded = requiredAmount - currentAvailable;
        totalAvailable = currentAvailable;
        address[] memory allPools = IPoolFactory(poolFactory).getPools();
        for (uint256 i = 0; i < allPools.length; i++) {
            if (stillNeeded == 0) break;
            address poolAddress = allPools[i];
            if (poolAddress == address(this)) continue;
            try ILiquidityPool(poolAddress).getStakedAmount(user) returns (uint256 userStakeInPool) {
                uint256 userCollateralInPool = (userStakeInPool * COLLATERAL_PERCENTAGE_BP) / BASIS_POINTS;
                uint256 availableFromPool = userCollateralInPool > stillNeeded ? stillNeeded : userCollateralInPool;
                try ILiquidityPool(poolAddress).totalLiquidity() returns (uint256 poolLiquidity) {
                    if (availableFromPool > 0 && poolLiquidity >= availableFromPool) {
                        try ILiquidityPool(poolAddress).contributeLiquidityForPayment(address(this), user, availableFromPool) {
                            totalAvailable += availableFromPool;
                            stillNeeded -= availableFromPool;
                        } catch {
                            continue;
                        }
                    }
                } catch {
                    continue;
                }
            } catch {
                continue;
            }
        }
        return totalAvailable;
    }

    function fallbackPay(address _merchantAddress, uint256 _amount) external whenActive {
        require(_amount > 0, "Amount must be > 0");
        require(_merchantAddress != address(0), "Invalid merchant address");
        uint256 totalCollateralAcrossPools = getTotalCollateralAcrossPools(msg.sender);
        uint256 currentPoolCollateral = this.getCollateralAvailable(msg.sender);
        uint256 currentPoolLiquidity = totalLiquidityStaked;
        if (currentPoolCollateral >= _amount && currentPoolLiquidity >= _amount) {
            executeOriginalFallbackPay(_merchantAddress, _amount);
            return;
        }
        uint256 availableAfterRedistribution = currentPoolCollateral;
        if (currentPoolLiquidity < _amount) {
            availableAfterRedistribution = redistributeFundsFromPools(msg.sender, _amount, currentPoolCollateral);
        }
        uint256 finalAvailableAmount = availableAfterRedistribution;
        if (finalAvailableAmount < _amount) {
            finalAvailableAmount = addLiquidityFromNewPools(msg.sender, _amount, availableAfterRedistribution);
        }
        require(finalAvailableAmount >= _amount, "Insufficient liquidity");
        require(_amount <= totalCollateralAcrossPools, "Exceeds collateral limit");
        executeOriginalFallbackPay(_merchantAddress, _amount);
    }

    function executeOriginalFallbackPay(address _merchantAddress, uint256 _amount) internal {
        require(totalLiquidityStaked >= _amount, "Insufficient pool liquidity");
        uint256 lpTokensToBurn;
        if (lpToken.totalSupply() == 0) {
            revert("No LP tokens to burn");
        } else {
            lpTokensToBurn = (_amount * lpToken.totalSupply()) / totalLiquidityStaked;
        }
        require(lpToken.balanceOf(msg.sender) >= lpTokensToBurn, "Insufficient LP tokens");
        Stake storage userStake = stakers[msg.sender];
        require(userStake.lpTokensMinted >= lpTokensToBurn, "Insufficient minted LP tokens");
        userStake.lpTokensMinted -= lpTokensToBurn;
        userStake.stakedAmount -= _amount;
        userStake.collateralAmount = (userStake.stakedAmount * COLLATERAL_PERCENTAGE_BP) / BASIS_POINTS;
        totalLiquidityStaked -= _amount;
        lpToken.burn(msg.sender, lpTokensToBurn);
        userDebts[msg.sender].push(Debt({
            user: msg.sender,
            merchantAddress: _merchantAddress,
            amount: _amount,
            timestamp: block.timestamp,
            isRepaid: false
        }));
        totalDebt += _amount;
        uint256 newTimelock = block.timestamp + UNSTAKE_TIME_LOCK_DURATION;
        if (newTimelock > debtRelatedUnstakeTimelock[msg.sender]) {
            debtRelatedUnstakeTimelock[msg.sender] = newTimelock;
        }
        require(stakingToken.transfer(_merchantAddress, _amount), "Payment transfer failed");
        emit FallbackPaymentMade(msg.sender, _merchantAddress, _amount, address(this));
    }

    function repayDebt(uint256 _debtIndex, uint256 _amount) external whenActive {
        require(_amount > 0, "Amount must be > 0");
        require(_debtIndex < userDebts[msg.sender].length, "Invalid debt index");
        Debt storage debt = userDebts[msg.sender][_debtIndex];
        require(!debt.isRepaid, "Debt already repaid");
        require(_amount <= debt.amount, "Amount exceeds debt");
        require(stakingToken.transferFrom(msg.sender, address(this), _amount), "Repayment transfer failed");
        if (_amount == debt.amount) {
            debt.isRepaid = true;
        } else {
            debt.amount -= _amount;
        }
        totalDebt -= _amount;
        if (this.getActiveDebtAmount(msg.sender) == 0) {
            debtRelatedUnstakeTimelock[msg.sender] = 0;
        }
        emit DebtRepaid(msg.sender, _amount);
    }

    function distributeRewards() external onlyFactoryOwner whenActive {
        require(rewardsPot > 0, "No rewards to distribute");
        require(lpToken.totalSupply() > 0, "No LP tokens to distribute");
        uint256 rewardsToDistribute = rewardsPot;
        rewardsPot = 0;
        emit RewardsDistributed(rewardsToDistribute, block.timestamp);
    }

    function emergencyWithdraw() external onlyFactoryOwner {
        require(status == PoolStatusContract.INACTIVE, "Pool must be inactive");
        uint256 balance = stakingToken.balanceOf(address(this));
        if (balance > 0) {
            stakingToken.transfer(factoryOwner, balance);
        }
    }

   function transferLiquidityToPool(address targetPool, address user, uint256 amount) external {
    require(msg.sender != address(0), "Invalid caller");
    require(amount > 0, "Amount must be > 0");
    require(totalLiquidityStaked >= amount, "Insufficient liquidity");
    address[] memory allPools = IPoolFactory(poolFactory).getPools();
    bool isValidPool = false;
    for (uint256 i = 0; i < allPools.length; i++) {
        if (allPools[i] == msg.sender || allPools[i] == targetPool) {
            isValidPool = true;
            break;
        }
    }
    require(isValidPool, "Unauthorized transfer");
    require(stakingToken.transfer(targetPool, amount), "Transfer failed");
    totalLiquidityStaked -= amount;
    // Notify target pool to increase its liquidity
    ILiquidityPool(targetPool).receiveLiquidity(amount);
}

   function contributeLiquidityForPayment(address targetPool, address user, uint256 amount) external {
    require(msg.sender != address(0), "Invalid caller");
    require(amount > 0, "Amount must be > 0");
    require(totalLiquidityStaked >= amount, "Insufficient liquidity");
    Stake storage userStake = stakers[user];
    uint256 userCollateral = (userStake.stakedAmount * COLLATERAL_PERCENTAGE_BP) / BASIS_POINTS;
    require(userCollateral >= amount, "Insufficient collateral");
    address[] memory allPools = IPoolFactory(poolFactory).getPools();
    bool isValidPool = false;
    for (uint256 i = 0; i < allPools.length; i++) {
        if (allPools[i] == msg.sender || allPools[i] == targetPool) {
            isValidPool = true;
            break;
        }
    }
    require(isValidPool, "Unauthorized contribution");
    require(stakingToken.transfer(targetPool, amount), "Contribution transfer failed");
    totalLiquidityStaked -= amount;
    // Notify target pool to increase its liquidity
    ILiquidityPool(targetPool).receiveLiquidity(amount);
}

function receiveLiquidity(uint256 amount) external {
    require(msg.sender != address(0), "Invalid caller");
    address[] memory allPools = IPoolFactory(poolFactory).getPools();
    bool isValidPool = false;
    for (uint256 i = 0; i < allPools.length; i++) {
        if (allPools[i] == msg.sender) {
            isValidPool = true;
            break;
        }
    }
    require(isValidPool, "Unauthorized caller");
    totalLiquidityStaked += amount;
}
    function getStakedAmount(address user) external view returns (uint256) {
        return stakers[user].stakedAmount;
    }
}