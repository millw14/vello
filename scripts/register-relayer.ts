/**
 * Register the Relayer on Velo Program
 * 
 * This must be run ONCE before the relayer can process withdrawals.
 * The relayer keypair should be funded first!
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
import * as fs from 'fs';
import * as crypto from 'crypto';

// Configuration
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const VELO_PROGRAM_ID = new PublicKey('AQgeVtAYEvigMbBW5gEiK4voELjFB94fDY9cFZqKHgZ8');
const RELAYER_KEYPAIR_PATH = './relayer/relayer-keypair.json';
const AUTHORITY_KEYPAIR_PATH = process.env.AUTHORITY_KEYPAIR_PATH || './authority-keypair.json';

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('     VELO RELAYER REGISTRATION');
  console.log('═══════════════════════════════════════');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  console.log('Connected to:', RPC_URL);

  // Load relayer keypair
  let relayerKeypair: Keypair;
  if (fs.existsSync(RELAYER_KEYPAIR_PATH)) {
    const data = JSON.parse(fs.readFileSync(RELAYER_KEYPAIR_PATH, 'utf-8'));
    relayerKeypair = Keypair.fromSecretKey(Uint8Array.from(data));
    console.log('Loaded relayer keypair:', relayerKeypair.publicKey.toString());
  } else {
    relayerKeypair = Keypair.generate();
    fs.mkdirSync('./relayer', { recursive: true });
    fs.writeFileSync(RELAYER_KEYPAIR_PATH, JSON.stringify(Array.from(relayerKeypair.secretKey)));
    console.log('Generated new relayer keypair:', relayerKeypair.publicKey.toString());
    console.log('⚠️  FUND THIS WALLET BEFORE CONTINUING!');
  }

  // Load authority keypair (who can register relayers)
  let authorityKeypair: Keypair;
  if (fs.existsSync(AUTHORITY_KEYPAIR_PATH)) {
    const data = JSON.parse(fs.readFileSync(AUTHORITY_KEYPAIR_PATH, 'utf-8'));
    authorityKeypair = Keypair.fromSecretKey(Uint8Array.from(data));
    console.log('Loaded authority keypair:', authorityKeypair.publicKey.toString());
  } else {
    // For devnet, use relayer as authority
    authorityKeypair = relayerKeypair;
    console.log('Using relayer as authority (devnet mode)');
  }

  // Check balances
  const relayerBalance = await connection.getBalance(relayerKeypair.publicKey);
  const authorityBalance = await connection.getBalance(authorityKeypair.publicKey);
  
  console.log('Relayer balance:', relayerBalance / 1e9, 'SOL');
  console.log('Authority balance:', authorityBalance / 1e9, 'SOL');

  if (authorityBalance < 0.01 * 1e9) {
    console.log('\n⚠️  Authority needs SOL! Airdropping...');
    try {
      const sig = await connection.requestAirdrop(authorityKeypair.publicKey, 1e9);
      await connection.confirmTransaction(sig);
      console.log('✓ Airdropped 1 SOL to authority');
    } catch (e) {
      console.error('Airdrop failed:', e);
    }
  }

  // Derive relayer state PDA
  const [relayerStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('relayer'), relayerKeypair.publicKey.toBuffer()],
    VELO_PROGRAM_ID
  );
  console.log('Relayer state PDA:', relayerStatePDA.toString());

  // Check if already registered
  const existingAccount = await connection.getAccountInfo(relayerStatePDA);
  if (existingAccount) {
    console.log('\n✓ Relayer is already registered!');
    return;
  }

  console.log('\nRegistering relayer...');

  // Build register_relayer instruction
  const discriminator = getDiscriminator('register_relayer');
  const data = Buffer.from(discriminator);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: relayerStatePDA, isSigner: false, isWritable: true },
      { pubkey: relayerKeypair.publicKey, isSigner: false, isWritable: false },
      { pubkey: authorityKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: VELO_PROGRAM_ID,
    data,
  });

  const transaction = new Transaction().add(instruction);
  
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [authorityKeypair],
      { commitment: 'confirmed' }
    );

    console.log('\n═══════════════════════════════════════');
    console.log('✓ RELAYER REGISTERED SUCCESSFULLY!');
    console.log('═══════════════════════════════════════');
    console.log('Signature:', signature);
    console.log('Relayer:', relayerKeypair.publicKey.toString());
    console.log('\nThe relayer can now process private withdrawals!');
  } catch (error: any) {
    console.error('\nRegistration failed:', error.message);
    
    if (error.logs) {
      console.log('\nProgram logs:');
      error.logs.forEach((log: string) => console.log('  ', log));
    }
  }
}

main().catch(console.error);
