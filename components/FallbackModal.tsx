import React, { useState, useEffect, useCallback } from 'react';
import { LiquidityPoolData, UserAccount } from '../types';
import { useStateContext } from '../BlockchainContext';
import { DollarSignIcon, AlertTriangleIcon, InfoIcon } from './icons/PhosphorIcons';

interface FallbackModalProps {
  pool: LiquidityPoolData;
  user: UserAccount;
  pools: LiquidityPoolData[];
  onClose: () => void;
  onConfirm: (poolId: string, merchantAddress: string, amount: number, selectedBank: string) => void; // Updated signature
  isProcessingPayment?: boolean; // New prop
}

const FallbackModal: React.FC<FallbackModalProps> = ({
  pool,
  user,
  pools,
  onClose,
  onConfirm,
  isProcessingPayment, // Consumed new prop
}) => {
  console.log('=== FallbackModal Render Start ===', {
    pool: pool?.id,
    user: user?.id,
    poolsLength: pools?.length,
    onCloseExists: !!onClose,
    onConfirmExists: !!onConfirm,
    isProcessingPayment
  });

  const { 
    getTotalCollateralAcrossPools, 
    getAllUserPools,
    addAppNotification 
  } = useStateContext();
  
  const [merchantAddress, setMerchantAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedBank, setSelectedBank] = useState(''); // New state for selected bank
  const [totalCollateral, setTotalCollateral] = useState<number>(0);
  const [userPools, setUserPools] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true); // This is for loading collateral data
  const [crossPoolAnalysis, setCrossPoolAnalysis] = useState<{
    primaryPoolCollateral: number;
    additionalPoolsNeeded: boolean;
    redistributionPools: string[];
  } | null>(null);

  console.log('=== Initial State ===', {
    merchantAddress,
    amount,
    selectedBank, // Added to log
    totalCollateral,
    userPools,
    isLoading, // This is for loading collateral data
    crossPoolAnalysis
  });

  const loadCrossPoolData = useCallback(async () => {
    console.log('=== loadCrossPoolData Execution ===');
    
    if (!getTotalCollateralAcrossPools) {
      console.error('Missing getTotalCollateralAcrossPools');
      addAppNotification('Application context error. Please refresh.', 'error');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      console.log('Fetching total collateral...');
      const total = await getTotalCollateralAcrossPools();
      console.log('Fetched total collateral:', total);

      let validPools: string[] = [];
      if (getAllUserPools) {
        console.log('Fetching user pools...');
        const fetchedPools = await getAllUserPools();
        console.log('Fetched user pools:', fetchedPools);
        validPools = Array.isArray(fetchedPools) ? fetchedPools : [];
      } else {
        console.warn('getAllUserPools undefined, using props.pools');
        validPools = pools.map(p => p.id); // Fallback to props.pools
      }
      
      let totalAsNumber: number;
      if (total === undefined || total === null) {
        console.log('Total collateral is undefined/null, setting to 0');
        totalAsNumber = 0;
      } else if (typeof total === 'string') {
        console.log('Total collateral is string, parsing:', total);
        totalAsNumber = parseFloat(total);
      } else if (typeof total === 'number') {
        console.log('Total collateral is number:', total);
        totalAsNumber = total;
      } else if (total && typeof total === 'object' && 'toNumber' in total) {
        console.log('Total collateral is object with toNumber, converting:', total);
        totalAsNumber = total.toNumber();
      } else {
        console.log('Total collateral is unknown type, setting to 0:', total);
        totalAsNumber = 0;
      }
      
      if (totalAsNumber === 0 || validPools.length === 0) {
        console.log('No collateral or pools found, notifying user');
        addAppNotification('No collateral or pools found for your account.', 'warning');
      }
      
      console.log('Updating state with:', { totalAsNumber, validPools });
      setTotalCollateral(totalAsNumber);
      setUserPools(validPools);

      // Calculate crossPoolAnalysis immediately after fetching data
      if (amount && validPools.length > 0) {
        const amountFloat = parseFloat(amount);
        console.log('Parsed amount for analysis:', amountFloat);
        
        if (!isNaN(amountFloat)) {
          const userStakeInPrimary = pool.stakers.find(s => s.userId === user.id);
          const primaryCollateral = userStakeInPrimary?.collateralAmount || 0;
          console.log('Primary pool stake:', {
            userStakeInPrimary,
            primaryCollateral
          });

          const analysis = {
            primaryPoolCollateral: primaryCollateral,
            additionalPoolsNeeded: amountFloat > primaryCollateral,
            redistributionPools: validPools.filter(poolAddr => poolAddr !== pool.id)
          };
          
          console.log('Cross pool analysis result:', analysis);
          setCrossPoolAnalysis(analysis);
        }
      }
      
    } catch (error) {
      console.error('Error in loadCrossPoolData:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      addAppNotification('Failed to load collateral data. Please try again.', 'error');
      setTotalCollateral(0);
      setUserPools([]);
    } finally {
      console.log('loadCrossPoolData complete, setting isLoading to false');
      setIsLoading(false);
    }
  }, [getTotalCollateralAcrossPools, getAllUserPools, addAppNotification, pools, pool, user, amount]);

  useEffect(() => {
    console.log('=== useEffect: loadCrossPoolData ===', {
      poolId: pool?.id,
      userId: user?.id,
      contextFunctions: {
        getTotalCollateralAcrossPools: !!getTotalCollateralAcrossPools,
        getAllUserPools: !!getAllUserPools,
        addAppNotification: !!addAppNotification
      }
    });
    loadCrossPoolData();
  }, [loadCrossPoolData]);

  const amountFloat = parseFloat(amount || '0');
  const isExecuteDisabled = 
    isLoading || 
    !merchantAddress.trim() || 
    !amount.trim() || 
    isNaN(amountFloat) ||
    amountFloat <= 0 || 
    amountFloat > totalCollateral;

  console.log('=== Execute Button State ===', {
    isLoading: isLoading || !!isProcessingPayment, // Consider both loading states
    merchantAddress: merchantAddress.trim(),
    amount: amount.trim(),
    selectedBank: selectedBank.trim(), // Added selectedBank
    amountFloat,
    totalCollateral,
    isExecuteDisabled: isExecuteDisabled || !!isProcessingPayment, // Disable if processing payment
    reasons: {
      isLoading: isLoading || !!isProcessingPayment,
      noMerchant: !merchantAddress.trim(),
      noAmount: !amount.trim(),
      noSelectedBank: !selectedBank.trim(), // Added reason for selectedBank
      invalidAmount: isNaN(amountFloat) || amountFloat <= 0,
      exceedsCollateral: amountFloat > totalCollateral
    }
  });

  const handleConfirm = useCallback(() => {
    console.log('=== handleConfirm Execution ===', {
      poolId: pool.id,
      merchantAddress,
      amount,
      selectedBank, // Added selectedBank
      amountFloat,
      totalCollateral,
      isExecuteDisabled: isExecuteDisabled || !!isProcessingPayment
    });
    
    if (isLoading || isProcessingPayment) { // Check both loading states
      console.log('Cannot execute: Loading in progress or payment processing');
      addAppNotification('Please wait for current operation to complete.', 'error');
      return;
    }

    if (!merchantAddress.trim()) {
      console.log('Cannot execute: Missing merchant address');
      addAppNotification('Please enter a merchant address.', 'error');
      return;
    }
    
    if (!amount.trim() || isNaN(amountFloat) || amountFloat <= 0) {
      console.log('Cannot execute: Invalid amount', { amount, amountFloat });
      addAppNotification('Please enter a valid payment amount.', 'error');
      return;
    }

    if (!selectedBank.trim()) { // Check for selectedBank
      console.log('Cannot execute: Missing selected bank');
      addAppNotification('Please enter or select a bank ID.', 'error');
      return;
    }
    
    // Collateral check can remain, as it's good info, though agent2 might also check balances later
    if (amountFloat > totalCollateral) {
      console.log('Cannot execute: Amount exceeds displayed collateral', { amountFloat, totalCollateral });
      addAppNotification(
        `Amount (${amountFloat}) exceeds total available collateral (${totalCollateral}) across all pools. Agent2 will verify final eligibility.`,
        'warning' // Changed to warning as agent2 is the final decider
      );
      // Proceeding as agent2 will make the final call, but user is warned.
    }
    
    console.log('Calling onConfirm with:', { poolId: pool.id, merchantAddress, amountFloat, selectedBank });
    onConfirm(pool.id, merchantAddress, amountFloat, selectedBank); // Pass selectedBank
    console.log('onConfirm called successfully');
  }, [isLoading, isProcessingPayment, merchantAddress, amount, selectedBank, amountFloat, totalCollateral, pool.id, onConfirm, addAppNotification]);

  console.log('=== Rendering UI ===', {
    isLoading: isLoading || !!isProcessingPayment, // Combined loading states for UI
    totalCollateral,
    userPoolsLength: userPools.length,
    crossPoolAnalysis,
    merchantAddress,
    amount
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-sky-400 mb-4">
          Complete Payment {/* Generalized Title */}
        </h2>
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Merchant Address
            </label>
            <input
              type="text"
              value={merchantAddress}
              onChange={(e) => {
                console.log('Merchant address changed:', e.target.value);
                setMerchantAddress(e.target.value);
              }}
              className="w-full bg-slate-700 text-white rounded-md px-3 py-2 text-sm"
              placeholder="0x..."
              disabled={isLoading || isProcessingPayment} // Disable if loading data or processing payment
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Payment Amount (Tokens)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => {
                console.log('Amount changed:', e.target.value);
                setAmount(e.target.value);
              }}
              className="w-full bg-slate-700 text-white rounded-md px-3 py-2 text-sm"
              placeholder="0.00"
              step="0.01"
              min="0"
              disabled={isLoading || isProcessingPayment} // Disable
            />
          </div>

          {/* New Selected Bank Field */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Bank ID / Name
            </label>
            <input
              type="text"
              value={selectedBank}
              onChange={(e) => {
                console.log('Selected bank changed:', e.target.value);
                setSelectedBank(e.target.value);
              }}
              className="w-full bg-slate-700 text-white rounded-md px-3 py-2 text-sm"
              placeholder="e.g., bank_a_id, Chase, etc."
              disabled={isLoading || isProcessingPayment} // Disable
            />
             <p className="mt-1 text-xs text-slate-400">
              Enter the identifier for the bank you wish to use.
            </p>
          </div>
        </div>

        <div className="bg-slate-700/50 p-4 rounded-lg mb-6 space-y-3">
          <h3 className="text-sm font-semibold text-sky-300 flex items-center">
            <InfoIcon size={16} className="mr-2" />
            Cross-Pool Collateral Analysis
          </h3>
          
          {isLoading ? (
            <div className="text-center text-slate-400 text-sm py-4">
              Loading collateral data...
            </div>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span>Primary Pool ({pool.regionName}):</span>
                <span className="text-green-400">
                  {pool.stakers.find(s => s.userId === user.id)?.collateralAmount.toLocaleString() || 0} Tokens
                </span>
              </div>
              
              <div className="flex justify-between">
                <span>Total Across All Pools:</span>
                <span className="text-sky-400 font-medium">
                  {totalCollateral.toLocaleString()} Tokens
                </span>
              </div>
              
              <div className="flex justify-between">
                <span>Your Active Pools:</span>
                <span className="text-indigo-400">
                  {userPools.length} pools
                </span>
              </div>
            </div>
          )}

          {crossPoolAnalysis && crossPoolAnalysis.additionalPoolsNeeded && (
            <div className="mt-3 p-2 bg-yellow-500/20 rounded border border-yellow-500/50">
              <div className="flex items-start text-yellow-300 text-xs">
                <AlertTriangleIcon size={14} className="mr-2 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium">Cross-Pool Redistribution Required</div>
                  <div className="mt-1">
                    Payment will use collateral from {crossPoolAnalysis.redistributionPools.length + 1} pools 
                    due to insufficient funds in primary pool.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => {
              console.log('Cancel button clicked');
              onClose();
            }}
            className="flex-1 bg-slate-600 hover:bg-slate-700 text-white py-2 px-4 rounded-md text-sm font-medium transition-colors"
            disabled={isLoading || isProcessingPayment} // Disable
          >
            Cancel
          </button>
          <button
            onClick={() => {
              console.log('Execute Payment button clicked');
              handleConfirm();
            }}
            disabled={isExecuteDisabled || !!isProcessingPayment || !selectedBank.trim()} // Disable if processing or no bank selected
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white py-2 px-4 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <DollarSignIcon size={16} />
            {isProcessingPayment ? 'Processing...' : (isLoading ? 'Loading Data...' : 'Execute Payment')}
          </button>
        </div>

        <div className="mt-4 text-xs text-slate-400">
          <InfoIcon size={12} className="inline mr-1" />
          Payments will be routed via your selected bank if available, or through Aegis fallback if needed.
        </div>
      </div>
    </div>
  );
};

export default FallbackModal;