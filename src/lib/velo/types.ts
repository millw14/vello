/**
 * VELO Types
 * Core types for the privacy transfer system
 * 
 * ARCHITECTURE:
 * - Private Balance: Internal ledger (arbitrary amounts, off-chain)
 * - Pool Notes: On-chain deposits in fixed denominations
 * - Internal Transfers: Velo-to-Velo, completely off-chain
 * - External Sends: Split into multiple pool transactions via relayer
 */

import { PublicKey } from '@solana/web3.js';

// ═══════════════════════════════════════════════════════════════════
// POOL SYSTEM (On-chain fixed denominations)
// ═══════════════════════════════════════════════════════════════════

export type PoolSize = 'SMALL' | 'MEDIUM' | 'LARGE';

export const POOL_AMOUNTS: Record<PoolSize, number> = {
  SMALL: 0.1,   // 0.1 SOL
  MEDIUM: 1,    // 1 SOL
  LARGE: 10,    // 10 SOL
};

// A deposit note - proof of deposit that can be used to withdraw
export interface VeloNote {
  id: string;
  poolSize: PoolSize;
  amount: number;           // in SOL
  commitment: string;       // hash proving deposit
  nullifier: string;        // prevents double-spend
  secret: string;           // secret for ZK proof
  createdAt: number;
  used: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// PRIVATE BALANCE SYSTEM (Off-chain internal ledger)
// ═══════════════════════════════════════════════════════════════════

export interface PrivateBalance {
  walletAddress: string;
  availableSOL: number;       // Spendable private balance
  pendingSOL: number;         // In-flight deposits/transfers
  lockedSOL: number;          // Locked in pool notes (on-chain)
  lastUpdated: number;
}

// Internal transfer between Velo users (NO on-chain transaction!)
export interface InternalTransfer {
  id: string;
  sender: string;             // Velo user
  recipient: string;          // Velo user
  amountSOL: number;          // Exact amount (e.g., 0.765)
  message?: string;           // Encrypted message
  timestamp: number;
  status: 'pending' | 'completed' | 'failed';
}

// ═══════════════════════════════════════════════════════════════════
// TRANSFERS
// ═══════════════════════════════════════════════════════════════════

// Pending transfer waiting for recipient to claim
export interface PendingTransfer {
  id: string;
  sender: string;           // sender's pubkey (hidden from recipient)
  recipient: string;        // recipient's pubkey
  encryptedAmount: string;  // encrypted amount (only recipient can decrypt)
  amountHint?: string;      // optional: pool size hint for UI
  amountSOL?: number;       // actual amount for internal transfers
  timestamp: number;
  claimed: boolean;
  claimedAt?: number;
  txSignature?: string;
  isInternal?: boolean;     // true if Velo-to-Velo transfer
}

// External send (to non-Velo wallet) - uses splitting
export interface ExternalSend {
  id: string;
  sender: string;
  recipient: string;          // External wallet address
  totalAmountSOL: number;     // Total amount requested
  sentAmountSOL: number;      // Amount successfully sent
  feeSOL: number;             // Total fees paid
  parts: ExternalSendPart[];  // Individual transactions
  status: 'pending' | 'in_progress' | 'completed' | 'partial' | 'failed';
  startedAt: number;
  completedAt?: number;
}

export interface ExternalSendPart {
  index: number;
  poolSize: PoolSize;
  amountSOL: number;
  status: 'waiting' | 'sending' | 'success' | 'error';
  txSignature?: string;
  error?: string;
  scheduledAt: number;
  completedAt?: number;
}

// ═══════════════════════════════════════════════════════════════════
// ACCOUNT STATE
// ═══════════════════════════════════════════════════════════════════

export interface VeloAccount {
  publicKey: string;
  privateBalance: PrivateBalance;
  notes: VeloNote[];
  pendingOutgoing: PendingTransfer[];
  pendingIncoming: PendingTransfer[];
  externalSends: ExternalSend[];
  isVeloUser: boolean;        // true if registered
}

// ═══════════════════════════════════════════════════════════════════
// TRANSACTION RESULTS
// ═══════════════════════════════════════════════════════════════════

export interface TxResult {
  success: boolean;
  signature?: string;
  error?: string;
}

export interface SendResult extends TxResult {
  transferId?: string;
  isInternal?: boolean;
  parts?: ExternalSendPart[];
  totalSent?: number;
  fee?: number;
}

export interface DepositResult extends TxResult {
  note?: VeloNote;
  newBalance?: number;
}

// ═══════════════════════════════════════════════════════════════════
// PRIVACY LEVEL
// ═══════════════════════════════════════════════════════════════════

export type PrivacyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'MAXIMUM';

export function getPrivacyLevel(config: {
  amountHidden: boolean;
  senderHidden: boolean;
  mixerUsed: boolean;
  isInternal?: boolean;
}): PrivacyLevel {
  // Internal transfers are always maximum privacy
  if (config.isInternal) return 'MAXIMUM';
  
  const score = 
    (config.amountHidden ? 1 : 0) +
    (config.senderHidden ? 1 : 0) +
    (config.mixerUsed ? 1 : 0);
  
  if (score === 3) return 'MAXIMUM';
  if (score === 2) return 'HIGH';
  if (score === 1) return 'MEDIUM';
  return 'LOW';
}

// ═══════════════════════════════════════════════════════════════════
// SUPPORTED TOKENS (Future expansion)
// ═══════════════════════════════════════════════════════════════════

export type SupportedToken = 'SOL' | 'USDC';

export const TOKEN_INFO: Record<SupportedToken, {
  symbol: string;
  name: string;
  decimals: number;
  mint?: string;
  icon: string;
}> = {
  SOL: {
    symbol: 'SOL',
    name: 'Solana',
    decimals: 9,
    icon: '◎',
  },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    icon: '$',
  },
};
