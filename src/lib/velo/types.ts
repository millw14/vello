/**
 * VELO Types
 * Core types for the privacy transfer system
 */

import { PublicKey } from '@solana/web3.js';

// Pool sizes for fixed denomination privacy
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

// Pending transfer waiting for recipient to claim
export interface PendingTransfer {
  id: string;
  sender: string;           // sender's pubkey (hidden from recipient)
  recipient: string;        // recipient's pubkey
  encryptedAmount: string;  // encrypted amount (only recipient can decrypt)
  amountHint?: string;      // optional: pool size hint for UI
  timestamp: number;
  claimed: boolean;
  claimedAt?: number;
  txSignature?: string;
}

// User's Velo account state
export interface VeloAccount {
  publicKey: string;
  encryptedBalance: number;     // total encrypted balance in vault
  notes: VeloNote[];            // deposit notes
  pendingOutgoing: PendingTransfer[];  // transfers sent, waiting for claim
  pendingIncoming: PendingTransfer[];  // transfers received, waiting to claim
}

// Transaction result
export interface TxResult {
  success: boolean;
  signature?: string;
  error?: string;
}

// Privacy level indicator
export type PrivacyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'MAXIMUM';

export function getPrivacyLevel(config: {
  amountHidden: boolean;
  senderHidden: boolean;
  mixerUsed: boolean;
}): PrivacyLevel {
  const score = 
    (config.amountHidden ? 1 : 0) +
    (config.senderHidden ? 1 : 0) +
    (config.mixerUsed ? 1 : 0);
  
  if (score === 3) return 'MAXIMUM';
  if (score === 2) return 'HIGH';
  if (score === 1) return 'MEDIUM';
  return 'LOW';
}
