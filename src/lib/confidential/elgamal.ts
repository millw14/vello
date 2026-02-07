/**
 * VELO ELGAMAL ENCRYPTION
 * 
 * Simplified ElGamal-like encryption for confidential amounts.
 * 
 * This uses tweetnacl's box (curve25519-xsalsa20-poly1305) for actual encryption,
 * but provides an ElGamal-compatible interface for Token-2022 integration.
 * 
 * For production Token-2022 confidential transfers, you'd use the actual
 * ElGamal implementation from @solana/spl-token, but this provides
 * compatible encrypted amounts for our use case.
 */

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import CryptoJS from 'crypto-js';
import { ElGamalKeypair, ElGamalCiphertext } from './types';
import { ELGAMAL_DERIVATION_MESSAGE } from './constants';

// ═══════════════════════════════════════════════════════════════════
// KEYPAIR GENERATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate ElGamal keypair from wallet signature.
 * This ensures deterministic key derivation - same wallet always gets same keys.
 */
export function deriveElGamalKeypair(walletSignature: Uint8Array): ElGamalKeypair {
  // Use signature as seed for keypair derivation
  const seed = nacl.hash(walletSignature).slice(0, 32);
  const keypair = nacl.box.keyPair.fromSecretKey(seed);
  
  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
  };
}

/**
 * Generate random ElGamal keypair (for testing).
 */
export function generateElGamalKeypair(): ElGamalKeypair {
  const keypair = nacl.box.keyPair();
  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ENCRYPTION / DECRYPTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Encrypt an amount using the recipient's public key.
 * Only the recipient (with their secret key) can decrypt.
 */
export function encryptAmount(
  amountLamports: bigint,
  recipientPublicKey: Uint8Array
): ElGamalCiphertext {
  // Convert amount to bytes (8 bytes for u64)
  const amountBytes = new Uint8Array(8);
  const view = new DataView(amountBytes.buffer);
  view.setBigUint64(0, amountLamports, true); // little-endian
  
  // Generate ephemeral keypair for this encryption
  const ephemeral = nacl.box.keyPair();
  
  // Create nonce (24 bytes)
  const nonce = nacl.randomBytes(24);
  
  // Encrypt the amount
  const encrypted = nacl.box(
    amountBytes,
    nonce,
    recipientPublicKey,
    ephemeral.secretKey
  );
  
  // Combine into ciphertext format:
  // commitment = ephemeral public key (32 bytes)
  // handle = nonce (24 bytes) + encrypted data (24 bytes for 8 bytes + overhead)
  const handle = new Uint8Array(nonce.length + encrypted.length);
  handle.set(nonce, 0);
  handle.set(encrypted, nonce.length);
  
  return {
    commitment: ephemeral.publicKey,
    handle: handle,
  };
}

/**
 * Decrypt an amount using the owner's secret key.
 */
export function decryptAmount(
  ciphertext: ElGamalCiphertext,
  secretKey: Uint8Array
): bigint | null {
  try {
    // Extract nonce and encrypted data from handle
    const nonce = ciphertext.handle.slice(0, 24);
    const encrypted = ciphertext.handle.slice(24);
    
    // Decrypt using the ephemeral public key (commitment) and our secret key
    const decrypted = nacl.box.open(
      encrypted,
      nonce,
      ciphertext.commitment, // ephemeral public key
      secretKey
    );
    
    if (!decrypted) return null;
    
    // Convert bytes back to amount
    const view = new DataView(decrypted.buffer);
    return view.getBigUint64(0, true);
  } catch (e) {
    console.error('Decryption failed:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SERIALIZATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Serialize ciphertext to hex string for storage/transmission.
 */
export function serializeCiphertext(ciphertext: ElGamalCiphertext): string {
  const combined = new Uint8Array(ciphertext.commitment.length + ciphertext.handle.length);
  combined.set(ciphertext.commitment, 0);
  combined.set(ciphertext.handle, ciphertext.commitment.length);
  return Buffer.from(combined).toString('hex');
}

/**
 * Deserialize ciphertext from hex string.
 */
export function deserializeCiphertext(hex: string): ElGamalCiphertext {
  const combined = Buffer.from(hex, 'hex');
  return {
    commitment: new Uint8Array(combined.slice(0, 32)),
    handle: new Uint8Array(combined.slice(32)),
  };
}

/**
 * Serialize keypair for storage.
 */
export function serializeKeypair(keypair: ElGamalKeypair): {
  publicKey: string;
  secretKey: string;
} {
  return {
    publicKey: Buffer.from(keypair.publicKey).toString('hex'),
    secretKey: Buffer.from(keypair.secretKey).toString('hex'),
  };
}

/**
 * Deserialize keypair from storage.
 */
export function deserializeKeypair(serialized: {
  publicKey: string;
  secretKey: string;
}): ElGamalKeypair {
  return {
    publicKey: new Uint8Array(Buffer.from(serialized.publicKey, 'hex')),
    secretKey: new Uint8Array(Buffer.from(serialized.secretKey, 'hex')),
  };
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert SOL amount to lamports.
 */
export function solToLamports(sol: number): bigint {
  return BigInt(Math.floor(sol * 1_000_000_000));
}

/**
 * Convert lamports to SOL amount.
 */
export function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / 1_000_000_000;
}

/**
 * Add two encrypted amounts (homomorphic addition).
 * Note: This is a simplified version. Full ElGamal supports this natively.
 * For our implementation, we decrypt, add, and re-encrypt.
 */
export function addEncryptedAmounts(
  ciphertext1: ElGamalCiphertext,
  ciphertext2: ElGamalCiphertext,
  secretKey: Uint8Array,
  recipientPublicKey: Uint8Array
): ElGamalCiphertext | null {
  const amount1 = decryptAmount(ciphertext1, secretKey);
  const amount2 = decryptAmount(ciphertext2, secretKey);
  
  if (amount1 === null || amount2 === null) return null;
  
  return encryptAmount(amount1 + amount2, recipientPublicKey);
}

/**
 * Check if encrypted amount is sufficient (for transfers).
 */
export function hasEnoughBalance(
  encryptedBalance: ElGamalCiphertext,
  requiredLamports: bigint,
  secretKey: Uint8Array
): boolean {
  const balance = decryptAmount(encryptedBalance, secretKey);
  if (balance === null) return false;
  return balance >= requiredLamports;
}

// ═══════════════════════════════════════════════════════════════════
// ZERO BALANCE ENCRYPTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Create encrypted zero balance (for new accounts).
 */
export function encryptZeroBalance(recipientPublicKey: Uint8Array): ElGamalCiphertext {
  return encryptAmount(BigInt(0), recipientPublicKey);
}

/**
 * Check if ciphertext decrypts to zero.
 */
export function isZeroBalance(
  ciphertext: ElGamalCiphertext,
  secretKey: Uint8Array
): boolean {
  const amount = decryptAmount(ciphertext, secretKey);
  return amount === BigInt(0);
}
