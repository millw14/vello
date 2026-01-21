/**
 * Initialize cSOL Mint with Token-2022
 * 
 * This creates a new SPL Token-2022 mint for wrapped SOL.
 * Note: Full confidential transfers require the Confidential Transfer extension
 * which needs additional setup. For now, we use client-side encryption simulation.
 * 
 * Run once to set up the Velo confidential token system.
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
  createInitializeMintInstruction,
  getMintLen,
  ExtensionType,
} from '@solana/spl-token';
import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

const DEVNET_URL = 'https://api.devnet.solana.com';

interface ConfidentialMintConfig {
  mintAddress: string;
  authority: string;
  decimals: number;
  createdAt: number;
  network: string;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('     VELO CONFIDENTIAL SOL (cSOL) MINT INITIALIZATION');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  
  // Load authority keypair
  const keypairPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  const secretKey = JSON.parse(readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  console.log('Authority:', authority.publicKey.toBase58());
  
  const connection = new Connection(DEVNET_URL, 'confirmed');
  
  // Check balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log('Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
  
  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    console.log('');
    console.log('⚠️  Low balance. Requesting airdrop...');
    try {
      const sig = await connection.requestAirdrop(authority.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, 'confirmed');
      console.log('✅ Airdrop successful');
    } catch (e) {
      console.log('Airdrop failed, continuing anyway...');
    }
  }
  
  // Check if mint already exists
  const configPath = path.join(process.cwd(), 'csol-mint-config.json');
  try {
    const existingConfig: ConfidentialMintConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    console.log('');
    console.log('⚠️  cSOL mint already exists!');
    console.log('   Address:', existingConfig.mintAddress);
    console.log('   Created:', new Date(existingConfig.createdAt).toISOString());
    
    // Verify it still exists on-chain
    const mintPubkey = new PublicKey(existingConfig.mintAddress);
    const mintAccount = await connection.getAccountInfo(mintPubkey);
    
    if (mintAccount) {
      console.log('   Status: ✅ Active on-chain');
      return;
    } else {
      console.log('   Status: ❌ Not found on-chain, recreating...');
    }
  } catch (e) {
    console.log('No existing mint found, creating new one...');
  }
  
  // Generate new mint keypair
  const mintKeypair = Keypair.generate();
  console.log('');
  console.log('New cSOL Mint:', mintKeypair.publicKey.toBase58());
  
  // Calculate space needed for mint (basic Token-2022, no extensions for now)
  // Note: Full confidential transfers would need ExtensionType.ConfidentialTransferMint
  const mintLen = getMintLen([]);
  
  console.log('Mint account size:', mintLen, 'bytes');
  console.log('Note: Using client-side encryption simulation for confidential amounts');
  
  // Calculate rent
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
  console.log('Rent exemption:', lamports / LAMPORTS_PER_SOL, 'SOL');
  
  // Create transaction
  const transaction = new Transaction();
  
  // 1. Create account for mint
  transaction.add(
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    })
  );
  
  // 2. Initialize mint
  const decimals = 9; // Same as SOL
  transaction.add(
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      decimals,
      authority.publicKey,  // Mint authority
      null,                 // Freeze authority (none)
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  console.log('');
  console.log('Creating cSOL Token-2022 mint...');
  
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [authority, mintKeypair],
      { commitment: 'confirmed' }
    );
    
    console.log('');
    console.log('✅ cSOL Mint created successfully!');
    console.log('');
    console.log('Transaction:', signature);
    console.log('Solscan: https://solscan.io/tx/' + signature + '?cluster=devnet');
    console.log('');
    
    // Save config
    const config: ConfidentialMintConfig = {
      mintAddress: mintKeypair.publicKey.toBase58(),
      authority: authority.publicKey.toBase58(),
      decimals,
      createdAt: Date.now(),
      network: 'devnet',
    };
    
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('Config saved to:', configPath);
    
    // Also update the constants file
    const constantsContent = `// Auto-generated cSOL mint address
// Created: ${new Date().toISOString()}

import { PublicKey } from '@solana/web3.js';

export const CSOL_MINT = new PublicKey('${mintKeypair.publicKey.toBase58()}');
export const CSOL_DECIMALS = ${decimals};
export const CSOL_AUTHORITY = new PublicKey('${authority.publicKey.toBase58()}');
`;
    
    writeFileSync(
      path.join(process.cwd(), 'src', 'lib', 'solana', 'csol-constants.ts'),
      constantsContent
    );
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('                    MINT CREATED');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('cSOL Mint Address:', mintKeypair.publicKey.toBase58());
    console.log('');
    console.log('How it works:');
    console.log('1. Users deposit SOL → receive cSOL');
    console.log('2. Amounts are encrypted client-side before storage');
    console.log('3. Only sender/recipient can decrypt their balances');
    console.log('4. Withdraw cSOL → get SOL back');
    console.log('');
    console.log('Note: Full on-chain confidential transfers require');
    console.log('the Confidential Transfer extension and ZK proofs.');
    console.log('Currently using simplified client-side encryption.');
    console.log('');
    
  } catch (error) {
    console.error('Failed to create mint:', error);
    throw error;
  }
}

main().catch(console.error);
