/**
 * VELO PRIVACY SERVICE
 * 
 * TRUE PRIVACY ARCHITECTURE:
 * 
 * 1. DEPOSIT (visible, but just shows "deposit to Velo"):
 *    - User signs transaction to deposit SOL to Velo pool
 *    - On Solscan: [Your Wallet] → [Velo Program]
 *    - You get a secret "note" proving your deposit
 * 
 * 2. SEND PRIVATE (YOUR WALLET IS INVISIBLE!):
 *    - You send your note to the RELAYER (off-chain, via HTTPS)
 *    - Relayer verifies note is valid
 *    - Relayer submits withdrawal transaction - RELAYER signs, not you!
 *    - On Solscan: [Velo Program] → [Recipient]
 *    - YOUR WALLET IS NOWHERE IN THIS TRANSACTION!
 * 
 * 3. FIXED DENOMINATIONS (amount privacy):
 *    - 0.1 SOL, 1 SOL, 10 SOL pools
 *    - All deposits/withdrawals look identical
 *    - Can't correlate by amount
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';
import CryptoJS from 'crypto-js';
import {
  VELO_PROGRAM_ID,
  createDepositInstruction,
  getPoolPDAs,
  commitmentToBytes,
  PoolSize as VeloPoolSize,
} from '@/lib/solana/velo-program';
import {
  VeloNote,
  PendingTransfer,
  PoolSize,
  POOL_AMOUNTS,
} from './types';
import {
  db,
  saveNote as dbSaveNote,
  getAvailableNotes,
  getNotesByPool,
  markNoteUsed,
  saveTransfer as dbSaveTransfer,
  getPendingIncoming,
  getPendingOutgoing,
  markTransferClaimed,
  logActivity,
  getVeloBalance as dbGetVeloBalance,
  migrateFromLocalStorage,
  clearOldTransfers,
} from '@/lib/db/velo-db';
import {
  relayWithdrawal,
  isRelayerAvailable,
  getRelayerInfo,
  estimateFee,
} from './relayer-client';

// Re-exports
export { POOL_AMOUNTS } from './types';
export { VELO_PROGRAM_ID };
export { relayWithdrawal, isRelayerAvailable, getRelayerInfo, estimateFee };

// Pool denominations in lamports
export const POOL_LAMPORTS: Record<PoolSize, number> = {
  SMALL: 0.1 * LAMPORTS_PER_SOL,
  MEDIUM: 1 * LAMPORTS_PER_SOL,
  LARGE: 10 * LAMPORTS_PER_SOL,
};

// ═══════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════

export async function initializeWallet(walletAddress: string): Promise<void> {
  await clearOldTransfers(walletAddress);
  await migrateFromLocalStorage(walletAddress);
}

// ═══════════════════════════════════════════════════════════════════
// NOTE GENERATION
// ═══════════════════════════════════════════════════════════════════

function generateSecret(): Uint8Array {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return array;
}

export function generateNote(poolSize: PoolSize): VeloNote {
  const secret = generateSecret();
  const nullifier = generateSecret();
  
  // commitment = SHA256(secret || nullifier)
  // Convert to hex string first, then parse - this is the correct way to hash bytes in CryptoJS
  const combined = new Uint8Array([...secret, ...nullifier]);
  const hexString = Array.from(combined).map(b => b.toString(16).padStart(2, '0')).join('');
  const commitment = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(hexString)).toString();
  
  return {
    id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    poolSize,
    amount: POOL_AMOUNTS[poolSize],
    commitment,
    nullifier: bs58.encode(nullifier),
    secret: bs58.encode(secret),
    createdAt: Date.now(),
    used: false,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PDA HELPERS
// ═══════════════════════════════════════════════════════════════════

export function getVaultPDA(poolSize: PoolSize): PublicKey {
  const { vaultPDA } = getPoolPDAs(poolSize as VeloPoolSize);
  return vaultPDA;
}

export function getPoolPDA(poolSize: PoolSize): PublicKey {
  const { poolPDA } = getPoolPDAs(poolSize as VeloPoolSize);
  return poolPDA;
}

// ═══════════════════════════════════════════════════════════════════
// NOTE STORAGE
// ═══════════════════════════════════════════════════════════════════

export async function loadNotes(publicKey: string): Promise<VeloNote[]> {
  const notes = await getAvailableNotes(publicKey);
  return notes.map(n => ({
    id: n.id,
    poolSize: n.poolSize,
    amount: n.amount,
    commitment: n.commitment,
    nullifier: n.nullifier,
    secret: n.secret,
    createdAt: n.createdAt,
    used: n.used,
  }));
}

export async function loadAvailableNotes(publicKey: string): Promise<VeloNote[]> {
  return loadNotes(publicKey);
}

// ═══════════════════════════════════════════════════════════════════
// TRANSFER TRACKING
// ═══════════════════════════════════════════════════════════════════

export async function getPendingForRecipient(publicKey: string): Promise<PendingTransfer[]> {
  try {
    const res = await fetch(`/api/transfers?wallet=${publicKey}&type=incoming`);
    const data = await res.json();
    if (data.transfers) {
      return data.transfers.map((t: any) => ({
        id: t.transferId,
        sender: t.sender,
        recipient: t.recipient,
        encryptedAmount: '',
        amountHint: t.poolSize,
        timestamp: new Date(t.createdAt).getTime(),
        claimed: t.status === 'claimed',
      }));
    }
    return [];
  } catch {
    const transfers = await getPendingIncoming(publicKey);
    return transfers.map(t => ({
      id: t.id,
      sender: t.sender,
      recipient: t.recipient,
      encryptedAmount: t.encryptedAmount,
      amountHint: t.amountHint,
      timestamp: t.timestamp,
      claimed: t.claimed,
    }));
  }
}

export async function getPendingForSender(publicKey: string): Promise<PendingTransfer[]> {
  try {
    const res = await fetch(`/api/transfers?wallet=${publicKey}&type=outgoing`);
    const data = await res.json();
    if (data.transfers) {
      return data.transfers.map((t: any) => ({
        id: t.transferId,
        sender: t.sender,
        recipient: t.recipient,
        encryptedAmount: '',
        amountHint: t.poolSize,
        timestamp: new Date(t.createdAt).getTime(),
        claimed: t.status === 'claimed',
      }));
    }
    return [];
  } catch {
    const transfers = await getPendingOutgoing(publicKey);
    return transfers.map(t => ({
      id: t.id,
      sender: t.sender,
      recipient: t.recipient,
      encryptedAmount: t.encryptedAmount,
      amountHint: t.amountHint,
      timestamp: t.timestamp,
      claimed: t.claimed,
    }));
  }
}

// ═══════════════════════════════════════════════════════════════════
// BALANCE
// ═══════════════════════════════════════════════════════════════════

export async function getEncryptedBalance(publicKey: string): Promise<{
  total: number;
  byPool: Record<PoolSize, number>;
  noteCount: number;
}> {
  return dbGetVeloBalance(publicKey);
}

// ═══════════════════════════════════════════════════════════════════
// DEPOSIT (User signs - visible on Solscan as "deposit to Velo")
// ═══════════════════════════════════════════════════════════════════

export async function deposit(
  connection: Connection,
  wallet: { publicKey: PublicKey; signTransaction: (tx: Transaction) => Promise<Transaction> },
  poolSize: PoolSize
): Promise<{ success: boolean; note?: VeloNote; signature?: string; error?: string }> {
  try {
    console.log('═══════════════════════════════════════');
    console.log('       VELO DEPOSIT');
    console.log('═══════════════════════════════════════');
    console.log('Pool:', poolSize, `(${POOL_AMOUNTS[poolSize]} SOL)`);
    
    // Generate note with commitment
    const note = generateNote(poolSize);
    const commitmentBytes = commitmentToBytes(note.commitment);
    
    console.log('Generated note with commitment:', note.commitment.slice(0, 16) + '...');
    
    // Create deposit instruction
    const depositIx = createDepositInstruction(
      wallet.publicKey,
      commitmentBytes,
      poolSize as VeloPoolSize
    );
    
    const tx = new Transaction().add(depositIx);
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    
    const signedTx = await wallet.signTransaction(tx);
    const signature = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');
    
    console.log('✓ Deposit confirmed:', signature);
    
    // Save note locally
    await dbSaveNote({
      id: note.id,
      walletAddress: wallet.publicKey.toBase58(),
      poolSize: note.poolSize,
      amount: note.amount,
      commitment: note.commitment,
      nullifier: note.nullifier,
      secret: note.secret,
      createdAt: note.createdAt,
      used: false,
      txSignature: signature,
    });

    await logActivity({
      walletAddress: wallet.publicKey.toBase58(),
      type: 'deposit',
      amount: POOL_AMOUNTS[poolSize],
      poolSize,
      timestamp: Date.now(),
      txSignature: signature,
    });
    
    console.log('═══════════════════════════════════════');
    console.log('✓ Note saved. Ready to send privately!');
    console.log('═══════════════════════════════════════');
    
    return { success: true, note, signature };
  } catch (error: any) {
    console.error('Deposit failed:', error);
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// SEND PRIVATE - THE PRIVACY MAGIC!
// 
// This uses the RELAYER to submit the withdrawal.
// YOUR WALLET IS NEVER VISIBLE ON THE BLOCKCHAIN!
// ═══════════════════════════════════════════════════════════════════

export async function sendPrivate(
  connection: Connection,
  wallet: { publicKey: PublicKey; signTransaction: (tx: Transaction) => Promise<Transaction> },
  _unused: Keypair,
  recipient: string,
  poolSize: PoolSize
): Promise<{ success: boolean; transferId?: string; signature?: string; error?: string }> {
  try {
    console.log('═══════════════════════════════════════');
    console.log('       VELO PRIVATE SEND');
    console.log('═══════════════════════════════════════');
    console.log('Recipient:', recipient.slice(0, 8) + '...');
    console.log('Pool:', poolSize, `(${POOL_AMOUNTS[poolSize]} SOL)`);
    console.log('');
    console.log('🔒 PRIVACY MODE: Using relayer');
    console.log('   Your wallet will NOT appear on Solscan!');
    console.log('');
    
    // Check relayer availability
    const relayerAvailable = await isRelayerAvailable();
    if (!relayerAvailable) {
      return {
        success: false,
        error: 'Relayer is not available. Please try again later.',
      };
    }
    
    // Find your deposit note
    const availableNotes = await getNotesByPool(wallet.publicKey.toBase58(), poolSize);
    
    if (availableNotes.length === 0) {
      return { 
        success: false, 
        error: `No deposit for ${poolSize} pool (${POOL_AMOUNTS[poolSize]} SOL). Deposit first!` 
      };
    }
    
    const note = availableNotes[0];
    console.log('Using note:', note.id);
    
    // Get fee estimate
    const feeEstimate = await estimateFee(poolSize);
    console.log('Relayer fee:', feeEstimate.feeSOL, 'SOL');
    console.log('Recipient will get:', feeEstimate.recipientAmountSOL, 'SOL');
    
    // Send to relayer for private withdrawal
    // THIS IS WHERE THE MAGIC HAPPENS!
    const relayResult = await relayWithdrawal(
      {
        id: note.id,
        poolSize: note.poolSize,
        amount: note.amount,
        commitment: note.commitment,
        nullifier: note.nullifier,
        secret: note.secret,
        createdAt: note.createdAt,
        used: false,
      },
      recipient
    );
    
    if (!relayResult.success) {
      return { success: false, error: relayResult.error };
    }
    
    // Mark note as used
    await markNoteUsed(note.id, relayResult.signature || 'relayed');
    
    const transferId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // Record transfer for history
    try {
      await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferId,
          sender: 'PRIVATE', // Don't store actual sender!
          recipient,
          amount: POOL_AMOUNTS[poolSize],
          poolSize,
          txSignature: relayResult.signature,
          viaRelayer: true,
        }),
      });
    } catch (e) {
      console.log('Transfer record save failed (non-critical)');
    }

    await logActivity({
      walletAddress: wallet.publicKey.toBase58(),
      type: 'send',
      amount: POOL_AMOUNTS[poolSize],
      poolSize,
      timestamp: Date.now(),
      counterparty: recipient,
      txSignature: relayResult.signature,
    });
    
    console.log('═══════════════════════════════════════');
    console.log('✓ PRIVATE TRANSFER COMPLETE!');
    console.log('');
    console.log('On Solscan:');
    console.log('  From: Velo Program (NOT your wallet!)');
    console.log('  To:', recipient.slice(0, 8) + '...');
    console.log('  Amount:', feeEstimate.recipientAmountSOL, 'SOL');
    console.log('');
    console.log('Your identity: COMPLETELY HIDDEN ✓');
    console.log('═══════════════════════════════════════');
    
    return { 
      success: true, 
      transferId,
      signature: relayResult.signature,
    };
  } catch (error: any) {
    console.error('Send failed:', error);
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// CLAIM (Not needed with relayer - SOL is sent directly!)
// This just marks transfers as acknowledged in the UI
// ═══════════════════════════════════════════════════════════════════

export async function claim(
  connection: Connection,
  wallet: { publicKey: PublicKey; signTransaction: (tx: Transaction) => Promise<Transaction> },
  transferId: string
): Promise<{ success: boolean; amount?: number; signature?: string; error?: string }> {
  try {
    // With relayer, SOL is sent directly - no claim needed!
    await fetch('/api/transfers/claim', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transferId }),
    });
    
    await markTransferClaimed(transferId);
    
    return { 
      success: true, 
      amount: 0.1,
      signature: 'direct_via_relayer',
    };
  } catch (error: any) {
    console.error('Claim acknowledgment failed:', error);
    return { success: false, error: error.message };
  }
}
