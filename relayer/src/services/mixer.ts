/**
 * Mixer Relayer Service
 * Handles mixer withdrawal relay transactions
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
import { RelayerConfig, WithdrawRequest, RelayResult } from '../types';
import { logger } from '../utils/logger';

export class MixerRelayer {
  private connection: Connection;
  private relayerKeypair: Keypair;
  private config: RelayerConfig;
  private programId: PublicKey;

  constructor(connection: Connection, relayerKeypair: Keypair, config: RelayerConfig) {
    this.connection = connection;
    this.relayerKeypair = relayerKeypair;
    this.config = config;
    this.programId = new PublicKey(config.mixerProgramId);
  }

  /**
   * Relay a mixer withdrawal transaction
   */
  async relayWithdrawal(request: WithdrawRequest): Promise<RelayResult> {
    try {
      // Validate fee is sufficient
      const minFee = this.calculateMinFee(request.poolDenomination);
      if (request.fee < minFee) {
        return {
          success: false,
          error: `Fee too low. Minimum: ${minFee} lamports`,
        };
      }

      // Build the withdrawal instruction
      const withdrawIx = await this.buildWithdrawInstruction(request);

      // Create transaction
      const transaction = new Transaction().add(withdrawIx);
      
      // Set fee payer to relayer
      transaction.feePayer = this.relayerKeypair.publicKey;
      
      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      // Sign and send
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.relayerKeypair],
        { commitment: 'confirmed' }
      );

      logger.info('Mixer withdrawal relayed', {
        signature,
        recipient: request.recipient,
        fee: request.fee,
      });

      return {
        success: true,
        signature,
        fee: request.fee,
        timestamp: Date.now(),
      };

    } catch (error: any) {
      logger.error('Mixer withdrawal relay failed', { error: error.message });
      return {
        success: false,
        error: error.message || 'Withdrawal relay failed',
      };
    }
  }

  /**
   * Build the mixer withdraw instruction
   */
  private async buildWithdrawInstruction(request: WithdrawRequest): Promise<TransactionInstruction> {
    const recipient = new PublicKey(request.recipient);
    
    // Derive pool PDA
    const [poolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), this.toLEBytes(request.poolDenomination)],
      this.programId
    );

    // Derive pool vault PDA
    const [poolVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), poolPda.toBuffer()],
      this.programId
    );

    // Build instruction data
    const proofA = Buffer.from(request.proof.a, 'base64');
    const proofB = Buffer.from(request.proof.b, 'base64');
    const proofC = Buffer.from(request.proof.c, 'base64');
    const root = this.hexToBytes(request.root);
    const nullifierHash = this.hexToBytes(request.nullifierHash);
    const feeBytes = this.toLEBytes(request.fee);

    // Anchor discriminator for 'withdraw' instruction
    const discriminator = Buffer.from([183, 18, 70, 156, 148, 109, 161, 34]); // withdraw

    const data = Buffer.concat([
      discriminator,
      proofA,       // ZKProof.a - 64 bytes
      proofB,       // ZKProof.b - 128 bytes
      proofC,       // ZKProof.c - 64 bytes
      root,         // root - 32 bytes
      nullifierHash,// nullifier_hash - 32 bytes
      recipient.toBuffer(),     // recipient - 32 bytes
      this.relayerKeypair.publicKey.toBuffer(), // relayer - 32 bytes
      feeBytes,     // fee - 8 bytes
    ]);

    return new TransactionInstruction({
      keys: [
        { pubkey: poolPda, isSigner: false, isWritable: true },
        { pubkey: poolVault, isSigner: false, isWritable: true },
        { pubkey: recipient, isSigner: false, isWritable: true },
        { pubkey: this.relayerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data,
    });
  }

  /**
   * Calculate minimum fee based on pool denomination
   */
  private calculateMinFee(poolDenomination: number): number {
    const feeFromPercent = Math.floor(poolDenomination * (this.config.feePercent / 100));
    return Math.max(feeFromPercent, this.config.minFee);
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
   * Get pool information
   */
  async getPoolInfo(denomination: number): Promise<any> {
    const [poolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), this.toLEBytes(denomination)],
      this.programId
    );

    try {
      const accountInfo = await this.connection.getAccountInfo(poolPda);
      if (!accountInfo) {
        return null;
      }
      // Decode pool account data (simplified)
      return {
        address: poolPda.toString(),
        exists: true,
        denomination,
      };
    } catch {
      return null;
    }
  }
}
