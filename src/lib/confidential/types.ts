/**
 * VELO CONFIDENTIAL TRANSFER TYPES
 */

import { PublicKey } from '@solana/web3.js';

// ═══════════════════════════════════════════════════════════════════
// ELGAMAL KEYPAIR (for encryption/decryption)
// ═══════════════════════════════════════════════════════════════════

export interface ElGamalKeypair {
  publicKey: Uint8Array;   // 32 bytes - used to encrypt
  secretKey: Uint8Array;   // 32 bytes - used to decrypt
}

export interface ElGamalCiphertext {
  commitment: Uint8Array;  // 32 bytes
  handle: Uint8Array;      // 32 bytes
}

// ═══════════════════════════════════════════════════════════════════
// USER CONFIDENTIAL ACCOUNT
// ═══════════════════════════════════════════════════════════════════

export interface ConfidentialAccountInfo {
  // Wallet addresses
  ownerWallet: string;           // User's main Solana wallet
  confidentialAccount: string;    // Token-2022 confidential account address
  
  // ElGamal keys (derived from wallet signature)
  elGamalPublicKey: string;       // Base58 encoded
  
  // Encrypted balance (only owner can decrypt)
  encryptedAvailableBalance: string;   // Hex encoded ciphertext
  encryptedPendingBalance: string;     // Hex encoded ciphertext
  
  // Decrypted balance (client-side only, never stored)
  decryptedBalance?: number;
  
  // Metadata
  createdAt: number;
  lastUpdated: number;
  isConfigured: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// CONFIDENTIAL TRANSFER
// ═══════════════════════════════════════════════════════════════════

export interface ConfidentialTransfer {
  id: string;
  
  // Participants
  senderAccount: string;      // Sender's confidential account
  recipientAccount: string;   // Recipient's confidential account
  
  // Encrypted amount (observers can't see the actual value)
  encryptedAmount: string;
  
  // Status
  status: 'pending' | 'completed' | 'failed';
  
  // Transaction info
  txSignature?: string;
  
  // Timestamps
  createdAt: number;
  completedAt?: number;
}

// ═══════════════════════════════════════════════════════════════════
// DEPOSIT / WITHDRAW
// ═══════════════════════════════════════════════════════════════════

export interface DepositRequest {
  ownerWallet: PublicKey;
  amountSOL: number;
}

export interface DepositResult {
  success: boolean;
  txSignature?: string;
  newEncryptedBalance?: string;
  error?: string;
}

export interface WithdrawRequest {
  ownerWallet: PublicKey;
  amountSOL: number;
  destinationWallet?: PublicKey;  // Optional, defaults to owner
}

export interface WithdrawResult {
  success: boolean;
  txSignature?: string;
  amountWithdrawn?: number;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// TRANSFER REQUEST
// ═══════════════════════════════════════════════════════════════════

export interface TransferRequest {
  senderWallet: PublicKey;
  recipientWallet: PublicKey;  // Velo looks up their confidential account
  amountSOL: number;
  memo?: string;
}

export interface TransferResult {
  success: boolean;
  transferId?: string;
  txSignature?: string;
  recipientCreated?: boolean;  // True if we auto-created recipient's account
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// BALANCE INFO
// ═══════════════════════════════════════════════════════════════════

export interface ConfidentialBalanceInfo {
  // Encrypted (for display purposes showing "encrypted")
  availableEncrypted: string;
  pendingEncrypted: string;
  
  // Decrypted (after user decrypts)
  availableDecrypted?: number;
  pendingDecrypted?: number;
  
  // Combined
  totalDecrypted?: number;
  
  // Status
  isDecrypted: boolean;
  lastDecryptedAt?: number;
}

// ═══════════════════════════════════════════════════════════════════
// API RESPONSES
// ═══════════════════════════════════════════════════════════════════

export interface CreateAccountResponse {
  success: boolean;
  accountAddress?: string;
  elGamalPublicKey?: string;
  error?: string;
}

export interface AccountLookupResponse {
  exists: boolean;
  accountInfo?: ConfidentialAccountInfo;
  error?: string;
}
