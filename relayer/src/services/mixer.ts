/**
 * Velo Mixer Relayer Service
 * 
 * THE PRIVACY MAGIC:
 * 1. User deposits to Velo pool (visible, but just "deposit to Velo")
 * 2. User sends note to THIS relayer off-chain
 * 3. Relayer verifies note is valid
 * 4. Relayer submits withdrawal transaction - RELAYER IS THE SIGNER
 * 5. On Solscan: "Velo Program transferred to [recipient]"
 * 6. USER'S WALLET IS NOWHERE IN THE WITHDRAWAL TRANSACTION!
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js';
import bs58 from 'bs58';
import * as crypto from 'crypto';
import { 
  RelayerConfig, 
  RelayerWithdrawRequest, 
  RelayResult,
  PoolSize,
  POOL_LAMPORTS,
  NullifierRecord,
} from '../types';
import { logger } from '../utils/logger';

// In-memory nullifier cache (use Redis in production)
const usedNullifiers = new Map<string, NullifierRecord>();

export class MixerRelayer {
  private connection: Connection;
  private relayerKeypair: Keypair;
  private config: RelayerConfig;
  private programId: PublicKey;

  constructor(connection: Connection, relayerKeypair: Keypair, config: RelayerConfig) {
    this.connection = connection;
    this.relayerKeypair = relayerKeypair;
    this.config = config;
    this.programId = new PublicKey(config.veloProgramId);
  }

  /**
   * Main privacy function: Relay a withdrawal on behalf of user
   * 
   * User is NOT visible anywhere in this transaction!
   */
  async relayWithdrawal(request: RelayerWithdrawRequest): Promise<RelayResult> {
    try {
      logger.info('Processing relay withdrawal request', {
        recipient: request.recipient,
        poolSize: request.poolSize,
      });

      // 1. Verify the note is valid
      const isValid = await this.verifyNote(request);
      if (!isValid.valid) {
        return { success: false, error: isValid.error };
      }

      // 2. Check nullifier hasn't been used (prevents double-spend)
      const nullifierHash = this.computeNullifierHash(request.nullifier);
      if (usedNullifiers.has(nullifierHash)) {
        return { success: false, error: 'Note already spent' };
      }

      // 3. Calculate fee
      const denomination = POOL_LAMPORTS[request.poolSize];
      const fee = this.calculateFee(denomination);
      const recipientAmount = denomination - fee;

      // 4. Build and submit transaction
      // This is where the magic happens - RELAYER signs, not user!
      const signature = await this.submitWithdrawal(
        request.recipient,
        request.poolSize,
        nullifierHash,
        fee
      );

      // 5. Record nullifier as used
      usedNullifiers.set(nullifierHash, {
        hash: nullifierHash,
        poolSize: request.poolSize,
        usedAt: Date.now(),
        relayTxSignature: signature,
      });

      logger.info('Withdrawal relayed successfully', {
        signature,
        recipient: request.recipient,
        fee,
        recipientAmount,
      });

      return {
        success: true,
        signature,
        fee,
        recipientAmount,
        timestamp: Date.now(),
      };

    } catch (error: any) {
      logger.error('Relay withdrawal failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify the note is valid
   * Checks that commitment = hash(secret || nullifier)
   * NOTE: Order matters! Client uses [secret, nullifier]
   */
  private async verifyNote(request: RelayerWithdrawRequest): Promise<{ valid: boolean; error?: string }> {
    try {
      // Decode nullifier and secret
      const nullifier = bs58.decode(request.nullifier);
      const secret = bs58.decode(request.secret);

      // DEBUG: Log the values
      logger.info('Verifying note:', {
        nullifierB58: request.nullifier.slice(0, 16) + '...',
        secretB58: request.secret.slice(0, 16) + '...',
        providedCommitment: request.noteCommitment,
        nullifierLen: nullifier.length,
        secretLen: secret.length,
      });

      // Recompute commitment - ORDER: secret FIRST, then nullifier (matches client)
      const combined = Buffer.concat([Buffer.from(secret), Buffer.from(nullifier)]);
      const computedCommitment = crypto.createHash('sha256').update(combined).digest('hex');

      logger.info('Computed commitment:', {
        computed: computedCommitment,
        provided: request.noteCommitment,
        match: computedCommitment === request.noteCommitment,
      });

      // Verify it matches
      if (computedCommitment !== request.noteCommitment) {
        // Try other order just in case
        const combinedAlt = Buffer.concat([Buffer.from(nullifier), Buffer.from(secret)]);
        const computedAlt = crypto.createHash('sha256').update(combinedAlt).digest('hex');
        logger.info('Alt order commitment:', { computed: computedAlt });
        
        return { valid: false, error: `Invalid note: commitment mismatch. Expected ${request.noteCommitment.slice(0,16)}..., got ${computedCommitment.slice(0,16)}...` };
      }

      // Verify recipient is valid
      try {
        new PublicKey(request.recipient);
      } catch {
        return { valid: false, error: 'Invalid recipient address' };
      }

      // Verify pool has sufficient funds
      const vaultBalance = await this.getVaultBalance(request.poolSize);
      const denomination = POOL_LAMPORTS[request.poolSize];
      if (vaultBalance < denomination) {
        return { valid: false, error: 'Insufficient pool liquidity' };
      }

      return { valid: true };
    } catch (error: any) {
      return { valid: false, error: `Verification failed: ${error.message}` };
    }
  }

  /**
   * Submit the withdrawal transaction using withdraw_test
   * RELAYER signs this - user is completely anonymous!
   * 
   * On Solscan: Signer = Relayer, not the user!
   */
  private async submitWithdrawal(
    recipient: string,
    poolSize: PoolSize,
    nullifierHash: string,
    fee: number
  ): Promise<string> {
    const recipientPubkey = new PublicKey(recipient);
    const denomination = POOL_LAMPORTS[poolSize];
    const denominationBytes = this.toLEBytes(denomination);

    // Derive PDAs
    const [poolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('velo_pool'), denominationBytes],
      this.programId
    );

    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('velo_vault'), denominationBytes],
      this.programId
    );

    // Use withdraw_test instruction (already deployed on devnet)
    // This works because RELAYER signs, not the user!
    const discriminator = this.getDiscriminator('withdraw_test');
    
    // withdraw_test takes nullifier as [u8; 32]
    const nullifierBytes = this.hexToBytes(nullifierHash);
    
    const data = Buffer.concat([
      discriminator,
      nullifierBytes,  // _nullifier: [u8; 32]
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: poolPDA, isSigner: false, isWritable: false },
        { pubkey: vaultPDA, isSigner: false, isWritable: true },
        { pubkey: recipientPubkey, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data,
    });

    const transaction = new Transaction().add(instruction);
    transaction.feePayer = this.relayerKeypair.publicKey;

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.relayerKeypair],
      { commitment: 'confirmed' }
    );

    return signature;
  }

  /**
   * Get vault balance for a pool
   */
  async getVaultBalance(poolSize: PoolSize): Promise<number> {
    const denomination = POOL_LAMPORTS[poolSize];
    const denominationBytes = this.toLEBytes(denomination);

    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('velo_vault'), denominationBytes],
      this.programId
    );

    return await this.connection.getBalance(vaultPDA);
  }

  /**
   * Calculate relayer fee
   */
  private calculateFee(denomination: number): number {
    let fee = Math.floor(denomination * (this.config.feePercent / 100));
    fee = Math.max(fee, this.config.minFee);
    fee = Math.min(fee, this.config.maxFee);
    return fee;
  }

  /**
   * Compute nullifier hash (same as on-chain)
   */
  private computeNullifierHash(nullifier: string): string {
    const nullifierBytes = bs58.decode(nullifier);
    return crypto.createHash('sha256').update(nullifierBytes).digest('hex');
  }

  /**
   * Get Anchor instruction discriminator
   */
  private getDiscriminator(name: string): Buffer {
    const hash = crypto.createHash('sha256')
      .update(`global:${name}`)
      .digest();
    return hash.slice(0, 8);
  }

  /**
   * Convert number to little-endian bytes
   */
  private toLEBytes(num: number): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(num));
    return buf;
  }

  /**
   * Convert hex string to bytes
   */
  private hexToBytes(hex: string): Buffer {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    return Buffer.from(cleanHex, 'hex');
  }

  /**
   * Check if relayer has sufficient balance to operate
   */
  async isRelayerRegistered(): Promise<boolean> {
    // Using withdraw_test doesn't require on-chain registration
    // Just check if relayer has balance to pay for transactions
    const balance = await this.connection.getBalance(this.relayerKeypair.publicKey);
    return balance > 0.01 * 1e9; // Need at least 0.01 SOL
  }
}
