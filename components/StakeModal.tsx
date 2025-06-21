
import React, { useState, useEffect } from 'react';
import { LiquidityPoolData, UserAccount } from '../types';
import { COLLATERAL_PERCENTAGE } from '../constants';
import { XIcon, ArrowUpIcon, ArrowDownIcon } from './icons/PhosphorIcons';

interface StakeModalProps {
  pool: LiquidityPoolData;
  user: UserAccount;
  onClose: () => void;
  onStake: (poolId: string, amount: number, isUnstaking: boolean) => void;
}

const StakeModal: React.FC<StakeModalProps> = ({ pool, user, onClose, onStake }) => {
  const [amount, setAmount] = useState('');
  const [isUnstaking, setIsUnstaking] = useState(false);
  const userStakeInPool = pool.stakers.find(s => s.userId === user.id);

  useEffect(() => {
    // Reset mode if user has no stake (can only stake)
    if (!userStakeInPool && isUnstaking) {
      setIsUnstaking(false);
    }
     // If user has stake, default to unstake if preferred, otherwise stake
    if (userStakeInPool && userStakeInPool.stakedAmount > 0) {
      // setIsUnstaking(true); // Optionally default to unstake if user has stake
    } else {
      setIsUnstaking(false); // Default to stake if no stake
    }
  }, [userStakeInPool, isUnstaking]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      alert("Please enter a valid amount.");
      return;
    }
    onStake(pool.id, numericAmount, isUnstaking);
    // onClose(); // Potentially close only on success, handled by parent
  };

  const maxStakeAmount = user.tokenBalance;
  const maxUnstakeAmount = userStakeInPool?.stakedAmount || 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-md transform transition-all">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold text-sky-400">
            {isUnstaking ? 'Unstake from' : 'Stake in'} {pool.regionName}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <XIcon size={24} />
          </button>
        </div>

        <div className="mb-4 flex justify-center">
            {userStakeInPool && userStakeInPool.stakedAmount > 0 && ( // Show toggle only if user has something to unstake
                 <div className="inline-flex rounded-md shadow-sm" role="group">
                    <button
                        type="button"
                        onClick={() => setIsUnstaking(false)}
                        className={`px-4 py-2 text-sm font-medium ${!isUnstaking ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'} border border-slate-600 rounded-l-lg focus:z-10 focus:ring-2 focus:ring-sky-500`}
                    >
                        <ArrowUpIcon size={16} className="inline mr-1" /> Stake
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsUnstaking(true)}
                        className={`px-4 py-2 text-sm font-medium ${isUnstaking ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'} border-t border-b border-r border-slate-600 rounded-r-lg focus:z-10 focus:ring-2 focus:ring-sky-500`}
                    >
                       <ArrowDownIcon size={16} className="inline mr-1" /> Unstake
                    </button>
                </div>
            )}
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="amount" className="block mb-1 text-sm font-medium text-slate-300">
              Amount to {isUnstaking ? 'Unstake' : 'Stake'}
            </label>
            <input
              type="number"
              id="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0.01"
              step="any" // Allow decimals
              max={isUnstaking ? maxUnstakeAmount : maxStakeAmount}
              className="bg-slate-700 border border-slate-600 text-slate-100 text-sm rounded-lg focus:ring-sky-500 focus:border-sky-500 block w-full p-2.5"
              placeholder="0.00"
              required
            />
            <p className="mt-1 text-xs text-slate-400">
              {isUnstaking ? `Max Unstake: ${maxUnstakeAmount.toLocaleString()}` : `Available to Stake: ${maxStakeAmount.toLocaleString()}`} Tokens
            </p>
            {!isUnstaking && parseFloat(amount) > 0 && (
                <p className="mt-1 text-xs text-slate-400">
                    Collateral ({(COLLATERAL_PERCENTAGE * 100).toFixed(0)}%): {(parseFloat(amount) * COLLATERAL_PERCENTAGE).toFixed(2)} Tokens
                </p>
            )}
          </div>
          
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-600 hover:bg-slate-500 rounded-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`px-4 py-2 text-sm font-medium text-white rounded-md ${isUnstaking ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
            >
              {isUnstaking ? 'Confirm Unstake' : 'Confirm Stake'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default StakeModal;