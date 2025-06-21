import React, { useState, useEffect } from "react";
import { UserAccount, LiquidityPoolData } from "../types";
import { useStateContext } from "../BlockchainContext";
import {
  DollarSignIcon,
  UsersIcon,
  ShieldIcon,
  AlertTriangleIcon,
  TrendingUpIcon,
  InfoIcon,
} from "./icons/PhosphorIcons";

interface UserStatsProps {
  user: UserAccount;
  pools: LiquidityPoolData[];
  onRepayDebt: () => void;
}

const UserStats: React.FC<UserStatsProps> = ({ user, pools, onRepayDebt }) => {
  const { getTotalCollateralAcrossPools, getAllUserPools, getRelatedPools } =
    useStateContext();

  const [crossPoolData, setCrossPoolData] = useState<{
    totalCollateral: string;
    userPools: string[];
    relatedPools: { [key: string]: string[] };
  }>({
    totalCollateral: "0",
    userPools: [],
    relatedPools: {},
  });

  useEffect(() => {
    const loadCrossPoolData = async () => {
      if (getTotalCollateralAcrossPools && getAllUserPools && getRelatedPools) {
        const totalCollateral = await getTotalCollateralAcrossPools();
        const userPools = await getAllUserPools();

        // Get related pools for each user pool
        const relatedPools: { [key: string]: string[] } = {};
        for (const poolAddress of userPools) {
          const related = await getRelatedPools(poolAddress);
          relatedPools[poolAddress] = related;
        }

        setCrossPoolData({
          totalCollateral,
          userPools,
          relatedPools,
        });
      }
    };

    loadCrossPoolData();
  }, [
    user,
    pools,
    getTotalCollateralAcrossPools,
    getAllUserPools,
    getRelatedPools,
  ]);

  // Calculate user's total stats across all pools
  const userStats = pools.reduce(
    (acc, pool) => {
      const userStake = pool.stakers.find((s) => s.userId === user.id);
      if (userStake) {
        acc.totalStaked += userStake.stakedAmount;
        acc.totalCollateral += userStake.collateralAmount;
        acc.activePools += 1;
      }
      acc.totalDebt += pool.userDebt;
      return acc;
    },
    {
      totalStaked: 0,
      totalCollateral: 0,
      totalDebt: 0,
      activePools: 0,
    }
  );

  const totalLPTokenValue = Object.values(user.lpTokenBalances).reduce(
    (sum, balance) => sum + balance,
    0
  );

  return (
    <div className="bg-slate-800 p-6 rounded-xl shadow-2xl">
      <h2 className="text-2xl font-semibold text-sky-400 mb-6 flex items-center">
        <UsersIcon size={28} className="mr-2" />
        Your Portfolio Overview
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-700/50 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-300 text-sm">Total Staked</span>
            <DollarSignIcon size={18} className="text-green-400" />
          </div>
          <div className="text-2xl font-bold text-green-400">
            {userStats.totalStaked.toLocaleString()}
          </div>
          <div className="text-xs text-slate-400">
            Across {userStats.activePools} pools
          </div>
        </div>

        <div className="bg-slate-700/50 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-300 text-sm">Available Collateral</span>
            <ShieldIcon size={18} className="text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-blue-400">
            {parseFloat(crossPoolData.totalCollateral).toLocaleString()}
          </div>
          <div className="text-xs text-slate-400">Cross-pool total</div>
        </div>

        <div className="bg-slate-700/50 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-300 text-sm">LP Token Value</span>
            <TrendingUpIcon size={18} className="text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-purple-400">
            {totalLPTokenValue.toFixed(4)}
          </div>
          <div className="text-xs text-slate-400">Total LP tokens held</div>
        </div>

        <div className="bg-slate-700/50 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-300 text-sm">Outstanding Debt</span>
            <AlertTriangleIcon size={18} className="text-red-400" />
          </div>
          <div className="text-2xl font-bold text-red-400">
            {userStats.totalDebt.toLocaleString()}
          </div>
          <div className="text-xs text-slate-400">Needs repayment</div>
        </div>
      </div>

      {/* Debt Warning Section with Repay Button */}
      {userStats.totalDebt > 0 && (
        <div className="bg-red-900/20 border border-red-700/50 p-4 rounded-lg mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangleIcon
                size={20}
                className="text-red-400 flex-shrink-0"
              />
              <div>
                <div className="text-red-400 font-medium">
                  Outstanding Debt: ${userStats.totalDebt.toLocaleString()}
                </div>
                <div className="text-red-300 text-sm">
                  Repay your debt to maintain good standing and avoid penalties
                </div>
              </div>
            </div>
            <button
              onClick={onRepayDebt}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              Repay Debt
            </button>
          </div>
        </div>
      )}

      {/* Cross-Pool Network Analysis */}
      {crossPoolData.userPools.length > 1 && (
        <div className="bg-slate-700/30 p-4 rounded-lg">
          <h3 className="text-lg font-semibold text-sky-300 mb-3 flex items-center">
            <InfoIcon size={20} className="mr-2" />
            Cross-Pool Network
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-300">
                Active Pools ({crossPoolData.userPools.length})
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {crossPoolData.userPools.map((poolAddress, index) => {
                  const pool = pools.find((p) => p.id === poolAddress);
                  const userStake = pool?.stakers.find(
                    (s) => s.userId === user.id
                  );
                  return (
                    <div
                      key={poolAddress}
                      className="text-xs bg-slate-600/50 p-2 rounded"
                    >
                      <div className="font-medium text-sky-400">
                        {pool?.regionName || `Pool ${index + 1}`}
                      </div>
                      <div className="text-slate-400">
                        Collateral:{" "}
                        {userStake?.collateralAmount.toLocaleString() || 0}{" "}
                        tokens
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-300">
                Liquidity Benefits
              </div>
              <div className="space-y-1 text-xs text-slate-400">
                <div className="flex items-center">
                  <div className="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
                  Cross-pool payment coverage
                </div>
                <div className="flex items-center">
                  <div className="w-2 h-2 bg-blue-400 rounded-full mr-2"></div>
                  Automatic liquidity redistribution
                </div>
                <div className="flex items-center">
                  <div className="w-2 h-2 bg-purple-400 rounded-full mr-2"></div>
                  Enhanced payment reliability
                </div>
                <div className="text-xs text-yellow-400 mt-2 p-2 bg-yellow-500/10 rounded">
                  <AlertTriangleIcon size={12} className="inline mr-1" />
                  Fallback payments can draw from all your pools
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserStats;
