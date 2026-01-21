/**
 * VELO Decoy Service
 * 
 * Creates noise transactions to confuse blockchain observers.
 * Real transactions become indistinguishable from decoy transactions.
 * 
 * How it works:
 * 1. Periodically triggers shuffle operations between vaults
 * 2. Creates fake "deposits" and "withdrawals" that look real
 * 3. Randomizes timing to prevent pattern analysis
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Keypair,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { getConnection } from './config';
import CryptoJS from 'crypto-js';

// Program ID
const VELO_PROGRAM_ID = new PublicKey('AQgeVtAYEvigMbBW5gEiK4voELjFB94fDY9cFZqKHgZ8');

// Pool denominations
const POOL_DENOMINATIONS = {
  SMALL: 0.1 * 1e9,   // 100,000,000 lamports
  MEDIUM: 1 * 1e9,    // 1,000,000,000 lamports  
  LARGE: 10 * 1e9,    // 10,000,000,000 lamports
};

type PoolSize = 'SMALL' | 'MEDIUM' | 'LARGE';

// Helper functions
function toLEBytes(num: number): Uint8Array {
  const buf = new Uint8Array(8);
  let temp = num;
  for (let i = 0; i < 8; i++) {
    buf[i] = temp & 0xff;
    temp = Math.floor(temp / 256);
  }
  return buf;
}

function getDiscriminator(instructionName: string): Uint8Array {
  const hash = CryptoJS.SHA256(`global:${instructionName}`);
  const hexStr = hash.toString(CryptoJS.enc.Hex);
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    bytes[i] = parseInt(hexStr.substr(i * 2, 2), 16);
  }
  return bytes;
}

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

// PDA derivation helpers
function findPoolPDA(denomination: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('velo_pool'), toLEBytes(denomination)],
    VELO_PROGRAM_ID
  )[0];
}

function findVaultPDA(denomination: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('velo_vault'), toLEBytes(denomination)],
    VELO_PROGRAM_ID
  )[0];
}

function findDecoyConfigPDA(poolPDA: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('decoy_config'), poolPDA.toBytes()],
    VELO_PROGRAM_ID
  )[0];
}

function findDecoyVaultPDA(denomination: number, index: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode('decoy_vault'),
      toLEBytes(denomination),
      new Uint8Array([index]),
    ],
    VELO_PROGRAM_ID
  )[0];
}

/**
 * Create shuffle instruction
 */
function createShuffleInstruction(
  poolSize: PoolSize,
  decoyIndex: number,
  amount: number,
  direction: boolean // true = vault->decoy, false = decoy->vault
): TransactionInstruction {
  const denomination = POOL_DENOMINATIONS[poolSize];
  const poolPDA = findPoolPDA(denomination);
  const vaultPDA = findVaultPDA(denomination);
  const decoyConfigPDA = findDecoyConfigPDA(poolPDA);
  const decoyVaultPDA = findDecoyVaultPDA(denomination, decoyIndex);

  const discriminator = getDiscriminator('shuffle');
  const data = Buffer.from(concatBytes(
    discriminator,
    new Uint8Array([decoyIndex]),
    toLEBytes(amount),
    new Uint8Array([direction ? 1 : 0])
  ));

  return new TransactionInstruction({
    keys: [
      { pubkey: poolPDA, isSigner: false, isWritable: false },
      { pubkey: decoyConfigPDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: decoyVaultPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: VELO_PROGRAM_ID,
    data,
  });
}

/**
 * Create decoy deposit instruction (fake deposit)
 */
function createDecoyDepositInstruction(poolSize: PoolSize): TransactionInstruction {
  const denomination = POOL_DENOMINATIONS[poolSize];
  const poolPDA = findPoolPDA(denomination);
  const vaultPDA = findVaultPDA(denomination);
  const decoyConfigPDA = findDecoyConfigPDA(poolPDA);
  const decoyVaultPDA = findDecoyVaultPDA(denomination, 0);

  // Generate random fake commitment
  const fakeCommitment = crypto.getRandomValues(new Uint8Array(32));

  const discriminator = getDiscriminator('decoy_deposit');
  const data = Buffer.from(concatBytes(discriminator, fakeCommitment));

  return new TransactionInstruction({
    keys: [
      { pubkey: poolPDA, isSigner: false, isWritable: true },
      { pubkey: decoyConfigPDA, isSigner: false, isWritable: false },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: decoyVaultPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: VELO_PROGRAM_ID,
    data,
  });
}

/**
 * Create decoy withdraw instruction (fake withdrawal)
 */
function createDecoyWithdrawInstruction(poolSize: PoolSize): TransactionInstruction {
  const denomination = POOL_DENOMINATIONS[poolSize];
  const poolPDA = findPoolPDA(denomination);
  const vaultPDA = findVaultPDA(denomination);
  const decoyConfigPDA = findDecoyConfigPDA(poolPDA);
  const decoyVaultPDA = findDecoyVaultPDA(denomination, 0);

  const discriminator = getDiscriminator('decoy_withdraw');
  const data = Buffer.from(discriminator);

  return new TransactionInstruction({
    keys: [
      { pubkey: poolPDA, isSigner: false, isWritable: false },
      { pubkey: decoyConfigPDA, isSigner: false, isWritable: false },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: decoyVaultPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: VELO_PROGRAM_ID,
    data,
  });
}

/**
 * Decoy Service Class
 * Manages automated noise generation
 */
export class DecoyService {
  private connection: Connection;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private stats = {
    shuffles: 0,
    decoyDeposits: 0,
    decoyWithdraws: 0,
    startTime: 0,
  };

  constructor(connection?: Connection) {
    this.connection = connection || getConnection();
  }

  /**
   * Start the decoy service
   * Generates noise transactions at random intervals
   */
  start(minIntervalMs: number = 10000, maxIntervalMs: number = 30000) {
    if (this.isRunning) {
      console.log('Decoy service already running');
      return;
    }

    this.isRunning = true;
    this.stats.startTime = Date.now();
    console.log('🎭 Decoy service started');
    console.log(`   Interval: ${minIntervalMs/1000}s - ${maxIntervalMs/1000}s`);

    const scheduleNext = () => {
      if (!this.isRunning) return;

      const delay = Math.random() * (maxIntervalMs - minIntervalMs) + minIntervalMs;
      this.intervalId = setTimeout(async () => {
        await this.executeRandomDecoy();
        scheduleNext();
      }, delay);
    };

    scheduleNext();
  }

  /**
   * Stop the decoy service
   */
  stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
    console.log('🎭 Decoy service stopped');
    console.log(`   Total shuffles: ${this.stats.shuffles}`);
    console.log(`   Decoy deposits: ${this.stats.decoyDeposits}`);
    console.log(`   Decoy withdraws: ${this.stats.decoyWithdraws}`);
  }

  /**
   * Execute a random decoy operation
   */
  private async executeRandomDecoy() {
    const operations = ['shuffle', 'decoy_deposit', 'decoy_withdraw'];
    const pools: PoolSize[] = ['SMALL', 'MEDIUM', 'LARGE'];
    
    const operation = operations[Math.floor(Math.random() * operations.length)];
    const poolSize = pools[Math.floor(Math.random() * pools.length)];

    console.log(`🎭 Decoy: ${operation} on ${poolSize} pool`);

    // Note: In a real implementation, you'd need a funded keypair to pay for transactions
    // This is a simulation - actual execution would require transaction fees
    
    switch (operation) {
      case 'shuffle':
        this.stats.shuffles++;
        break;
      case 'decoy_deposit':
        this.stats.decoyDeposits++;
        break;
      case 'decoy_withdraw':
        this.stats.decoyWithdraws++;
        break;
    }
  }

  /**
   * Execute a real shuffle transaction (requires funded keypair)
   */
  async executeShuffle(
    feePayer: Keypair,
    poolSize: PoolSize,
    decoyIndex: number = 0,
    direction: boolean = true
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      const denomination = POOL_DENOMINATIONS[poolSize];
      // Shuffle small portion of the pool
      const amount = Math.floor(denomination * 0.1); // 10% of denomination

      const tx = new Transaction();
      tx.add(createShuffleInstruction(poolSize, decoyIndex, amount, direction));

      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [feePayer],
        { commitment: 'confirmed' }
      );

      this.stats.shuffles++;
      return { success: true, signature };
    } catch (error: any) {
      console.error('Shuffle failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute a decoy deposit (requires funded decoy vault)
   */
  async executeDecoyDeposit(
    feePayer: Keypair,
    poolSize: PoolSize
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      const tx = new Transaction();
      tx.add(createDecoyDepositInstruction(poolSize));

      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [feePayer],
        { commitment: 'confirmed' }
      );

      this.stats.decoyDeposits++;
      return { success: true, signature };
    } catch (error: any) {
      console.error('Decoy deposit failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute a decoy withdrawal (requires funded vault)
   */
  async executeDecoyWithdraw(
    feePayer: Keypair,
    poolSize: PoolSize
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      const tx = new Transaction();
      tx.add(createDecoyWithdrawInstruction(poolSize));

      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [feePayer],
        { commitment: 'confirmed' }
      );

      this.stats.decoyWithdraws++;
      return { success: true, signature };
    } catch (error: any) {
      console.error('Decoy withdrawal failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    const runtime = this.stats.startTime ? Date.now() - this.stats.startTime : 0;
    return {
      ...this.stats,
      runtimeMs: runtime,
      runtimeMinutes: Math.floor(runtime / 60000),
      isRunning: this.isRunning,
    };
  }
}

// Singleton instance for global use
let decoyServiceInstance: DecoyService | null = null;

export function getDecoyService(): DecoyService {
  if (!decoyServiceInstance) {
    decoyServiceInstance = new DecoyService();
  }
  return decoyServiceInstance;
}

/**
 * Create instruction to initialize decoy system for a pool
 */
export function createInitDecoySystemInstruction(
  poolSize: PoolSize,
  authority: PublicKey,
  numVaults: number = 4
): TransactionInstruction {
  const denomination = POOL_DENOMINATIONS[poolSize];
  const poolPDA = findPoolPDA(denomination);
  const decoyConfigPDA = findDecoyConfigPDA(poolPDA);

  const discriminator = getDiscriminator('init_decoy_system');
  const data = Buffer.from(concatBytes(discriminator, new Uint8Array([numVaults])));

  return new TransactionInstruction({
    keys: [
      { pubkey: poolPDA, isSigner: false, isWritable: false },
      { pubkey: decoyConfigPDA, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: VELO_PROGRAM_ID,
    data,
  });
}
