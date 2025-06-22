import React, { useState, useEffect, useCallback } from "react";
import {
  LiquidityPoolData,
  UserAccount,
  PoolStatus,
  AppNotification as AppNotificationType,
} from "./types";
import {
  COLLATERAL_PERCENTAGE,
  FALLBACK_CAP_PER_USER_PER_POOL,
  UNSTAKE_TIME_LOCK_DURATION_MS,
  LP_TOKEN_NAME_PREFIX,
  BASE_APY,
} from "./constants";
import Header from "./components/Header";
import CreatePoolForm from "./components/CreatePoolForm";
import PoolCard from "./components/PoolCard";
import StakeModal from "./components/StakeModal";
import FallbackModal from "./components/FallbackModal";
import RepayModal from "./components/RepayModal";
import UserStats from "./components/UserStats";
import Profile from "./components/Profile";
import {
  InfoIcon,
  DollarSignIcon,
  UsersIcon,
  ShieldIcon,
  AlertTriangleIcon,
  GiftIcon,
  PlusCircleIcon,
  LogOutIcon,
  EditIcon,
  CheckCircleIcon,
  WalletIcon as ConnectWalletIcon,
} from "./components/icons/PhosphorIcons";
import { User } from "lucide-react";
import { useStateContext } from "./BlockchainContext";

const App: React.FC = () => {
  const {
    address,
    connectWallet,
    disconnectWallet,
    isLoading,
    setIsLoading,
    createPoolOnChain,
    fetchBlockchainPools,
    appNotifications,
    addAppNotification,
    stakeInPool,
    unstakeFromPool,
    fetchUserData,
    fallbackPayWithCrossPools,
    getTotalCollateralAcrossPools,
    getAllUserPools,
    getRelatedPools,
    getLiquidityPoolContract,
    repayOnChain,
  } = useStateContext();

  // Navigation state
  const [currentView, setCurrentView] = useState<"pools" | "profile">("pools");

  // Local UI state
  const [pools, setPools] = useState<LiquidityPoolData[]>([]);
  const [currentUserData, setCurrentUserData] = useState<UserAccount | null>(
    null
  );

  const [selectedPoolForAction, setSelectedPoolForAction] =
    useState<LiquidityPoolData | null>(null);
  const [isStakeModalOpen, setIsStakeModalOpen] = useState(false);
  const [isFallbackModalOpen, setIsFallbackModalOpen] = useState(false);
  const [isRepayModalOpen, setIsRepayModalOpen] = useState(false);

  // Effect to update currentUserData when wallet address changes
  useEffect(() => {
    if (address && fetchUserData) {
      fetchUserData(address).then((userData) => {
        setCurrentUserData(userData);
        console.log("Fetched user data:", userData);
      });
    } else {
      setCurrentUserData(null);
    }
  }, [address, fetchUserData]);

  const loadBlockchainPools = useCallback(async () => {
    if (fetchBlockchainPools) {
      const fetchedPools = await fetchBlockchainPools();
      setPools(fetchedPools || []);
    }
  }, [fetchBlockchainPools]);

  useEffect(() => {
    loadBlockchainPools();
  }, [loadBlockchainPools, address]);

  const handleCreatePool = async (regionName: string) => {
    if (!address) {
      addAppNotification("Please connect your wallet.", "error");
      return;
    }

    if (
      pools.find((p) => p.regionName.toLowerCase() === regionName.toLowerCase())
    ) {
      addAppNotification(
        `Pool for region ${regionName} already exists (locally). Check blockchain.`,
        "error"
      );
      return;
    }

    if (createPoolOnChain) {
      const success = await createPoolOnChain(regionName);
      if (success) {
        await loadBlockchainPools();
      }
    }
  };

  const handleStake = async (
    poolId: string,
    amount: number,
    isUnstaking: boolean = false
  ) => {
    if (!currentUserData || !address) {
      addAppNotification("Please connect your wallet.", "error");
      return;
    }

    const pool = pools.find((p) => p.id === poolId);
    if (!pool) {
      addAppNotification("Pool not found.", "error");
      return;
    }

    try {
      let success = false;

      if (isUnstaking) {
        const userStake = pool.stakers.find((s) => s.userId === address);
        if (!userStake || userStake.stakedAmount === 0) {
          addAppNotification("No stake found to unstake.", "error");
          return;
        }

        const proportionToUnstake = amount / userStake.stakedAmount;
        const lpTokensToUnstake =
          userStake.lpTokensMinted * proportionToUnstake;

        if (unstakeFromPool) {
          success = await unstakeFromPool(poolId, lpTokensToUnstake.toString());
        }
      } else {
        if (stakeInPool) {
          success = await stakeInPool(amount.toString());
        }
      }

      if (success) {
        await loadBlockchainPools();
        if (fetchUserData) {
          const updatedUserData = await fetchUserData(address);
          setCurrentUserData(updatedUserData);
        }
        setIsStakeModalOpen(false);
      }
    } catch (error) {
      console.error("Stake/Unstake error:", error);
      addAppNotification(
        `${isUnstaking ? "Unstaking" : "Staking"} failed: ${error.message}`,
        "error"
      );
    }
  };

  const handleFallbackPayment = async (
    initialPoolId: string,
    merchantAddress: string,
    amount: number
  ) => {
    if (!currentUserData) {
      addAppNotification("Please connect your wallet.", "error");
      return;
    }

    if (!fallbackPayWithCrossPools) {
      addAppNotification(
        "Cross-pool fallback payment function not available.",
        "error"
      );
      return;
    }

    try {
      addAppNotification("Analyzing cross-pool liquidity...", "info");

      const success = await fallbackPayWithCrossPools(
        merchantAddress,
        amount.toString()
      );

      if (success) {
        await loadBlockchainPools();
        if (fetchUserData) {
          const updatedUserData = await fetchUserData(address);
          setCurrentUserData(updatedUserData);
        }
        setIsFallbackModalOpen(false);
        addAppNotification(
          "Cross-pool payment completed successfully!",
          "success"
        );
      }
    } catch (error) {
      console.error("Cross-pool fallback payment error:", error);
      addAppNotification(
        `Cross-pool payment failed: ${error.message}`,
        "error"
      );
    }
  };

  const handleRepayDebt = async (
    poolId: string,
    debtIndex: number,
    amountToRepay: number
  ) => {
    if (!currentUserData) {
      addAppNotification("Please connect your wallet.", "error");
      return;
    }

    try {
      const success = await repayOnChain(
        poolId,
        debtIndex,
        amountToRepay.toString()
      );

      if (success) {
        await loadBlockchainPools();
        if (fetchUserData) {
          const updatedUserData = await fetchUserData(address);
          setCurrentUserData(updatedUserData);
        }
        setIsRepayModalOpen(false);
      }
    } catch (error: any) {
      console.error("Repay payment error:", error);
      addAppNotification(`Repay payment failed: ${error.message}`, "error");
    }
  };

  const handleDistributeRewards = useCallback(async () => {
    if (!address) {
      addAppNotification("Please connect your wallet.", "error");
      return;
    }
    addAppNotification(
      "Distribute rewards - Blockchain interaction TBD",
      "info"
    );
  }, [address, pools, addAppNotification]);

  const openModal = (
    pool: LiquidityPoolData,
    modalType: "stake" | "fallback" | "repay"
  ) => {
    if (!address) {
      addAppNotification("Please connect your wallet first.", "error");
      return;
    }
    setSelectedPoolForAction(pool);
    if (modalType === "stake") setIsStakeModalOpen(true);
    else if (modalType === "fallback") setIsFallbackModalOpen(true);
    else if (modalType === "repay") setIsRepayModalOpen(true);
  };

  const togglePoolStatus = async (poolId: string) => {
    if (!address) {
      addAppNotification("Please connect your wallet.", "error");
      return;
    }
    addAppNotification(
      `Toggle status for ${poolId} - Blockchain interaction TBD`,
      "info"
    );
  };

  // Render Profile View
  if (currentView === "profile") {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
        <div className="bg-slate-800 border-b border-slate-700 px-4 md:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-6">
              <h1 className="text-2xl md:text-3xl font-bold text-sky-400">
                Aegis Protocol
              </h1>
              <nav className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentView("pools")}
                  className="px-4 py-2 text-slate-400 hover:text-white rounded-lg transition-colors"
                >
                  Pools
                </button>
                <button
                  onClick={() => setCurrentView("profile")}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2"
                >
                  <User size={16} />
                  Profile
                </button>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              {address ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm bg-slate-700 px-3 py-1.5 rounded-md">
                    {address.substring(0, 6)}...
                    {address.substring(address.length - 4)}
                  </span>
                  <button
                    onClick={disconnectWallet}
                    className="p-2 bg-red-600 hover:bg-red-700 rounded-md text-white flex items-center gap-1 text-sm"
                  >
                    <LogOutIcon size={16} /> Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={connectWallet}
                  disabled={isLoading}
                  className="p-2.5 bg-sky-600 hover:bg-sky-700 rounded-md text-white flex items-center gap-2 text-sm disabled:bg-slate-600"
                >
                  <ConnectWalletIcon size={18} />
                  {isLoading ? "Connecting..." : "Connect Wallet"}
                </button>
              )}
            </div>
          </div>
        </div>

        <Profile />

        {/* Notifications */}
        <div className="fixed top-20 right-5 z-50 space-y-2 w-full max-w-xs sm:max-w-sm">
          {appNotifications.map((n: AppNotificationType) => (
            <div
              key={n.id}
              className={`px-4 py-3 rounded-md shadow-lg text-sm font-medium flex items-start
              ${n.type === "success" ? "bg-green-600 text-white" : ""}
              ${n.type === "error" ? "bg-red-600 text-white" : ""}
              ${n.type === "info" ? "bg-blue-600 text-white" : ""}
            `}
            >
              {n.type === "success" && (
                <CheckCircleIcon
                  size={20}
                  className="mr-2 flex-shrink-0 mt-0.5"
                />
              )}
              {n.type === "error" && (
                <AlertTriangleIcon
                  size={20}
                  className="mr-2 flex-shrink-0 mt-0.5"
                />
              )}
              {n.type === "info" && (
                <InfoIcon size={20} className="mr-2 flex-shrink-0 mt-0.5" />
              )}
              <span>{n.message}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Render Main Pools View
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      <div className="bg-slate-800 border-b border-slate-700 px-4 md:px-6 lg:px-8 py-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-6">
            <h1 className="text-2xl md:text-3xl font-bold text-sky-400">
              Aegis Protocol
            </h1>
            <nav className="flex items-center gap-1">
              <button
                onClick={() => setCurrentView("pools")}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg"
              >
                Pools
              </button>
              <button
                onClick={() => setCurrentView("profile")}
                className="px-4 py-2 text-slate-400 hover:text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <User size={16} />
                Profile
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {address ? (
              <div className="flex items-center gap-2">
                <span className="text-sm bg-slate-700 px-3 py-1.5 rounded-md">
                  {address.substring(0, 6)}...
                  {address.substring(address.length - 4)}
                </span>
                <button
                  onClick={disconnectWallet}
                  className="p-2 bg-red-600 hover:bg-red-700 rounded-md text-white flex items-center gap-1 text-sm"
                >
                  <LogOutIcon size={16} /> Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={connectWallet}
                disabled={isLoading}
                className="p-2.5 bg-sky-600 hover:bg-sky-700 rounded-md text-white flex items-center gap-2 text-sm disabled:bg-slate-600"
              >
                <ConnectWalletIcon size={18} />
                {isLoading ? "Connecting..." : "Connect Wallet"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="fixed top-20 right-5 z-50 space-y-2 w-full max-w-xs sm:max-w-sm">
        {appNotifications.map((n: AppNotificationType) => (
          <div
            key={n.id}
            className={`px-4 py-3 rounded-md shadow-lg text-sm font-medium flex items-start
            ${n.type === "success" ? "bg-green-600 text-white" : ""}
            ${n.type === "error" ? "bg-red-600 text-white" : ""}
            ${n.type === "info" ? "bg-blue-600 text-white" : ""}
          `}
          >
            {n.type === "success" && (
              <CheckCircleIcon
                size={20}
                className="mr-2 flex-shrink-0 mt-0.5"
              />
            )}
            {n.type === "error" && (
              <AlertTriangleIcon
                size={20}
                className="mr-2 flex-shrink-0 mt-0.5"
              />
            )}
            {n.type === "info" && (
              <InfoIcon size={20} className="mr-2 flex-shrink-0 mt-0.5" />
            )}
            <span>{n.message}</span>
          </div>
        ))}
      </div>

      <main className="flex-grow container mx-auto p-4 md:p-6 lg:p-8 space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <h2 className="text-3xl md:text-4xl font-bold text-sky-400">
            Liquidity Pools
          </h2>
        </div>

        {currentUserData && (
          <UserStats
            user={currentUserData}
            pools={pools}
            onRepayDebt={repayOnChain}
          />
        )}

        {address && (
          <div className="bg-slate-800 p-6 rounded-xl shadow-2xl">
            <h2 className="text-2xl font-semibold text-sky-400 mb-4 flex items-center">
              <EditIcon size={28} className="mr-2" />
              Pool Management
            </h2>
            <CreatePoolForm onCreatePool={handleCreatePool} />
            <button
              onClick={handleDistributeRewards}
              disabled={
                isLoading ||
                !pools.some(
                  (p) => p.rewardsPot > 0 && p.status === PoolStatus.ACTIVE
                )
              }
              className="mt-4 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg text-sm px-5 py-2.5 text-center flex items-center justify-center gap-2 disabled:bg-slate-600 disabled:cursor-not-allowed"
            >
              <GiftIcon size={20} /> Distribute All Rewards (Chain)
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pools.map((pool) => (
            <PoolCard
              key={pool.id}
              pool={pool}
              currentUser={currentUserData}
              onStake={() => openModal(pool, "stake")}
              onFallbackPay={() => openModal(pool, "fallback")}
              onRepayDebt={() => openModal(pool, "repay")}
              onToggleStatus={
                address ? () => togglePoolStatus(pool.id) : undefined
              }
            />
          ))}
          {isLoading && pools.length === 0 && (
            <p className="md:col-span-3 text-center">
              Loading pools from blockchain...
            </p>
          )}
          {!isLoading && pools.length === 0 && (
            <div className="md:col-span-2 lg:col-span-3 text-center py-10 bg-slate-800 rounded-xl">
              <PlusCircleIcon
                size={48}
                className="mx-auto text-slate-500 mb-4"
              />
              <p className="text-slate-400 text-lg">
                No liquidity pools found on the blockchain.
              </p>
              {address ? (
                <p className="text-slate-500">
                  Use the pool management controls to create a new pool.
                </p>
              ) : (
                <p className="text-slate-500">
                  Connect your wallet to create and manage pools.
                </p>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      {selectedPoolForAction && currentUserData && isStakeModalOpen && (
        <StakeModal
          pool={selectedPoolForAction}
          user={currentUserData}
          onClose={() => setIsStakeModalOpen(false)}
          onStake={handleStake}
        />
      )}

      {selectedPoolForAction && currentUserData && isFallbackModalOpen && (
        <FallbackModal
          pool={selectedPoolForAction}
          user={currentUserData}
          pools={pools}
          onClose={() => setIsFallbackModalOpen(false)}
          onConfirm={handleFallbackPayment}
        />
      )}

      {selectedPoolForAction && currentUserData && isRepayModalOpen && (
        <RepayModal
          pool={selectedPoolForAction}
          user={currentUserData}
          onClose={() => setIsRepayModalOpen(false)}
          onConfirm={handleRepayDebt}
        />
      )}

      <footer className="text-center p-4 md:p-6 text-slate-500 border-t border-slate-700">
        Project Aegis &copy; {new Date().getFullYear()} - Blockchain Liquidity
        System {address ? "(Connected)" : "(Disconnected)"}
      </footer>
    </div>
  );
};

export default App;
