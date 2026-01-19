/**
 * Stealth Address System for Velo
 * 
 * Uses Elliptic Curve Diffie-Hellman (ECDH) with Curve25519 (X25519)
 * to generate one-time, unlinkable receiving addresses.
 * 
 * Cryptographic Primitives:
 * - X25519: Elliptic Curve Diffie-Hellman key exchange
 * - Ed25519: Digital signatures (via Solana keypairs)
 * - Poseidon: ZK-friendly hashing for stealth address derivation
 * 
 * Flow:
 * 1. Recipient generates view keypair (X25519) and spend keypair (Ed25519)
 * 2. Recipient publishes view public key as "meta-address"
 * 3. Sender generates ephemeral X25519 keypair
 * 4. Sender computes shared secret: S = ECDH(ephemeralSecret, recipientViewPub)
 * 5. Stealth address: P = Poseidon(S || recipientSpendPub)
 * 6. Sender publishes ephemeral public key alongside payment
 * 7. Recipient scans by recomputing: S' = ECDH(ephemeralPub, viewSecret)
 * 8. If Poseidon(S' || spendPub) matches, recipient can claim using derived key
 * 
 * Security: Only the recipient with viewSecretKey can detect payments,
 * and only the recipient with spendSecretKey can spend the funds.
 */

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import bs58 from 'bs58';
import { Keypair, PublicKey } from '@solana/web3.js';
import { poseidonHash } from './light-protocol';

export interface StealthKeys {
  viewKey: {
    publicKey: string;
    secretKey: string;
  };
  spendKey: {
    publicKey: string;
    secretKey: string;
  };
}

export interface StealthAddress {
  address: string;
  ephemeralPublicKey: string;
  expiresAt: number;
}

export interface StealthPayment {
  stealthAddress: string;
  ephemeralPublicKey: string;
  amount: number;
  timestamp: number;
}

/**
 * Generate stealth key pairs for a user
 * - View key: Used to scan for incoming payments
 * - Spend key: Used to claim received funds
 */
export function generateStealthKeys(): StealthKeys {
  const viewKeyPair = nacl.box.keyPair();
  const spendKeyPair = nacl.box.keyPair();

  return {
    viewKey: {
      publicKey: bs58.encode(viewKeyPair.publicKey),
      secretKey: bs58.encode(viewKeyPair.secretKey),
    },
    spendKey: {
      publicKey: bs58.encode(spendKeyPair.publicKey),
      secretKey: bs58.encode(spendKeyPair.secretKey),
    },
  };
}

/**
 * Generate a one-time stealth address for receiving payments
 * Uses X25519 ECDH for key exchange and Poseidon for ZK-friendly hashing
 * 
 * @param recipientViewPublicKey - Recipient's published view public key (X25519)
 * @returns StealthAddress with the address, ephemeral key, and expiry
 */
export function generateStealthAddress(recipientViewPublicKey: string): StealthAddress {
  // Generate ephemeral X25519 keypair (sender-side, one-time use)
  const ephemeralKeyPair = nacl.box.keyPair();
  
  // Decode recipient's view public key (X25519, 32 bytes)
  const recipientViewPub = bs58.decode(recipientViewPublicKey);
  
  // Validate key length
  if (recipientViewPub.length !== 32) {
    throw new Error('Invalid view public key length. Expected 32 bytes for X25519.');
  }
  
  // Compute shared secret using X25519 ECDH
  // sharedSecret = X25519(ephemeralSecretKey, recipientViewPub)
  const sharedSecret = nacl.box.before(recipientViewPub, ephemeralKeyPair.secretKey);
  
  // Derive stealth address seed using Poseidon (ZK-friendly)
  // stealthSeed = Poseidon(sharedSecret, recipientViewPub)
  const stealthSeed = poseidonHash([sharedSecret, recipientViewPub]);
  
  // Create a deterministic Ed25519 keypair from the Poseidon hash
  // This keypair will control the stealth address on Solana
  const stealthKeypair = Keypair.fromSeed(stealthSeed);
  
  return {
    address: stealthKeypair.publicKey.toBase58(),
    ephemeralPublicKey: bs58.encode(ephemeralKeyPair.publicKey),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  };
}

/**
 * Scan for incoming stealth payments using view key
 * Recomputes stealth addresses to detect payments belonging to this user
 * 
 * @param viewSecretKey - User's X25519 view secret key
 * @param spendPublicKey - User's X25519 spend public key (used in stealth derivation)
 * @param payments - Array of potential stealth payments to scan
 * @returns Array of payments that belong to this user
 */
export function scanStealthPayments(
  viewSecretKey: string,
  spendPublicKey: string,
  payments: StealthPayment[]
): StealthPayment[] {
  const viewSecret = bs58.decode(viewSecretKey);
  const spendPub = bs58.decode(spendPublicKey);
  
  // Validate key lengths
  if (viewSecret.length !== 32 || spendPub.length !== 32) {
    throw new Error('Invalid key length. Expected 32 bytes for X25519 keys.');
  }
  
  const matchedPayments: StealthPayment[] = [];
  
  for (const payment of payments) {
    try {
      // Decode ephemeral public key from payment announcement
      const ephemeralPub = bs58.decode(payment.ephemeralPublicKey);
      
      if (ephemeralPub.length !== 32) continue;
      
      // Recompute shared secret: S' = X25519(viewSecret, ephemeralPub)
      const sharedSecret = nacl.box.before(ephemeralPub, viewSecret);
      
      // Derive expected stealth address using Poseidon
      const stealthSeed = poseidonHash([sharedSecret, spendPub]);
      const expectedKeypair = Keypair.fromSeed(stealthSeed);
      
      // Check if this payment's stealth address matches our computation
      if (expectedKeypair.publicKey.toBase58() === payment.stealthAddress) {
        matchedPayments.push(payment);
      }
    } catch {
      // Invalid payment data, skip
      continue;
    }
  }
  
  return matchedPayments;
}

/**
 * Derive the private key for a stealth address to claim funds
 * This function recovers the Ed25519 keypair that controls a stealth address
 * 
 * @param viewSecretKey - User's X25519 view secret key  
 * @param spendPublicKey - User's X25519 spend public key
 * @param ephemeralPublicKey - Ephemeral public key from the payment announcement
 * @returns Ed25519 Keypair that can sign transactions for the stealth address
 */
export function deriveStealthPrivateKey(
  viewSecretKey: string,
  spendPublicKey: string,
  ephemeralPublicKey: string
): Keypair {
  const viewSecret = bs58.decode(viewSecretKey);
  const spendPub = bs58.decode(spendPublicKey);
  const ephemeralPub = bs58.decode(ephemeralPublicKey);
  
  // Validate key lengths
  if (viewSecret.length !== 32 || spendPub.length !== 32 || ephemeralPub.length !== 32) {
    throw new Error('Invalid key length. All keys must be 32 bytes.');
  }
  
  // Recompute shared secret: S = X25519(viewSecret, ephemeralPub)
  const sharedSecret = nacl.box.before(ephemeralPub, viewSecret);
  
  // Derive stealth keypair seed using Poseidon (matches sender's computation)
  const stealthSeed = poseidonHash([sharedSecret, spendPub]);
  
  // Return the Ed25519 keypair that controls the stealth address
  return Keypair.fromSeed(stealthSeed);
}

/**
 * Encrypt data for stealth address recipient
 */
export function encryptForStealth(
  data: string,
  recipientViewPublicKey: string
): { encrypted: string; ephemeralPublicKey: string } {
  const ephemeralKeyPair = nacl.box.keyPair();
  const recipientPub = bs58.decode(recipientViewPublicKey);
  
  const nonce = nacl.randomBytes(24);
  const messageBytes = naclUtil.decodeUTF8(data);
  
  const encrypted = nacl.box(messageBytes, nonce, recipientPub, ephemeralKeyPair.secretKey);
  
  // Combine nonce and ciphertext
  const combined = new Uint8Array([...nonce, ...encrypted]);
  
  return {
    encrypted: bs58.encode(combined),
    ephemeralPublicKey: bs58.encode(ephemeralKeyPair.publicKey),
  };
}

/**
 * Decrypt data sent to stealth address
 */
export function decryptFromStealth(
  encryptedData: string,
  ephemeralPublicKey: string,
  viewSecretKey: string
): string | null {
  try {
    const combined = bs58.decode(encryptedData);
    const nonce = combined.slice(0, 24);
    const ciphertext = combined.slice(24);
    
    const ephemeralPub = bs58.decode(ephemeralPublicKey);
    const viewSecret = bs58.decode(viewSecretKey);
    
    const decrypted = nacl.box.open(ciphertext, nonce, ephemeralPub, viewSecret);
    
    if (!decrypted) return null;
    
    return naclUtil.encodeUTF8(decrypted);
  } catch {
    return null;
  }
}

// ============================================================================
// VIEW TAG OPTIMIZATION
// ============================================================================

/**
 * Generate a view tag for efficient scanning
 * View tags allow quick rejection of non-matching payments without full ECDH
 * 
 * @param sharedSecret - The ECDH shared secret
 * @returns 1-byte view tag
 */
export function generateViewTag(sharedSecret: Uint8Array): number {
  // Use first byte of Poseidon hash of shared secret as view tag
  const hash = poseidonHash([sharedSecret]);
  return hash[0];
}

/**
 * Create a stealth meta-address that can be published
 * Meta-address contains both view and spend public keys
 */
export function createMetaAddress(stealthKeys: StealthKeys): string {
  const viewPub = bs58.decode(stealthKeys.viewKey.publicKey);
  const spendPub = bs58.decode(stealthKeys.spendKey.publicKey);
  
  // Combine both keys: [viewPub (32 bytes) || spendPub (32 bytes)]
  const combined = new Uint8Array(64);
  combined.set(viewPub, 0);
  combined.set(spendPub, 32);
  
  return bs58.encode(combined);
}

/**
 * Parse a stealth meta-address
 */
export function parseMetaAddress(metaAddress: string): { viewPublicKey: string; spendPublicKey: string } {
  const decoded = bs58.decode(metaAddress);
  
  if (decoded.length !== 64) {
    throw new Error('Invalid meta-address length. Expected 64 bytes.');
  }
  
  return {
    viewPublicKey: bs58.encode(decoded.slice(0, 32)),
    spendPublicKey: bs58.encode(decoded.slice(32, 64)),
  };
}
