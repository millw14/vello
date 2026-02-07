/**
 * VELO CONFIDENTIAL CONSTANTS
 */

import { PublicKey } from '@solana/web3.js';

// ═══════════════════════════════════════════════════════════════════
// NETWORK CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

export const SOLANA_NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
export const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// ═══════════════════════════════════════════════════════════════════
// CSOL MINT (Token-2022 Confidential Wrapped SOL)
// Will be updated after mint creation
// ═══════════════════════════════════════════════════════════════════

// Placeholder - will be replaced by actual mint after initialization
export const CSOL_MINT_ADDRESS = process.env.NEXT_PUBLIC_CSOL_MINT || '';
export const CSOL_MINT = CSOL_MINT_ADDRESS ? new PublicKey(CSOL_MINT_ADDRESS) : null;
export const CSOL_DECIMALS = 9;  // Same as SOL

// ═══════════════════════════════════════════════════════════════════
// VELO AUTHORITY (can mint/burn cSOL)
// ═══════════════════════════════════════════════════════════════════

export const VELO_AUTHORITY_ADDRESS = process.env.NEXT_PUBLIC_VELO_AUTHORITY || '';
export const VELO_AUTHORITY = VELO_AUTHORITY_ADDRESS ? new PublicKey(VELO_AUTHORITY_ADDRESS) : null;

// ═══════════════════════════════════════════════════════════════════
// FEES
// ═══════════════════════════════════════════════════════════════════

export const CONFIDENTIAL_TRANSFER_FEE_BPS = 50;  // 0.5% fee
export const MIN_DEPOSIT_SOL = 0.001;
export const MIN_TRANSFER_SOL = 0.001;
export const MIN_WITHDRAW_SOL = 0.001;

// Account creation rent (approximate)
export const CONFIDENTIAL_ACCOUNT_RENT_SOL = 0.003;

// ═══════════════════════════════════════════════════════════════════
// ELGAMAL CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

// Message to sign for deriving ElGamal keypair
export const ELGAMAL_DERIVATION_MESSAGE = 'VELO_CONFIDENTIAL_KEYPAIR_v1';

// ═══════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export const API_ENDPOINTS = {
  // User account management
  createAccount: '/api/confidential/account',
  getAccount: '/api/confidential/account',
  lookupByWallet: '/api/confidential/lookup',
  
  // Balance operations
  deposit: '/api/confidential/deposit',
  withdraw: '/api/confidential/withdraw',
  getBalance: '/api/confidential/balance',
  
  // Transfers
  transfer: '/api/confidential/transfer',
  getTransfers: '/api/confidential/transfers',
};

// ═══════════════════════════════════════════════════════════════════
// ERROR CODES
// ═══════════════════════════════════════════════════════════════════

export const ERROR_CODES = {
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  RECIPIENT_NOT_FOUND: 'RECIPIENT_NOT_FOUND',
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',
  MINT_NOT_CONFIGURED: 'MINT_NOT_CONFIGURED',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
};
