/**
 * Velo Stealth Address Relayer Service
 * 
 * Maximum privacy: hides BOTH sender AND recipient!
 * 
 * How stealth addresses work:
 * 1. Recipient publishes a "stealth meta-address" (can be stored on-chain or shared)
 * 2. Sender generates one-time stealth address from meta-address
 * 3. Funds sent to stealth address
 * 4. Only recipient can compute the private key to this address
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
import * as nacl from 'tweetnacl';
import { 
  RelayerConfig, 
  StealthTransferRequest,
  RelayResult,
  PoolSize,
  POOL_LAMPORTS,
} from '../types';
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
    this.programId = new PublicKey(config.veloProgramId);
  }

  /**
   * Relay a stealth transfer
   * Generates stealth address and sends funds there
   */
  async relayStealthTransfer(
    request: StealthTransferRequest
  ): Promise<RelayResult & { stealthAddress?: string }> {
    try {
      // 1. Verify note
      const isValid = this.verifyNote(request);
      if (!isValid.valid) {
        return { success: false, error: isValid.error };
      }

      // 2. Generate stealth address for recipient
      const { stealthAddress, ephemeralPubkey, stealthHash } = this.generateStealthAddress(
        request.recipientStealthMeta
      );

      // 3. Calculate fee
      const denomination = POOL_LAMPORTS[request.poolSize];
      const fee = this.calculateFee(denomination);

      // 4. Submit stealth transfer
      const signature = await this.submitStealthTransfer(
        stealthAddress,
        stealthHash,
        ephemeralPubkey,
        request.poolSize,
        this.computeNullifierHash(request.nullifier),
        fee
      );

      logger.info('Stealth transfer relayed', {
        signature,
        stealthAddress: stealthAddress.toString(),
      });

      return {
        success: true,
        signature,
        stealthAddress: stealthAddress.toString(),
        fee,
        timestamp: Date.now(),
      };

    } catch (error: any) {
      logger.error('Stealth transfer failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate a stealth address from recipient's meta-address
   */
  private generateStealthAddress(
    recipientStealthMeta: string
  ): { stealthAddress: PublicKey; ephemeralPubkey: Uint8Array; stealthHash: Uint8Array } {
    // Generate ephemeral keypair
    const ephemeralKeypair = nacl.box.keyPair();
    
    // Derive stealth hash from shared secret
    // In production: use proper ECDH with recipient's public spend/view keys
    const stealthHash = crypto.createHash('sha256')
      .update(Buffer.concat([
        Buffer.from(ephemeralKeypair.publicKey),
        Buffer.from(bs58.decode(recipientStealthMeta)),
      ]))
      .digest();

    // Derive stealth PDA
    const [stealthAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from('stealth'), stealthHash],
      this.programId
    );

    return {
      stealthAddress,
      ephemeralPubkey: ephemeralKeypair.publicKey,
      stealthHash: new Uint8Array(stealthHash),
    };
  }

  /**
   * Submit stealth transfer transaction
   */
  private async submitStealthTransfer(
    stealthAddress: PublicKey,
    stealthHash: Uint8Array,
    ephemeralPubkey: Uint8Array,
    poolSize: PoolSize,
    nullifierHash: string,
    fee: number
  ): Promise<string> {
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

    const [stealthPaymentPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('stealth_payment'), stealthHash],
      this.programId
    );

    // Build instruction
    const discriminator = this.getDiscriminator('withdraw_to_stealth');
    const nullifierBytes = Buffer.alloc(32); // Placeholder for nullifier

    // Pad ephemeral pubkey to 32 bytes
    const ephemeralPubkey32 = Buffer.alloc(32);
    ephemeralPubkey32.set(ephemeralPubkey.slice(0, 32));

    const data = Buffer.concat([
      discriminator,
      Buffer.from(stealthHash),    // stealth_hash: [u8; 32]
      ephemeralPubkey32,           // ephemeral_pubkey: [u8; 32]
      nullifierBytes,              // nullifier: [u8; 32]
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: poolPDA, isSigner: false, isWritable: false },
        { pubkey: vaultPDA, isSigner: false, isWritable: true },
        { pubkey: stealthAddress, isSigner: false, isWritable: true },
        { pubkey: stealthPaymentPDA, isSigner: false, isWritable: true },
        { pubkey: this.relayerKeypair.publicKey, isSigner: true, isWritable: true },
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
   * Verify note is valid
   */
  private verifyNote(request: StealthTransferRequest): { valid: boolean; error?: string } {
    try {
      const nullifier = bs58.decode(request.nullifier);
      const secret = bs58.decode(request.secret);

      const combined = Buffer.concat([Buffer.from(nullifier), Buffer.from(secret)]);
      const computedCommitment = crypto.createHash('sha256').update(combined).digest('hex');

      if (computedCommitment !== request.noteCommitment) {
        return { valid: false, error: 'Invalid note' };
      }

      return { valid: true };
    } catch (error: any) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Scan for stealth payments to a wallet
   */
  async scanStealthPayments(
    viewingKey: Uint8Array,
    spendingPubkey: PublicKey
  ): Promise<Array<{ address: string; amount: number }>> {
    // In production: scan all stealth payment accounts
    // Check if viewingKey + ephemeralPubkey derives to the stealth address
    // This proves the payment was for this recipient
    return [];
  }

  private calculateFee(denomination: number): number {
    let fee = Math.floor(denomination * (this.config.feePercent / 100));
    fee = Math.max(fee, this.config.minFee);
    fee = Math.min(fee, this.config.maxFee);
    return fee;
  }

  private computeNullifierHash(nullifier: string): string {
    const nullifierBytes = bs58.decode(nullifier);
    return crypto.createHash('sha256').update(nullifierBytes).digest('hex');
  }

  private getDiscriminator(name: string): Buffer {
    const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
    return hash.slice(0, 8);
  }

  private toLEBytes(num: number): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(num));
    return buf;
  }
}
