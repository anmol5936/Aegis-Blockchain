import React, { useState, useEffect } from "react";
import { DebtEntry, LiquidityPoolData, UserAccount } from "../types";
import { XIcon, CheckCircleIcon } from "./icons/PhosphorIcons";
import { useStateContext } from "../BlockchainContext";

interface RepayModalProps {
  pool: LiquidityPoolData;
  user: UserAccount;
  onClose: () => void;
  onConfirm: (poolId: string, debtIndex: number, amount: number) => void;
}

const RepayModal: React.FC<RepayModalProps> = ({
  pool,
  user,
  onClose,
  onConfirm,
}) => {
  const { addAppNotification, stakingTokenInfo, isLoading } = useStateContext();
  const [selectedDebtIndex, setSelectedDebtIndex] = useState<number | null>(
    null
  );
  const [amount, setAmount] = useState("");
  const [isDebtLoading, setIsDebtLoading] = useState(true);

  // Create array of unpaid debts WITH their original indices
  const unpaidDebtsWithIndices = pool.debts
    .map((debt, originalIndex) => ({ debt, originalIndex }))
    .filter(({ debt }) => !debt.isRepaid);

  // Calculate total active debt
  const totalActiveDebt = unpaidDebtsWithIndices
    .map(({ debt }) => debt.amount)
    .reduce((sum, amount) => sum + amount, 0);

  // Reset loading state once debts are available
  useEffect(() => {
    if (!isLoading) {
      setIsDebtLoading(false);
    }
  }, [isLoading]);

  const handleRepay = (originalDebtIndex: number, amount: number) => {
    onConfirm(pool.id, originalDebtIndex, amount);
  };

  const formatAddress = (address: string) => {
    if (address.length <= 10) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedDebtIndex === null) {
      addAppNotification("Please select a debt to repay.", "error");
      return;
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      addAppNotification("Please enter a valid amount.", "error");
      return;
    }

    // Find the selected debt using the filtered array index
    const selectedDebtItem = unpaidDebtsWithIndices[selectedDebtIndex];
    if (!selectedDebtItem) {
      addAppNotification("Selected debt not found.", "error");
      return;
    }

    if (numericAmount > selectedDebtItem.debt.amount) {
      addAppNotification(
        "Repayment amount cannot exceed the debt amount.",
        "error"
      );
      return;
    }

    if (numericAmount > user.tokenBalance) {
      addAppNotification("Insufficient token balance for repayment.", "error");
      return;
    }

    // Pass the ORIGINAL debt index to the repay function
    handleRepay(selectedDebtItem.originalIndex, numericAmount);
  };

  // Calculate if button should be disabled
  const isButtonDisabled = () => {
    if (selectedDebtIndex === null || !amount || isLoading) {
      return true;
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return true;
    }

    const selectedDebtItem = unpaidDebtsWithIndices[selectedDebtIndex];
    if (!selectedDebtItem) {
      return true;
    }

    if (
      numericAmount > selectedDebtItem.debt.amount ||
      numericAmount > user.tokenBalance
    ) {
      return true;
    }

    return false;
  };

  const handleDebtSelection = (filteredIndex: number) => {
    setSelectedDebtIndex(filteredIndex);
    const selectedDebtItem = unpaidDebtsWithIndices[filteredIndex];
    const maxAmount = Math.min(selectedDebtItem.debt.amount, user.tokenBalance);
    const decimals = stakingTokenInfo?.decimals || 18;
    setAmount(maxAmount.toFixed(Math.min(decimals, 6)));
  };

  if (isDebtLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-md">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-sky-400">Repay Debt</h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200"
            >
              <XIcon size={24} />
            </button>
          </div>
          <p className="text-slate-300">Loading debts...</p>
        </div>
      </div>
    );
  }

  if (unpaidDebtsWithIndices.length === 0) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-md">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-sky-400">Repay Debt</h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200"
            >
              <XIcon size={24} />
            </button>
          </div>
          <p className="text-slate-300">
            You have no outstanding debt in the {pool.regionName} pool.
          </p>
          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-600 hover:bg-slate-500 rounded-md"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-md">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold text-sky-400">Repay Debt</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200"
          >
            <XIcon size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <p className="mb-4 text-sm text-slate-300">
            Pool: <span className="font-semibold">{pool.regionName}</span>
          </p>

          <p className="mb-4 text-sm text-slate-400">
            Total Debt:{" "}
            <span className="font-semibold text-red-400">
              {totalActiveDebt.toFixed(2)} Tokens
            </span>
          </p>

          <p className="mb-4 text-sm text-slate-400">
            Your current balance:{" "}
            <span className="font-semibold text-green-400">
              {user.tokenBalance.toFixed(2)} Tokens
            </span>
          </p>

          {/* Debt Selection */}
          <div className="mb-6">
            <label className="block mb-2 text-sm font-medium text-slate-300">
              Select Debt to Repay
            </label>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {unpaidDebtsWithIndices.map(
                ({ debt, originalIndex }, filteredIndex) => (
                  <div
                    key={originalIndex}
                    onClick={() => handleDebtSelection(filteredIndex)}
                    className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedDebtIndex === filteredIndex
                        ? "bg-sky-900 border-sky-500"
                        : "bg-slate-700 border-slate-600 hover:bg-slate-600"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm text-slate-300">
                          Merchant:{" "}
                          <span className="font-mono">
                            {formatAddress(debt.merchantAddress)}
                          </span>
                        </p>
                        <p className="text-xs text-slate-400">
                          Amount:{" "}
                          <span className="font-semibold text-red-400">
                            {debt.amount.toFixed(2)} Tokens
                          </span>
                        </p>
                        <p className="text-xs text-slate-500">
                          Index: {originalIndex}
                        </p>
                      </div>
                      {selectedDebtIndex === filteredIndex && (
                        <CheckCircleIcon size={20} className="text-sky-400" />
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>

          {/* Amount Input */}
          {selectedDebtIndex !== null && (
            <div className="mb-6">
              <label
                htmlFor="repayAmount"
                className="block mb-1 text-sm font-medium text-slate-300"
              >
                Amount to Repay
              </label>
              <input
                type="number"
                id="repayAmount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0.01"
                step="0.000001"
                max={Math.min(
                  unpaidDebtsWithIndices[selectedDebtIndex].debt.amount,
                  user.tokenBalance
                )}
                className="bg-slate-700 border border-slate-600 text-slate-100 text-sm rounded-lg focus:ring-sky-500 focus:border-sky-500 block w-full p-2.5"
                placeholder="0.00"
                required
              />
              <button
                type="button"
                onClick={() => {
                  const maxAmount = Math.min(
                    unpaidDebtsWithIndices[selectedDebtIndex].debt.amount,
                    user.tokenBalance
                  );
                  const decimals = stakingTokenInfo?.decimals || 18;
                  setAmount(maxAmount.toFixed(Math.min(decimals, 6)));
                }}
                className="mt-1 text-xs text-sky-400 hover:text-sky-300"
              >
                Pay Maximum Possible
              </button>
            </div>
          )}

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
              className="px-4 py-2 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-md flex items-center gap-2 disabled:bg-slate-500 disabled:cursor-not-allowed"
            >
              <CheckCircleIcon size={18} /> Confirm Repayment
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RepayModal;
