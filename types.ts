export interface UserAccount {
  id: string; // Simulated address
  name: string;
  tokenBalance: number; // User's main token balance (simulates bank)
  lpTokenBalances: Record<string, number>; // poolId -> LP token amount
}

export interface StakeEntry {
  userId: string;
  stakedAmount: number;
  collateralAmount: number; // e.g., 20% of stakedAmount
  lpTokensMinted: number;
  stakeTimestamp: number;
}

export enum PoolStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  PAUSED = "paused",
}

export interface LiquidityPoolData {
  id: string;
  regionName: string;
  totalLiquidity: number;
  totalDebt: number;
  userDebt: number; // Add this to store the user's active debt for the pool
  stakers: StakeEntry[];
  debts: DebtEntry[]; // Keep for potential future use
  status: PoolStatus;
  rewardsPot: number;
  apy: number;
  lpTokenSupply: number;
}

export interface DebtEntry {
  userId: string;
  merchantAddress: string;
  amount: number;
  timestamp: number;
  isRepaid: boolean;
}
export type NotificationType = "success" | "error" | "info";

export interface AppNotification {
  id: string;
  message: string;
  type: NotificationType;
}
