/**
 * Velo Program Client SDK
 * 
 * TypeScript clients for interacting with Velo on-chain programs
 */

import { Connection, PublicKey, Transaction, Keypair } from '@solana/web3.js';
import { getConnection } from '../config';

// Program IDs (update after deployment)
export const PROGRAM_IDS = {
  mixer: new PublicKey('VeLoMix1111111111111111111111111111111111111'),
  privateTx: new PublicKey('VeLoPTx1111111111111111111111111111111111111'),
  subscription: new PublicKey('VeLoSub1111111111111111111111111111111111111'),
  stealth: new PublicKey('VeLoStH1111111111111111111111111111111111111'),
};

// Pool denominations
export const POOL_DENOMINATIONS = {
  SMALL: 0.1,   // 0.1 SOL
  MEDIUM: 1.0,  // 1 SOL
  LARGE: 10.0,  // 10 SOL
} as const;

export type PoolDenomination = keyof typeof POOL_DENOMINATIONS;

// Subscription tiers
export const SUBSCRIPTION_TIERS = {
  Basic: 0,
  Standard: 1,
  Premium: 2,
  Maximum: 3,
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;

// ============================================================================
// MIXER CLIENT
// ============================================================================

export interface MixerDepositResult {
  success: boolean;
  commitment?: string;
  leafIndex?: number;
  signature?: string;
  error?: string;
}

export interface MixerWithdrawResult {
  success: boolean;
  signature?: string;
  error?: string;
}

export interface MixerNote {
  commitment: string;
  nullifier: string;
  secret: string;
  poolDenomination: PoolDenomination;
  leafIndex: number;
  timestamp: number;
}

/**
 * Generate a mixer deposit commitment
 */
export function generateMixerCommitment(): { commitment: Uint8Array; nullifier: Uint8Array; secret: Uint8Array } {
  const nullifier = crypto.getRandomValues(new Uint8Array(32));
  const secret = crypto.getRandomValues(new Uint8Array(32));
  
  // commitment = hash(nullifier || secret)
  const combined = new Uint8Array(64);
  combined.set(nullifier, 0);
  combined.set(secret, 32);
  
  // Use simple hash for now (in production, use Poseidon)
  const commitment = simpleHash(combined);
  
  return { commitment, nullifier, secret };
}

/**
 * Generate nullifier hash for withdrawal
 */
export function generateNullifierHash(nullifier: Uint8Array): Uint8Array {
  return simpleHash(nullifier);
}

/**
 * Simple hash function (placeholder for Poseidon)
 */
function simpleHash(data: Uint8Array): Uint8Array {
  const hash = new Uint8Array(32);
  for (let i = 0; i < data.length; i++) {
    hash[i % 32] ^= data[i];
  }
  // Add some mixing
  for (let i = 0; i < 32; i++) {
    hash[i] = (hash[i] + hash[(i + 1) % 32] * 31) & 0xff;
  }
  return hash;
}

// ============================================================================
// SUBSCRIPTION CLIENT
// ============================================================================

export interface SubscriptionInfo {
  tier: SubscriptionTier;
  expiry: number;
  totalPaid: number;
  features: TierFeatures;
}

export interface TierFeatures {
  mixingRounds: number;
  stealthAddresses: boolean;
  zkProofs: boolean;
  fullObfuscation: boolean;
  maxTxPerDay: number;
  privacyScore: number;
}

export const TIER_FEATURES: Record<SubscriptionTier, TierFeatures> = {
  Basic: {
    mixingRounds: 1,
    stealthAddresses: false,
    zkProofs: false,
    fullObfuscation: false,
    maxTxPerDay: 5,
    privacyScore: 40,
  },
  Standard: {
    mixingRounds: 3,
    stealthAddresses: true,
    zkProofs: false,
    fullObfuscation: false,
    maxTxPerDay: 20,
    privacyScore: 60,
  },
  Premium: {
    mixingRounds: 5,
    stealthAddresses: true,
    zkProofs: true,
    fullObfuscation: false,
    maxTxPerDay: 100,
    privacyScore: 80,
  },
  Maximum: {
    mixingRounds: 8,
    stealthAddresses: true,
    zkProofs: true,
    fullObfuscation: true,
    maxTxPerDay: Infinity,
    privacyScore: 100,
  },
};

export const TIER_PRICES: Record<SubscriptionTier, number> = {
  Basic: 0,
  Standard: 5,
  Premium: 15,
  Maximum: 50,
};

/**
 * Derive subscription PDA for a user
 */
export function getSubscriptionPDA(userPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('subscription'), userPubkey.toBuffer()],
    PROGRAM_IDS.subscription
  );
}

// ============================================================================
// STEALTH CLIENT
// ============================================================================

export interface StealthMetaAddress {
  spendPublicKey: Uint8Array;
  viewPublicKey: Uint8Array;
}

export interface StealthPayment {
  stealthAddress: string;
  ephemeralPublicKey: string;
  encryptedViewTag: string;
  amount: number;
}

/**
 * Generate stealth meta-address keys
 */
export function generateStealthMetaAddress(): {
  spendKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  viewKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
} {
  // In production, use proper ed25519/curve25519 key generation
  const spendKeypair = {
    publicKey: crypto.getRandomValues(new Uint8Array(32)),
    secretKey: crypto.getRandomValues(new Uint8Array(32)),
  };
  const viewKeypair = {
    publicKey: crypto.getRandomValues(new Uint8Array(32)),
    secretKey: crypto.getRandomValues(new Uint8Array(32)),
  };
  
  return { spendKeypair, viewKeypair };
}

/**
 * Derive stealth meta PDA for a user
 */
export function getStealthMetaPDA(userPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('stealth_meta'), userPubkey.toBuffer()],
    PROGRAM_IDS.stealth
  );
}

// ============================================================================
// RELAYER CLIENT
// ============================================================================

export interface RelayerInfo {
  address: string;
  feePercent: number;
  minFee: number;
  maxFee: number;
  isOnline: boolean;
}

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL || 'http://localhost:3001';

/**
 * Get relayer info
 */
export async function getRelayerInfo(): Promise<RelayerInfo | null> {
  try {
    const response = await fetch(`${RELAYER_URL}/info`);
    if (!response.ok) return null;
    
    const data = await response.json();
    return {
      address: data.relayerAddress,
      feePercent: data.feePercent,
      minFee: data.minFee,
      maxFee: data.maxFee,
      isOnline: true,
    };
  } catch {
    return null;
  }
}

/**
 * Estimate relayer fee
 */
export async function estimateRelayerFee(amount: number, type: string): Promise<number | null> {
  try {
    const response = await fetch(`${RELAYER_URL}/estimate-fee`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, type }),
    });
    if (!response.ok) return null;
    
    const data = await response.json();
    return data.estimatedFee;
  } catch {
    return null;
  }
}

/**
 * Submit withdrawal through relayer
 */
export async function relayWithdrawal(
  proof: { a: string; b: string; c: string },
  root: string,
  nullifierHash: string,
  recipient: string,
  fee: number,
  poolDenomination: number
): Promise<{ success: boolean; signature?: string; error?: string }> {
  try {
    const response = await fetch(`${RELAYER_URL}/relay/mixer/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof,
        root,
        nullifierHash,
        recipient,
        fee,
        poolDenomination,
      }),
    });
    
    return await response.json();
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// UTILS
// ============================================================================

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert bytes to base64
 */
export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Convert base64 to bytes
 */
export function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(atob(base64).split('').map(c => c.charCodeAt(0)));
}
