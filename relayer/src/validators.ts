/**
 * Request validation utilities
 */

import { PublicKey } from '@solana/web3.js';
import { RelayerWithdrawRequest, StealthTransferRequest, PoolSize, POOL_LAMPORTS } from './types';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a withdrawal request
 */
export function validateWithdrawRequest(body: any): ValidationResult {
  if (!body) {
    return { valid: false, error: 'Request body is empty' };
  }

  // Check note data
  if (!body.noteCommitment || typeof body.noteCommitment !== 'string') {
    return { valid: false, error: 'Missing or invalid noteCommitment' };
  }
  
  if (!body.nullifier || typeof body.nullifier !== 'string') {
    return { valid: false, error: 'Missing or invalid nullifier' };
  }
  
  if (!body.secret || typeof body.secret !== 'string') {
    return { valid: false, error: 'Missing or invalid secret' };
  }

  // Validate commitment format (64 char hex)
  if (!/^[a-fA-F0-9]{64}$/.test(body.noteCommitment)) {
    return { valid: false, error: 'Invalid commitment format (expected 64 char hex)' };
  }

  // Check recipient
  if (!body.recipient) {
    return { valid: false, error: 'Missing recipient' };
  }
  
  try {
    new PublicKey(body.recipient);
  } catch {
    return { valid: false, error: 'Invalid recipient address' };
  }

  // Check pool size
  if (!body.poolSize || !POOL_LAMPORTS[body.poolSize as PoolSize]) {
    return { valid: false, error: 'Invalid pool size. Use: SMALL, MEDIUM, or LARGE' };
  }

  return { valid: true };
}

/**
 * Validate a stealth transfer request
 */
export function validateStealthRequest(body: any): ValidationResult {
  if (!body) {
    return { valid: false, error: 'Request body is empty' };
  }

  // Check note data
  if (!body.noteCommitment || typeof body.noteCommitment !== 'string') {
    return { valid: false, error: 'Missing or invalid noteCommitment' };
  }
  
  if (!body.nullifier || typeof body.nullifier !== 'string') {
    return { valid: false, error: 'Missing or invalid nullifier' };
  }
  
  if (!body.secret || typeof body.secret !== 'string') {
    return { valid: false, error: 'Missing or invalid secret' };
  }

  // Check stealth meta address
  if (!body.recipientStealthMeta) {
    return { valid: false, error: 'Missing recipientStealthMeta' };
  }
  
  try {
    new PublicKey(body.recipientStealthMeta);
  } catch {
    return { valid: false, error: 'Invalid recipientStealthMeta address' };
  }

  // Check pool size
  if (!body.poolSize || !POOL_LAMPORTS[body.poolSize as PoolSize]) {
    return { valid: false, error: 'Invalid pool size. Use: SMALL, MEDIUM, or LARGE' };
  }

  return { valid: true };
}

/**
 * Validate a transfer request (legacy)
 */
export function validateTransferRequest(body: any): ValidationResult {
  return { valid: true }; // Deprecated
}
