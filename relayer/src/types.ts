/**
 * Velo Relayer Type Definitions
 */

export interface RelayerConfig {
  rpcUrl: string;
  relayerKeypairPath: string;
  minFee: number;        // Minimum fee in lamports
  maxFee: number;        // Maximum fee in lamports
  feePercent: number;    // Fee as percentage of withdrawal
  veloProgramId: string; // Main Velo program ID
}

// Pool denominations
export enum PoolSize {
  SMALL = 'SMALL',   // 0.1 SOL
  MEDIUM = 'MEDIUM', // 1 SOL
  LARGE = 'LARGE',   // 10 SOL
}

export const POOL_AMOUNTS: Record<PoolSize, number> = {
  [PoolSize.SMALL]: 0.1,
  [PoolSize.MEDIUM]: 1,
  [PoolSize.LARGE]: 10,
};

export const POOL_LAMPORTS: Record<PoolSize, number> = {
  [PoolSize.SMALL]: 100_000_000,     // 0.1 SOL
  [PoolSize.MEDIUM]: 1_000_000_000,  // 1 SOL
  [PoolSize.LARGE]: 10_000_000_000,  // 10 SOL
};

/**
 * Request to withdraw via relayer
 * User sends this off-chain (HTTPS) to the relayer
 * Relayer verifies and submits on-chain
 */
export interface RelayerWithdrawRequest {
  // Note proof (from user's deposit)
  noteCommitment: string;     // The commitment from deposit
  nullifier: string;          // Base58 encoded nullifier
  secret: string;             // Base58 encoded secret (proves ownership)
  
  // Where to send
  recipient: string;          // Recipient public key (base58)
  
  // Pool info
  poolSize: PoolSize;
  
  // Optional: signature to prove wallet ownership
  // (not strictly needed since we verify nullifier)
  senderSignature?: string;
}

/**
 * Request for stealth address transfer
 */
export interface StealthTransferRequest {
  noteCommitment: string;
  nullifier: string;
  secret: string;
  recipientStealthMeta: string; // Recipient's stealth meta-address
  poolSize: PoolSize;
}

export interface RelayResult {
  success: boolean;
  signature?: string;
  error?: string;
  fee?: number;
  recipientAmount?: number;
  timestamp?: number;
}

export interface RelayerInfo {
  address: string;
  feePercent: number;
  minFee: number;
  maxFee: number;
  supportedPools: PoolSize[];
  isActive: boolean;
  totalRelayed: number;
}

/**
 * Velo Note - stored by user after deposit
 */
export interface VeloNote {
  id: string;
  poolSize: PoolSize;
  amount: number;
  commitment: string;
  nullifier: string;
  secret: string;
  createdAt: number;
  used: boolean;
  txSignature?: string;
}

/**
 * Nullifier tracking to prevent double-spend
 */
export interface NullifierRecord {
  hash: string;
  poolSize: PoolSize;
  usedAt: number;
  relayTxSignature: string;
}
