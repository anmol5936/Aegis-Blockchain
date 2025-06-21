import React from "react";
import { useState } from "react";
import { useEffect } from "react";
import { LiquidityPoolData, UserAccount, PoolStatus } from "../types";
import { LP_TOKEN_NAME_PREFIX } from "../constants";
import {
  DollarSignIcon,
  UsersIcon,
  BarChartIcon,
  TrendingUpIcon,
  PauseIcon,
  PlayIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
  AlertTriangleIcon,
  InfoIcon 
} from "./icons/PhosphorIcons";
import { useStateContext } from "../BlockchainContext";



interface PoolCardProps {
  pool: LiquidityPoolData;
  currentUser: UserAccount | null;
  onStake: () => void;
  onFallbackPay: () => void;
  onRepayDebt: () => void;
  onToggleStatus?: () => void; // Optional: only for admin
}

const PoolCard: React.FC<PoolCardProps> = ({
  pool,
  currentUser,
  onStake,
  onFallbackPay,
  onRepayDebt,
  onToggleStatus,
}) => {
  const userStakeInPool = currentUser
    ? pool.stakers.find((s) => s.userId === currentUser.id)
    : null;

    console.log("PoolCard props:", userStakeInPool)

  const { getTotalCollateralAcrossPools } = useStateContext();
  const [totalUserCollateral, setTotalUserCollateral] = useState('0');

// Replace the useEffect in your PoolCard component with this:

useEffect(() => {
  console.log("pool", pool);
  console.log("currentUser?.id", currentUser?.id);
  console.log("userStakeInPool", userStakeInPool);
  console.log('Loading cross-pool collateral for user:', currentUser?.id);
  console.log("currentUser", currentUser);
  console.log("getTotalCollateralAcrossPools", getTotalCollateralAcrossPools);
  
  const loadCrossPoolCollateral = async () => {
    // Add proper checks before calling the function
    if (getTotalCollateralAcrossPools && currentUser && currentUser.id) {
      try {
        console.log('Calling getTotalCollateralAcrossPools for user:', currentUser.id);
        const total = await getTotalCollateralAcrossPools();
        console.log('Total collateral loaded:', total);
        setTotalUserCollateral(total);
        console.log('Set totalUserCollateral:', total);
      } catch (error) {
        console.error('Error loading cross-pool collateral:', error);
      }
    } else {
      console.log('Skipping collateral load - missing dependencies:', {
        hasFunction: !!getTotalCollateralAcrossPools,
        hasUser: !!currentUser,
        userId: currentUser?.id
      });
    }
  };
  
  loadCrossPoolCollateral();
}, [getTotalCollateralAcrossPools, currentUser, currentUser?.id]);

// Also add the missing InfoIcon import at the top of your file:



  const getStatusColor = () => {
    switch (pool.status) {
      case PoolStatus.ACTIVE:
        return "text-green-400";
      case PoolStatus.PAUSED:
        return "text-yellow-400";
      case PoolStatus.INACTIVE:
        return "text-red-400";
      default:
        return "text-slate-400";
    }
  };

  const getStatusIcon = () => {
    switch (pool.status) {
      case PoolStatus.ACTIVE:
        return <ShieldCheckIcon size={18} className="mr-1" />;
      case PoolStatus.PAUSED:
        return <ShieldWarningIcon size={18} className="mr-1" />;
      case PoolStatus.INACTIVE:
        return <AlertTriangleIcon size={18} className="mr-1" />;
      default:
        return null;
    }
  };

  return (
    <div
      className={`bg-slate-800 rounded-xl shadow-2xl p-6 flex flex-col justify-between transition-all duration-300 hover:shadow-sky-500/30 ${pool.status === PoolStatus.PAUSED
          ? "opacity-70 border-2 border-yellow-500"
          : "border-2 border-slate-700"
        }`}
    >
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold text-sky-400">
            {pool.regionName} Pool
          </h3>
          <span
            className={`flex items-center text-xs font-semibold px-2 py-1 rounded-full ${getStatusColor()} bg-opacity-20 ${pool.status === PoolStatus.ACTIVE
                ? "bg-green-500/20"
                : pool.status === PoolStatus.PAUSED
                  ? "bg-yellow-500/20"
                  : "bg-red-500/20"
              }`}
          >
            {getStatusIcon()} {pool.status.toUpperCase()}
          </span>
        </div>

        <div className="space-y-3 text-sm text-slate-300 mb-6">
          <div className="flex items-center justify-between">
            <span className="flex items-center">
              <DollarSignIcon size={18} className="mr-2 text-green-400" /> Total
              Liquidity:
            </span>
            <span className="font-medium text-green-400">
              {pool.totalLiquidity.toLocaleString()} Tokens
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center">
              <UsersIcon size={18} className="mr-2 text-indigo-400" /> Stakers:
            </span>
            <span className="font-medium text-indigo-400">
              {pool.stakers.length}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center">
              <BarChartIcon size={18} className="mr-2 text-pink-400" /> Active
              Debts:
            </span>
            <span className="font-medium text-pink-400">
              {pool.debts.filter((d) => !d.isRepaid).length}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center">
              <TrendingUpIcon size={18} className="mr-2 text-teal-400" /> APY:
            </span>
            <span className="font-medium text-teal-400">
              {pool.apy.toFixed(2)}%
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center">
              <DollarSignIcon size={18} className="mr-2 text-yellow-400" />{" "}
              Rewards Pot:
            </span>
            <span className="font-medium text-yellow-400">
              {pool.rewardsPot.toFixed(2)} Tokens
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center">
              <DollarSignIcon size={18} className="mr-2 text-red-400" /> Total
              Debt:
            </span>
            <span className="font-medium text-red-400">
              {pool.totalDebt.toLocaleString()} Tokens
            </span>
          </div>
        </div>

        {currentUser && (
          <div className="bg-slate-700/50 p-3 rounded-lg mb-6 space-y-2 text-xs">
            <h4 className="font-semibold text-sky-300 mb-1">
              Your Stats in this Pool:
            </h4>
            <div className="flex justify-between">
              <span>Staked:</span>
              <span>
                {userStakeInPool?.stakedAmount.toLocaleString() || 0} Tokens
              </span>
            </div>
            <div className="flex justify-between">
              <span>Local Collateral:</span>
              <span>
                {userStakeInPool?.collateralAmount.toLocaleString() || 0} Tokens
              </span>
            </div>
            {/* New cross-pool collateral display */}
            <div className="flex justify-between text-sky-300">
              <span>Total Cross-Pool Collateral:</span>
              <span className="font-medium">
                {parseFloat(totalUserCollateral).toLocaleString()} Tokens
              </span>
            </div>
            <div className="flex justify-between">
              <span>LP Tokens:</span>
              <span>
                {(currentUser.lpTokenBalances[pool.id] || 0).toFixed(4)}{" "}
                {`${LP_TOKEN_NAME_PREFIX}${pool.regionName}`}
              </span>
            </div>
            <div className="flex justify-between text-red-400">
              <span>Your Debt:</span>
              <span>{pool.userDebt.toLocaleString()} Tokens</span>
            </div>

            {/* Cross-pool payment capability indicator */}
            {parseFloat(totalUserCollateral) > (userStakeInPool?.collateralAmount || 0) && (
              <div className="mt-2 p-2 bg-blue-500/20 rounded border border-blue-500/50">
                <div className="flex items-center text-blue-300 text-xs">
                  <InfoIcon size={12} className="mr-1" />
                  <span>Cross-pool payments available</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {currentUser && pool.status === PoolStatus.ACTIVE && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-auto">
          <button
            onClick={onStake}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-3 rounded-md text-sm transition-colors"
          >
            Stake/Unstake
          </button>
          <button
  onClick={onFallbackPay}
  disabled={
    !userStakeInPool ||
    userStakeInPool.stakedAmount <= 0 ||
    parseFloat(totalUserCollateral) <= pool.userDebt
  }
  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-3 rounded-md text-sm transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed"
  title={
    !userStakeInPool || userStakeInPool.stakedAmount <= 0
      ? "Must stake first"
      : parseFloat(totalUserCollateral) <= pool.userDebt
        ? `Insufficient total collateral (${totalUserCollateral}) vs debt (${pool.userDebt})`
        : "Execute cross-pool fallback payment"
  }
>
  Fallback Pay
</button>
          <button
            onClick={onRepayDebt}
            disabled={pool.userDebt === 0}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 px-3 rounded-md text-sm transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed"
            title={
              pool.userDebt === 0
                ? "No debt to repay"
                : "Repay outstanding debt"
            }
          >
            Repay Debt
          </button>
        </div>
      )}
      {currentUser && currentUser.id === "admin" && onToggleStatus && (
        <button
          onClick={onToggleStatus}
          className={`w-full mt-2 font-medium py-2 px-3 rounded-md text-sm transition-colors ${pool.status === PoolStatus.ACTIVE
              ? "bg-yellow-500 hover:bg-yellow-600"
              : "bg-green-500 hover:bg-green-600"
            } text-white flex items-center justify-center gap-2`}
        >
          {pool.status === PoolStatus.ACTIVE ? (
            <PauseIcon size={16} />
          ) : (
            <PlayIcon size={16} />
          )}
          {pool.status === PoolStatus.ACTIVE ? "Pause Pool" : "Activate Pool"}
        </button>
      )}
    </div>
  );
};

export default PoolCard;
