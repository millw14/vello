/**
 * Stealth Address System for Velo
 * 
 * Uses Elliptic Curve Diffie-Hellman (ECDH) to generate one-time,
 * unlinkable receiving addresses.
 * 
 * Flow:
 * 1. Recipient generates a view keypair and publishes the public key
 * 2. Sender generates ephemeral keypair
 * 3. Sender computes shared secret using ECDH
 * 4. Stealth address = hash(sharedSecret || recipientViewPub)
 * 5. Only recipient can scan and detect payments using their view key
 */

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import bs58 from 'bs58';
import { Keypair, PublicKey } from '@solana/web3.js';
import CryptoJS from 'crypto-js';

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
 * @param recipientViewPublicKey - Recipient's published view public key
 * @returns StealthAddress with the address, ephemeral key, and expiry
 */
export function generateStealthAddress(recipientViewPublicKey: string): StealthAddress {
  // Generate ephemeral keypair (sender-side, one-time use)
  const ephemeralKeyPair = nacl.box.keyPair();
  
  // Decode recipient's view public key
  const recipientViewPub = bs58.decode(recipientViewPublicKey);
  
  // Compute shared secret using ECDH
  // sharedSecret = ECDH(ephemeralSecret, recipientViewPub)
  const sharedSecret = nacl.box.before(recipientViewPub, ephemeralKeyPair.secretKey);
  
  // Derive stealth address from shared secret
  // stealthAddress = Hash(sharedSecret || recipientViewPub)
  const combined = new Uint8Array([...sharedSecret, ...recipientViewPub]);
  const hash = CryptoJS.SHA256(CryptoJS.lib.WordArray.create(combined as unknown as number[]));
  const hashBytes = hexToBytes(hash.toString());
  
  // Create a deterministic keypair from the hash (for Solana address)
  const stealthKeypair = Keypair.fromSeed(hashBytes.slice(0, 32));
  
  return {
    address: stealthKeypair.publicKey.toBase58(),
    ephemeralPublicKey: bs58.encode(ephemeralKeyPair.publicKey),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  };
}

/**
 * Scan for incoming stealth payments
 * @param viewSecretKey - User's view secret key
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
  
  const matchedPayments: StealthPayment[] = [];
  
  for (const payment of payments) {
    try {
      // Decode ephemeral public key from payment
      const ephemeralPub = bs58.decode(payment.ephemeralPublicKey);
      
      // Compute shared secret
      const sharedSecret = nacl.box.before(ephemeralPub, viewSecret);
      
      // Derive expected stealth address
      const combined = new Uint8Array([...sharedSecret, ...spendPub]);
      const hash = CryptoJS.SHA256(CryptoJS.lib.WordArray.create(combined as unknown as number[]));
      const hashBytes = hexToBytes(hash.toString());
      const expectedKeypair = Keypair.fromSeed(hashBytes.slice(0, 32));
      
      // Check if this payment matches
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
 * @param viewSecretKey - User's view secret key  
 * @param ephemeralPublicKey - Ephemeral public key from the payment
 * @returns Keypair that can sign transactions for the stealth address
 */
export function deriveStealthPrivateKey(
  viewSecretKey: string,
  spendPublicKey: string,
  ephemeralPublicKey: string
): Keypair {
  const viewSecret = bs58.decode(viewSecretKey);
  const spendPub = bs58.decode(spendPublicKey);
  const ephemeralPub = bs58.decode(ephemeralPublicKey);
  
  // Compute shared secret
  const sharedSecret = nacl.box.before(ephemeralPub, viewSecret);
  
  // Derive stealth keypair
  const combined = new Uint8Array([...sharedSecret, ...spendPub]);
  const hash = CryptoJS.SHA256(CryptoJS.lib.WordArray.create(combined as unknown as number[]));
  const hashBytes = hexToBytes(hash.toString());
  
  return Keypair.fromSeed(hashBytes.slice(0, 32));
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

// Helper function
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}
