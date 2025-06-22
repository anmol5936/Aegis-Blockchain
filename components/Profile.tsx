import React, { useState, useEffect, useCallback } from 'react';
import { useStateContext } from '../BlockchainContext';
import {
  User,
  Wallet,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Gift,
  Plus,
  Minus,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  PieChart,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  Coins,
  Shield,
  Target
} from 'lucide-react';

interface ProfileStats {
  totalCollateral: number;
  totalDebt: number;
  totalStaked: number;
  totalRewards: number;
  netWorth: number;
}

interface PoolParticipation {
  poolId: string;
  regionName: string;
  stakedAmount: number;
  collateralAmount: number;
  debtAmount: number;
  lpTokens: number;
  apy: number;
}

const Profile: React.FC = () => {
  const {
    address,
    fetchUserData,
    fetchBlockchainPools,
    getTotalCollateralAcrossPools,
    stakeInPool,
    unstakeFromPool,
    repayOnChain,
    addAppNotification,
    isLoading,
    setIsLoading,
    isRepaymentPolling,
    setIsRepaymentPolling
  } = useStateContext();

  const [profileStats, setProfileStats] = useState<ProfileStats>({
    totalCollateral: 0,
    totalDebt: 0,
    totalStaked: 0,
    totalRewards: 0,
    netWorth: 0,
  });

  const [poolParticipations, setPoolParticipations] = useState<PoolParticipation[]>([]);
  const [selectedAction, setSelectedAction] = useState<'stake' | 'unstake' | null>(null);
  const [actionAmount, setActionAmount] = useState('');
  const [selectedPoolId, setSelectedPoolId] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRepaymentToastId, setAutoRepaymentToastId] = useState<string | null>(null);
  const [pollingTimeoutId, setPollingTimeoutId] = useState<NodeJS.Timeout | null>(null);
  const [pollCount, setPollCount] = useState(0);

  const MAX_POLL_COUNT = 3; // Max number of times to poll for debt clearance
  const POLL_INTERVAL = 15000; // 15 seconds

  const clearPolling = useCallback(() => {
    if (pollingTimeoutId) {
      clearTimeout(pollingTimeoutId);
      setPollingTimeoutId(null);
    }
    setIsRepaymentPolling(false);
    setPollCount(0);
    // autoRepaymentToastId is handled by the notification system's timeout
  }, [pollingTimeoutId, setIsRepaymentPolling]);

  const loadProfileData = useCallback(async (isPollingCall = false) => {
    if (!address) return;

    // If this is not a polling call and polling is already active, don't proceed with a new full load.
    // Let the polling mechanism handle the refresh.
    if (!isPollingCall && isRepaymentPolling) {
        console.log("Profile data load skipped: repayment polling is active.");
        // Ensure isRefreshing is false if we skip, as it might have been set by a manual refresh click
        if (isRefreshing) setIsRefreshing(false);
        return;
    }

    try {
      if (!isPollingCall) { // Only set general loading for non-polling initial loads or manual refreshes
        setIsRefreshing(true); // For manual refresh button indication
        setIsLoading(true); // General loading state
      }
      
      // Fetch user data and pools
      const [userData, pools] = await Promise.all([
        fetchUserData(address),
        fetchBlockchainPools()
      ]);

      if (!userData || !pools) {
        if (!isPollingCall) setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      // Calculate total collateral across all pools
      const totalCollateral = parseFloat(await getTotalCollateralAcrossPools(address));
      
      // Calculate stats from pools
      let totalDebt = 0;
      let totalStaked = 0;
      let totalRewards = 0;
      const participations: PoolParticipation[] = [];

      pools.forEach(pool => {
        const userStake = pool.stakers.find(s => s.userId === address);
        const userDebt = pool.debts
          .filter(debt => debt.user === address && !debt.isRepaid)
          .reduce((sum, debt) => sum + debt.amount, 0);

        if (userStake || userDebt > 0) {
          const stakedAmount = userStake?.stakedAmount || 0;
          const collateralAmount = userStake?.collateralAmount || 0;
          const lpTokens = userStake?.lpTokensMinted || 0;
          
          totalStaked += stakedAmount;
          totalDebt += userDebt;
          totalRewards += (stakedAmount * pool.apy) / 100; // Simplified reward calculation

          participations.push({
            poolId: pool.id,
            regionName: pool.regionName,
            stakedAmount,
            collateralAmount,
            debtAmount: userDebt,
            lpTokens,
            apy: pool.apy
          });
        }
      });

      const netWorth = totalCollateral - totalDebt;

      setProfileStats({
        totalCollateral,
        totalDebt,
        totalStaked,
        totalRewards,
        netWorth
      });

      setPoolParticipations(participations);

      if (isPollingCall) {
        // This is a polling call
        if (totalDebt === 0 || pollCount >= MAX_POLL_COUNT -1) { // -1 because pollCount increments before next call
          addAppNotification(totalDebt === 0 ? 'Debt repayment confirmed.' : 'Finished checking for debt repayment.', totalDebt === 0 ? 'success' : 'info');
          clearPolling();
        } else {
          // Continue polling
          const nextPollCount = pollCount + 1;
          setPollCount(nextPollCount);
          const timeoutId = setTimeout(() => loadProfileData(true), POLL_INTERVAL);
          setPollingTimeoutId(timeoutId);
          console.log(`Scheduled next poll (${nextPollCount}/${MAX_POLL_COUNT}) for debt check.`);
        }
      } else if (totalDebt > 0 && !isRepaymentPolling) { // This is an initial load or manual refresh, not a poll itself
        // Check bank status only if there's debt and not already polling
        try {
          const response = await fetch('http://localhost:8000/health');
          if (response.ok) {
            const healthData = await response.json();
            const bankIsActive = Object.values(healthData.bank_statuses || {}).includes('up');

            if (bankIsActive) {
              console.log('Bank is active and debt exists. Starting repayment polling.');
              setIsRepaymentPolling(true); // This will be the loader for polling
              // setIsLoading(true) is already set for initial load / manual refresh
              const toastId = Date.now().toString(); // Simple ID for notification
              addAppNotification('Repayment in progress...', 'info');
              setAutoRepaymentToastId(toastId);
              setPollCount(0); // Reset poll count for new polling session
              const timeoutId = setTimeout(() => loadProfileData(true), POLL_INTERVAL); // Start first poll
              setPollingTimeoutId(timeoutId);
            } else {
               // Bank not active, or no debt, or already polling. Normal load completes.
               setIsLoading(false);
            }
          } else {
            console.warn('Failed to fetch bank status from health endpoint.');
            setIsLoading(false); // Normal load completes
          }
        } catch (fetchError) {
          console.error('Error fetching bank health:', fetchError);
          addAppNotification('Could not verify bank status for automatic repayment.', 'warning');
          setIsLoading(false); // Normal load completes
        }
      } else {
         // No debt, or already polling. Normal load completes.
         setIsLoading(false);
      }

    } catch (error) {
      console.error('Error loading profile data:', error);
      addAppNotification('Failed to load profile data', 'error');
      clearPolling(); // Clear polling on error
      setIsLoading(false); // Ensure loading is false on error
    } finally {
      // General refresh indicator for manual refresh button should always be turned off
      setIsRefreshing(false);
      // General isLoading is managed based on conditions above (polling or initial load)
      // If not polling and not set to false above, it means it was an initial load without triggering polling.
      if (!isRepaymentPolling && isLoading && !isPollingCall) {
        setIsLoading(false);
      }
    }
  }, [
    address,
    fetchUserData,
    fetchBlockchainPools,
    getTotalCollateralAcrossPools,
    addAppNotification,
    isRepaymentPolling,
    setIsRepaymentPolling,
    setIsLoading,
    pollCount,
    clearPolling,
    isLoading, // Added isLoading to dependency array
    isRefreshing // Added isRefreshing
]);

  useEffect(() => {
    if (address && !isRepaymentPolling) { // Only load initially if not already polling
      loadProfileData();
    }
    // Cleanup polling on component unmount
    return () => {
      if (pollingTimeoutId) {
        clearTimeout(pollingTimeoutId);
      }
    };
  }, [address]); // Removed loadProfileData from here to prevent re-triggering due to its own state changes. address ensures it runs on connect.

  // Effect to handle manual refresh or direct calls to loadProfileData while polling
  useEffect(() => {
    // This effect is to allow manual refresh to work alongside polling logic
    // If isRefreshing is true (manual click) and polling is not active, call loadProfileData
    // The main loadProfileData will then handle the rest.
    // No specific action needed here as loadProfileData itself handles isRefreshing state.
  }, [isRefreshing]);


  const handleStakeUnstake = async () => {
    if (!selectedPoolId || !actionAmount || !selectedAction) {
      addAppNotification('Please fill in all required fields', 'error');
      return;
    }

    const amount = parseFloat(actionAmount);
    if (isNaN(amount) || amount <= 0) {
      addAppNotification('Please enter a valid amount', 'error');
      return;
    }

    try {
      let success = false;
      if (selectedAction === 'stake') {
        success = await stakeInPool(selectedPoolId, amount.toString());
      } else {
        success = await unstakeFromPool(selectedPoolId, amount.toString());
      }

      if (success) {
        setActionAmount('');
        setSelectedAction(null);
        setSelectedPoolId('');
        await loadProfileData();
      }
    } catch (error) {
      console.error('Stake/Unstake error:', error);
    }
  };

  const handleRepayAllDebt = async () => {
    try {
      const success = await repayOnChain();
      if (success) {
        await loadProfileData();
      }
    } catch (error) {
      console.error('Repay debt error:', error);
    }
  };

  const handleClaimRewards = async () => {
    // This would integrate with a reward claiming function
    addAppNotification('Reward claiming functionality coming soon!', 'info');
  };

  if (!address) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Wallet className="mx-auto h-16 w-16 text-slate-500 mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h2>
          <p className="text-slate-400">Please connect your wallet to view your profile</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-slate-700 rounded-full flex items-center justify-center">
              <User className="w-6 h-6 text-slate-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Portfolio Overview</h1>
              <p className="text-slate-400 text-sm">
                {address.substring(0, 6)}...{address.substring(address.length - 4)}
              </p>
            </div>
          </div>
          <button
            onClick={() => loadProfileData()}
            disabled={isRefreshing || isRepaymentPolling}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:opacity-70 rounded-lg text-white text-sm transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing || isRepaymentPolling ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-slate-400" />
              <h3 className="text-slate-300 text-sm font-medium">Net Worth</h3>
            </div>
            <p className="text-xl font-bold text-white">${profileStats.netWorth.toFixed(2)}</p>
            <p className="text-xs text-slate-500 mt-1">
              {profileStats.netWorth >= 0 ? '+' : ''}{((profileStats.netWorth / (profileStats.totalCollateral || 1)) * 100).toFixed(1)}%
            </p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-slate-400" />
              <h3 className="text-slate-300 text-sm font-medium">Total Collateral</h3>
            </div>
            <p className="text-xl font-bold text-white">${profileStats.totalCollateral.toFixed(2)}</p>
            <p className="text-xs text-slate-500 mt-1">Available for borrowing</p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-slate-400" />
              <h3 className="text-slate-300 text-sm font-medium">Total Debt</h3>
            </div>
            <p className="text-xl font-bold text-white">${profileStats.totalDebt.toFixed(2)}</p>
            <p className="text-xs text-slate-500 mt-1">Outstanding balance</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Target className="w-5 h-5" />
            Quick Actions
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            <button
              onClick={() => setSelectedAction('stake')}
              className="flex items-center gap-2 p-3 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg text-white text-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              Stake Tokens
            </button>
            
            <button
              onClick={() => setSelectedAction('unstake')}
              className="flex items-center gap-2 p-3 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg text-white text-sm transition-colors"
            >
              <Minus className="w-4 h-4" />
              Unstake Tokens
            </button>
            
            <button
              onClick={handleRepayAllDebt}
              disabled={profileStats.totalDebt === 0 || isLoading || isRepaymentPolling}
              className="flex items-center gap-2 p-3 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg text-white text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <DollarSign className="w-4 h-4" />
              {isRepaymentPolling && profileStats.totalDebt > 0 ? 'Repaying...' : 'Repay All Debt'}
            </button>
          </div>

          {/* Action Form */}
          {selectedAction && (
            <div className="bg-slate-700 rounded-lg p-4 border border-slate-600">
              <h3 className="text-base font-semibold text-white mb-4 capitalize">
                {selectedAction} Tokens
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Select Pool
                  </label>
                  <select
                    value={selectedPoolId}
                    onChange={(e) => setSelectedPoolId(e.target.value)}
                    className="w-full p-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:ring-1 focus:ring-slate-500 focus:border-slate-500"
                  >
                    <option value="">Choose a pool...</option>
                    {poolParticipations.map((pool) => (
                      <option key={pool.poolId} value={pool.poolId}>
                        {pool.regionName} - ${pool.stakedAmount.toFixed(2)} staked
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Amount
                  </label>
                  <input
                    type="number"
                    value={actionAmount}
                    onChange={(e) => setActionAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:ring-1 focus:ring-slate-500 focus:border-slate-500"
                  />
                </div>
                
                <div className="flex items-end gap-2">
                  <button
                    onClick={handleStakeUnstake}
                    disabled={!selectedPoolId || !actionAmount || isLoading}
                    className="flex-1 px-3 py-2 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-800 rounded text-white text-sm transition-colors disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Processing...' : `${selectedAction === 'stake' ? 'Stake' : 'Unstake'}`}
                  </button>
                  <button
                    onClick={() => {
                      setSelectedAction(null);
                      setActionAmount('');
                      setSelectedPoolId('');
                    }}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Pool Participations */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <PieChart className="w-5 h-5" />
            Pool Participations
          </h2>
          
          {poolParticipations.length === 0 ? (
            <div className="text-center py-8">
              <Coins className="mx-auto h-12 w-12 text-slate-600 mb-4" />
              <p className="text-slate-400">No pool participations found</p>
              <p className="text-slate-500 text-sm">Start by staking tokens in a liquidity pool</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {poolParticipations.map((pool) => (
                <div
                  key={pool.poolId}
                  className="bg-slate-700 border border-slate-600 rounded-lg p-4 hover:bg-slate-650 transition-colors"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold text-white">{pool.regionName}</h3>
                    <span className="text-xs bg-slate-600 text-slate-300 px-2 py-1 rounded">
                      {pool.apy.toFixed(1)}% APY
                    </span>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-sm">Staked Amount:</span>
                      <span className="text-white text-sm font-medium">${pool.stakedAmount.toFixed(2)}</span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-sm">Collateral Value:</span>
                      <span className="text-green-400 text-sm font-medium">${pool.collateralAmount.toFixed(2)}</span>
                    </div>
                    
                    {pool.debtAmount > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-sm">Outstanding Debt:</span>
                        <span className="text-red-400 text-sm font-medium">${pool.debtAmount.toFixed(2)}</span>
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-sm">LP Tokens:</span>
                      <span className="text-slate-300 text-sm font-medium">{pool.lpTokens.toFixed(4)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rewards Section */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Gift className="w-5 h-5" />
              Rewards & Earnings
            </h2>
            <button
              onClick={handleClaimRewards}
              disabled={profileStats.totalRewards === 0}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-800 rounded text-white text-sm transition-colors disabled:cursor-not-allowed"
            >
              Claim Rewards
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-700 border border-slate-600 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Gift className="w-4 h-4 text-slate-400" />
                <span className="text-slate-300 text-sm font-medium">Pending Rewards</span>
              </div>
              <p className="text-xl font-bold text-white">${profileStats.totalRewards.toFixed(2)}</p>
            </div>
            
            <div className="bg-slate-700 border border-slate-600 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <ArrowUpRight className="w-4 h-4 text-slate-400" />
                <span className="text-slate-300 text-sm font-medium">Total Earned</span>
              </div>
              <p className="text-xl font-bold text-white">$0.00</p>
            </div>
            
            <div className="bg-slate-700 border border-slate-600 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <span className="text-slate-300 text-sm font-medium">Next Reward</span>
              </div>
              <p className="text-xl font-bold text-white">24h</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;