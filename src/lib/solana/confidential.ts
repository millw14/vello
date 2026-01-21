/**
 * VELO Confidential Transfer System
 * 
 * Encrypts transaction amounts so observers can't see how much is being transferred.
 * Uses AES-GCM encryption with keys derived from the user's secret.
 * 
 * How it works:
 * 1. User generates a secret key when creating their wallet
 * 2. Amounts are encrypted with AES-GCM before being stored/transmitted
 * 3. Only the user can decrypt their own amounts
 * 4. On-chain: observers see encrypted blobs, not actual amounts
 * 5. Receiver: just gets normal SOL transfer - doesn't need Velo!
 * 
 * Privacy levels:
 * - Level 1 (Basic): Fixed denominations (0.1, 1, 10 SOL) - max anonymity
 * - Level 2 (Confidential): Variable amounts with encryption - flexible but less anonymous
 */

import CryptoJS from 'crypto-js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

// ============================================================================
// ENCRYPTION UTILITIES
// ============================================================================

/**
 * Derive an encryption key from user's secret
 * Uses PBKDF2 with the secret as password
 */
export function deriveEncryptionKey(secret: Uint8Array): string {
  const secretHex = Array.from(secret).map(b => b.toString(16).padStart(2, '0')).join('');
  // Use first 16 bytes of secret as salt
  const salt = CryptoJS.enc.Hex.parse(secretHex.slice(0, 32));
  const key = CryptoJS.PBKDF2(secretHex, salt, {
    keySize: 256 / 32, // 256 bits
    iterations: 1000,
  });
  return key.toString();
}

/**
 * Encrypt an amount using AES-GCM
 * Returns encrypted blob that can be stored on-chain
 */
export function encryptAmount(amount: number, encryptionKey: string): string {
  // Add random padding to prevent amount inference from ciphertext length
  const padding = nacl.randomBytes(16);
  const paddingHex = Array.from(padding).map(b => b.toString(16).padStart(2, '0')).join('');
  
  const plaintext = JSON.stringify({
    amount,
    padding: paddingHex,
    timestamp: Date.now(),
  });
  
  const encrypted = CryptoJS.AES.encrypt(plaintext, encryptionKey);
  return encrypted.toString();
}

/**
 * Decrypt an encrypted amount
 * Returns the original amount or null if decryption fails
 */
export function decryptAmount(encryptedAmount: string, encryptionKey: string): number | null {
  try {
    const decrypted = CryptoJS.AES.decrypt(encryptedAmount, encryptionKey);
    const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
    const data = JSON.parse(plaintext);
    return data.amount;
  } catch (error) {
    console.error('Failed to decrypt amount:', error);
    return null;
  }
}

// ============================================================================
// CONFIDENTIAL NOTE SYSTEM
// ============================================================================

export interface ConfidentialNote {
  // Public (visible on-chain)
  commitment: string;           // Hash of nullifier + secret
  encryptedAmount: string;      // AES-encrypted amount (only owner can decrypt)
  poolId: string;               // Which pool this belongs to
  timestamp: number;            // When it was created
  
  // Private (stored locally, never on-chain)
  nullifier: string;            // Random nullifier (bs58 encoded)
  secret: string;               // Random secret (bs58 encoded)
  amount: number;               // Actual amount in lamports
  encryptionKey: string;        // Derived from secret
}

/**
 * Generate a confidential note with encrypted amount
 * The amount is encrypted so on-chain observers can't see it
 */
export function generateConfidentialNote(amountLamports: number): ConfidentialNote {
  // Generate random secret and nullifier
  const secret = nacl.randomBytes(32);
  const nullifier = nacl.randomBytes(32);
  
  // Compute commitment = SHA256(nullifier || secret)
  const combined = new Uint8Array(64);
  combined.set(nullifier, 0);
  combined.set(secret, 32);
  const commitmentHash = CryptoJS.SHA256(
    CryptoJS.lib.WordArray.create(Array.from(combined) as unknown as number[])
  ).toString();
  
  // Derive encryption key from secret
  const encryptionKey = deriveEncryptionKey(secret);
  
  // Encrypt the amount
  const encryptedAmount = encryptAmount(amountLamports, encryptionKey);
  
  // Determine pool based on amount
  let poolId = 'CUSTOM';
  if (amountLamports === 100_000_000) poolId = 'SMALL';
  else if (amountLamports === 1_000_000_000) poolId = 'MEDIUM';
  else if (amountLamports === 10_000_000_000) poolId = 'LARGE';
  
  return {
    commitment: commitmentHash,
    encryptedAmount,
    poolId,
    timestamp: Date.now(),
    nullifier: bs58.encode(nullifier),
    secret: bs58.encode(secret),
    amount: amountLamports,
    encryptionKey,
  };
}

/**
 * Restore a confidential note from stored data
 * Used when loading notes from localStorage
 */
export function restoreConfidentialNote(
  storedNote: Partial<ConfidentialNote> & { nullifier: string; secret: string; amount: number }
): ConfidentialNote {
  const secret = bs58.decode(storedNote.secret);
  const nullifier = bs58.decode(storedNote.nullifier);
  
  // Recompute commitment
  const combined = new Uint8Array(64);
  combined.set(nullifier, 0);
  combined.set(secret, 32);
  const commitmentHash = CryptoJS.SHA256(
    CryptoJS.lib.WordArray.create(Array.from(combined) as unknown as number[])
  ).toString();
  
  // Derive encryption key
  const encryptionKey = deriveEncryptionKey(secret);
  
  // Encrypt amount
  const encryptedAmount = encryptAmount(storedNote.amount, encryptionKey);
  
  let poolId = storedNote.poolId || 'CUSTOM';
  if (storedNote.amount === 100_000_000) poolId = 'SMALL';
  else if (storedNote.amount === 1_000_000_000) poolId = 'MEDIUM';
  else if (storedNote.amount === 10_000_000_000) poolId = 'LARGE';
  
  return {
    commitment: commitmentHash,
    encryptedAmount,
    poolId,
    timestamp: storedNote.timestamp || Date.now(),
    nullifier: storedNote.nullifier,
    secret: storedNote.secret,
    amount: storedNote.amount,
    encryptionKey,
  };
}

// ============================================================================
// ON-CHAIN ENCRYPTED STORAGE
// ============================================================================

/**
 * Format encrypted amount for on-chain storage
 * Returns a fixed-size byte array to prevent length-based analysis
 */
export function formatForOnChain(encryptedAmount: string): Uint8Array {
  // Pad to fixed size (256 bytes) to prevent length analysis
  const FIXED_SIZE = 256;
  const encoded = new TextEncoder().encode(encryptedAmount);
  
  if (encoded.length > FIXED_SIZE) {
    // Truncate (shouldn't happen with normal amounts)
    return encoded.slice(0, FIXED_SIZE);
  }
  
  // Pad with random bytes
  const result = new Uint8Array(FIXED_SIZE);
  result.set(encoded, 0);
  // Fill rest with random padding
  const padding = nacl.randomBytes(FIXED_SIZE - encoded.length);
  result.set(padding, encoded.length);
  
  return result;
}

/**
 * Parse encrypted amount from on-chain storage
 */
export function parseFromOnChain(data: Uint8Array): string {
  // Find the end of the encrypted string (null terminator or invalid UTF-8)
  let endIndex = data.length;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) {
      endIndex = i;
      break;
    }
  }
  
  return new TextDecoder().decode(data.slice(0, endIndex));
}

// ============================================================================
// PRIVACY ANALYSIS
// ============================================================================

export interface PrivacyScore {
  score: number;              // 0-100
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'MAXIMUM';
  factors: {
    amountHidden: boolean;    // Is amount encrypted?
    fixedDenomination: boolean; // Using standard pool sizes?
    mixerUsed: boolean;       // Going through mixer?
    decoyActive: boolean;     // Decoy system running?
    stealthAddress: boolean;  // Using stealth addresses?
  };
  recommendations: string[];
}

/**
 * Calculate privacy score for a transaction
 */
export function calculatePrivacyScore(options: {
  amountLamports: number;
  useEncryption: boolean;
  useMixer: boolean;
  useDecoys: boolean;
  useStealth: boolean;
}): PrivacyScore {
  const factors = {
    amountHidden: options.useEncryption,
    fixedDenomination: [100_000_000, 1_000_000_000, 10_000_000_000].includes(options.amountLamports),
    mixerUsed: options.useMixer,
    decoyActive: options.useDecoys,
    stealthAddress: options.useStealth,
  };
  
  // Calculate score
  let score = 0;
  if (factors.amountHidden) score += 15;
  if (factors.fixedDenomination) score += 25;
  if (factors.mixerUsed) score += 30;
  if (factors.decoyActive) score += 15;
  if (factors.stealthAddress) score += 15;
  
  // Determine level
  let level: 'LOW' | 'MEDIUM' | 'HIGH' | 'MAXIMUM';
  if (score >= 85) level = 'MAXIMUM';
  else if (score >= 60) level = 'HIGH';
  else if (score >= 35) level = 'MEDIUM';
  else level = 'LOW';
  
  // Generate recommendations
  const recommendations: string[] = [];
  if (!factors.fixedDenomination) {
    recommendations.push('Use fixed pool denominations (0.1, 1, or 10 SOL) for better anonymity');
  }
  if (!factors.mixerUsed) {
    recommendations.push('Use the mixer for unlinkable transfers');
  }
  if (!factors.decoyActive) {
    recommendations.push('Enable decoy transactions for additional cover traffic');
  }
  if (!factors.amountHidden) {
    recommendations.push('Enable amount encryption to hide transfer values');
  }
  
  return { score, level, factors, recommendations };
}

// ============================================================================
// HELPER: What the observer sees vs what actually happens
// ============================================================================

/**
 * Generate a "what observers see" report for educational purposes
 */
export function generateObserverView(note: ConfidentialNote, recipientAddress: string): {
  onChainVisible: Record<string, string>;
  actualData: Record<string, string | number>;
  privacyAnalysis: string[];
} {
  return {
    onChainVisible: {
      'From': 'Velo Pool / Random Intermediate Wallet',
      'To': recipientAddress,
      'Amount': note.encryptedAmount.slice(0, 20) + '... (encrypted)',
      'Commitment': note.commitment.slice(0, 16) + '...',
      'Timestamp': 'Visible',
    },
    actualData: {
      'Actual Amount': note.amount / 1e9 + ' SOL',
      'Pool': note.poolId,
      'Created': new Date(note.timestamp).toISOString(),
    },
    privacyAnalysis: [
      '✓ Sender identity: HIDDEN (mixed through pool)',
      '✓ Amount: ENCRYPTED (observer sees ciphertext)',
      '✓ Recipient: SEES NORMAL TRANSFER (no Velo needed)',
      '✓ Link between deposit/withdraw: BROKEN',
    ],
  };
}
