/**
 * Private Transaction Relayer Service
 * Handles shielded transfer relay transactions
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
import { RelayerConfig, TransferRequest, RelayResult } from '../types';
import { logger } from '../utils/logger';

export class PrivateTxRelayer {
  private connection: Connection;
  private relayerKeypair: Keypair;
  private config: RelayerConfig;
  private programId: PublicKey;

  constructor(connection: Connection, relayerKeypair: Keypair, config: RelayerConfig) {
    this.connection = connection;
    this.relayerKeypair = relayerKeypair;
    this.config = config;
    this.programId = new PublicKey(config.privateTxProgramId);
  }

  /**
   * Relay a private transfer transaction
   */
  async relayTransfer(request: TransferRequest): Promise<RelayResult> {
    try {
      // Build the transfer instruction
      const transferIx = await this.buildTransferInstruction(request);

      // Create transaction
      const transaction = new Transaction().add(transferIx);
      
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

      logger.info('Private transfer relayed', {
        signature,
        publicAmount: request.publicAmount,
        nullifiersCount: request.inputNullifiers.length,
      });

      return {
        success: true,
        signature,
        timestamp: Date.now(),
      };

    } catch (error: any) {
      logger.error('Private transfer relay failed', { error: error.message });
      return {
        success: false,
        error: error.message || 'Transfer relay failed',
      };
    }
  }

  /**
   * Build the private transfer instruction
   */
  private async buildTransferInstruction(request: TransferRequest): Promise<TransactionInstruction> {
    // Derive protocol PDA
    const [protocolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('protocol')],
      this.programId
    );

    // Derive protocol vault PDA
    const [protocolVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault')],
      this.programId
    );

    // Derive nullifier set PDA (simplified - in production would be more complex)
    const [nullifierSet] = PublicKey.findProgramAddressSync(
      [Buffer.from('nullifiers')],
      this.programId
    );

    // Build proof data
    const proofData = Buffer.from(request.proof.proofData, 'base64');
    const merkleRoot = this.hexToBytes(request.proof.merkleRoot);

    // Build nullifiers
    const nullifiersBuffer = Buffer.concat(
      request.inputNullifiers.map(n => this.hexToBytes(n))
    );

    // Build commitments
    const commitmentsBuffer = Buffer.concat(
      request.outputCommitments.map(c => this.hexToBytes(c))
    );

    // Build encrypted outputs
    const encryptedBuffer = Buffer.concat(
      request.encryptedOutputs.map(e => {
        const data = Buffer.from(e, 'base64');
        // Prefix with length
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32LE(data.length);
        return Buffer.concat([lenBuf, data]);
      })
    );

    // Anchor discriminator for 'private_transfer' instruction
    const discriminator = Buffer.from([78, 34, 12, 189, 201, 99, 145, 213]);

    // Public amount as signed 64-bit integer
    const publicAmountBuf = Buffer.alloc(8);
    if (request.publicAmount >= 0) {
      publicAmountBuf.writeBigInt64LE(BigInt(request.publicAmount));
    } else {
      publicAmountBuf.writeBigInt64LE(BigInt(request.publicAmount));
    }

    // Serialize lengths for vectors
    const nullifiersLen = Buffer.alloc(4);
    nullifiersLen.writeUInt32LE(request.inputNullifiers.length);

    const commitmentsLen = Buffer.alloc(4);
    commitmentsLen.writeUInt32LE(request.outputCommitments.length);

    const encryptedLen = Buffer.alloc(4);
    encryptedLen.writeUInt32LE(request.encryptedOutputs.length);

    const data = Buffer.concat([
      discriminator,
      // TransferProof
      Buffer.alloc(4).fill(proofData.length), // proof_data length
      proofData,
      merkleRoot,
      // Vectors
      nullifiersLen,
      nullifiersBuffer,
      commitmentsLen,
      commitmentsBuffer,
      encryptedLen,
      encryptedBuffer,
      // Public amount
      publicAmountBuf,
    ]);

    // Build accounts
    const accounts = [
      { pubkey: protocolPda, isSigner: false, isWritable: true },
      { pubkey: nullifierSet, isSigner: false, isWritable: true },
      { pubkey: protocolVault, isSigner: false, isWritable: true },
    ];

    // Add treasury if withdrawing
    if (request.publicAmount < 0) {
      // Get treasury from protocol account (simplified)
      accounts.push({ pubkey: protocolPda, isSigner: false, isWritable: true }); // treasury placeholder
    } else {
      accounts.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
    }

    // Add user (relayer acts on behalf)
    accounts.push({ pubkey: this.relayerKeypair.publicKey, isSigner: true, isWritable: true });
    accounts.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });

    return new TransactionInstruction({
      keys: accounts,
      programId: this.programId,
      data,
    });
  }

  /**
   * Convert hex string to bytes
   */
  private hexToBytes(hex: string): Buffer {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    return Buffer.from(cleanHex, 'hex');
  }

  /**
   * Get protocol status
   */
  async getProtocolInfo(): Promise<any> {
    const [protocolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('protocol')],
      this.programId
    );

    try {
      const accountInfo = await this.connection.getAccountInfo(protocolPda);
      if (!accountInfo) {
        return { initialized: false };
      }
      return {
        address: protocolPda.toString(),
        initialized: true,
      };
    } catch {
      return { initialized: false };
    }
  }
}
