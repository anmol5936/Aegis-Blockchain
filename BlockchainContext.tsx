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
  stakeInPool: (poolAddress: string, amount: string) => Promise<boolean>;
  unstakeFromPool: (poolAddress: string, lpAmount: string) => Promise<boolean>;
  getUserStakeInfo: (
    poolAddress: string,
    userAddress?: string
  ) => Promise<StakeEntry | null>;
  fetchUserData: (userAddress?: string) => Promise<UserAccount | null>;
  getAllUserPools: (userAddress?: string) => Promise<string[]>;
  getTotalCollateralAcrossPools: (userAddress?: string) => Promise<string>;
  getRelatedPools: (poolAddress: string) => Promise<string[]>;
  fallbackPayWithCrossPools: (
    primaryPoolAddress: string,
    merchantAddress: string,
    amount: string
  ) => Promise<boolean>;
  repayOnChain: (
    poolAddress: string,
    debtIndex: number,
    amount: string
  ) => Promise<boolean>;
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
    async (poolAddress: string, amount: string): Promise<boolean> => {
      console.log("=== stakeInPool ===", { poolAddress, amount });
      if (!signer || !address) {
        addAppNotification("Please connect your wallet first", "error");
        return false;
      }

      try {
        setIsLoading(true);
        const poolContract = getLiquidityPoolContract(poolAddress);
        console.log("this is pool address ---------> ", poolAddress);
        console.log("Pool contract:", poolContract?.address);
        if (!poolContract) {
          addAppNotification("Pool contract not found", "error");
          setIsLoading(false);
          return false;
        }

        const amountWei = ethers.utils.parseUnits(
          amount,
          stakingTokenInfo?.decimals || 18
        );
        const currentAllowance = await getTokenAllowance(poolAddress);
        const currentAllowanceWei = ethers.utils.parseUnits(
          currentAllowance,
          stakingTokenInfo?.decimals || 18
        );

        if (currentAllowanceWei.lt(amountWei)) {
          addAppNotification(
            "Insufficient token allowance. Please approve tokens first.",
            "info"
          );
          const approvalTx = await approveToken(poolAddress, amount);
          if (!approvalTx) {
            setIsLoading(false);
            return false;
          }
        }

        addAppNotification("Initiating stake transaction...", "info");
        const stakeTx = await poolContract.stake(amountWei);
        console.log("Stake tx sent:", stakeTx.hash);
        addAppNotification(
          `Stake transaction sent. Hash: ${stakeTx.hash.substring(0, 10)}...`,
          "info"
        );
        await stakeTx.wait();
        addAppNotification(`Successfully staked ${amount} tokens!`, "success");
        setIsLoading(false);
        return true;
      } catch (error) {
        console.error("Staking error:", error);
        let errorMessage = "Staking failed";
        if (error.message.includes("insufficient funds")) {
          errorMessage = "Insufficient funds for transaction";
        } else if (error.message.includes("user rejected")) {
          errorMessage = "Transaction rejected by user";
        } else if (error.message.includes("execution reverted")) {
          errorMessage = "Transaction reverted - check pool status and balance";
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

  const unstakeFromPool = useCallback(
    async (poolAddress: string, lpAmount: string): Promise<boolean> => {
      console.log("=== unstakeFromPool ===", { poolAddress, lpAmount });
      if (!signer || !address) {
        addAppNotification("Please connect your wallet first", "error");
        return false;
      }

      try {
        setIsLoading(true);
        const poolContract = getLiquidityPoolContract(poolAddress);
        if (!poolContract) {
          addAppNotification("Pool contract not found", "error");
          setIsLoading(false);
          return false;
        }

        const lpAmountFloat = parseFloat(lpAmount);
        if (isNaN(lpAmountFloat) || lpAmountFloat <= 0) {
          addAppNotification("Invalid LP token amount", "error");
          setIsLoading(false);
          return false;
        }

        const lpTokenAddress = await poolContract.lpToken();
        const lpTokenContract = new ethers.Contract(
          lpTokenAddress,
          LPERC20_ABI,
          signer
        );
        const userLPBalance = await lpTokenContract.balanceOf(address);
        const lpAmountWei = ethers.utils.parseUnits(lpAmount, 18);
        if (userLPBalance.lt(lpAmountWei)) {
          addAppNotification("Insufficient LP tokens to unstake", "error");
          setIsLoading(false);
          return false;
        }

        try {
          const canUnstake = await poolContract.unstake(address);
          if (!canUnstake) {
            addAppNotification(
              "Unstaking is still in timelock period",
              "error"
            );
            setIsLoading(false);
            return false;
          }
        } catch (timelockError) {
          console.warn("Could not check timelock status:", timelockError);
        }

        const gasEstimate = await poolContract.estimateGas.unstake(lpAmountWei);
        console.log("Gas estimate for unstake:", gasEstimate.toString());
        const gasLimit = gasEstimate.mul(120).div(100);

        addAppNotification("Initiating unstake transaction...", "info");
        const unstakeTx = await poolContract.unstake(lpAmountWei, { gasLimit });
        console.log("Unstake tx sent:", unstakeTx.hash);
        addAppNotification(
          `Unstake transaction sent. Hash: ${unstakeTx.hash.substring(
            0,
            10
          )}...`,
          "info"
        );
        const receipt = await unstakeTx.wait();

        if (receipt.status === 1) {
          addAppNotification(
            `Successfully unstaked ${lpAmount} LP tokens!`,
            "success"
          );
          setIsLoading(false);
          return true;
        } else {
          addAppNotification("Unstake transaction failed", "error");
          setIsLoading(false);
          return false;
        }
      } catch (error) {
        console.error("Unstaking error:", error);
        let errorMessage = "Unstaking failed";
        if (error.code === -32603) {
          errorMessage = "RPC error - check network connection and try again";
        } else if (error.message.includes("insufficient funds")) {
          errorMessage = "Insufficient LP tokens to unstake";
        } else if (error.message.includes("user rejected")) {
          errorMessage = "Transaction rejected by user";
        } else if (error.message.includes("execution reverted")) {
          const match = error.message.match(/execution reverted: (.+)/);
          errorMessage = match
            ? `Transaction reverted: ${match[1]}`
            : "Transaction reverted - check timelock and LP balance";
        } else if (error.reason) {
          errorMessage = `Transaction failed: ${error.reason}`;
        }
        addAppNotification(errorMessage, "error");
        setIsLoading(false);
        return false;
      }
    },
    [signer, address, getLiquidityPoolContract, addAppNotification]
  );

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

  const repayOnChain = async (
    poolAddress: string,
    debtIndex: number,
    amount: string
  ): Promise<boolean> => {
    if (!signer || !address) {
      addAppNotification("Please connect your wallet first", "error");
      return false;
    }

    try {
      setIsLoading(true);

      // Validate inputs
      if (!ethers.utils.isAddress(poolAddress) || debtIndex < 0 || !amount) {
        addAppNotification(
          "Invalid pool address, debt index, or amount",
          "error"
        );
        setIsLoading(false);
        return false;
      }

      const poolContract = getLiquidityPoolContract(poolAddress);
      if (!poolContract) {
        addAppNotification("Pool contract not found", "error");
        setIsLoading(false);
        return false;
      }

      // Fetch and validate debt from contract
      let userDebts;
      try {
        userDebts = await poolContract.getUserDebts(address);
      } catch (error) {
        addAppNotification("Failed to fetch user debts from contract", "error");
        setIsLoading(false);
        return false;
      }

      if (debtIndex >= userDebts.length) {
        addAppNotification("Invalid debt index", "error");
        setIsLoading(false);
        return false;
      }

      const debt = userDebts[debtIndex];
      if (debt.isRepaid) {
        addAppNotification("Debt already repaid", "error");
        setIsLoading(false);
        return false;
      }

      const debtAmountWei = debt.amount;
      const amountWei = ethers.utils.parseUnits(
        amount,
        stakingTokenInfo?.decimals || 18
      );

      if (amountWei.gt(debtAmountWei)) {
        addAppNotification("Repayment amount exceeds debt", "error");
        setIsLoading(false);
        return false;
      }

      // Check user token balance
      const userBalance = await getTokenBalance(address);
      const userBalanceWei = ethers.utils.parseUnits(
        userBalance,
        stakingTokenInfo?.decimals || 18
      );

      if (userBalanceWei.lt(amountWei)) {
        addAppNotification("Insufficient token balance for repayment", "error");
        setIsLoading(false);
        return false;
      }

      // Check and handle token approval
      const currentAllowance = await getTokenAllowance(poolAddress);
      const currentAllowanceWei = ethers.utils.parseUnits(
        currentAllowance,
        stakingTokenInfo?.decimals || 18
      );

      if (currentAllowanceWei.lt(amountWei)) {
        addAppNotification("Approving tokens for repayment...", "info");
        const approvalTx = await approveToken(poolAddress, amount);
        if (!approvalTx) {
          addAppNotification("Token approval failed", "error");
          setIsLoading(false);
          return false;
        }

        // Wait for approval transaction to be mined
        await approvalTx.wait();
        addAppNotification("Token approval confirmed", "success");
      }

      // Estimate gas first to catch potential revert reasons
      try {
        const gasEstimate = await poolContract.estimateGas.repayDebt(
          debtIndex,
          amountWei
        );
        console.log("Gas estimate for repayDebt:", gasEstimate.toString());

        // Add 20% buffer to gas limit
        const gasLimit = gasEstimate.mul(120).div(100);

        addAppNotification("Initiating repay transaction...", "info");
        const repayTx = await poolContract.repayDebt(debtIndex, amountWei, {
          gasLimit: gasLimit,
        });

        addAppNotification(
          `Repay transaction sent. Hash: ${repayTx.hash.substring(0, 10)}...`,
          "info"
        );

        const receipt = await repayTx.wait();

        if (receipt.status === 1) {
          const formattedAmount = ethers.utils.formatUnits(
            amountWei,
            stakingTokenInfo?.decimals || 18
          );
          addAppNotification(
            `Successfully repaid ${formattedAmount} tokens`,
            "success"
          );
          setIsLoading(false);
          return true;
        } else {
          addAppNotification("Repay transaction failed", "error");
          setIsLoading(false);
          return false;
        }
      } catch (gasError) {
        console.error("Gas estimation or transaction failed:", gasError);

        // Try to extract revert reason
        let revertReason = "Unknown error";
        if (gasError.reason) {
          revertReason = gasError.reason;
        } else if (gasError.message.includes("execution reverted")) {
          const match = gasError.message.match(/execution reverted: (.+)/);
          if (match) {
            revertReason = match[1];
          }
        }

        addAppNotification(`Repayment failed: ${revertReason}`, "error");
        setIsLoading(false);
        return false;
      }
    } catch (error: any) {
      console.error("Repay payment error:", error);
      let errorMessage = "Repay payment failed";

      // Enhanced error handling
      if (error.code === "INSUFFICIENT_FUNDS") {
        errorMessage = "Insufficient funds for transaction";
      } else if (error.code === "UNPREDICTABLE_GAS_LIMIT") {
        errorMessage =
          "Transaction may fail - check debt status and pool state";
      } else if (error.message.includes("insufficient allowance")) {
        errorMessage = "Insufficient token allowance";
      } else if (error.message.includes("user rejected")) {
        errorMessage = "Transaction rejected by user";
      } else if (error.message.includes("invalid debt index")) {
        errorMessage = "Invalid debt index";
      } else if (error.message.includes("debt already repaid")) {
        errorMessage = "Debt already repaid";
      } else if (error.message.includes("amount exceeds debt")) {
        errorMessage = "Repayment amount exceeds debt";
      } else if (error.message.includes("pool is not active")) {
        errorMessage = "Pool is not active";
      } else if (error.reason) {
        errorMessage = `Transaction failed: ${error.reason}`;
      }

      addAppNotification(errorMessage, "error");
      setIsLoading(false);
      return false;
    }
  };

  const fallbackPayWithCrossPools = useCallback(
    async (
      primaryPoolAddress: string,
      merchantAddress: string,
      amount: string
    ): Promise<boolean> => {
      console.log("=== fallbackPayWithCrossPools ===", {
        primaryPoolAddress,
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

        // Get pool contract
        const poolContract = getLiquidityPoolContract(primaryPoolAddress);
        if (!poolContract) {
          addAppNotification("Primary pool contract not found", "error");
          setIsLoading(false);
          return false;
        }

        // Validate merchant address
        if (!ethers.utils.isAddress(merchantAddress)) {
          addAppNotification("Invalid merchant address", "error");
          setIsLoading(false);
          return false;
        }

        const decimals = stakingTokenInfo?.decimals || 18;
        let amountWei;
        try {
          amountWei = ethers.utils.parseUnits(amount, decimals);
        } catch (parseError) {
          console.error("Error parsing payment amount to Wei:", parseError);
          addAppNotification(
            `Invalid payment amount format: ${amount}`,
            "error"
          );
          setIsLoading(false);
          return false;
        }

        // Fetch total collateral directly
        const totalCollateralValue = await getTotalCollateralAcrossPools(
          address
        );
        const totalCollateralFloat = parseFloat(totalCollateralValue);
        console.log("Total collateral across pools:", {
          totalCollateralFloat,
          amountFloat,
        });

        if (totalCollateralFloat < amountFloat) {
          addAppNotification(
            `Insufficient total collateral. Available: ${totalCollateralFloat}, Required: ${amount}`,
            "error"
          );
          setIsLoading(false);
          return false;
        }

        // Get LP token contract instance
        const lpTokenAddress = await poolContract.lpToken();
        const lpTokenContract = new ethers.Contract(
          lpTokenAddress,
          LPERC20_ABI,
          signer
        );
        const lpBalance = await lpTokenContract.balanceOf(address);
        console.log(
          "User LP balance:",
          ethers.utils.formatUnits(lpBalance, 18)
        );

        // Check token allowance for the pool contract
        const allowance = await getTokenAllowance(primaryPoolAddress, address);
        const allowanceFloat = parseFloat(allowance);
        console.log("Token allowance for pool:", {
          allowanceFloat,
          amountFloat,
        });

        if (allowanceFloat < amountFloat) {
          addAppNotification(
            "Insufficient token allowance. Approving tokens...",
            "info"
          );
          // Ensure amount is passed as a clean string
          const approvalTx = await approveToken(
            primaryPoolAddress,
            amountFloat.toString()
          );
          if (!approvalTx) {
            addAppNotification("Token approval failed", "error");
            setIsLoading(false);
            return false;
          }
        }

        // Log pool state for debugging
        const poolStatus = await poolContract.getPoolStatus();
        const primaryCollateral = await poolContract.getStake(address);
        const totalLiquidity = await poolContract.totalLiquidity();
        console.log("Pool state:", {
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
          totalLiquidity: ethers.utils.formatUnits(totalLiquidity, decimals),
          lpBalance: ethers.utils.formatUnits(lpBalance, 18),
        });

        addAppNotification("Initiating cross-pool payment...", "info");

        // Estimate gas
        let gasEstimate;
        try {
          gasEstimate = await poolContract.estimateGas.fallbackPay(
            merchantAddress,
            amountWei
          );
          console.log("Gas estimate:", gasEstimate.toString());
        } catch (gasError) {
          console.error("Gas estimation failed:", gasError);
          addAppNotification(
            `Gas estimation failed: ${gasError.reason || gasError.message}`,
            "error"
          );
          setIsLoading(false);
          throw gasError;
        }

        // Execute transaction
        const gasLimit = gasEstimate.mul(120).div(100); // 20% buffer
        const fallbackTx = await poolContract.fallbackPay(
          merchantAddress,
          amountWei,
          { gasLimit }
        );
        console.log("Fallback payment tx sent:", { hash: fallbackTx.hash });
        addAppNotification(
          `Cross-pool payment transaction sent. Hash: ${fallbackTx.hash.substring(
            0,
            6
          )}...`,
          "info"
        );

        await fallbackTx.wait();
        addAppNotification(
          `Successfully paid ${amount} tokens using cross-pool collateral!`,
          "success"
        );
        setIsLoading(false);
        return true;
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
      getTotalCollateralAcrossPools,
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
