/**
 * VELO CONFIDENTIAL TRANSFER SYSTEM
 * 
 * Token-2022 Confidential Transfers with encrypted amounts.
 * 
 * Architecture:
 * - Each user gets a confidential token account (cSOL)
 * - Balances are encrypted with ElGamal encryption
 * - Transfers use ZK proofs to verify validity without revealing amounts
 * - Only account owners can decrypt their balances
 */

export * from './types';
export * from './elgamal';
export * from './account-service';
export * from './transfer-service';
export * from './constants';
