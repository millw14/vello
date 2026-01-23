/**
 * VELO RELAYER CLIENT
 * 
 * Client for communicating with the Velo Relayer service.
 * This is the KEY to privacy - withdrawals go through the relayer,
 * so your wallet is NEVER visible on-chain!
 */

import { PoolSize, VeloNote } from './types';

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL || 'http://localhost:3001';

export interface RelayerInfo {
  relayerAddress: string;
  isRegistered: boolean;
  feePercent: number;
  minFee: number;
  maxFee: number;
  minFeeSOL: number;
  maxFeeSOL: number;
  supportedPools: Array<{
    size: PoolSize;
    amount: number;
    lamports: number;
  }>;
  programId: string;
  balance: number;
}

export interface FeeEstimate {
  poolSize: PoolSize;
  denomination: number;
  denominationSOL: number;
  fee: number;
  feeSOL: number;
  recipientAmount: number;
  recipientAmountSOL: number;
}

export interface PoolStatus {
  size: PoolSize;
  denomination: number;
  balance: number;
  canWithdraw: boolean;
}

export interface RelayResult {
  success: boolean;
  signature?: string;
  fee?: number;
  feeSOL?: number;
  recipientAmount?: number;
  recipientAmountSOL?: number;
  message?: string;
  error?: string;
}

export interface StealthRelayResult extends RelayResult {
  stealthAddress?: string;
}

/**
 * Check relayer health
 */
export async function checkRelayerHealth(): Promise<{
  status: string;
  relayerAddress: string;
  balance: number;
  network: string;
}> {
  const response = await fetch(`${RELAYER_URL}/health`);
  if (!response.ok) {
    throw new Error('Relayer unavailable');
  }
  return response.json();
}

/**
 * Get relayer info and fee schedule
 */
export async function getRelayerInfo(): Promise<RelayerInfo> {
  const response = await fetch(`${RELAYER_URL}/info`);
  if (!response.ok) {
    throw new Error('Failed to get relayer info');
  }
  return response.json();
}

/**
 * Estimate fee for a withdrawal
 */
export async function estimateFee(poolSize: PoolSize): Promise<FeeEstimate> {
  const response = await fetch(`${RELAYER_URL}/estimate-fee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ poolSize }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to estimate fee');
  }
  
  return response.json();
}

/**
 * Get pool liquidity info
 */
export async function getPoolsStatus(): Promise<PoolStatus[]> {
  const response = await fetch(`${RELAYER_URL}/pools`);
  if (!response.ok) {
    throw new Error('Failed to get pool status');
  }
  const data = await response.json();
  return data.pools;
}

/**
 * RELAY A PRIVATE WITHDRAWAL
 * 
 * This is the privacy magic!
 * Your note is sent to the relayer, which submits the withdrawal.
 * YOUR WALLET IS NEVER VISIBLE ON-CHAIN!
 */
export async function relayWithdrawal(
  note: VeloNote,
  recipient: string
): Promise<RelayResult> {
  try {
    console.log('🔒 Sending withdrawal to relayer...');
    console.log('   Recipient:', recipient.slice(0, 8) + '...');
    console.log('   Pool:', note.poolSize);
    console.log('   Your wallet: HIDDEN ✓');
    
    const response = await fetch(`${RELAYER_URL}/relay/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noteCommitment: note.commitment,
        nullifier: note.nullifier,
        secret: note.secret,
        recipient,
        poolSize: note.poolSize,
      }),
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('✓ Private withdrawal successful!');
      console.log('   Signature:', result.signature);
      console.log('   Fee:', result.feeSOL, 'SOL');
      console.log('   Recipient got:', result.recipientAmountSOL, 'SOL');
      console.log('   ON SOLSCAN: Sender shows as VELO PROGRAM, not you!');
    }
    
    return result;
  } catch (error: any) {
    console.error('Relay withdrawal failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to connect to relayer',
    };
  }
}

/**
 * RELAY A STEALTH TRANSFER
 * 
 * Maximum privacy - hides BOTH sender AND recipient!
 */
export async function relayStealthTransfer(
  note: VeloNote,
  recipientStealthMeta: string
): Promise<StealthRelayResult> {
  try {
    console.log('🔒 Sending stealth transfer to relayer...');
    console.log('   Pool:', note.poolSize);
    console.log('   Sender: HIDDEN ✓');
    console.log('   Recipient: HIDDEN ✓');
    
    const response = await fetch(`${RELAYER_URL}/relay/stealth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noteCommitment: note.commitment,
        nullifier: note.nullifier,
        secret: note.secret,
        recipientStealthMeta,
        poolSize: note.poolSize,
      }),
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('✓ Stealth transfer successful!');
      console.log('   Stealth address:', result.stealthAddress);
    }
    
    return result;
  } catch (error: any) {
    console.error('Stealth relay failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to connect to relayer',
    };
  }
}

/**
 * Check if relayer is available
 */
export async function isRelayerAvailable(): Promise<boolean> {
  try {
    const health = await checkRelayerHealth();
    return health.status === 'ok';
  } catch {
    return false;
  }
}
