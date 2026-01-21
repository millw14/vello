/**
 * Velo Stealth Address System v2
 * 
 * Implements EIP-5564 style stealth addresses for Solana
 * 
 * How it works:
 * 1. Recipient generates stealth meta-address (spend key + view key)
 * 2. Sender generates ephemeral keypair
 * 3. Sender computes stealth address using ECDH shared secret
 * 4. Funds go to stealth address (looks like random wallet)
 * 5. Recipient scans for payments using view key
 * 6. Recipient derives private key for stealth address
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import CryptoJS from 'crypto-js';

export interface StealthMetaAddress {
  // Spending key - used to derive stealth address private keys
  spendingPubkey: Uint8Array;
  // Viewing key - used to scan for incoming payments  
  viewingPubkey: Uint8Array;
  // Encoded format for sharing
  encoded: string;
}

export interface StealthKeypair {
  spendingKeypair: nacl.BoxKeyPair;
  viewingKeypair: nacl.BoxKeyPair;
  metaAddress: StealthMetaAddress;
}

export interface StealthPaymentInfo {
  // The stealth address where funds are sent
  stealthAddress: string;
  // Ephemeral pubkey (published for recipient to scan)
  ephemeralPubkey: string;
  // View tag (first byte of shared secret, for fast scanning)
  viewTag: number;
}

export interface ScannedPayment {
  stealthAddress: string;
  ephemeralPubkey: string;
  // The derived keypair to control this stealth address
  keypair: Keypair;
}

/**
 * Generate a new stealth meta-address
 * This is what recipients share publicly
 */
export function generateStealthMetaAddress(): StealthKeypair {
  // Generate spending keypair (for deriving stealth private keys)
  const spendingKeypair = nacl.box.keyPair();
  
  // Generate viewing keypair (for scanning payments)
  const viewingKeypair = nacl.box.keyPair();
  
  // Encode meta-address for sharing: "velo:spend_pubkey:view_pubkey"
  const encoded = `velo:${bs58.encode(spendingKeypair.publicKey)}:${bs58.encode(viewingKeypair.publicKey)}`;
  
  return {
    spendingKeypair,
    viewingKeypair,
    metaAddress: {
      spendingPubkey: spendingKeypair.publicKey,
      viewingPubkey: viewingKeypair.publicKey,
      encoded,
    },
  };
}

/**
 * Parse a stealth meta-address from encoded string
 */
export function parseStealthMetaAddress(encoded: string): StealthMetaAddress | null {
  try {
    const parts = encoded.split(':');
    if (parts.length !== 3 || parts[0] !== 'velo') {
      return null;
    }
    
    const spendingPubkey = bs58.decode(parts[1]);
    const viewingPubkey = bs58.decode(parts[2]);
    
    if (spendingPubkey.length !== 32 || viewingPubkey.length !== 32) {
      return null;
    }
    
    return {
      spendingPubkey,
      viewingPubkey,
      encoded,
    };
  } catch {
    return null;
  }
}

/**
 * Generate a stealth address for sending to a recipient
 * Returns the stealth address and ephemeral pubkey to publish
 */
export function generateStealthAddress(recipientMetaAddress: StealthMetaAddress): StealthPaymentInfo {
  // Generate ephemeral keypair (one-time use)
  const ephemeralKeypair = nacl.box.keyPair();
  
  // Compute shared secret: ECDH(ephemeral_secret, recipient_view_pubkey)
  const sharedSecret = nacl.scalarMult(
    ephemeralKeypair.secretKey.slice(0, 32),
    recipientMetaAddress.viewingPubkey
  );
  
  // Hash the shared secret to get a scalar
  const sharedSecretHash = hashToScalar(sharedSecret);
  
  // Compute stealth pubkey: spend_pubkey + hash(shared_secret) * G
  // Simplified: we derive a seed from spend_pubkey XOR shared_secret_hash
  const stealthSeed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    stealthSeed[i] = recipientMetaAddress.spendingPubkey[i] ^ sharedSecretHash[i];
  }
  
  // Generate deterministic keypair from seed
  const stealthKeypair = Keypair.fromSeed(stealthSeed);
  
  // View tag is first byte of shared secret (for fast scanning)
  const viewTag = sharedSecret[0];
  
  return {
    stealthAddress: stealthKeypair.publicKey.toBase58(),
    ephemeralPubkey: bs58.encode(ephemeralKeypair.publicKey),
    viewTag,
  };
}

/**
 * Scan for incoming stealth payments
 * Recipient uses their viewing key to check if a payment is for them
 */
export function scanForPayment(
  stealthKeypair: StealthKeypair,
  ephemeralPubkey: string,
  stealthAddress: string
): ScannedPayment | null {
  try {
    const ephemeralPubkeyBytes = bs58.decode(ephemeralPubkey);
    
    // Compute shared secret: ECDH(view_secret, ephemeral_pubkey)
    const sharedSecret = nacl.scalarMult(
      stealthKeypair.viewingKeypair.secretKey.slice(0, 32),
      ephemeralPubkeyBytes
    );
    
    // Hash the shared secret
    const sharedSecretHash = hashToScalar(sharedSecret);
    
    // Derive what the stealth address should be
    const stealthSeed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      stealthSeed[i] = stealthKeypair.spendingKeypair.publicKey[i] ^ sharedSecretHash[i];
    }
    
    const derivedKeypair = Keypair.fromSeed(stealthSeed);
    
    // Check if it matches the stealth address
    if (derivedKeypair.publicKey.toBase58() === stealthAddress) {
      return {
        stealthAddress,
        ephemeralPubkey,
        keypair: derivedKeypair,
      };
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Hash bytes to a 32-byte scalar
 */
function hashToScalar(data: Uint8Array): Uint8Array {
  const hash = CryptoJS.SHA256(
    CryptoJS.lib.WordArray.create(data as unknown as number[])
  ).toString();
  
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hash.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Store stealth keypair securely in localStorage
 */
export function saveStealthKeypair(keypair: StealthKeypair, walletAddress: string): void {
  const data = {
    spending: bs58.encode(keypair.spendingKeypair.secretKey),
    viewing: bs58.encode(keypair.viewingKeypair.secretKey),
  };
  localStorage.setItem(`velo_stealth_${walletAddress}`, JSON.stringify(data));
}

/**
 * Load stealth keypair from localStorage
 */
export function loadStealthKeypair(walletAddress: string): StealthKeypair | null {
  try {
    const stored = localStorage.getItem(`velo_stealth_${walletAddress}`);
    if (!stored) return null;
    
    const data = JSON.parse(stored);
    const spendingSecret = bs58.decode(data.spending);
    const viewingSecret = bs58.decode(data.viewing);
    
    // Reconstruct keypairs
    const spendingKeypair = nacl.box.keyPair.fromSecretKey(spendingSecret);
    const viewingKeypair = nacl.box.keyPair.fromSecretKey(viewingSecret);
    
    const encoded = `velo:${bs58.encode(spendingKeypair.publicKey)}:${bs58.encode(viewingKeypair.publicKey)}`;
    
    return {
      spendingKeypair,
      viewingKeypair,
      metaAddress: {
        spendingPubkey: spendingKeypair.publicKey,
        viewingPubkey: viewingKeypair.publicKey,
        encoded,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Store published ephemeral keys (for scanning)
 * In production, these would be stored on-chain or in a registry
 */
export function publishEphemeralKey(
  stealthAddress: string,
  ephemeralPubkey: string,
  viewTag: number,
  amount: number
): void {
  const existing = JSON.parse(localStorage.getItem('velo_stealth_registry') || '[]');
  existing.push({
    stealthAddress,
    ephemeralPubkey,
    viewTag,
    amount,
    timestamp: Date.now(),
  });
  // Keep last 1000 entries
  if (existing.length > 1000) {
    existing.splice(0, existing.length - 1000);
  }
  localStorage.setItem('velo_stealth_registry', JSON.stringify(existing));
}

/**
 * Get all published stealth payments (for scanning)
 */
export function getPublishedPayments(): Array<{
  stealthAddress: string;
  ephemeralPubkey: string;
  viewTag: number;
  amount: number;
  timestamp: number;
}> {
  return JSON.parse(localStorage.getItem('velo_stealth_registry') || '[]');
}

/**
 * Scan all published payments for ones belonging to this keypair
 */
export function scanAllPayments(stealthKeypair: StealthKeypair): ScannedPayment[] {
  const published = getPublishedPayments();
  const found: ScannedPayment[] = [];
  
  for (const payment of published) {
    // Quick view tag check first
    const ephemeralBytes = bs58.decode(payment.ephemeralPubkey);
    const sharedSecret = nacl.scalarMult(
      stealthKeypair.viewingKeypair.secretKey.slice(0, 32),
      ephemeralBytes
    );
    
    // Skip if view tag doesn't match (fast rejection)
    if (sharedSecret[0] !== payment.viewTag) {
      continue;
    }
    
    // Full scan
    const result = scanForPayment(stealthKeypair, payment.ephemeralPubkey, payment.stealthAddress);
    if (result) {
      found.push(result);
    }
  }
  
  return found;
}
