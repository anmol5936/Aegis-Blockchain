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
  InfoIcon,
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

  console.log("PoolCard props:", userStakeInPool);

  const { getTotalCollateralAcrossPools } = useStateContext();
  const [totalUserCollateral, setTotalUserCollateral] = useState("0");

  // Replace the useEffect in your PoolCard component with this:

  useEffect(() => {
    console.log("pool", pool);
    console.log("currentUser?.id", currentUser?.id);
    console.log("userStakeInPool", userStakeInPool);
    console.log("Loading cross-pool collateral for user:", currentUser?.id);
    console.log("currentUser", currentUser);
    console.log("getTotalCollateralAcrossPools", getTotalCollateralAcrossPools);

    const loadCrossPoolCollateral = async () => {
      // Add proper checks before calling the function
      if (getTotalCollateralAcrossPools && currentUser && currentUser.id) {
        try {
          console.log(
            "Calling getTotalCollateralAcrossPools for user:",
            currentUser.id
          );
          const total = await getTotalCollateralAcrossPools();
          console.log("Total collateral loaded:", total);
          setTotalUserCollateral(total);
          console.log("Set totalUserCollateral:", total);
        } catch (error) {
          console.error("Error loading cross-pool collateral:", error);
        }
      } else {
        console.log("Skipping collateral load - missing dependencies:", {
          hasFunction: !!getTotalCollateralAcrossPools,
          hasUser: !!currentUser,
          userId: currentUser?.id,
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

  const hasUserDebt = pool.userDebt > 0;
  const canFallbackPay =
    userStakeInPool &&
    userStakeInPool.stakedAmount > 0 &&
    parseFloat(totalUserCollateral) > pool.userDebt;

  return (
    <div
      className={`bg-slate-800 rounded-xl shadow-2xl p-6 flex flex-col transition-all duration-300 hover:shadow-sky-500/30 min-h-[500px] ${
        pool.status === PoolStatus.PAUSED
          ? "opacity-70 border-2 border-yellow-500"
          : "border-2 border-slate-700"
      }`}
    >
      {/* Header Section */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold text-sky-400">
          {pool.regionName} Pool
        </h3>
        <span
          className={`flex items-center text-xs font-semibold px-3 py-1.5 rounded-full ${getStatusColor()} bg-opacity-20 ${
            pool.status === PoolStatus.ACTIVE
              ? "bg-green-500/20"
              : pool.status === PoolStatus.PAUSED
              ? "bg-yellow-500/20"
              : "bg-red-500/20"
          }`}
        >
          {getStatusIcon()} {pool.status.toUpperCase()}
        </span>
      </div>

      {/* Pool Stats Section */}
      <div className="space-y-3 text-sm text-slate-300 mb-6 flex-grow">
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

      {/* User Stats Section */}
      {currentUser && (
        <div className="bg-slate-700/50 p-4 rounded-lg mb-6 space-y-3 text-sm">
          <h4 className="font-semibold text-sky-300 mb-2 flex items-center">
            <UsersIcon size={16} className="mr-1" />
            Your Stats in this Pool
          </h4>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Staked:</span>
                <span className="text-white font-medium">
                  {userStakeInPool?.stakedAmount.toLocaleString() || 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Local Collateral:</span>
                <span className="text-white font-medium">
                  {userStakeInPool?.collateralAmount.toLocaleString() || 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">LP Tokens:</span>
                <span className="text-purple-400 font-medium">
                  {(currentUser.lpTokenBalances[pool.id] || 0).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sky-400">Cross-Pool Total:</span>
                <span className="text-sky-300 font-medium">
                  {parseFloat(totalUserCollateral).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-red-400">Your Debt:</span>
                <span className="text-red-300 font-medium">
                  {pool.userDebt.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Cross-pool payment capability indicator */}
          {parseFloat(totalUserCollateral) >
            (userStakeInPool?.collateralAmount || 0) && (
            <div className="mt-3 p-2 bg-blue-500/20 rounded border border-blue-500/50">
              <div className="flex items-center text-blue-300 text-xs">
                <InfoIcon size={12} className="mr-1 flex-shrink-0" />
                <span>Cross-pool payments available</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons Section */}
      {currentUser && pool.status === PoolStatus.ACTIVE && (
        <div className="space-y-3 mt-auto">
          {/* Primary Action Buttons */}
          <div className="grid grid-cols-1 gap-3">
            <button
              onClick={onStake}
              className="w-full bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-medium py-3 px-4 rounded-lg text-sm transition-all duration-200 transform hover:scale-[1.02] shadow-lg hover:shadow-green-500/25"
            >
              <div className="flex items-center justify-center gap-2">
                <DollarSignIcon size={16} />
                Stake / Unstake
              </div>
            </button>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={onFallbackPay}
                disabled={!canFallbackPay}
                className={`w-full font-medium py-3 px-4 rounded-lg text-sm transition-all duration-200 transform hover:scale-[1.02] shadow-lg ${
                  canFallbackPay
                    ? "bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white hover:shadow-blue-500/25"
                    : "bg-slate-600 text-slate-400 cursor-not-allowed"
                }`}
                title={
                  !userStakeInPool || userStakeInPool.stakedAmount <= 0
                    ? "Must stake first"
                    : parseFloat(totalUserCollateral) <= pool.userDebt
                    ? `Insufficient collateral (${totalUserCollateral}) vs debt (${pool.userDebt})`
                    : "Execute cross-pool fallback payment"
                }
              >
                <div className="flex items-center justify-center gap-1">
                  <ShieldCheckIcon size={14} />
                  <span className="text-xs">Fallback Pay</span>
                </div>
              </button>

              {hasUserDebt && (
                <button
                  onClick={onRepayDebt}
                  className="w-full bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white font-medium py-3 px-4 rounded-lg text-sm transition-all duration-200 transform hover:scale-[1.02] shadow-lg hover:shadow-orange-500/25"
                >
                  <div className="flex items-center justify-center gap-1">
                    <AlertTriangleIcon size={14} />
                    <span className="text-xs">Repay Debt</span>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin Controls */}
      {currentUser && currentUser.id === "admin" && onToggleStatus && (
        <div className="mt-3 pt-3 border-t border-slate-600">
          <button
            onClick={onToggleStatus}
            className={`w-full font-medium py-3 px-4 rounded-lg text-sm transition-all duration-200 transform hover:scale-[1.02] shadow-lg ${
              pool.status === PoolStatus.ACTIVE
                ? "bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 hover:shadow-yellow-500/25"
                : "bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 hover:shadow-green-500/25"
            } text-white flex items-center justify-center gap-2`}
          >
            {pool.status === PoolStatus.ACTIVE ? (
              <PauseIcon size={16} />
            ) : (
              <PlayIcon size={16} />
            )}
            {pool.status === PoolStatus.ACTIVE ? "Pause Pool" : "Activate Pool"}
          </button>
        </div>
      )}

      {/* Pool Inactive State */}
      {currentUser && pool.status !== PoolStatus.ACTIVE && (
        <div className="mt-auto p-4 bg-slate-700/30 rounded-lg border border-slate-600">
          <div className="flex items-center justify-center text-slate-400 text-sm">
            <AlertTriangleIcon size={16} className="mr-2" />
            Pool is {pool.status.toLowerCase()} - Actions unavailable
          </div>
        </div>
      )}
    </div>
  );
};

export default PoolCard;
