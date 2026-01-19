/**
 * Subscription System for Velo
 * 
 * Implements tiered access to privacy features:
 * - Basic: Free, basic mixing
 * - Standard: 5 SOL/month, stealth addresses
 * - Premium: 15 SOL/month, ZK proofs
 * - Maximum: 50 SOL/month, full obfuscation
 */

import {
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { getConnection, VELO_CONSTANTS, Tier } from './config';

export interface Subscription {
  tier: Tier;
  expiresAt: number;
  autoRenew: boolean;
  paymentHistory: PaymentRecord[];
}

export interface PaymentRecord {
  timestamp: number;
  tier: Tier;
  amount: number;
  signature: string;
  duration: number; // in days
}

// Treasury address (would be a PDA in production)
const TREASURY_ADDRESS = 'VELo1111111111111111111111111111111111111111';

/**
 * Calculate subscription price
 */
export function getSubscriptionPrice(tier: Tier, durationDays: number = 30): number {
  const monthlyPrice = VELO_CONSTANTS.TIER_PRICES[tier];
  return (monthlyPrice / 30) * durationDays;
}

/**
 * Create subscription payment transaction
 */
export async function createSubscriptionTransaction(
  payerKeypair: Keypair,
  tier: Tier,
  durationDays: number = 30
): Promise<{ transaction: Transaction; amount: number }> {
  const amount = getSubscriptionPrice(tier, durationDays);
  const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
  
  const transaction = new Transaction();
  
  // In production, this would call the Velo subscription program
  // For now, direct transfer to treasury
  if (lamports > 0) {
    // 90% to treasury, 10% to dev fund
    const treasuryAmount = Math.floor(lamports * 0.9);
    const devAmount = lamports - treasuryAmount;
    
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: payerKeypair.publicKey,
        toPubkey: new PublicKey(TREASURY_ADDRESS),
        lamports: treasuryAmount,
      })
    );
    
    // Dev fund would go to a different address
    // Skipped for demo
  }
  
  return { transaction, amount };
}

/**
 * Subscribe to a tier
 */
export async function subscribe(
  payerKeypair: Keypair,
  tier: Tier,
  durationDays: number = 30
): Promise<{ success: boolean; signature?: string; error?: string }> {
  if (tier === 'basic') {
    // Basic tier is free
    return { success: true };
  }
  
  const connection = getConnection();
  
  try {
    const { transaction, amount } = await createSubscriptionTransaction(
      payerKeypair,
      tier,
      durationDays
    );
    
    if (amount === 0) {
      return { success: true };
    }
    
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [payerKeypair]
    );
    
    return { success: true, signature };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Subscription failed',
    };
  }
}

/**
 * Check if subscription is active
 */
export function isSubscriptionActive(subscription: Subscription): boolean {
  return subscription.expiresAt > Date.now();
}

/**
 * Get days remaining on subscription
 */
export function getDaysRemaining(subscription: Subscription): number {
  if (!isSubscriptionActive(subscription)) return 0;
  
  const msRemaining = subscription.expiresAt - Date.now();
  return Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
}

/**
 * Get tier features
 */
export function getTierFeatures(tier: Tier): {
  name: string;
  price: number;
  features: string[];
  privacyScore: number;
} {
  const config = VELO_CONSTANTS.TIER_CONFIG[tier];
  const price = VELO_CONSTANTS.TIER_PRICES[tier];
  
  const features: string[] = [
    `${config.mixingRounds}x mixing rounds`,
  ];
  
  if (config.stealthAddresses) features.push('Stealth addresses');
  if (config.zkProofs) features.push('ZK-proof transactions');
  if (config.obfuscation) features.push('Full transaction obfuscation');
  
  // Calculate privacy score
  let privacyScore = 20; // Base
  privacyScore += config.mixingRounds * 8;
  if (config.stealthAddresses) privacyScore += 15;
  if (config.zkProofs) privacyScore += 20;
  if (config.obfuscation) privacyScore += 15;
  
  return {
    name: tier.charAt(0).toUpperCase() + tier.slice(1),
    price,
    features,
    privacyScore: Math.min(privacyScore, 100),
  };
}

/**
 * Get all tier comparisons
 */
export function getAllTiers(): Array<ReturnType<typeof getTierFeatures> & { tier: Tier }> {
  const tiers: Tier[] = ['basic', 'standard', 'premium', 'maximum'];
  return tiers.map(tier => ({
    tier,
    ...getTierFeatures(tier),
  }));
}

/**
 * Check if user can access a feature
 */
export function canAccessFeature(
  subscription: Subscription,
  feature: 'stealthAddresses' | 'zkProofs' | 'obfuscation'
): boolean {
  if (!isSubscriptionActive(subscription) && subscription.tier !== 'basic') {
    return false;
  }
  
  const config = VELO_CONSTANTS.TIER_CONFIG[subscription.tier];
  return config[feature];
}

/**
 * Get mixing rounds for tier
 */
export function getMixingRounds(tier: Tier): number {
  return VELO_CONSTANTS.TIER_CONFIG[tier].mixingRounds;
}

/**
 * Mock subscription for development
 */
export function createMockSubscription(tier: Tier): Subscription {
  return {
    tier,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
    autoRenew: false,
    paymentHistory: [],
  };
}
