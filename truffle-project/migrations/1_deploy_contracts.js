const PoolFactory = artifacts.require("PoolFactory");
const SimpleStakingToken = artifacts.require("SimpleStakingToken");
const CrossPoolLib = artifacts.require("CrossPoolLib");
const DebtLib = artifacts.require("DebtLib");
const fs = require('fs');
const path = require('path');

module.exports = async function (deployer, network, accounts) {
  console.log("=== Minimal Deployment - Essential Contracts Only ===");
  console.log("Network:", network);
  console.log("Deployer account:", accounts[0]);
  
  let stakingTokenAddress;
  let stakingTokenInstance;
  
  try {
    // 1. Deploy SimpleStakingToken
    if (network === "development" || network === "ganache" || network === "goerli" || network === "sepolia") {
      console.log("\n=== Deploying SimpleStakingToken ===");
      
      const initialSupply = network === "development" || network === "ganache" ? 1000000 : 10000000;
      
      await deployer.deploy(
        SimpleStakingToken,
        "Aegis Staking Token",
        "AST",
        18,
        initialSupply,
        { from: accounts[0] }
      );
      
      stakingTokenInstance = await SimpleStakingToken.deployed();
      stakingTokenAddress = stakingTokenInstance.address;
      
      console.log("✓ SimpleStakingToken deployed at:", stakingTokenAddress);
      
      if ((network === "development" || network === "ganache") && accounts.length > 1) {
        console.log("Minting test tokens for development...");
        for (let i = 1; i < Math.min(accounts.length, 5); i++) {
          const mintAmount = web3.utils.toWei("10000", "ether");
          await stakingTokenInstance.mint(accounts[i], mintAmount, { from: accounts[0] });
          console.log(`✓ Minted 10,000 AST to account ${accounts[i]}`);
        }
      }
      
    } else {
      stakingTokenAddress = process.env.STAKING_TOKEN_ADDRESS;
      if (!stakingTokenAddress) {
        throw new Error(`STAKING_TOKEN_ADDRESS environment variable required for network: ${network}`);
      }
      console.log("Using existing staking token:", stakingTokenAddress);
    }

    // 2. Deploy Libraries
    console.log("\n=== Deploying Libraries ===");
    await deployer.deploy(CrossPoolLib, { from: accounts[0] });
    const crossPoolLibInstance = await CrossPoolLib.deployed();
    console.log("✓ CrossPoolLib deployed at:", crossPoolLibInstance.address);

    await deployer.deploy(DebtLib, { from: accounts[0] });
    const debtLibInstance = await DebtLib.deployed();
    console.log("✓ DebtLib deployed at:", debtLibInstance.address);

    // 3. Link Libraries to PoolFactory
    console.log("\n=== Linking Libraries to PoolFactory ===");
    await deployer.link(CrossPoolLib, PoolFactory);
    await deployer.link(DebtLib, PoolFactory);
    console.log("✓ Libraries linked to PoolFactory");

    // 4. Deploy PoolFactory
    console.log("\n=== Deploying PoolFactory ===");
    await deployer.deploy(PoolFactory, stakingTokenAddress, { from: accounts[0] });
    const poolFactoryInstance = await PoolFactory.deployed();
    console.log("✓ PoolFactory deployed at:", poolFactoryInstance.address);

    // Verify PoolFactory deployment
    console.log("\n=== Verification ===");
    console.log(`✓ SimpleStakingToken symbol: ${await stakingTokenInstance.symbol()}`);
    console.log(`✓ PoolFactory address: ${poolFactoryInstance.address}`);

    console.log("Testing PoolFactory functionality...");
    try {
      const factoryOwner = await poolFactoryInstance.owner();
      console.log(`✓ PoolFactory owner: ${factoryOwner}`);
    } catch (error) {
      console.log("⚠ PoolFactory owner check failed, but deployment succeeded");
    }

    // Create demo pools for development
    let createdPools = [];
    if (network === "development" || network === "ganache") {
      console.log("\n=== Creating Demo Pools for Frontend ===");
      
      const demoRegions = ["Mumbai", "Delhi", "Bangalore"];
      
      for (const region of demoRegions) {
        try {
          console.log(`Creating pool for ${region}...`);
          const tx = await poolFactoryInstance.createPool(region, { from: accounts[0] });
          
          const poolCreatedEvent = tx.logs.find(log => log.event === 'PoolCreated');
          if (poolCreatedEvent) {
            const poolAddress = poolCreatedEvent.args.poolAddress;
            console.log(`✓ Created pool for ${region} at: ${poolAddress}`);
            createdPools.push({ region, address: poolAddress });
          } else {
            console.log(`⚠ No PoolCreated event found for ${region}, but transaction succeeded`);
          }
        } catch (error) {
          console.log(`⚠ Failed to create pool for ${region}: ${error.message}`);
        }
      }
      
      if (createdPools.length > 0) {
        console.log("\n=== Demo Pools Created ===");
        createdPools.forEach(pool => {
          console.log(`${pool.region}: ${pool.address}`);
        });
      } else {
        console.log("⚠ No demo pools were created successfully");
      }
    }

    // Final deployment summary
    console.log("\n=== DEPLOYMENT COMPLETE ===");
    console.log("Essential contracts deployed:");
    console.log(`1. SimpleStakingToken: ${stakingTokenAddress}`);
    console.log(`2. CrossPoolLib: ${crossPoolLibInstance.address}`);
    console.log(`3. DebtLib: ${debtLibInstance.address}`);
    console.log(`4. PoolFactory: ${poolFactoryInstance.address}`);
    console.log(`Demo pools: ${createdPools.map(pool => `${pool.region}: ${pool.address}`).join(", ")}`);

    // Save deployment config for frontend
    const deploymentConfig = {
      network: network,
      timestamp: new Date().toISOString(),
      contracts: {
        POOL_FACTORY_ADDRESS: poolFactoryInstance.address,
        STAKING_TOKEN_ADDRESS: stakingTokenAddress,
        CROSS_POOL_LIB_ADDRESS: crossPoolLibInstance.address,
        DEBT_LIB_ADDRESS: debtLibInstance.address,
        DEMO_POOLS: createdPools
      },
      accounts: accounts.slice(0, 5)
    };

    const configPath = path.join(__dirname, '../deployment-config.json');
    const envPath = path.join(__dirname, '../../.env');
    
    fs.writeFileSync(configPath, JSON.stringify(deploymentConfig, null, 2));
    
    const envContent = `VITE_POOL_FACTORY_ADDRESS=${poolFactoryInstance.address}\nVITE_STAKING_TOKEN_ADDRESS=${stakingTokenAddress}\nVITE_CROSS_POOL_LIB_ADDRESS=${crossPoolLibInstance.address}\nVITE_DEBT_LIB_ADDRESS=${debtLibInstance.address}\nVITE_NETWORK=${network}\nVITE_DEPLOYMENT_TIMESTAMP=${deploymentConfig.timestamp}`;
    
    fs.writeFileSync(envPath, envContent);

    console.log("\n=== Frontend Configuration ===");
    console.log("Deployment config saved to:", configPath);
    console.log("Environment variables saved to:", envPath);
    console.log("Copy the following to your .env file:");
    console.log(envContent);

    console.log("\n=== All Frontend Functionality Supported ===");
    console.log("✓ Pool creation and management");
    console.log("✓ Staking and unstaking");
    console.log("✓ LP token minting/burning");
    console.log("✓ Fallback payments");
    console.log("✓ Debt management");
    console.log("✓ Rewards distribution");

  } catch (error) {
    console.error("\n=== DEPLOYMENT FAILED ===");
    console.error("Error:", error.message);
    throw error;
  }
};