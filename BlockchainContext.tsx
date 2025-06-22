import React, {
  useContext,
  createContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import LiquidityPoolArtifact from "./truffle-project/build/contracts/LiquidityPool.json";
import PoolFactory from "./truffle-project/build/contracts/PoolFactory.json";
import ERC20 from "./truffle-project/build/contracts/ERC20.json";
import LPERC20 from "./truffle-project/build/contracts/LPERC20.json";
import { ethers } from "https://esm.sh/ethers@5.7.2";
import {
  LiquidityPoolData,
  UserAccount,
  PoolStatus,
  StakeEntry,
  DebtEntry,
  AppNotification,
  NotificationType,
} from "./types";

import axios from "axios";

declare global {
  interface Window {
    ethereum?: any;
  }
}

const PoolFactoryABI: ethers.ContractInterface = PoolFactory.abi;
const LiquidityPoolABI: ethers.ContractInterface = LiquidityPoolArtifact.abi;
const ERC20_ABI = ERC20.abi;
const LPERC20_ABI: ethers.ContractInterface = LPERC20.abi;

const POOL_FACTORY_ADDRESS = import.meta.env.VITE_POOL_FACTORY_ADDRESS;
const STAKING_TOKEN_ADDRESS = import.meta.env.VITE_STAKING_TOKEN_ADDRESS;

interface IBlockchainContext {
  address: string | null;
  signer: ethers.Signer | null;
  provider: ethers.providers.Web3Provider | null;
  poolFactoryContract: ethers.Contract | null;
  stakingTokenContract: ethers.Contract | null;
  connectWallet: () => Promise<ethers.Contract | undefined>;
  disconnectWallet: () => void;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  appNotifications: AppNotification[];
  addAppNotification: (message: string, type?: NotificationType) => void;
  createPoolOnChain: (
    regionName: string
  ) => Promise<ethers.providers.TransactionResponse | null>;
  fetchBlockchainPools: () => Promise<LiquidityPoolData[]>;
  getLiquidityPoolContract: (poolAddress: string) => ethers.Contract | null;
  getTokenBalance: (address?: string) => Promise<string>;
  approveToken: (
    spenderAddress: string,
    amount: string
  ) => Promise<ethers.providers.TransactionResponse | null>;
  getTokenAllowance: (
    spenderAddress: string,
    address?: string
  ) => Promise<string>;
  stakingTokenInfo: { name: string; symbol: string; decimals: number } | null;
  stakeInPool: (amount: string) => Promise<boolean>;
  unstakeFromPool: ( lpAmount: string) => Promise<boolean>;
  getUserStakeInfo: (
    poolAddress: string,
    userAddress?: string
  ) => Promise<StakeEntry | null>;
  fetchUserData: (userAddress?: string) => Promise<UserAccount | null>;
  getAllUserPools: (userAddress?: string) => Promise<string[]>;
  getTotalCollateralAcrossPools: (userAddress?: string) => Promise<string>;
  getRelatedPools: (poolAddress: string) => Promise<string[]>;
  fallbackPayWithCrossPools: (
    merchantAddress: string,
    amount: string
  ) => Promise<boolean>;
  repayOnChain: () => Promise<boolean>;
}

const defaultBlockchainContextState: IBlockchainContext = {
  address: null,
  signer: null,
  provider: null,
  poolFactoryContract: null,
  stakingTokenContract: null,
  connectWallet: async () => undefined,
  disconnectWallet: () => {},
  isLoading: false,
  setIsLoading: () => {},
  appNotifications: [],
  addAppNotification: () => {},
  createPoolOnChain: async () => null,
  fetchBlockchainPools: async () => [],
  getLiquidityPoolContract: () => null,
  getTokenBalance: async () => "0",
  approveToken: async () => null,
  getTokenAllowance: async () => "0",
  stakingTokenInfo: null,
  stakeInPool: async () => false,
  unstakeFromPool: async () => false,
  getUserStakeInfo: async () => null,
  fetchUserData: async () => null,
  fallbackPayWithCrossPools: async () => false,
  getAllUserPools: async () => [],
  getTotalCollateralAcrossPools: async () => "0",
  getRelatedPools: async () => [],
  repayOnChain: async () => false,
};

const StateContext = createContext<IBlockchainContext>(
  defaultBlockchainContextState
);

export const StateContextProvider = ({ children }) => {
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [provider, setProvider] =
    useState<ethers.providers.Web3Provider | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [poolFactoryContract, setPoolFactoryContract] =
    useState<ethers.Contract | null>(null);
  const [stakingTokenContract, setStakingTokenContract] =
    useState<ethers.Contract | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [appNotifications, setAppNotifications] = useState<AppNotification[]>(
    []
  );
  const [stakingTokenInfo, setStakingTokenInfo] = useState<{
    name: string;
    symbol: string;
    decimals: number;
  } | null>(null);

  const addAppNotification = useCallback(
    (message: string, type: NotificationType = "info") => {
      console.log("=== addAppNotification ===", { message, type });
      const newNotification: AppNotification = {
        id: Date.now().toString(),
        message,
        type,
      };
      setAppNotifications((prev) => [newNotification, ...prev.slice(0, 4)]);
      setTimeout(() => {
        setAppNotifications((prev) =>
          prev.filter((n) => n.id !== newNotification.id)
        );
      }, 7000);
    },
    []
  );

  const initializeContracts = useCallback(
    async (web3Signer: ethers.Signer) => {
      console.log("=== initializeContracts ===", {
        poolFactoryAddress: POOL_FACTORY_ADDRESS,
        stakingTokenAddress: STAKING_TOKEN_ADDRESS,
      });
      try {
        if (!ethers.utils.isAddress(POOL_FACTORY_ADDRESS)) {
          throw new Error("Invalid PoolFactory address");
        }
        if (!ethers.utils.isAddress(STAKING_TOKEN_ADDRESS)) {
          throw new Error("Invalid StakingToken address");
        }

        const factoryContract = new ethers.Contract(
          POOL_FACTORY_ADDRESS,
          PoolFactoryABI,
          web3Signer
        );
        const tokenContract = new ethers.Contract(
          STAKING_TOKEN_ADDRESS,
          ERC20_ABI,
          web3Signer
        );
        setPoolFactoryContract(factoryContract);
        setStakingTokenContract(tokenContract);

        const [name, symbol, decimals] = await Promise.all([
          tokenContract.name(),
          tokenContract.symbol(),
          tokenContract.decimals(),
        ]);

        setStakingTokenInfo({ name, symbol, decimals });
        console.log("=== Contracts Initialized ===", {
          factoryContract: factoryContract.address,
          tokenContract: tokenContract.address,
          name,
          symbol,
          decimals,
        });

        return { factoryContract, tokenContract };
      } catch (error) {
        console.error("Contract initialization error:", error);
        addAppNotification(
          `Contract initialization failed: ${error.message}`,
          "error"
        );
        throw error;
      }
    },
    [addAppNotification]
  );

  const connectWallet = useCallback(async (): Promise<
    ethers.Contract | undefined
  > => {
    console.log("=== connectWallet ===");
    try {
      if (!window.ethereum) {
        addAppNotification("Please install MetaMask!", "error");
        return undefined;
      }

      setIsLoading(true);
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
      const web3Signer = web3Provider.getSigner();

      setProvider(web3Provider);
      setSigner(web3Signer);
      setAddress(accounts[0]);

      const { factoryContract } = await initializeContracts(web3Signer);
      addAppNotification("Wallet connected successfully!", "success");
      setIsLoading(false);
      return factoryContract;
    } catch (error) {
      console.error("Wallet connection error:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error during connection.";
      addAppNotification(`Connection error: ${errorMessage}`, "error");
      setIsLoading(false);
      return undefined;
    }
  }, [addAppNotification, initializeContracts]);

  const disconnectWallet = useCallback(() => {
    console.log("=== disconnectWallet ===");
    setSigner(null);
    setProvider(null);
    setAddress(null);
    setPoolFactoryContract(null);
    setStakingTokenContract(null);
    setStakingTokenInfo(null);
    addAppNotification("Wallet disconnected.", "info");
  }, [addAppNotification]);

  const getLiquidityPoolContract = useCallback(
    (poolAddress: string): ethers.Contract | null => {
      console.log("=== getLiquidityPoolContract ===", { poolAddress });
      if (!signer) return null;
      return new ethers.Contract(poolAddress, LiquidityPoolABI, signer);
    },
    [signer]
  );

  const getAllUserPools = useCallback(
    async (userAddress?: string): Promise<string[]> => {
      console.log("=== getAllUserPools ===", { userAddress, address });
      if (!poolFactoryContract || !address) {
        console.warn("getAllUserPools: Missing dependencies", {
          poolFactoryContract: !!poolFactoryContract,
          address,
        });
        return [];
      }

      try {
        const targetAddress = userAddress || address;
        const allPools = await poolFactoryContract.getPools();
        console.log("Fetched all pools:", allPools);
        const userPools: string[] = [];

        for (const poolAddress of allPools) {
          const poolContract = getLiquidityPoolContract(poolAddress);
          if (poolContract) {
            const stake = await poolContract.getStake(targetAddress);
            console.log("Stake for pool", { poolAddress, stake });
            if (stake.stakedAmount.gt(0)) {
              userPools.push(poolAddress);
            }
          }
        }
        console.log("User pools:", userPools);
        return userPools;
      } catch (error) {
        console.error("Error fetching user pools:", error);
        addAppNotification("Failed to fetch user pools", "error");
        return [];
      }
    },
    [poolFactoryContract, address, getLiquidityPoolContract, addAppNotification]
  );

  const getUserStakeInfo = useCallback(
    async (
      poolAddress: string,
      userAddress?: string
    ): Promise<StakeEntry | null> => {
      console.log("=== getUserStakeInfo ===", { poolAddress, userAddress });
      if (!address) return null;

      try {
        const poolContract = getLiquidityPoolContract(poolAddress);
        if (!poolContract) return null;

        const stake = await poolContract.getStake(userAddress || address);
        console.log("Fetched stake:", stake);

        return {
          userId: userAddress || address,
          stakedAmount: parseFloat(
            ethers.utils.formatUnits(
              stake.stakedAmount,
              stakingTokenInfo?.decimals || 18
            )
          ),
          collateralAmount: parseFloat(
            ethers.utils.formatUnits(
              stake.collateralAmount,
              stakingTokenInfo?.decimals || 18
            )
          ),
          lpTokensMinted: parseFloat(
            ethers.utils.formatUnits(stake.lpTokensMinted, 18)
          ),
          stakeTimestamp: stake.stakeTimestamp.toNumber(),
        };
      } catch (error) {
        console.error("Error fetching user stake info:", error);
        addAppNotification(
          `Failed to fetch stake info for pool ${poolAddress}`,
          "error"
        );
        return null;
      }
    },
    [address, getLiquidityPoolContract, stakingTokenInfo, addAppNotification]
  );

  const getTotalCollateralAcrossPools = useCallback(
    async (userAddress?: string): Promise<string> => {
      console.log("=== getTotalCollateralAcrossPools ===", {
        userAddress,
        address,
      });
      if (!address || !signer) {
        console.warn("getTotalCollateralAcrossPools: Missing dependencies", {
          address,
          signer: !!signer,
        });
        return "0";
      }

      try {
        let totalCollateral = 0;
        const targetAddress = userAddress || address;
        const userPools = await getAllUserPools(targetAddress);
        console.log("User pools for collateral:", userPools);

        for (const poolAddress of userPools) {
          const userStake = await getUserStakeInfo(poolAddress, targetAddress);
          if (userStake) {
            totalCollateral += userStake.collateralAmount;
            console.log("Collateral for pool", {
              poolAddress,
              collateral: userStake.collateralAmount,
            });
          }
        }

        console.log("Total collateral:", totalCollateral);

        return totalCollateral.toString();
      } catch (error) {
        console.error("Error getting total collateral across pools:", error);
        addAppNotification("Failed to fetch total collateral", "error");
        return "0";
      }
    },
    [address, signer, getAllUserPools, getUserStakeInfo, addAppNotification]
  );

  const getRelatedPools = useCallback(
    async (poolAddress: string): Promise<string[]> => {
      console.log("=== getRelatedPools ===", { poolAddress });
      return getAllUserPools(); // Simplified for now; adjust based on actual logic
    },
    [getAllUserPools]
  );

  const fetchBlockchainPools = useCallback(async (): Promise<
    LiquidityPoolData[]
  > => {
    console.log("=== fetchBlockchainPools ===");
    if (!poolFactoryContract) {
      if (address && signer) {
        addAppNotification(
          "Contracts not ready. Attempting to initialize...",
          "info"
        );
        try {
          const { factoryContract } = await initializeContracts(signer);
          return await fetchPoolsFromContract(factoryContract);
        } catch (error) {
          addAppNotification("Failed to initialize contracts", "error");
          return [];
        }
      }
      return [];
    }
    return await fetchPoolsFromContract(poolFactoryContract);
  }, [
    poolFactoryContract,
    address,
    signer,
    initializeContracts,
    addAppNotification,
  ]);

  const fetchPoolsFromContract = useCallback(
    async (contract: ethers.Contract): Promise<LiquidityPoolData[]> => {
      console.log("=== fetchPoolsFromContract ===", {
        contractAddress: contract.address,
      });
      setIsLoading(true);
      try {
        const poolCount = await contract.getPoolCount();
        console.log("Pool count:", poolCount.toNumber());

        if (poolCount.toNumber() === 0) {
          setIsLoading(false);
          return [];
        }

        const poolAddresses = await contract.getPools();
        console.log("Fetched pool addresses:", poolAddresses);
        const fetchedPoolsData: LiquidityPoolData[] = [];

        for (const pAddress of poolAddresses) {
          if (!ethers.utils.isAddress(pAddress)) {
            console.warn(`Invalid pool address: ${pAddress}`);
            continue;
          }

          const poolContract = getLiquidityPoolContract(pAddress);
          if (poolContract) {
            try {
              const [
                region,
                totalLiquidityRaw,
                statusRaw,
                rewardsPotRaw,
                apyRaw,
                lpTokenSupplyRaw,
                totalDebtRaw,
                userDebtRaw,
                userDebtsRaw,
              ] = await Promise.all([
                poolContract.regionName(),
                poolContract.totalLiquidity(),
                poolContract.getPoolStatus(),
                poolContract.rewardsPot(),
                poolContract.apy(),
                poolContract.lpTokenSupply(),
                poolContract.getTotalDebt(),
                address
                  ? poolContract.getActiveDebtAmount(address)
                  : Promise.resolve(0),
                address
                  ? poolContract.getUserDebts(address)
                  : Promise.resolve([]),
              ]);

              let stakers: StakeEntry[] = [];
              if (address) {
                const userStake = await getUserStakeInfo(pAddress, address);
                if (userStake && userStake.stakedAmount > 0) {
                  stakers = [userStake];
                }
              }

              const debts: DebtEntry[] = address
                ? userDebtsRaw.map((debt: any) => ({
                    user: debt.user,
                    merchantAddress: debt.merchantAddress,
                    amount: parseFloat(
                      ethers.utils.formatUnits(
                        debt.amount,
                        stakingTokenInfo?.decimals || 18
                      )
                    ),
                    timestamp: debt.timestamp.toNumber(),
                    isRepaid: debt.isRepaid,
                  }))
                : [];

              const poolData: LiquidityPoolData = {
                id: pAddress,
                regionName: region || `Pool ${pAddress.substring(0, 8)}...`,
                totalLiquidity: parseFloat(
                  ethers.utils.formatUnits(totalLiquidityRaw, 18)
                ),
                totalDebt: parseFloat(
                  ethers.utils.formatUnits(totalDebtRaw, 18)
                ),
                userDebt: parseFloat(ethers.utils.formatUnits(userDebtRaw, 18)),
                stakers,
                debts,
                status:
                  statusRaw === 0
                    ? PoolStatus.ACTIVE
                    : statusRaw === 1
                    ? PoolStatus.PAUSED
                    : PoolStatus.INACTIVE,
                rewardsPot: parseFloat(
                  ethers.utils.formatUnits(rewardsPotRaw, 18)
                ),
                apy: apyRaw.toNumber() / 100,
                lpTokenSupply: parseFloat(
                  ethers.utils.formatUnits(lpTokenSupplyRaw, 18)
                ),
              };

              fetchedPoolsData.push(poolData);
              console.log(`Pool ${pAddress} data:`, poolData);
            } catch (poolError) {
              console.error(
                `Error fetching details for pool ${pAddress}:`,
                poolError
              );
            }
          }
        }

        setIsLoading(false);
        return fetchedPoolsData;
      } catch (error) {
        console.error("Error fetching blockchain pools:", error);
        addAppNotification(`Error fetching pools: ${error.message}`, "error");
        setIsLoading(false);
        return [];
      }
    },
    [getLiquidityPoolContract, getUserStakeInfo, address, addAppNotification]
  );

  const getTokenBalance = useCallback(
    async (targetAddress?: string): Promise<string> => {
      console.log("=== getTokenBalance ===", { targetAddress });
      if (!stakingTokenContract || !address) return "0";

      try {
        const balance = await stakingTokenContract.balanceOf(
          targetAddress || address
        );
        console.log("Fetched token balance:", balance.toString());
        return ethers.utils.formatUnits(
          balance,
          stakingTokenInfo?.decimals || 18
        );
      } catch (error) {
        console.error("Error fetching token balance:", error);
        addAppNotification("Failed to fetch token balance", "error");
        return "0";
      }
    },
    [stakingTokenContract, address, stakingTokenInfo, addAppNotification]
  );

  const approveToken = useCallback(
    async (
      spenderAddress: string,
      amount: string
    ): Promise<ethers.providers.TransactionResponse | null> => {
      console.log("=== approveToken ===", { spenderAddress, amount });
      if (!stakingTokenContract || !signer) {
        addAppNotification("Please connect your wallet first", "error");
        return null;
      }

      try {
        setIsLoading(true);
        const amountWei = ethers.utils.parseUnits(
          amount,
          stakingTokenInfo?.decimals || 18
        );
        const tx = await stakingTokenContract.approve(
          spenderAddress,
          amountWei
        );
        console.log("Approval tx sent:", tx.hash);
        addAppNotification(
          `Approval transaction sent. Hash: ${tx.hash.substring(0, 10)}...`,
          "info"
        );
        await tx.wait();
        addAppNotification("Token approval confirmed!", "success");
        setIsLoading(false);
        return tx;
      } catch (error) {
        console.error("Token approval error:", error);
        addAppNotification(`Approval failed: ${error.message}`, "error");
        setIsLoading(false);
        return null;
      }
    },
    [stakingTokenContract, signer, stakingTokenInfo, addAppNotification]
  );

  const getTokenAllowance = useCallback(
    async (spenderAddress: string, targetAddress?: string): Promise<string> => {
      console.log("=== getTokenAllowance ===", {
        spenderAddress,
        targetAddress,
      });
      if (!stakingTokenContract || !address) return "0";

      try {
        const allowance = await stakingTokenContract.allowance(
          targetAddress || address,
          spenderAddress
        );
        console.log("Fetched allowance:", allowance.toString());
        return ethers.utils.formatUnits(
          allowance,
          stakingTokenInfo?.decimals || 18
        );
      } catch (error) {
        console.error("Error fetching token allowance:", error);
        addAppNotification("Failed to fetch token allowance", "error");
        return "0";
      }
    },
    [stakingTokenContract, address, stakingTokenInfo, addAppNotification]
  );

  const stakeInPool = useCallback(
    async (amount: string): Promise<boolean> => {
      console.log("=== stakeInPool ===", { amount });
      if (!signer || !address) {
        addAppNotification("Please connect your wallet first", "error");
        return false;
      }

      try {
        setIsLoading(true);

        // Fetch pools data from API
        addAppNotification("Fetching pool information...", "info");
        const response = await axios.get("http://localhost:8765/pools");
        const poolsData = response.data;

        if (!poolsData.pools || poolsData.pools.length === 0) {
          addAppNotification("No active pools found", "error");
          setIsLoading(false);
          return false;
        }

        // Filter only active pools
        const activePools = poolsData.pools.filter(
          (pool) => pool.status === "ACTIVE"
        );

        if (activePools.length === 0) {
          addAppNotification("No active pools available for staking", "error");
          setIsLoading(false);
          return false;
        }

        console.log("Active pools:", activePools);

        // Calculate distribution amounts based on inverse liquidity
        const distributedAmounts = calculateDistribution(activePools, amount);
        console.log("Distribution amounts:", distributedAmounts);

        const totalAmountWei = ethers.utils.parseUnits(
          amount,
          stakingTokenInfo?.decimals || 18
        );

        // Check total allowance for all pools
        let totalAllowanceNeeded = ethers.BigNumber.from(0);
        for (const distribution of distributedAmounts) {
          const amountWei = ethers.utils.parseUnits(
            distribution.amount.toString(),
            stakingTokenInfo?.decimals || 18
          );
          totalAllowanceNeeded = totalAllowanceNeeded.add(amountWei);
        }

        // Check and approve tokens if needed for each pool
        for (const distribution of distributedAmounts) {
          const currentAllowance = await getTokenAllowance(distribution.poolId);
          const currentAllowanceWei = ethers.utils.parseUnits(
            currentAllowance,
            stakingTokenInfo?.decimals || 18
          );
          const requiredAmountWei = ethers.utils.parseUnits(
            distribution.amount.toString(),
            stakingTokenInfo?.decimals || 18
          );

          if (currentAllowanceWei.lt(requiredAmountWei)) {
            addAppNotification(
              `Approving tokens for ${distribution.regionName} pool...`,
              "info"
            );
            const approvalTx = await approveToken(
              distribution.poolId,
              distribution.amount.toString()
            );
            if (!approvalTx) {
              setIsLoading(false);
              return false;
            }
          }
        }

        // Execute staking transactions for each pool
        const stakePromises = [];
        for (const distribution of distributedAmounts) {
          if (distribution.amount > 0) {
            stakePromises.push(
              executeStakeForPool(
                distribution.poolId,
                distribution.amount,
                distribution.regionName
              )
            );
          }
        }

        addAppNotification(
          "Executing stake transactions across pools...",
          "info"
        );
        const results = await Promise.allSettled(stakePromises);

        // Check results
        const successful = results.filter(
          (result) => result.status === "fulfilled"
        ).length;
        const failed = results.filter(
          (result) => result.status === "rejected"
        ).length;

        if (successful > 0) {
          addAppNotification(
            `Successfully staked in ${successful} pools! ${
              failed > 0 ? `${failed} transactions failed.` : ""
            }`,
            successful === distributedAmounts.length ? "success" : "info"
          );
        } else {
          addAppNotification("All staking transactions failed", "error");
          setIsLoading(false);
          return false;
        }

        setIsLoading(false);
        return successful > 0;
      } catch (error) {
        console.error("Staking error:", error);
        let errorMessage = "Staking failed";
        if (error.message?.includes("insufficient funds")) {
          errorMessage = "Insufficient funds for transaction";
        } else if (error.message?.includes("user rejected")) {
          errorMessage = "Transaction rejected by user";
        } else if (error.message?.includes("execution reverted")) {
          errorMessage = "Transaction reverted - check pool status and balance";
        } else if (error.message?.includes("Network Error")) {
          errorMessage = "Failed to fetch pool data - check API connection";
        }
        addAppNotification(errorMessage, "error");
        setIsLoading(false);
        return false;
      }
    },
    [
      signer,
      address,
      getLiquidityPoolContract,
      stakingTokenInfo,
      getTokenAllowance,
      approveToken,
      addAppNotification,
    ]
  );

  // Helper function to calculate distribution based on inverse liquidity
  const calculateDistribution = (pools, totalAmount) => {
    const totalAmountNum = parseFloat(totalAmount);

    // Calculate inverse weights (pools with lower liquidity get higher weight)
    const poolsWithWeights = pools.map((pool) => {
      // Add 1 to avoid division by zero and ensure minimum weight
      const inverseLiquidity = 1 / (pool.totalLiquidity + 1);
      return {
        ...pool,
        weight: inverseLiquidity,
      };
    });

    // Calculate total weight
    const totalWeight = poolsWithWeights.reduce(
      (sum, pool) => sum + pool.weight,
      0
    );

    // Distribute amount based on weights
    const distributions = poolsWithWeights.map((pool, index) => {
      const percentage = pool.weight / totalWeight;
      let amount = totalAmountNum * percentage;

      // Round to reasonable decimal places (6 decimal places)
      amount = Math.round(amount * 1000000) / 1000000;

      return {
        poolId: pool.id,
        regionName: pool.regionName,
        amount: amount,
        percentage: (percentage * 100).toFixed(2),
        currentLiquidity: pool.totalLiquidity,
      };
    });

    // Ensure total distributed amount equals input amount (handle rounding)
    const totalDistributed = distributions.reduce(
      (sum, dist) => sum + dist.amount,
      0
    );
    const difference = totalAmountNum - totalDistributed;

    if (Math.abs(difference) > 0.000001) {
      // Add the difference to the pool with the highest weight
      const maxWeightIndex = distributions.findIndex(
        (dist) =>
          dist.amount === Math.max(...distributions.map((d) => d.amount))
      );
      distributions[maxWeightIndex].amount += difference;
      distributions[maxWeightIndex].amount =
        Math.round(distributions[maxWeightIndex].amount * 1000000) / 1000000;
    }

    return distributions;
  };

  // Helper function to execute stake for a specific pool
  const executeStakeForPool = async (poolAddress, amount, regionName) => {
    try {
      const poolContract = getLiquidityPoolContract(poolAddress);
      console.log(`Staking in ${regionName} pool (${poolAddress}):`, amount);

      if (!poolContract) {
        throw new Error(`Pool contract not found for ${regionName}`);
      }

      const amountWei = ethers.utils.parseUnits(
        amount.toString(),
        stakingTokenInfo?.decimals || 18
      );

      const stakeTx = await poolContract.stake(amountWei);
      console.log(`Stake tx sent for ${regionName}:`, stakeTx.hash);

      addAppNotification(
        `Stake transaction sent for ${regionName}. Hash: ${stakeTx.hash.substring(
          0,
          10
        )}...`,
        "info"
      );

      await stakeTx.wait();

      addAppNotification(
        `Successfully staked ${amount} tokens in ${regionName} pool!`,
        "success"
      );

      return { success: true, poolAddress, regionName, amount };
    } catch (error) {
      console.error(`Staking error for ${regionName}:`, error);
      addAppNotification(
        `Failed to stake in ${regionName} pool: ${error.message}`,
        "error"
      );
      throw error;
    }
  };

  const unstakeFromPool = useCallback(
  async (lpAmount: string): Promise<boolean> => {
    console.log("=== unstakeFromPool ===", { lpAmount });
    if (!signer || !address) {
      addAppNotification("Please connect your wallet first", "error");
      return false;
    }

    try {
      setIsLoading(true);
      const lpAmountFloat = parseFloat(lpAmount);
      if (isNaN(lpAmountFloat) || lpAmountFloat <= 0) {
        addAppNotification("Invalid LP token amount", "error");
        setIsLoading(false);
        return false;
      }

      // Fetch all pools where the user has staked
      addAppNotification("Fetching user pools for unstaking...", "info");
      const userPools = await getAllUserPools(address);
      if (userPools.length === 0) {
        addAppNotification("No pools found with user stakes", "error");
        setIsLoading(false);
        return false;
      }

      // Get user's LP token balance and stake info for each pool
      const poolsWithStakes = [];
      let totalUserLPTokens = 0;

      for (const poolAddress of userPools) {
        const poolContract = getLiquidityPoolContract(poolAddress);
        if (!poolContract) {
          console.warn(`Pool contract not found for ${poolAddress}`);
          continue;
        }

        const stakeInfo = await getUserStakeInfo(poolAddress, address);
        if (!stakeInfo || stakeInfo.lpTokensMinted <= 0) {
          console.warn(`No valid stake found for pool ${poolAddress}`);
          continue;
        }

        const lpTokenAddress = await poolContract.lpToken();
        const lpTokenContract = new ethers.Contract(
          lpTokenAddress,
          LPERC20_ABI,
          signer
        );
        const userLPBalance = await lpTokenContract.balanceOf(address);
        const userLPBalanceFloat = parseFloat(
          ethers.utils.formatUnits(userLPBalance, 18)
        );

        if (userLPBalanceFloat > 0) {
          poolsWithStakes.push({
            poolId: poolAddress,
            regionName: stakeInfo.regionName || `Pool ${poolAddress.substring(0, 8)}...`,
            lpBalance: userLPBalanceFloat,
            lpBalanceWei: userLPBalance,
            stakeInfo,
            poolContract,
            lpTokenContract,
          });
          totalUserLPTokens += userLPBalanceFloat;
        }
      }

      if (poolsWithStakes.length === 0) {
        addAppNotification("No pools with LP tokens available for unstaking", "error");
        setIsLoading(false);
        return false;
      }

      if (totalUserLPTokens < lpAmountFloat) {
        addAppNotification(
          `Insufficient LP tokens. Available: ${totalUserLPTokens}, Requested: ${lpAmount}`,
          "error"
        );
        setIsLoading(false);
        return false;
      }

      // Calculate distribution based on proportional LP token balances
      const distributedAmounts = poolsWithStakes.map((pool) => {
        const proportion = pool.lpBalance / totalUserLPTokens;
        let amount = lpAmountFloat * proportion;
        // Round to 6 decimal places to avoid precision issues
        amount = Math.round(amount * 1000000) / 1000000;

        return {
          poolId: pool.poolId,
          regionName: pool.regionName,
          amount: amount,
          amountWei: ethers.utils.parseUnits(amount.toString(), 18),
          lpBalance: pool.lpBalance,
          poolContract: pool.poolContract,
          lpTokenContract: pool.lpTokenContract,
        };
      });

      // Adjust for rounding errors
      const totalDistributed = distributedAmounts.reduce(
        (sum, dist) => sum + dist.amount,
        0
      );
      const difference = lpAmountFloat - totalDistributed;
      if (Math.abs(difference) > 0.000001) {
        const maxAmountIndex = distributedAmounts.findIndex(
          (dist) => dist.amount === Math.max(...distributedAmounts.map((d) => d.amount))
        );
        distributedAmounts[maxAmountIndex].amount += difference;
        distributedAmounts[maxAmountIndex].amount =
          Math.round(distributedAmounts[maxAmountIndex].amount * 1000000) / 1000000;
        distributedAmounts[maxAmountIndex].amountWei = ethers.utils.parseUnits(
          distributedAmounts[maxAmountIndex].amount.toString(),
          18
        );
      }

      console.log("Distribution amounts for unstaking:", distributedAmounts);

      // Execute unstake transactions for each pool
      const unstakePromises = [];
      for (const distribution of distributedAmounts) {
        if (distribution.amount > 0) {
          unstakePromises.push(
            executeUnstakeForPool(
              distribution.poolId,
              distribution.amount,
              distribution.amountWei,
              distribution.regionName,
              distribution.poolContract
            )
          );
        }
      }

      if (unstakePromises.length === 0) {
        addAppNotification("No valid unstake amounts to process", "error");
        setIsLoading(false);
        return false;
      }

      addAppNotification(
        "Executing unstake transactions across pools...",
        "info"
      );
      const results = await Promise.allSettled(unstakePromises);

      // Check results
      const successful = results.filter(
        (result) => result.status === "fulfilled"
      ).length;
      const failed = results.filter(
        (result) => result.status === "rejected"
      ).length;

      if (successful > 0) {
        addAppNotification(
          `Successfully unstaked from ${successful} pools! ${
            failed > 0 ? `${failed} transactions failed.` : ""
          }`,
          successful === distributedAmounts.length ? "success" : "info"
        );
      } else {
        addAppNotification("All unstake transactions failed", "error");
        setIsLoading(false);
        return false;
      }

      setIsLoading(false);
      return successful > 0;
    } catch (error) {
      console.error("Unstaking error:", error);
      let errorMessage = "Unstaking failed";
      if (error.message?.includes("insufficient funds")) {
        errorMessage = "Insufficient LP tokens for transaction";
      } else if (error.message?.includes("user rejected")) {
        errorMessage = "Transaction rejected by user";
      } else if (error.message?.includes("execution reverted")) {
        errorMessage = "Transaction reverted - check timelock and LP balance";
      } else if (error.message?.includes("Network Error")) {
        errorMessage = "Failed to fetch pool data - check network connection";
      }
      addAppNotification(errorMessage, "error");
      setIsLoading(false);
      return false;
    }
  },
  [
    signer,
    address,
    getLiquidityPoolContract,
    getAllUserPools,
    getUserStakeInfo,
    addAppNotification,
  ]
);

// Helper function to execute unstake for a specific pool
const executeUnstakeForPool = async (
  poolAddress: string,
  amount: number,
  amountWei: ethers.BigNumber,
  regionName: string,
  poolContract: ethers.Contract
) => {
  try {
    console.log(`Unstaking from ${regionName} pool (${poolAddress}):`, amount);

    // Check timelock (if applicable)
    try {
      const canUnstake = await poolContract.canUnstake(address);
      if (!canUnstake) {
        throw new Error("Unstaking is still in timelock period");
      }
    } catch (timelockError) {
      console.warn(`Could not check timelock status for ${regionName}:`, timelockError);
    }

    // Estimate gas
    const gasEstimate = await poolContract.estimateGas.unstake(amountWei);
    console.log(`Gas estimate for ${regionName}:`, gasEstimate.toString());
    const gasLimit = gasEstimate.mul(120).div(100); // 20% buffer

    addAppNotification(
      `Initiating unstake transaction for ${regionName}...`,
      "info"
    );
    const unstakeTx = await poolContract.unstake(amountWei, { gasLimit });
    console.log(`Unstake tx sent for ${regionName}:`, unstakeTx.hash);

    addAppNotification(
      `Unstake transaction sent for ${regionName}. Hash: ${unstakeTx.hash.substring(
        0,
        10
      )}...`,
      "info"
    );

    await unstakeTx.wait();

    addAppNotification(
      `Successfully unstaked ${amount} LP tokens from ${regionName} pool!`,
      "success"
    );

    return { success: true, poolAddress, regionName, amount };
  } catch (error) {
    console.error(`Unstaking error for ${regionName}:`, error);
    let errorMessage = `Failed to unstake from ${regionName} pool: ${error.message}`;
    if (error.message.includes("timelock")) {
      errorMessage = `Unstaking from ${regionName} is still in timelock period`;
    } else if (error.message.includes("insufficient")) {
      errorMessage = `Insufficient LP tokens in ${regionName} pool`;
    } else if (error.message.includes("reverted")) {
      errorMessage = `Transaction reverted for ${regionName} - check contract state`;
    }
    addAppNotification(errorMessage, "error");
    throw error;
  }
};

  const createPoolOnChain = useCallback(
    async (
      regionName: string
    ): Promise<ethers.providers.TransactionResponse | null> => {
      console.log("=== createPoolOnChain ===", { regionName });
      if (!poolFactoryContract || !signer) {
        addAppNotification(
          "Please connect your wallet and ensure contracts are initialized.",
          "error"
        );
        return null;
      }

      try {
        setIsLoading(true);
        const tx = await poolFactoryContract.createPool(regionName);
        console.log("Pool creation tx sent:", tx.hash);
        addAppNotification(
          `Pool "${regionName}" creation transaction sent (Tx: ${tx.hash.substring(
            0,
            10
          )}...)`,
          "info"
        );
        await tx.wait(1);
        addAppNotification(
          `Pool "${regionName}" created successfully on-chain!`,
          "success"
        );
        setIsLoading(false);
        return tx;
      } catch (error) {
        console.error("Error creating pool on chain:", error);
        addAppNotification(`Error creating pool: ${error.message}`, "error");
        setIsLoading(false);
        return null;
      }
    },
    [poolFactoryContract, signer, addAppNotification]
  );

  const fetchUserData = useCallback(
    async (userAddress?: string): Promise<UserAccount | null> => {
      console.log("=== fetchUserData ===", { userAddress });
      if (!address) return null;

      try {
        const targetAddress = userAddress || address;
        const tokenBalance = await getTokenBalance(targetAddress);
        const pools = await fetchBlockchainPools();
        const lpTokenBalances: { [poolId: string]: number } = {};

        for (const pool of pools) {
          const stakeInfo = await getUserStakeInfo(pool.id, targetAddress);
          if (stakeInfo) {
            lpTokenBalances[pool.id] = stakeInfo.lpTokensMinted;
          }
        }

        const userData = {
          id: targetAddress,
          name: `User (${targetAddress.substring(0, 6)}...)`,
          tokenBalance: parseFloat(tokenBalance),
          lpTokenBalances,
        };
        console.log("Fetched user data:", userData);
        return userData;
      } catch (error) {
        console.error("Error fetching user data:", error);
        addAppNotification("Failed to fetch user data", "error");
        return null;
      }
    },
    [
      address,
      getTokenBalance,
      fetchBlockchainPools,
      getUserStakeInfo,
      addAppNotification,
    ]
  );

  const repayOnChain = useCallback(async (): Promise<boolean> => {
    console.log("=== repayOnChain ===");
    if (!signer || !address) {
      addAppNotification("Please connect your wallet first", "error");
      return false;
    }

    try {
      setIsLoading(true);

      // Get user balance once to avoid multiple calls
      const userBalance = await getTokenBalance(address);
      let remainingBalanceWei = ethers.utils.parseUnits(
        userBalance,
        stakingTokenInfo?.decimals || 18
      );

      if (remainingBalanceWei.eq(0)) {
        addAppNotification("Insufficient token balance for repayment", "error");
        setIsLoading(false);
        return false;
      }

      // Fetch all pools
      const pools = await fetchBlockchainPools();
      if (!pools.length) {
        addAppNotification("No pools found", "info");
        setIsLoading(false);
        return true; // No debts to repay
      }

      let allSuccessful = true;

      // Iterate through each pool
      for (const pool of pools) {
        const poolAddress = pool.id;
        const poolContract = getLiquidityPoolContract(poolAddress);
        if (!poolContract) {
          addAppNotification(
            `Pool contract not found for ${poolAddress}`,
            "error"
          );
          allSuccessful = false;
          continue;
        }

        // Get all user debts
        let userDebts;
        try {
          userDebts = await poolContract.getUserDebts(address);
        } catch (error) {
          console.error(
            `Failed to fetch debts for pool ${poolAddress}:`,
            error
          );
          addAppNotification(
            `Failed to fetch debts for pool ${poolAddress}`,
            "error"
          );
          allSuccessful = false;
          continue;
        }

        // Create array of unpaid debts with their original indices
        const unpaidDebtsWithIndices = userDebts
          .map((debt: any, index: number) => ({
            debt: {
              user: debt.user,
              merchantAddress: debt.merchantAddress,
              amount: debt.amount,
              timestamp: debt.timestamp.toNumber(),
              isRepaid: debt.isRepaid,
            },
            index,
          }))
          .filter(({ debt }) => !debt.isRepaid);

        if (!unpaidDebtsWithIndices.length) {
          console.log(`No unpaid debts found for pool ${poolAddress}`);
          continue;
        }

        // Check and handle token approval for the pool
        const currentAllowance = await getTokenAllowance(poolAddress);
        const currentAllowanceWei = ethers.utils.parseUnits(
          currentAllowance,
          stakingTokenInfo?.decimals || 18
        );

        const totalDebtAmountWei = unpaidDebtsWithIndices.reduce(
          (sum, { debt }) => sum.add(debt.amount),
          ethers.BigNumber.from(0)
        );

        if (currentAllowanceWei.lt(totalDebtAmountWei)) {
          addAppNotification(
            `Approving tokens for pool ${poolAddress}...`,
            "info"
          );
          const approvalAmount = ethers.utils.formatUnits(
            totalDebtAmountWei,
            stakingTokenInfo?.decimals || 18
          );
          const approvalTx = await approveToken(poolAddress, approvalAmount);
          if (!approvalTx) {
            addAppNotification(
              `Token approval failed for pool ${poolAddress}`,
              "error"
            );
            allSuccessful = false;
            continue;
          }

          await approvalTx.wait();
          addAppNotification(
            `Token approval confirmed for pool ${poolAddress}`,
            "success"
          );
        }

        // Process each unpaid debt
        for (const { debt, index } of unpaidDebtsWithIndices) {
          if (remainingBalanceWei.eq(0)) {
            addAppNotification(
              "Insufficient balance to repay remaining debts",
              "error"
            );
            allSuccessful = false;
            break;
          }

          const debtAmountWei = debt.amount;
          const repayAmountWei = remainingBalanceWei.lt(debtAmountWei)
            ? remainingBalanceWei
            : debtAmountWei;

          if (repayAmountWei.eq(0)) {
            addAppNotification(
              `Zero repayment amount for debt index ${index} in pool ${poolAddress}`,
              "error"
            );
            allSuccessful = false;
            continue;
          }

          // Estimate gas
          let gasEstimate;
          try {
            gasEstimate = await poolContract.estimateGas.repayDebt(
              index,
              repayAmountWei
            );
            console.log(
              `Gas estimate for repayDebt in pool ${poolAddress}:`,
              gasEstimate.toString()
            );
          } catch (gasError) {
            console.error(
              `Gas estimation failed for pool ${poolAddress}, debt ${index}:`,
              gasError
            );
            addAppNotification(
              `Gas estimation failed for debt ${index} in pool ${poolAddress}`,
              "error"
            );
            allSuccessful = false;
            continue;
          }

          // Execute repayment
          try {
            const gasLimit = gasEstimate.mul(120).div(100); // 20% buffer
            addAppNotification(
              `Initiating repayment for debt ${index} in pool ${poolAddress}...`,
              "info"
            );
            const repayTx = await poolContract.repayDebt(
              index,
              repayAmountWei,
              {
                gasLimit,
              }
            );

            addAppNotification(
              `Repay transaction sent for debt ${index} in pool ${poolAddress}. Hash: ${repayTx.hash.substring(
                0,
                10
              )}...`,
              "info"
            );

            const receipt = await repayTx.wait();

            if (receipt.status === 1) {
              const formattedAmount = ethers.utils.formatUnits(
                repayAmountWei,
                stakingTokenInfo?.decimals || 18
              );
              addAppNotification(
                `Successfully repaid ${formattedAmount} tokens for debt ${index} in pool ${poolAddress}`,
                "success"
              );
              remainingBalanceWei = remainingBalanceWei.sub(repayAmountWei);
            } else {
              addAppNotification(
                `Repay transaction failed for debt ${index} in pool ${poolAddress}`,
                "error"
              );
              allSuccessful = false;
            }
          } catch (txError) {
            console.error(
              `Repayment failed for debt ${index} in pool ${poolAddress}:`,
              txError
            );
            let errorMessage = `Repayment failed for debt ${index} in pool ${poolAddress}`;
            if (txError.reason) {
              errorMessage = `${errorMessage}: ${txError.reason}`;
            } else if (txError.message.includes("rejected")) {
              errorMessage = `Transaction rejected by user for debt ${index} in pool ${poolAddress}`;
            } else if (txError.message.includes("reverted")) {
              const match = txError.message.match(/execution reverted: (.+)/);
              errorMessage = match
                ? `${errorMessage}: ${match[1]}`
                : `${errorMessage}: Transaction reverted`;
            }
            addAppNotification(errorMessage, "error");
            allSuccessful = false;
          }
        }
      }

      setIsLoading(false);
      if (allSuccessful) {
        addAppNotification("All unpaid debts successfully repaid!", "success");
      } else {
        addAppNotification(
          "Some debt repayments failed. Please check notifications for details.",
          "error"
        );
      }
      return allSuccessful;
    } catch (error) {
      console.error("Repay all debts error:", error);
      let errorMessage = "Failed to process debt repayments";
      if (error.code === "INSUFFICIENT") {
        errorMessage = "Insufficient funds for transaction";
      } else if (error.code === "UNPREDICTABLE_GAS_LIMIT") {
        errorMessage = "Transaction may fail - check contract state";
      } else if (error.message.includes("rejected")) {
        errorMessage = "Transaction rejected by user";
      } else if (error.reason) {
        errorMessage = `Transaction error: ${error.reason}`;
      }

      addAppNotification(errorMessage, "error");
      setIsLoading(false);
      return false;
    }
  }, [
    signer,
    address,
    getTokenBalance,
    stakingTokenInfo,
    fetchBlockchainPools,
    getLiquidityPoolContract,
    getTokenAllowance,
    approveToken,
    addAppNotification,
  ]);

  const fallbackPayWithCrossPools = useCallback(
    async (merchantAddress: string, amount: string): Promise<boolean> => {
      console.log("=== fallbackPayWithCrossPools ===", {
        merchantAddress,
        amount,
      });
      if (!signer || !address) {
        addAppNotification("Please connect your wallet first", "error");
        return false;
      }

      try {
        setIsLoading(true);
        const amountFloat = parseFloat(amount);
        if (isNaN(amountFloat) || amountFloat <= 0) {
          addAppNotification("Invalid payment amount", "error");
          setIsLoading(false);
          return false;
        }

        // Validate merchant address
        if (!ethers.utils.isAddress(merchantAddress)) {
          addAppNotification("Invalid merchant address", "error");
          setIsLoading(false);
          return false;
        }

        // Fetch pools data from API
        let poolsData;
        try {
          const response = await fetch("http://localhost:8765/pools");
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          poolsData = await response.json();
        } catch (fetchError) {
          console.error("Error fetching pools data:", fetchError);
          addAppNotification("Failed to fetch pools data", "error");
          setIsLoading(false);
          return false;
        }

        // Filter pools for current user and get user collateral amounts
        const userPools = poolsData.pools
          .filter((pool) => pool.userStake?.collateralAmount > 0)
          .sort(
            (a, b) =>
              (b.userStake?.collateralAmount || 0) -
              (a.userStake?.collateralAmount || 0)
          ); // Sort by collateral descending

        if (userPools.length === 0) {
          addAppNotification(
            "No pools with collateral found for user",
            "error"
          );
          setIsLoading(false);
          return false;
        }

        // Calculate total collateral
        const totalCollateralFloat = userPools.reduce(
          (sum, pool) => sum + pool.userStake.collateralAmount,
          0
        );
        console.log("Total collateral across pools:", {
          totalCollateralFloat,
          amountFloat,
          userPoolsCount: userPools.length,
        });

        if (totalCollateralFloat < amountFloat) {
          addAppNotification(
            `Insufficient total collateral. Available: ${totalCollateralFloat}, Required: ${amount}`,
            "error"
          );
          setIsLoading(false);
          return false;
        }

        const decimals = stakingTokenInfo?.decimals || 18;
        let remainingAmount = amountFloat;
        const paymentTransactions = [];

        // Process each pool until remaining amount is zero
        for (const pool of userPools) {
          if (remainingAmount <= 0) break;

          const poolAddress = pool.id;
          const availableCollateral = pool.userStake.collateralAmount;

          // Determine how much to pay from this pool
          const paymentFromThisPool = Math.min(
            remainingAmount,
            availableCollateral
          );

          console.log(`Processing pool ${pool.regionName} (${poolAddress}):`, {
            availableCollateral,
            paymentFromThisPool,
            remainingAmount,
          });

          // Get pool contract
          const poolContract = getLiquidityPoolContract(poolAddress);
          if (!poolContract) {
            console.error(`Pool contract not found for ${poolAddress}`);
            continue;
          }

          let paymentAmountWei;
          try {
            paymentAmountWei = ethers.utils.parseUnits(
              paymentFromThisPool.toString(),
              decimals
            );
          } catch (parseError) {
            console.error("Error parsing payment amount to Wei:", parseError);
            continue;
          }

          // Check token allowance for this pool
          const allowance = await getTokenAllowance(poolAddress, address);
          const allowanceFloat = parseFloat(allowance);
          console.log(`Token allowance for pool ${pool.regionName}:`, {
            allowanceFloat,
            paymentFromThisPool,
          });

          if (allowanceFloat < paymentFromThisPool) {
            addAppNotification(
              `Approving tokens for ${pool.regionName} pool...`,
              "info"
            );
            const approvalTx = await approveToken(
              poolAddress,
              paymentFromThisPool.toString()
            );
            if (!approvalTx) {
              addAppNotification(
                `Token approval failed for ${pool.regionName} pool`,
                "error"
              );
              continue;
            }
          }

          // Log pool state for debugging
          try {
            const poolStatus = await poolContract.getPoolStatus();
            const primaryCollateral = await poolContract.getStake(address);
            const totalLiquidity = await poolContract.totalLiquidity();
            console.log(`Pool state for ${pool.regionName}:`, {
              poolStatus: poolStatus.toString(),
              primaryCollateral: {
                stakedAmount: ethers.utils.formatUnits(
                  primaryCollateral.stakedAmount,
                  decimals
                ),
                collateralAmount: ethers.utils.formatUnits(
                  primaryCollateral.collateralAmount,
                  decimals
                ),
              },
              totalLiquidity: ethers.utils.formatUnits(
                totalLiquidity,
                decimals
              ),
            });
          } catch (statusError) {
            console.error(
              `Error getting pool status for ${pool.regionName}:`,
              statusError
            );
          }

          // Estimate gas
          let gasEstimate;
          try {
            gasEstimate = await poolContract.estimateGas.fallbackPay(
              merchantAddress,
              paymentAmountWei
            );
            console.log(
              `Gas estimate for ${pool.regionName}:`,
              gasEstimate.toString()
            );
          } catch (gasError) {
            console.error(
              `Gas estimation failed for ${pool.regionName}:`,
              gasError
            );
            addAppNotification(
              `Gas estimation failed for ${pool.regionName}: ${
                gasError.reason || gasError.message
              }`,
              "error"
            );
            continue;
          }

          // Store transaction details for execution
          paymentTransactions.push({
            poolContract,
            poolAddress,
            regionName: pool.regionName,
            merchantAddress,
            paymentAmountWei,
            paymentAmount: paymentFromThisPool,
            gasEstimate,
          });

          // Update remaining amount
          remainingAmount -= paymentFromThisPool;
          console.log(
            `Remaining amount after ${pool.regionName}:`,
            remainingAmount
          );
        }

        if (paymentTransactions.length === 0) {
          addAppNotification("No valid pools found for payment", "error");
          setIsLoading(false);
          return false;
        }

        addAppNotification(
          "Initiating cross-pool payment transactions...",
          "info"
        );

        // Execute all transactions
        const successfulTransactions = [];
        for (const txData of paymentTransactions) {
          try {
            // Execute transaction
            const gasLimit = txData.gasEstimate.mul(120).div(100); // 20% buffer
            const fallbackTx = await txData.poolContract.fallbackPay(
              txData.merchantAddress,
              txData.paymentAmountWei,
              { gasLimit }
            );

            console.log(`Fallback payment tx sent for ${txData.regionName}:`, {
              hash: fallbackTx.hash,
              amount: txData.paymentAmount,
            });

            addAppNotification(
              `Payment transaction sent for ${
                txData.regionName
              }. Hash: ${fallbackTx.hash.substring(0, 6)}...`,
              "info"
            );

            await fallbackTx.wait();
            successfulTransactions.push({
              regionName: txData.regionName,
              amount: txData.paymentAmount,
              hash: fallbackTx.hash,
            });
          } catch (txError) {
            console.error(
              `Transaction failed for ${txData.regionName}:`,
              txError
            );
            addAppNotification(
              `Payment failed for ${txData.regionName}: ${
                txError.reason || txError.message
              }`,
              "error"
            );
          }
        }

        if (successfulTransactions.length > 0) {
          const totalPaid = successfulTransactions.reduce(
            (sum, tx) => sum + tx.amount,
            0
          );
          addAppNotification(
            `Successfully paid ${totalPaid.toFixed(
              6
            )} tokens using cross-pool collateral from ${
              successfulTransactions.length
            } pool(s)!`,
            "success"
          );

          console.log("Successful transactions:", successfulTransactions);
          setIsLoading(false);
          return true;
        } else {
          addAppNotification("All payment transactions failed", "error");
          setIsLoading(false);
          return false;
        }
      } catch (error) {
        console.error("Cross-pool payment error:", error);
        let errorMessage = "Cross-pool payment failed";

        if (error.reason) {
          errorMessage = `Transaction reverted: ${error.reason}`;
        } else if (error.message.includes("insufficient collateral")) {
          errorMessage = "Insufficient collateral across pools";
        } else if (error.message.includes("insufficient liquidity")) {
          errorMessage = "Insufficient liquidity even after redistribution";
        } else if (error.message.includes("user rejected")) {
          errorMessage = "Transaction rejected by user";
        } else if (error.message) {
          errorMessage = error.message;
        }

        addAppNotification(errorMessage, "error");
        setIsLoading(false);
        return false;
      }
    },
    [
      signer,
      address,
      getLiquidityPoolContract,
      stakingTokenInfo,
      getTokenAllowance,
      approveToken,
      addAppNotification,
    ]
  );
  const contextValue = useMemo(
    () => ({
      address,
      signer,
      provider,
      poolFactoryContract,
      stakingTokenContract,
      connectWallet,
      disconnectWallet,
      isLoading,
      setIsLoading,
      appNotifications,
      addAppNotification,
      createPoolOnChain,
      fetchBlockchainPools,
      getLiquidityPoolContract,
      getTokenBalance,
      approveToken,
      getTokenAllowance,
      stakingTokenInfo,
      stakeInPool,
      unstakeFromPool,
      getUserStakeInfo,
      fetchUserData,
      fallbackPayWithCrossPools,
      getTotalCollateralAcrossPools,
      getAllUserPools,
      getRelatedPools,
      repayOnChain,
    }),
    [
      address,
      signer,
      provider,
      poolFactoryContract,
      stakingTokenContract,
      connectWallet,
      disconnectWallet,
      isLoading,
      appNotifications,
      addAppNotification,
      createPoolOnChain,
      fetchBlockchainPools,
      getLiquidityPoolContract,
      getTokenBalance,
      approveToken,
      getTokenAllowance,
      stakingTokenInfo,
      stakeInPool,
      unstakeFromPool,
      getUserStakeInfo,
      fetchUserData,
      fallbackPayWithCrossPools,
      getTotalCollateralAcrossPools,
      getAllUserPools,
      getRelatedPools,
      repayOnChain,
    ]
  );

  useEffect(() => {
    if (window.ethereum) {
      const handleAccountsChanged = async (accounts: string[]) => {
        console.log("=== handleAccountsChanged ===", { accounts });
        if (accounts.length > 0) {
          setAddress(accounts[0]);
          if (provider) {
            const web3Signer = provider.getSigner();
            setSigner(web3Signer);
            try {
              await initializeContracts(web3Signer);
            } catch (error) {
              addAppNotification("Failed to reinitialize contracts", "error");
            }
          }
        } else {
          disconnectWallet();
        }
      };

      const handleChainChanged = () => {
        console.log("=== handleChainChanged ===");
        addAppNotification("Network changed. Reloading...", "info");
        window.location.reload();
      };

      window.ethereum.on("accountsChanged", handleAccountsChanged);
      window.ethereum.on("chainChanged", handleChainChanged);

      return () => {
        if (window.ethereum.removeListener) {
          window.ethereum.removeListener(
            "accountsChanged",
            handleAccountsChanged
          );
          window.ethereum.removeListener("chainChanged", handleChainChanged);
        }
      };
    }
  }, [provider, initializeContracts, disconnectWallet, addAppNotification]);

  return (
    <StateContext.Provider value={contextValue}>
      {children}
    </StateContext.Provider>
  );
};

export const useStateContext = () => {
  const context = useContext(StateContext);
  if (!context) {
    throw new Error(
      "useStateContext must be used within a StateContextProvider"
    );
  }
  return context;
};
