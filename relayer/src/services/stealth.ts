/**
 * Stealth Address Relayer Service
 * Handles stealth payment relay transactions
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
import { RelayerConfig, RelayResult } from '../types';
import { logger } from '../utils/logger';

export class StealthRelayer {
  private connection: Connection;
  private relayerKeypair: Keypair;
  private config: RelayerConfig;
  private programId: PublicKey;

  constructor(connection: Connection, relayerKeypair: Keypair, config: RelayerConfig) {
    this.connection = connection;
    this.relayerKeypair = relayerKeypair;
    this.config = config;
    this.programId = new PublicKey(config.stealthProgramId);
  }

  /**
   * Relay a stealth payment (announce + transfer)
   */
  async relayStealthPayment(
    recipientMeta: string,
    amount: number,
    senderSignedTx: string
  ): Promise<RelayResult> {
    try {
      // Deserialize the sender's pre-signed transaction
      const txBuffer = Buffer.from(senderSignedTx, 'base64');
      const transaction = Transaction.from(txBuffer);

      // Verify transaction structure
      if (transaction.instructions.length === 0) {
        return {
          success: false,
          error: 'Invalid transaction: no instructions',
        };
      }

      // Add relayer as additional signer for fee payment
      transaction.feePayer = this.relayerKeypair.publicKey;
      
      // Get fresh blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      // Partial sign by relayer
      transaction.partialSign(this.relayerKeypair);

      // Send transaction
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        { skipPreflight: false }
      );

      // Confirm
      await this.connection.confirmTransaction(signature, 'confirmed');

      logger.info('Stealth payment relayed', {
        signature,
        recipientMeta,
        amount,
      });

      return {
        success: true,
        signature,
        timestamp: Date.now(),
      };

    } catch (error: any) {
      logger.error('Stealth payment relay failed', { error: error.message });
      return {
        success: false,
        error: error.message || 'Stealth payment relay failed',
      };
    }
  }

  /**
   * Generate and relay a stealth announcement
   */
  async relayAnnouncement(
    senderPubkey: PublicKey,
    recipientMetaPubkey: PublicKey,
    stealthAddress: PublicKey,
    ephemeralPublicKey: Buffer,
    encryptedViewTag: Buffer,
    amount: number
  ): Promise<RelayResult> {
    try {
      // Derive registry PDA
      const [registryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('registry')],
        this.programId
      );

      // Create announcement account keypair
      const announcementKeypair = Keypair.generate();

      // Build announce instruction
      const discriminator = Buffer.from([156, 89, 234, 12, 67, 189, 201, 34]); // announce_payment

      const amountBuf = Buffer.alloc(8);
      amountBuf.writeBigUInt64LE(BigInt(amount));

      const data = Buffer.concat([
        discriminator,
        stealthAddress.toBuffer(),
        ephemeralPublicKey,
        encryptedViewTag,
        amountBuf,
      ]);

      const announceIx = new TransactionInstruction({
        keys: [
          { pubkey: registryPda, isSigner: false, isWritable: true },
          { pubkey: recipientMetaPubkey, isSigner: false, isWritable: true },
          { pubkey: announcementKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: stealthAddress, isSigner: false, isWritable: true },
          { pubkey: senderPubkey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: this.programId,
        data,
      });

      // Create and send transaction
      const transaction = new Transaction().add(announceIx);
      transaction.feePayer = this.relayerKeypair.publicKey;

      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.relayerKeypair, announcementKeypair],
        { commitment: 'confirmed' }
      );

      logger.info('Stealth announcement relayed', {
        signature,
        announcement: announcementKeypair.publicKey.toString(),
        stealthAddress: stealthAddress.toString(),
      });

      return {
        success: true,
        signature,
        timestamp: Date.now(),
      };

    } catch (error: any) {
      logger.error('Stealth announcement relay failed', { error: error.message });
      return {
        success: false,
        error: error.message || 'Announcement relay failed',
      };
    }
  }

  /**
   * Relay a claim transaction for stealth funds
   */
  async relayClaim(
    announcementPubkey: PublicKey,
    stealthAddress: PublicKey,
    claimerPubkey: PublicKey,
    ownershipProof: Buffer
  ): Promise<RelayResult> {
    try {
      // Build claim instruction
      const discriminator = Buffer.from([98, 145, 67, 189, 34, 201, 156, 12]); // claim_stealth_funds

      const data = Buffer.concat([
        discriminator,
        ownershipProof,
      ]);

      const claimIx = new TransactionInstruction({
        keys: [
          { pubkey: announcementPubkey, isSigner: false, isWritable: true },
          { pubkey: stealthAddress, isSigner: false, isWritable: true },
          { pubkey: claimerPubkey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: this.programId,
        data,
      });

      const transaction = new Transaction().add(claimIx);
      transaction.feePayer = this.relayerKeypair.publicKey;

      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      // Note: In production, the claimer would need to sign this
      // For relay, we assume the claimer pre-signed the transaction

      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.relayerKeypair],
        { commitment: 'confirmed' }
      );

      logger.info('Stealth claim relayed', {
        signature,
        stealthAddress: stealthAddress.toString(),
        claimer: claimerPubkey.toString(),
      });

      return {
        success: true,
        signature,
        timestamp: Date.now(),
      };

    } catch (error: any) {
      logger.error('Stealth claim relay failed', { error: error.message });
      return {
        success: false,
        error: error.message || 'Claim relay failed',
      };
    }
  }

  /**
   * Get registry status
   */
  async getRegistryInfo(): Promise<any> {
    const [registryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('registry')],
      this.programId
    );

    try {
      const accountInfo = await this.connection.getAccountInfo(registryPda);
      if (!accountInfo) {
        return { initialized: false };
      }
      return {
        address: registryPda.toString(),
        initialized: true,
      };
    } catch {
      return { initialized: false };
    }
  }
}
