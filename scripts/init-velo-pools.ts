import { Connection, PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL, Transaction, TransactionInstruction } from "@solana/web3.js";
import { readFileSync } from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";

// NEW Velo Program ID
const VELO_PROGRAM_ID = new PublicKey("AQgeVtAYEvigMbBW5gEiK4voELjFB94fDY9cFZqKHgZ8");

// Pool denominations in lamports
const POOL_DENOMINATIONS = {
  SMALL: 0.1 * LAMPORTS_PER_SOL,   // 100,000,000 lamports
  MEDIUM: 1 * LAMPORTS_PER_SOL,    // 1,000,000,000 lamports
  LARGE: 10 * LAMPORTS_PER_SOL,    // 10,000,000,000 lamports
};

function toLEBytes(num: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(num), 0);
  return buf;
}

function findPoolPDA(denomination: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("velo_pool"), toLEBytes(denomination)],
    VELO_PROGRAM_ID
  );
}

async function initializePool(
  connection: Connection,
  payer: Keypair,
  denomination: number,
  poolName: string
): Promise<string | null> {
  const [poolPDA, bump] = findPoolPDA(denomination);
  
  console.log(`\n📦 Initializing ${poolName} pool (${denomination / LAMPORTS_PER_SOL} SOL)...`);
  console.log(`   Pool PDA: ${poolPDA.toBase58()}`);
  
  // Check if pool already exists
  const existingAccount = await connection.getAccountInfo(poolPDA);
  if (existingAccount) {
    console.log(`   ✅ Pool already exists (${existingAccount.data.length} bytes)`);
    return null;
  }
  
  // Create instruction data for initialize_pool
  // Discriminator for Anchor: first 8 bytes of sha256("global:initialize_pool")
  const hash = createHash("sha256").update("global:initialize_pool").digest();
  const discriminator = hash.slice(0, 8);
  
  const denominationBytes = toLEBytes(denomination);
  const data = Buffer.concat([discriminator, denominationBytes]);
  
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: poolPDA, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: VELO_PROGRAM_ID,
    data,
  });
  
  const transaction = new Transaction().add(instruction);
  
  try {
    const signature = await connection.sendTransaction(transaction, [payer], {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    
    await connection.confirmTransaction(signature, "confirmed");
    console.log(`   ✅ Initialized! Signature: ${signature.slice(0, 20)}...`);
    console.log(`   🔗 https://solscan.io/tx/${signature}?cluster=devnet`);
    return signature;
  } catch (error: any) {
    console.error(`   ❌ Failed: ${error.message}`);
    if (error.logs) {
      console.error("   Logs:", error.logs.slice(-5));
    }
    return null;
  }
}

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("       VELO PRIVACY PROTOCOL");
  console.log("       Pool Initialization");
  console.log("═══════════════════════════════════════");
  console.log(`Program ID: ${VELO_PROGRAM_ID.toBase58()}`);
  
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // Load wallet
  const homeDir = os.homedir();
  let walletPath: string;
  
  // Try WSL path first (if running in WSL)
  if (process.platform === "linux" && process.env.WSL_DISTRO_NAME) {
    walletPath = path.join(homeDir, ".config", "solana", "id.json");
  } else {
    // Windows path - point to WSL wallet
    walletPath = "\\\\wsl$\\Ubuntu\\home\\freemell\\.config\\solana\\id.json";
  }
  
  let payer: Keypair;
  try {
    const walletSecretKey = JSON.parse(readFileSync(walletPath, "utf-8"));
    payer = Keypair.fromSecretKey(Uint8Array.from(walletSecretKey));
    console.log(`\n👤 Authority: ${payer.publicKey.toBase58()}`);
    
    const balance = await connection.getBalance(payer.publicKey);
    console.log(`💰 Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    
    if (balance < 0.1 * LAMPORTS_PER_SOL) {
      console.error("❌ Insufficient balance. Need at least 0.1 SOL");
      return;
    }
  } catch (error) {
    console.error(`❌ Could not load wallet from: ${walletPath}`);
    console.error("   Error:", error);
    return;
  }
  
  // Initialize all three pools
  const results: { name: string; denomination: number; pda: string; success: boolean }[] = [];
  
  for (const [name, denomination] of Object.entries(POOL_DENOMINATIONS)) {
    const [pda] = findPoolPDA(denomination);
    const sig = await initializePool(connection, payer, denomination, name);
    results.push({ 
      name, 
      denomination, 
      pda: pda.toBase58(),
      success: sig !== null 
    });
  }
  
  // Summary
  console.log("\n═══════════════════════════════════════");
  console.log("📊 Velo Pool Summary:");
  console.log("═══════════════════════════════════════");
  for (const result of results) {
    const status = result.success ? "✅ NEW" : "✅ EXISTS";
    console.log(`   ${result.name}: ${result.pda.slice(0, 16)}... (${result.denomination / LAMPORTS_PER_SOL} SOL) ${status}`);
  }
  
  console.log("\n✅ Velo pools are ready for private deposits!");
  console.log(`\n🔗 View program: https://solscan.io/account/${VELO_PROGRAM_ID.toBase58()}?cluster=devnet`);
}

main().catch(console.error);
