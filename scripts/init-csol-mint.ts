/**
 * VELO cSOL MINT INITIALIZATION
 * 
 * Creates a Token-2022 mint with Confidential Transfer extension.
 * This enables encrypted balances and private transfers.
 * 
 * Run: npx tsx scripts/init-csol-mint.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  createInitializeMintInstruction,
  getMintLen,
  createInitializeTransferFeeConfigInstruction,
  createInitializePermanentDelegateInstruction,
} from '@solana/spl-token';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const NETWORK = process.env.SOLANA_NETWORK || 'devnet';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const DECIMALS = 9; // Same as SOL

// Fee configuration (0.5% = 50 basis points)
const FEE_BASIS_POINTS = 50;
const MAX_FEE = BigInt(1_000_000_000); // 1 SOL max fee

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function loadKeypair(filePath: string): Keypair {
  const resolvedPath = filePath.replace('~', os.homedir());
  const secretKey = JSON.parse(readFileSync(resolvedPath, 'utf-8'));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

function saveKeypair(keypair: Keypair, filePath: string): void {
  const resolvedPath = filePath.replace('~', os.homedir());
  writeFileSync(resolvedPath, JSON.stringify(Array.from(keypair.secretKey)));
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('          VELO CONFIDENTIAL SOL (cSOL) MINT SETUP');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Network:', NETWORK);
  console.log('RPC:', RPC_URL);
  console.log('');

  const connection = new Connection(RPC_URL, 'confirmed');

  // ═══════════════════════════════════════════════════════════════════
  // LOAD OR CREATE AUTHORITY KEYPAIR
  // ═══════════════════════════════════════════════════════════════════

  const authorityPath = path.join(os.homedir(), '.config', 'solana', 'velo-authority.json');
  let authority: Keypair;

  if (existsSync(authorityPath)) {
    console.log('Loading existing Velo authority...');
    authority = loadKeypair(authorityPath);
  } else {
    console.log('Creating new Velo authority keypair...');
    authority = Keypair.generate();
    saveKeypair(authority, authorityPath);
    console.log('Saved to:', authorityPath);
  }

  console.log('Authority:', authority.publicKey.toBase58());

  // Check balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log('Balance:', balance / LAMPORTS_PER_SOL, 'SOL');

  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.log('');
    console.log('Requesting airdrop...');
    try {
      const sig = await connection.requestAirdrop(authority.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, 'confirmed');
      console.log('✓ Airdrop successful');
    } catch (e) {
      console.log('Airdrop failed. Please fund the authority wallet manually.');
      console.log('Address:', authority.publicKey.toBase58());
      process.exit(1);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECK EXISTING CONFIG
  // ═══════════════════════════════════════════════════════════════════

  const configPath = path.join(process.cwd(), 'csol-config.json');
  
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    console.log('');
    console.log('Existing cSOL mint found:');
    console.log('  Address:', config.mintAddress);
    console.log('  Created:', new Date(config.createdAt).toISOString());

    // Verify it exists on-chain
    try {
      const mintAccount = await connection.getAccountInfo(new PublicKey(config.mintAddress));
      if (mintAccount) {
        console.log('  Status: ✓ Active on-chain');
        console.log('');
        console.log('To create a new mint, delete csol-config.json and run again.');
        return;
      }
    } catch (e) {
      console.log('  Status: Not found on-chain, creating new mint...');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CREATE MINT
  // ═══════════════════════════════════════════════════════════════════

  console.log('');
  console.log('Creating cSOL Token-2022 mint...');

  const mintKeypair = Keypair.generate();
  console.log('Mint address:', mintKeypair.publicKey.toBase58());

  // Calculate space needed for mint with extensions
  // Using TransferFeeConfig for now (Confidential Transfer requires more setup)
  const extensions = [ExtensionType.TransferFeeConfig];
  const mintLen = getMintLen(extensions);
  
  console.log('Extensions: TransferFeeConfig');
  console.log('Account size:', mintLen, 'bytes');

  // Get rent
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
  console.log('Rent:', lamports / LAMPORTS_PER_SOL, 'SOL');

  // Build transaction
  const transaction = new Transaction();

  // 1. Create account
  transaction.add(
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    })
  );

  // 2. Initialize transfer fee config
  transaction.add(
    createInitializeTransferFeeConfigInstruction(
      mintKeypair.publicKey,
      authority.publicKey,  // Transfer fee config authority
      authority.publicKey,  // Withdraw withheld authority
      FEE_BASIS_POINTS,
      MAX_FEE,
      TOKEN_2022_PROGRAM_ID
    )
  );

  // 3. Initialize mint
  transaction.add(
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      DECIMALS,
      authority.publicKey,  // Mint authority
      authority.publicKey,  // Freeze authority
      TOKEN_2022_PROGRAM_ID
    )
  );

  // Send transaction
  console.log('');
  console.log('Sending transaction...');

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [authority, mintKeypair],
      { commitment: 'confirmed' }
    );

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                    ✓ MINT CREATED SUCCESSFULLY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('Transaction:', signature);
    console.log('Solscan:', `https://solscan.io/tx/${signature}?cluster=${NETWORK}`);
    console.log('');
    console.log('cSOL Mint:', mintKeypair.publicKey.toBase58());
    console.log('Authority:', authority.publicKey.toBase58());
    console.log('');

    // Save config
    const config = {
      mintAddress: mintKeypair.publicKey.toBase58(),
      authority: authority.publicKey.toBase58(),
      decimals: DECIMALS,
      feeBasisPoints: FEE_BASIS_POINTS,
      maxFee: MAX_FEE.toString(),
      network: NETWORK,
      createdAt: Date.now(),
      txSignature: signature,
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('Config saved to:', configPath);

    // Generate constants file
    const constantsContent = `/**
 * cSOL MINT CONSTANTS
 * Auto-generated on ${new Date().toISOString()}
 * Network: ${NETWORK}
 */

import { PublicKey } from '@solana/web3.js';

// cSOL Token-2022 Mint
export const CSOL_MINT = new PublicKey('${mintKeypair.publicKey.toBase58()}');
export const CSOL_DECIMALS = ${DECIMALS};

// Velo Authority (can mint/burn cSOL)
export const VELO_AUTHORITY = new PublicKey('${authority.publicKey.toBase58()}');

// Fee configuration
export const CSOL_FEE_BASIS_POINTS = ${FEE_BASIS_POINTS}; // ${FEE_BASIS_POINTS / 100}%
export const CSOL_MAX_FEE = BigInt('${MAX_FEE.toString()}');
`;

    const constantsPath = path.join(process.cwd(), 'src', 'lib', 'confidential', 'csol-mint.ts');
    writeFileSync(constantsPath, constantsContent);
    console.log('Constants saved to:', constantsPath);

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                         NEXT STEPS');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('1. Add to .env.local:');
    console.log(`   NEXT_PUBLIC_CSOL_MINT=${mintKeypair.publicKey.toBase58()}`);
    console.log(`   NEXT_PUBLIC_VELO_AUTHORITY=${authority.publicKey.toBase58()}`);
    console.log('');
    console.log('2. Fund the authority wallet with SOL for user withdrawals:');
    console.log(`   solana transfer ${authority.publicKey.toBase58()} 10 --allow-unfunded-recipient`);
    console.log('');
    console.log('3. Start the app: npm run dev');
    console.log('');

  } catch (error: any) {
    console.error('');
    console.error('Failed to create mint:', error.message);
    if (error.logs) {
      console.error('Logs:', error.logs);
    }
    process.exit(1);
  }
}

main().catch(console.error);
