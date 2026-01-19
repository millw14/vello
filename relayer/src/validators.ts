/**
 * Request Validators
 */

import { PublicKey } from '@solana/web3.js';
import { WithdrawRequest, TransferRequest } from './types';

interface ValidationResult {
  valid: boolean;
  error?: string;
}

const VALID_POOL_DENOMINATIONS = [
  100_000_000,    // 0.1 SOL
  1_000_000_000,  // 1 SOL
  10_000_000_000, // 10 SOL
];

/**
 * Validate mixer withdrawal request
 */
export function validateWithdrawRequest(body: any): ValidationResult {
  // Check required fields
  if (!body.proof) {
    return { valid: false, error: 'Missing proof' };
  }
  if (!body.proof.a || !body.proof.b || !body.proof.c) {
    return { valid: false, error: 'Invalid proof structure' };
  }
  if (!body.root) {
    return { valid: false, error: 'Missing Merkle root' };
  }
  if (!body.nullifierHash) {
    return { valid: false, error: 'Missing nullifier hash' };
  }
  if (!body.recipient) {
    return { valid: false, error: 'Missing recipient' };
  }
  if (typeof body.fee !== 'number' || body.fee < 0) {
    return { valid: false, error: 'Invalid fee' };
  }
  if (!VALID_POOL_DENOMINATIONS.includes(body.poolDenomination)) {
    return { valid: false, error: 'Invalid pool denomination' };
  }

  // Validate recipient is valid public key
  try {
    new PublicKey(body.recipient);
  } catch {
    return { valid: false, error: 'Invalid recipient public key' };
  }

  // Validate hex strings
  if (!isValidHex(body.root, 64)) {
    return { valid: false, error: 'Invalid root format (expected 32-byte hex)' };
  }
  if (!isValidHex(body.nullifierHash, 64)) {
    return { valid: false, error: 'Invalid nullifier hash format' };
  }

  // Validate proof data
  try {
    Buffer.from(body.proof.a, 'base64');
    Buffer.from(body.proof.b, 'base64');
    Buffer.from(body.proof.c, 'base64');
  } catch {
    return { valid: false, error: 'Invalid proof encoding (expected base64)' };
  }

  return { valid: true };
}

/**
 * Validate private transfer request
 */
export function validateTransferRequest(body: any): ValidationResult {
  // Check required fields
  if (!body.proof) {
    return { valid: false, error: 'Missing proof' };
  }
  if (!body.proof.proofData || !body.proof.merkleRoot) {
    return { valid: false, error: 'Invalid proof structure' };
  }
  if (!Array.isArray(body.inputNullifiers) || body.inputNullifiers.length === 0) {
    return { valid: false, error: 'Missing input nullifiers' };
  }
  if (!Array.isArray(body.outputCommitments) || body.outputCommitments.length === 0) {
    return { valid: false, error: 'Missing output commitments' };
  }
  if (typeof body.publicAmount !== 'number') {
    return { valid: false, error: 'Missing public amount' };
  }

  // If withdrawing (negative public amount), recipient is required
  if (body.publicAmount < 0 && !body.recipient) {
    return { valid: false, error: 'Recipient required for withdrawal' };
  }

  // Validate recipient if provided
  if (body.recipient) {
    try {
      new PublicKey(body.recipient);
    } catch {
      return { valid: false, error: 'Invalid recipient public key' };
    }
  }

  // Validate nullifiers
  for (const nullifier of body.inputNullifiers) {
    if (!isValidHex(nullifier, 64)) {
      return { valid: false, error: 'Invalid nullifier format' };
    }
  }

  // Validate commitments
  for (const commitment of body.outputCommitments) {
    if (!isValidHex(commitment, 64)) {
      return { valid: false, error: 'Invalid commitment format' };
    }
  }

  return { valid: true };
}

/**
 * Check if string is valid hex of expected length
 */
function isValidHex(str: string, expectedLength: number): boolean {
  if (typeof str !== 'string') return false;
  // Remove 0x prefix if present
  const hex = str.startsWith('0x') ? str.slice(2) : str;
  if (hex.length !== expectedLength) return false;
  return /^[0-9a-fA-F]+$/.test(hex);
}
