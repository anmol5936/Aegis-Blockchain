// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./LiquidityPool.sol";

/**
 * @title PoolFactory
 * @dev Factory contract for creating and managing regional liquidity pools
 */
contract PoolFactory {
    address public owner;
    address[] public pools;
    address public stakingTokenAddress; // Global staking token for all pools
    
    mapping(string => bool) public regionExists;
    mapping(address => string) public poolToRegion;
    mapping(string => address) public regionToPool;
    
    event PoolCreated(
        address indexed poolAddress, 
        string regionName, 
        address indexed createdBy
    );
    
    event StakingTokenUpdated(address indexed newStakingToken);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "PoolFactory: caller is not the owner");
        _;
    }
    
    constructor(address _stakingTokenAddress) {
        owner = msg.sender;
        stakingTokenAddress = _stakingTokenAddress;
    }
    
    /**
     * @dev Creates a new liquidity pool for a region
     * @param _regionName Name of the region for the pool
     */
   function createPool(string memory _regionName) external onlyOwner {
    require(bytes(_regionName).length > 0, "PoolFactory: region name cannot be empty");
    require(!regionExists[_regionName], "PoolFactory: region already exists");
    require(stakingTokenAddress != address(0), "PoolFactory: staking token not set");
    
    // Deploy new LiquidityPool contract
    LiquidityPool newPool = new LiquidityPool(_regionName, owner, stakingTokenAddress, address(this));
    
    address poolAddress = address(newPool);
    
    // Update state
    pools.push(poolAddress);
    regionExists[_regionName] = true;
    poolToRegion[poolAddress] = _regionName;
    regionToPool[_regionName] = poolAddress;
    
    emit PoolCreated(poolAddress, _regionName, msg.sender);
}
    /**
     * @dev Returns all deployed pool addresses
     */
    function getPools() external view returns (address[] memory) {
        return pools;
    }
    
    /**
     * @dev Returns the number of deployed pools
     */
    function getPoolCount() external view returns (uint256) {
        return pools.length;
    }
    
    /**
     * @dev Returns pool address for a specific region
     */
    function getPoolByRegion(string memory _regionName) external view returns (address) {
        require(regionExists[_regionName], "PoolFactory: region does not exist");
        return regionToPool[_regionName];
    }
    
    /**
     * @dev Updates the global staking token address
     */
    function setStakingToken(address _stakingTokenAddress) external onlyOwner {
        require(_stakingTokenAddress != address(0), "PoolFactory: invalid token address");
        stakingTokenAddress = _stakingTokenAddress;
        emit StakingTokenUpdated(_stakingTokenAddress);
    }
    
    /**
     * @dev Transfers ownership of the factory
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "PoolFactory: new owner is the zero address");
        owner = newOwner;
    }
    
    /**
     * @dev Emergency function to pause/unpause a specific pool
     */
    function togglePoolStatus(address poolAddress) external onlyOwner {
        require(poolAddress != address(0), "PoolFactory: invalid pool address");
        require(bytes(poolToRegion[poolAddress]).length > 0, "PoolFactory: pool not found");
        
        LiquidityPool(poolAddress).toggleStatus();
    }
    
    /**
     * @dev Add rewards to a specific pool's reward pot
     */
    function addRewardsToPool(address poolAddress, uint256 amount) external onlyOwner {
        require(poolAddress != address(0), "PoolFactory: invalid pool address");
        require(bytes(poolToRegion[poolAddress]).length > 0, "PoolFactory: pool not found");
        require(amount > 0, "PoolFactory: amount must be greater than 0");
        
        // Transfer staking tokens from factory owner to the pool
        IERC20(stakingTokenAddress).transferFrom(msg.sender, poolAddress, amount);
        LiquidityPool(poolAddress).addRewardsToPot(amount);
    }
}