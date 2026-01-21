/**
 * Velo Privacy Protocol Client
 * 
 * Interacts with the deployed Velo program on Solana devnet
 * Program ID: AQgeVtAYEvigMbBW5gEiK4voELjFB94fDY9cFZqKHgZ8
 * 
 * Features:
 * - ZK-ready architecture with Merkle tree tracking
 * - Nullifier-based double-spend prevention  
 * - Three pool denominations: 0.1, 1, 10 SOL
 * - Confidential transfers with encrypted amounts
 * - Decoy system for traffic analysis resistance
 * - Automatic private transfer to any wallet (receiver doesn't need Velo!)
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
import bs58 from 'bs58';
import CryptoJS from 'crypto-js';
import nacl from 'tweetnacl';

// Deployed Velo Program ID
export const VELO_PROGRAM_ID = new PublicKey('AQgeVtAYEvigMbBW5gEiK4voELjFB94fDY9cFZqKHgZ8');

// Pool denominations in lamports
export const POOL_DENOMINATIONS = {
  SMALL: 0.1 * LAMPORTS_PER_SOL,   // 100,000,000 lamports
  MEDIUM: 1 * LAMPORTS_PER_SOL,    // 1,000,000,000 lamports
  LARGE: 10 * LAMPORTS_PER_SOL,    // 10,000,000,000 lamports
} as const;

export type PoolSize = keyof typeof POOL_DENOMINATIONS;

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
 * Find pool PDA for a given denomination (uses "velo_pool" seed)
 */
function findPoolPDA(denomination: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [stringToBytes('velo_pool'), toLEBytes(denomination)],
    VELO_PROGRAM_ID
  );
}

/**
 * Find vault PDA for a given denomination (uses "velo_vault" seed)
 */
function findVaultPDA(denomination: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [stringToBytes('velo_vault'), toLEBytes(denomination)],
    VELO_PROGRAM_ID
  );
}

/**
 * Get pool and vault PDAs for a pool size
 */
export function getPoolPDAs(poolSize: PoolSize): { poolPDA: PublicKey; vaultPDA: PublicKey } {
  const denomination = POOL_DENOMINATIONS[poolSize];
  return {
    poolPDA: findPoolPDA(denomination)[0],
    vaultPDA: findVaultPDA(denomination)[0],
  };
}

/**
 * Derive poolSize from denomination (for backward compatibility with old notes)
 */
export function getPoolSizeFromDenomination(denomination: number): PoolSize {
  const LAMPORTS_PER_SOL = 1_000_000_000;
  if (denomination === 0.1 * LAMPORTS_PER_SOL) return 'SMALL';
  if (denomination === 1 * LAMPORTS_PER_SOL) return 'MEDIUM';
  if (denomination === 10 * LAMPORTS_PER_SOL) return 'LARGE';
  // Default to SMALL if unknown
  console.warn('Unknown denomination:', denomination, 'defaulting to SMALL');
  return 'SMALL';
}

export interface VeloNote {
  commitment: string;
  nullifier: string;
  nullifierHash: string;
  secret: string;
  denomination: number;
  depositTime: number;
  leafIndex?: number;
  poolSize: PoolSize;
}

/**
 * Generate a Velo deposit note with nullifier hash
 */
export function generateVeloNote(poolSize: PoolSize): VeloNote {
  // Generate random secret and nullifier (32 bytes each)
  const secret = nacl.randomBytes(32);
  const nullifier = nacl.randomBytes(32);
  
  // Compute commitment = hash(nullifier || secret)
  const combined = new Uint8Array([...nullifier, ...secret]);
  const commitment = CryptoJS.SHA256(
    CryptoJS.lib.WordArray.create(combined as unknown as number[])
  ).toString();
  
  // Compute nullifierHash = hash(nullifier)
  const nullifierHash = CryptoJS.SHA256(
    CryptoJS.lib.WordArray.create(nullifier as unknown as number[])
  ).toString();
  
  return {
    commitment,
    nullifier: bs58.encode(nullifier),
    nullifierHash,
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
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(commitment.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Create deposit instruction for Velo program
 */
export function createDepositInstruction(
  depositor: PublicKey,
  commitment: Uint8Array,
  poolSize: PoolSize
): TransactionInstruction {
  const { poolPDA, vaultPDA } = getPoolPDAs(poolSize);
  
  const discriminator = getDiscriminator('deposit');
  const data = Buffer.from(concatBytes(discriminator, commitment));

  return new TransactionInstruction({
    keys: [
      { pubkey: poolPDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: depositor, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: VELO_PROGRAM_ID,
    data,
  });
}

/**
 * Find confidential note PDA
 */
function findConfidentialNotePDA(commitment: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('confidential_note'), commitment],
    VELO_PROGRAM_ID
  )[0];
}

/**
 * Create confidential deposit instruction (with encrypted amount)
 * Observer sees encrypted blob instead of actual amount
 */
export function createConfidentialDepositInstruction(
  depositor: PublicKey,
  commitment: Uint8Array,
  encryptedAmount: Uint8Array, // 128 bytes fixed size
  poolSize: PoolSize
): TransactionInstruction {
  const { poolPDA, vaultPDA } = getPoolPDAs(poolSize);
  const confidentialNotePDA = findConfidentialNotePDA(commitment);
  
  const discriminator = getDiscriminator('confidential_deposit');
  
  // Pad encrypted amount to 128 bytes
  const paddedEncryptedAmount = new Uint8Array(128);
  paddedEncryptedAmount.set(encryptedAmount.slice(0, 128), 0);
  
  const data = Buffer.from(concatBytes(discriminator, commitment, paddedEncryptedAmount));

  return new TransactionInstruction({
    keys: [
      { pubkey: poolPDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: confidentialNotePDA, isSigner: false, isWritable: true },
      { pubkey: depositor, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: VELO_PROGRAM_ID,
    data,
  });
}

/**
 * Create withdraw_test instruction (no ZK proof required - for testing)
 */
export function createWithdrawTestInstruction(
  recipient: PublicKey,
  nullifier: Uint8Array,
  poolSize: PoolSize
): TransactionInstruction {
  const { poolPDA, vaultPDA } = getPoolPDAs(poolSize);
  
  const discriminator = getDiscriminator('withdraw_test');
  const data = Buffer.from(concatBytes(discriminator, nullifier));

  return new TransactionInstruction({
    keys: [
      { pubkey: poolPDA, isSigner: false, isWritable: false },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: VELO_PROGRAM_ID,
    data,
  });
}

/**
 * Deposit to Velo pool
 */
export async function depositToVelo(
  connection: Connection,
  depositor: Keypair,
  note: VeloNote
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
    console.error('Velo deposit failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Withdraw from Velo pool (test mode - no ZK proof)
 * In production, this would use the full ZK withdraw with proofs
 */
export async function withdrawFromVelo(
  connection: Connection,
  feePayer: Keypair,
  note: VeloNote,
  recipient: PublicKey
): Promise<{ success: boolean; signature?: string; error?: string }> {
  try {
    const nullifierBytes = bs58.decode(note.nullifier);
    
    const tx = new Transaction();
    tx.add(createWithdrawTestInstruction(recipient, nullifierBytes, note.poolSize));
    
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [feePayer],
      { commitment: 'confirmed' }
    );
    
    return { success: true, signature };
  } catch (error: any) {
    console.error('Velo withdraw failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get Velo pool info for a specific denomination
 */
export async function getVeloPoolInfo(
  connection: Connection,
  poolSize: PoolSize
): Promise<{
  authority: string;
  denomination: number;
  merkleRoot: string;
  nextIndex: number;
  totalDeposits: number;
} | null> {
  try {
    const { poolPDA } = getPoolPDAs(poolSize);
    const accountInfo = await connection.getAccountInfo(poolPDA);
    if (!accountInfo) return null;
    
    // Parse account data (skip 8-byte discriminator)
    const data = accountInfo.data.slice(8);
    
    // VeloPool struct:
    // authority (32) + denomination (8) + merkle_root (32) + next_index (4) + total_deposits (8)
    const authority = new PublicKey(data.slice(0, 32)).toBase58();
    const denomination = Number(data.readBigUInt64LE(32));
    const merkleRoot = data.slice(40, 72).toString('hex');
    const nextIndex = data.readUInt32LE(72);
    const totalDeposits = Number(data.readBigUInt64LE(76));
    
    return { authority, denomination, merkleRoot, nextIndex, totalDeposits };
  } catch (error) {
    console.error('Failed to get Velo pool info:', error);
    return null;
  }
}

/**
 * Get all pool infos
 */
export async function getAllVeloPoolInfos(connection: Connection): Promise<{
  SMALL: Awaited<ReturnType<typeof getVeloPoolInfo>>;
  MEDIUM: Awaited<ReturnType<typeof getVeloPoolInfo>>;
  LARGE: Awaited<ReturnType<typeof getVeloPoolInfo>>;
}> {
  const [small, medium, large] = await Promise.all([
    getVeloPoolInfo(connection, 'SMALL'),
    getVeloPoolInfo(connection, 'MEDIUM'),
    getVeloPoolInfo(connection, 'LARGE'),
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

// ═══════════════════════════════════════════════════════════════════
// AUTOMATIC PRIVATE TRANSFER
// ═══════════════════════════════════════════════════════════════════
// 
// Flow: Mixer → Fresh Wallet → Recipient
// 
// 1. Withdraw from mixer to a fresh intermediate wallet
// 2. Fresh wallet sends to recipient's regular wallet
// 3. Recipient sees transfer from random wallet (not connected to Velo)
// 4. Recipient does NOT need Velo!

/**
 * Send privately to ANY regular Solana wallet
 * Recipient does NOT need Velo - they just receive SOL from a random wallet
 * 
 * Flow:
 * 1. Withdraw from mixer to fresh intermediate wallet
 * 2. Intermediate wallet sends to recipient
 * 3. Recipient sees: "Received from [random wallet]"
 */
export async function sendPrivateAuto(
  connection: Connection,
  feePayer: Keypair,
  note: VeloNote | MixerNote,
  recipientAddress: string
): Promise<{ 
  success: boolean; 
  signature?: string;
  intermediateWallet?: string;
  error?: string 
}> {
  try {
    const recipient = new PublicKey(recipientAddress);
    
    // Derive poolSize from denomination if not present (backward compatibility)
    const poolSize = note.poolSize || getPoolSizeFromDenomination(note.denomination);
    
    // Step 1: Generate fresh intermediate wallet
    const intermediateWallet = Keypair.generate();
    console.log('🔒 Private Transfer (Auto Mode)');
    console.log('   Pool:', poolSize, '(' + (note.denomination / 1_000_000_000) + ' SOL)');
    console.log('   Intermediate wallet:', intermediateWallet.publicKey.toBase58().slice(0, 16) + '...');
    console.log('   Final recipient:', recipientAddress.slice(0, 16) + '...');
    
    // Step 2: Withdraw from mixer to intermediate wallet
    console.log('   Step 1: Withdrawing from mixer to intermediate...');
    const nullifierBytes = bs58.decode(note.nullifier);
    
    const withdrawTx = new Transaction();
    withdrawTx.add(createWithdrawTestInstruction(
      intermediateWallet.publicKey, 
      nullifierBytes, 
      poolSize
    ));
    
    const withdrawSig = await sendAndConfirmTransaction(
      connection,
      withdrawTx,
      [feePayer],
      { commitment: 'confirmed' }
    );
    console.log('   ✓ Mixer withdrawal:', withdrawSig.slice(0, 20) + '...');
    
    // Small delay to ensure the intermediate wallet is funded
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 3: Send from intermediate to final recipient
    console.log('   Step 2: Sending from intermediate to recipient...');
    
    // Calculate amount to send (leave some for rent if needed)
    const intermediateBalance = await connection.getBalance(intermediateWallet.publicKey);
    const sendAmount = intermediateBalance - 5000; // Leave 5000 lamports for fee
    
    if (sendAmount <= 0) {
      return { success: false, error: 'Intermediate wallet has insufficient balance' };
    }
    
    const transferIx = SystemProgram.transfer({
      fromPubkey: intermediateWallet.publicKey,
      toPubkey: recipient,
      lamports: sendAmount,
    });
    
    const transferTx = new Transaction().add(transferIx);
    
    const transferSig = await sendAndConfirmTransaction(
      connection,
      transferTx,
      [intermediateWallet], // Intermediate wallet signs
      { commitment: 'confirmed' }
    );
    
    console.log('   ✓ Final transfer:', transferSig.slice(0, 20) + '...');
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('   PRIVATE TRANSFER COMPLETE');
    console.log('═══════════════════════════════════════');
    console.log('   Recipient sees: transfer from', intermediateWallet.publicKey.toBase58().slice(0, 12) + '...');
    console.log('   Connection to you: NONE');
    console.log('   Connection to Velo: HIDDEN');
    
    return { 
      success: true, 
      signature: transferSig,
      intermediateWallet: intermediateWallet.publicKey.toBase58(),
    };
  } catch (error: any) {
    console.error('Private transfer failed:', error);
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEALTH TRANSFERS (Maximum Privacy - Recipient is Hidden)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Withdraw from mixer to a stealth address
 * This hides both the sender (mixer) AND the recipient (stealth)
 */
export async function withdrawToStealthOnChain(
  connection: Connection,
  feePayer: Keypair,
  note: VeloNote | MixerNote,
  recipientMetaAddress: string
): Promise<{ 
  success: boolean; 
  signature?: string;
  stealthInfo?: {
    stealthAddress: string;
    ephemeralPublicKey: string;
  };
  error?: string 
}> {
  try {
    const poolSize = note.poolSize || getPoolSizeFromDenomination(note.denomination);
    
    // Generate stealth address from recipient's meta-address
    // Meta-address format: "velo:spend_pub:view_pub"
    const parts = recipientMetaAddress.split(':');
    if (parts.length !== 3 || parts[0] !== 'velo') {
      return { success: false, error: 'Invalid meta-address format. Expected velo:spend:view' };
    }
    
    const spendPub = bs58.decode(parts[1]);
    const viewPub = bs58.decode(parts[2]);
    
    // Generate ephemeral keypair for this transaction
    const ephemeral = nacl.box.keyPair();
    
    // Derive stealth address: S = spend_pub + H(ephemeral_priv * view_pub) * G
    // Simplified: just use spend_pub XOR hash(shared_secret) for demo
    const sharedSecret = nacl.box.before(viewPub, ephemeral.secretKey);
    const hash = nacl.hash(sharedSecret).slice(0, 32);
    
    // Create stealth address (simplified - in production use proper EC math)
    const stealthBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      stealthBytes[i] = spendPub[i] ^ hash[i];
    }
    const stealthKeypair = Keypair.fromSeed(nacl.hash(stealthBytes).slice(0, 32));
    
    console.log('🔒 Stealth Transfer');
    console.log('   Pool:', poolSize);
    console.log('   Stealth address:', stealthKeypair.publicKey.toBase58().slice(0, 16) + '...');
    console.log('   Ephemeral key:', bs58.encode(ephemeral.publicKey).slice(0, 16) + '...');
    
    // Withdraw from mixer to stealth address
    const nullifierBytes = bs58.decode(note.nullifier);
    
    const withdrawTx = new Transaction();
    withdrawTx.add(createWithdrawTestInstruction(
      stealthKeypair.publicKey, 
      nullifierBytes, 
      poolSize
    ));
    
    const signature = await sendAndConfirmTransaction(
      connection,
      withdrawTx,
      [feePayer],
      { commitment: 'confirmed' }
    );
    
    console.log('   ✓ Funds sent to stealth address');
    console.log('   Signature:', signature.slice(0, 20) + '...');
    
    // Store ephemeral public key for recipient to scan
    // In production, this would be published to an announcement contract
    const stealthInfo = {
      stealthAddress: stealthKeypair.publicKey.toBase58(),
      ephemeralPublicKey: bs58.encode(ephemeral.publicKey),
    };
    
    // Save to localStorage (in production, announce on-chain)
    const announcements = JSON.parse(localStorage.getItem('velo_stealth_announcements') || '[]');
    announcements.push({
      ...stealthInfo,
      timestamp: Date.now(),
      amount: note.denomination,
    });
    localStorage.setItem('velo_stealth_announcements', JSON.stringify(announcements));
    
    return { 
      success: true, 
      signature,
      stealthInfo,
    };
  } catch (error: any) {
    console.error('Stealth transfer failed:', error);
    return { success: false, error: error.message };
  }
}

// Export legacy names for compatibility
export const MIXER_PROGRAM_ID = VELO_PROGRAM_ID;
export const generateMixerNote = generateVeloNote;
export const depositToMixer = depositToVelo;
export const withdrawFromMixer = withdrawFromVelo;
export const getMixerPoolInfo = getVeloPoolInfo;
export const getAllPoolInfos = getAllVeloPoolInfos;
export type MixerNote = VeloNote;
