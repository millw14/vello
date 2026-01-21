/**
 * Initialize the Velo Mixer Pool on Devnet
 * 
 * Run with: npx ts-node scripts/init-mixer.ts
 */

import { 
  Connection, 
  PublicKey, 
  Keypair, 
  Transaction, 
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const MIXER_PROGRAM_ID = new PublicKey('DSQt1z5wNcmE5h2XL1K1QAWHy28iJufg52aGy3kn8pEc');

// Anchor discriminator for "initialize" instruction
// This is the first 8 bytes of sha256("global:initialize")
const INITIALIZE_DISCRIMINATOR = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);

async function main() {
  console.log('🚀 Initializing Velo Mixer Pool on Devnet...\n');

  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Load wallet - check multiple locations
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const possiblePaths = [
    path.join(homeDir, '.config', 'solana', 'id.json'),
    // WSL path accessible from Windows
    '\\\\wsl$\\Ubuntu\\home\\freemell\\.config\\solana\\id.json',
    // Direct WSL mount
    '/home/freemell/.config/solana/id.json',
  ];
  
  let keypairPath = '';
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      keypairPath = p;
      console.log('📁 Found wallet at:', p);
      break;
    }
  }
  
  if (!keypairPath) {
    console.error('❌ Wallet not found. Tried:');
    possiblePaths.forEach(p => console.log('   -', p));
    console.log('\nCopy from WSL:');
    console.log('  wsl cp ~/.config/solana/id.json /mnt/c/Users/1/.config/solana/id.json');
    return;
  }
  
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  console.log('👤 Authority:', authority.publicKey.toBase58());
  
  // Check balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log('💰 Balance:', balance / LAMPORTS_PER_SOL, 'SOL\n');
  
  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.error('❌ Insufficient balance. Need at least 0.1 SOL');
    console.log('Run: solana airdrop 1');
    return;
  }

  // Derive mixer pool PDA
  const [mixerPoolPDA, mixerBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('mixer')],
    MIXER_PROGRAM_ID
  );
  console.log('📍 Mixer Pool PDA:', mixerPoolPDA.toBase58());
  
  // Derive vault PDA
  const [vaultPDA, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault')],
    MIXER_PROGRAM_ID
  );
  console.log('🏦 Vault PDA:', vaultPDA.toBase58());

  // Check if already initialized
  const existingAccount = await connection.getAccountInfo(mixerPoolPDA);
  if (existingAccount) {
    console.log('\n✅ Mixer pool already initialized!');
    console.log('   Owner:', existingAccount.owner.toBase58());
    console.log('   Data length:', existingAccount.data.length, 'bytes');
    return;
  }

  // Build initialize instruction
  // deposit_amount: u64 = 1 SOL = 1_000_000_000 lamports
  const depositAmount = BigInt(1 * LAMPORTS_PER_SOL);
  const depositAmountBuffer = Buffer.alloc(8);
  depositAmountBuffer.writeBigUInt64LE(depositAmount);

  const data = Buffer.concat([
    INITIALIZE_DISCRIMINATOR,
    depositAmountBuffer,
  ]);

  const initializeIx = new TransactionInstruction({
    keys: [
      { pubkey: mixerPoolPDA, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: MIXER_PROGRAM_ID,
    data,
  });

  // Send transaction
  console.log('\n📤 Sending initialize transaction...');
  
  const tx = new Transaction().add(initializeIx);
  
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [authority],
      { commitment: 'confirmed' }
    );
    
    console.log('\n✅ Mixer Pool Initialized Successfully!');
    console.log('📝 Signature:', signature);
    console.log('🔗 Explorer: https://explorer.solana.com/tx/' + signature + '?cluster=devnet');
    
    // Verify
    const poolAccount = await connection.getAccountInfo(mixerPoolPDA);
    if (poolAccount) {
      console.log('\n📊 Pool Account:');
      console.log('   Size:', poolAccount.data.length, 'bytes');
      console.log('   Lamports:', poolAccount.lamports);
    }
    
  } catch (error: any) {
    console.error('\n❌ Transaction failed:', error.message);
    if (error.logs) {
      console.log('\nProgram logs:');
      error.logs.forEach((log: string) => console.log('  ', log));
    }
  }
}

main().catch(console.error);
