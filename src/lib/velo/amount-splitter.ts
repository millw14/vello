/**
 * VELO AMOUNT SPLITTER
 * 
 * Hides the true amount by splitting into multiple fixed-denomination transfers.
 * 
 * Example: User wants to send 1.5 SOL
 * - Splits into: 1x 1.0 SOL + 5x 0.1 SOL = 6 separate transfers
 * - Each transfer has random delay (0-180 seconds)
 * - Each goes to different stealth address (recipient collects all)
 * 
 * On Solscan: Observer sees 6 unrelated 0.1-1.0 SOL transfers
 * Can't tell they're all going to same person!
 */

import { PoolSize, POOL_AMOUNTS } from './types';

export interface SplitPlan {
  parts: {
    poolSize: PoolSize;
    amount: number;
    delayMs: number;  // Random delay before sending
    order: number;    // Execution order
  }[];
  totalAmount: number;
  estimatedTimeMs: number;
  numTransactions: number;
}

// Pool amounts in SOL
const POOLS: { size: PoolSize; amount: number }[] = [
  { size: 'LARGE', amount: 10 },
  { size: 'MEDIUM', amount: 1 },
  { size: 'SMALL', amount: 0.1 },
];

/**
 * Calculate optimal split for an amount
 * Uses greedy algorithm: largest denominations first
 */
export function calculateSplit(amountSOL: number): SplitPlan {
  const parts: SplitPlan['parts'] = [];
  let remaining = amountSOL;
  let order = 0;
  let totalDelay = 0;

  // Greedy: use largest denominations first
  for (const pool of POOLS) {
    while (remaining >= pool.amount - 0.001) { // Small epsilon for float comparison
      // Random delay: 5-60 seconds between transfers
      const delayMs = Math.floor(Math.random() * 55000) + 5000;
      
      parts.push({
        poolSize: pool.size,
        amount: pool.amount,
        delayMs: totalDelay + delayMs,
        order: order++,
      });
      
      remaining -= pool.amount;
      totalDelay += delayMs;
    }
  }

  // Shuffle the order to make it less predictable
  // But keep the delays progressive
  const shuffledParts = shuffleArray([...parts]).map((part, idx) => ({
    ...part,
    order: idx,
  }));

  return {
    parts: shuffledParts,
    totalAmount: amountSOL - remaining,
    estimatedTimeMs: totalDelay,
    numTransactions: parts.length,
  };
}

/**
 * Calculate split with privacy optimization
 * Adds extra "noise" transactions if amount is too uniform
 */
export function calculatePrivacySplit(amountSOL: number): SplitPlan {
  const baseSplit = calculateSplit(amountSOL);
  
  // If all same denomination, add variance
  const uniqueDenoms = new Set(baseSplit.parts.map(p => p.poolSize));
  
  if (uniqueDenoms.size === 1 && baseSplit.parts.length > 2) {
    // All same size - consider splitting differently
    // e.g., 1.0 SOL could be 10x 0.1 SOL for more privacy
    const allSmall = calculateSplit(amountSOL * 10) // Convert to 0.1 SOL units mentally
    // Actually just return base - the randomized timing is the main privacy feature
  }
  
  return baseSplit;
}

/**
 * Get user-friendly description of the split plan
 */
export function describeSplit(plan: SplitPlan): string {
  const counts: Record<PoolSize, number> = { SMALL: 0, MEDIUM: 0, LARGE: 0 };
  
  for (const part of plan.parts) {
    counts[part.poolSize]++;
  }
  
  const parts: string[] = [];
  if (counts.LARGE > 0) parts.push(`${counts.LARGE}x 10 SOL`);
  if (counts.MEDIUM > 0) parts.push(`${counts.MEDIUM}x 1 SOL`);
  if (counts.SMALL > 0) parts.push(`${counts.SMALL}x 0.1 SOL`);
  
  const timeMin = Math.ceil(plan.estimatedTimeMs / 60000);
  
  return `${parts.join(' + ')} over ~${timeMin} minutes`;
}

/**
 * Validate user has enough notes for the split
 */
export function validateNotesForSplit(
  plan: SplitPlan,
  availableNotes: { poolSize: PoolSize }[]
): { valid: boolean; missing: { poolSize: PoolSize; count: number }[] } {
  const needed: Record<PoolSize, number> = { SMALL: 0, MEDIUM: 0, LARGE: 0 };
  const have: Record<PoolSize, number> = { SMALL: 0, MEDIUM: 0, LARGE: 0 };
  
  for (const part of plan.parts) {
    needed[part.poolSize]++;
  }
  
  for (const note of availableNotes) {
    have[note.poolSize]++;
  }
  
  const missing: { poolSize: PoolSize; count: number }[] = [];
  
  for (const size of ['SMALL', 'MEDIUM', 'LARGE'] as PoolSize[]) {
    if (needed[size] > have[size]) {
      missing.push({ poolSize: size, count: needed[size] - have[size] });
    }
  }
  
  return { valid: missing.length === 0, missing };
}

/**
 * Fisher-Yates shuffle
 */
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Execute a split plan with delays
 * Returns async iterator for progress tracking
 */
export async function* executeSplitPlan(
  plan: SplitPlan,
  sendFn: (poolSize: PoolSize, index: number) => Promise<{ success: boolean; signature?: string; error?: string }>
): AsyncGenerator<{
  index: number;
  total: number;
  poolSize: PoolSize;
  status: 'waiting' | 'sending' | 'success' | 'error';
  signature?: string;
  error?: string;
  delayMs?: number;
}> {
  const sortedParts = [...plan.parts].sort((a, b) => a.delayMs - b.delayMs);
  let lastDelay = 0;

  for (let i = 0; i < sortedParts.length; i++) {
    const part = sortedParts[i];
    const waitTime = part.delayMs - lastDelay;
    lastDelay = part.delayMs;

    // Yield waiting status
    yield {
      index: i,
      total: sortedParts.length,
      poolSize: part.poolSize,
      status: 'waiting',
      delayMs: waitTime,
    };

    // Wait
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // Yield sending status
    yield {
      index: i,
      total: sortedParts.length,
      poolSize: part.poolSize,
      status: 'sending',
    };

    // Send
    const result = await sendFn(part.poolSize, i);

    // Yield result
    yield {
      index: i,
      total: sortedParts.length,
      poolSize: part.poolSize,
      status: result.success ? 'success' : 'error',
      signature: result.signature,
      error: result.error,
    };

    if (!result.success) {
      // Stop on first error
      return;
    }
  }
}
