/**
 * Velo Mixer Program Client (Multi-Pool)
 * 
 * Interacts with the deployed mixer program on Solana devnet
 * Program ID: DSQt1z5wNcmE5h2XL1K1QAWHy28iJufg52aGy3kn8pEc
 * 
 * Supports three pool denominations:
 * - SMALL: 0.1 SOL
 * - MEDIUM: 1 SOL  
 * - LARGE: 10 SOL
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { getConnection } from './config';
import bs58 from 'bs58';
import CryptoJS from 'crypto-js';
import nacl from 'tweetnacl';

// Deployed Program ID
export const MIXER_PROGRAM_ID = new PublicKey('DSQt1z5wNcmE5h2XL1K1QAWHy28iJufg52aGy3kn8pEc');

// Pool denominations in lamports
export const POOL_DENOMINATIONS = {
  SMALL: 0.1 * LAMPORTS_PER_SOL,   // 100,000,000 lamports
  MEDIUM: 1 * LAMPORTS_PER_SOL,    // 1,000,000,000 lamports
  LARGE: 10 * LAMPORTS_PER_SOL,    // 10,000,000,000 lamports
} as const;

export type PoolSize = keyof typeof POOL_DENOMINATIONS;

// Pool PDAs (derived with denomination)
export const POOL_PDAS = {
  SMALL: findPoolPDA(POOL_DENOMINATIONS.SMALL),
  MEDIUM: findPoolPDA(POOL_DENOMINATIONS.MEDIUM),
  LARGE: findPoolPDA(POOL_DENOMINATIONS.LARGE),
} as const;

// Vault PDAs
export const VAULT_PDAS = {
  SMALL: findVaultPDA(POOL_DENOMINATIONS.SMALL),
  MEDIUM: findVaultPDA(POOL_DENOMINATIONS.MEDIUM),
  LARGE: findVaultPDA(POOL_DENOMINATIONS.LARGE),
} as const;

/**
 * Convert u64 to little-endian bytes (browser-compatible)
 */
function toLEBytes(num: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let n = BigInt(num);
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(n & BigInt(0xff));
    n = n >> BigInt(8);
  }
  return bytes;
}

/**
 * Compute Anchor instruction discriminator (browser-compatible)
 */
function getDiscriminator(instructionName: string): Uint8Array {
  const hash = CryptoJS.SHA256(`global:${instructionName}`);
  const hexStr = hash.toString(CryptoJS.enc.Hex);
  // Take first 8 bytes (16 hex chars)
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    bytes[i] = parseInt(hexStr.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert string to Uint8Array (browser-compatible)
 */
function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Concatenate multiple Uint8Arrays
 */
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Find pool PDA for a given denomination
 */
function findPoolPDA(denomination: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [stringToBytes('pool'), toLEBytes(denomination)],
    MIXER_PROGRAM_ID
  );
}

/**
 * Find vault PDA for a given denomination
 */
function findVaultPDA(denomination: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [stringToBytes('vault'), toLEBytes(denomination)],
    MIXER_PROGRAM_ID
  );
}

/**
 * Get pool and vault PDAs for a pool size
 */
export function getPoolPDAs(poolSize: PoolSize): { poolPDA: PublicKey; vaultPDA: PublicKey } {
  return {
    poolPDA: POOL_PDAS[poolSize][0],
    vaultPDA: VAULT_PDAS[poolSize][0],
  };
}

export interface MixerNote {
  commitment: string;
  nullifier: string;
  secret: string;
  denomination: number;
  depositTime: number;
  leafIndex?: number;
  poolSize: PoolSize;
}

/**
 * Generate a mixer deposit note
 */
export function generateMixerNote(poolSize: PoolSize): MixerNote {
  // Generate random secret and nullifier (32 bytes each)
  const secret = nacl.randomBytes(32);
  const nullifier = nacl.randomBytes(32);
  
  // Compute commitment = hash(nullifier || secret)
  const combined = new Uint8Array([...nullifier, ...secret]);
  const commitment = CryptoJS.SHA256(
    CryptoJS.lib.WordArray.create(combined as unknown as number[])
  ).toString();
  
  return {
    commitment,
    nullifier: bs58.encode(nullifier),
    secret: bs58.encode(secret),
    denomination: POOL_DENOMINATIONS[poolSize],
    depositTime: Date.now(),
    poolSize,
  };
}

/**
 * Convert commitment string to 32-byte array for on-chain use
 */
function commitmentToBytes(commitment: string): Uint8Array {
  // Commitment is a hex string from SHA256
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(commitment.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Create deposit instruction for the mixer program
 */
export function createDepositInstruction(
  depositor: PublicKey,
  commitment: Uint8Array,
  poolSize: PoolSize
): TransactionInstruction {
  const { poolPDA, vaultPDA } = getPoolPDAs(poolSize);
  
  // Build instruction data: discriminator + commitment (32 bytes)
  const discriminator = getDiscriminator('deposit');
  const data = Buffer.from(concatBytes(discriminator, commitment));

  return new TransactionInstruction({
    keys: [
      { pubkey: poolPDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: depositor, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: MIXER_PROGRAM_ID,
    data,
  });
}

/**
 * Create withdraw instruction for the mixer program
 */
export function createWithdrawInstruction(
  recipient: PublicKey,
  nullifier: Uint8Array,
  poolSize: PoolSize
): TransactionInstruction {
  const { poolPDA, vaultPDA } = getPoolPDAs(poolSize);
  
  // Build instruction data: discriminator + nullifier (32 bytes)
  const discriminator = getDiscriminator('withdraw');
  const data = Buffer.from(concatBytes(discriminator, nullifier));

  return new TransactionInstruction({
    keys: [
      { pubkey: poolPDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
    ],
    programId: MIXER_PROGRAM_ID,
    data,
  });
}

/**
 * Deposit to mixer pool
 */
export async function depositToMixer(
  connection: Connection,
  depositor: Keypair,
  note: MixerNote
): Promise<{ success: boolean; signature?: string; error?: string }> {
  try {
    const commitmentBytes = commitmentToBytes(note.commitment);
    
    const tx = new Transaction();
    tx.add(createDepositInstruction(depositor.publicKey, commitmentBytes, note.poolSize));
    
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [depositor],
      { commitment: 'confirmed' }
    );
    
    return { success: true, signature };
  } catch (error: any) {
    console.error('Deposit failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Withdraw from mixer pool (test mode - fee payer signs)
 * In production, this would be submitted through a relayer for full privacy
 */
export async function withdrawFromMixer(
  connection: Connection,
  feePayer: Keypair,
  note: MixerNote,
  recipient: PublicKey
): Promise<{ success: boolean; signature?: string; error?: string }> {
  try {
    const nullifierBytes = bs58.decode(note.nullifier);
    
    const tx = new Transaction();
    tx.add(createWithdrawInstruction(recipient, nullifierBytes, note.poolSize));
    
    // Fee payer signs the transaction
    // Note: In production, a relayer would do this to maintain privacy
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [feePayer],
      { commitment: 'confirmed' }
    );
    
    return { success: true, signature };
  } catch (error: any) {
    console.error('Withdraw failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get mixer pool info for a specific denomination
 */
export async function getMixerPoolInfo(
  connection: Connection,
  poolSize: PoolSize
): Promise<{
  authority: string;
  denomination: number;
  nextIndex: number;
  totalDeposits: number;
} | null> {
  try {
    const { poolPDA } = getPoolPDAs(poolSize);
    const accountInfo = await connection.getAccountInfo(poolPDA);
    if (!accountInfo) return null;
    
    // Parse account data (skip 8-byte discriminator)
    const data = accountInfo.data.slice(8);
    
    // MixerPool struct: authority (32) + denomination (8) + next_index (4) + total_deposits (8)
    const authority = new PublicKey(data.slice(0, 32)).toBase58();
    const denomination = Number(data.readBigUInt64LE(32));
    const nextIndex = data.readUInt32LE(40);
    const totalDeposits = Number(data.readBigUInt64LE(44));
    
    return { authority, denomination, nextIndex, totalDeposits };
  } catch (error) {
    console.error('Failed to get pool info:', error);
    return null;
  }
}

/**
 * Get all pool infos
 */
export async function getAllPoolInfos(connection: Connection): Promise<{
  SMALL: Awaited<ReturnType<typeof getMixerPoolInfo>>;
  MEDIUM: Awaited<ReturnType<typeof getMixerPoolInfo>>;
  LARGE: Awaited<ReturnType<typeof getMixerPoolInfo>>;
}> {
  const [small, medium, large] = await Promise.all([
    getMixerPoolInfo(connection, 'SMALL'),
    getMixerPoolInfo(connection, 'MEDIUM'),
    getMixerPoolInfo(connection, 'LARGE'),
  ]);
  return { SMALL: small, MEDIUM: medium, LARGE: large };
}

/**
 * Check if a specific pool is initialized
 */
export async function isPoolInitialized(connection: Connection, poolSize: PoolSize): Promise<boolean> {
  const { poolPDA } = getPoolPDAs(poolSize);
  const accountInfo = await connection.getAccountInfo(poolPDA);
  return accountInfo !== null;
}

/**
 * Check if all pools are initialized
 */
export async function areAllPoolsInitialized(connection: Connection): Promise<{
  SMALL: boolean;
  MEDIUM: boolean;
  LARGE: boolean;
  allReady: boolean;
}> {
  const [small, medium, large] = await Promise.all([
    isPoolInitialized(connection, 'SMALL'),
    isPoolInitialized(connection, 'MEDIUM'),
    isPoolInitialized(connection, 'LARGE'),
  ]);
  return {
    SMALL: small,
    MEDIUM: medium,
    LARGE: large,
    allReady: small && medium && large,
  };
}
