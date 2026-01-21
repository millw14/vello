import { Connection, PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL, Transaction, TransactionInstruction } from "@solana/web3.js";
import { readFileSync } from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";

const MIXER_PROGRAM_ID = new PublicKey("DSQt1z5wNcmE5h2XL1K1QAWHy28iJufg52aGy3kn8pEc");

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
    [Buffer.from("pool"), toLEBytes(denomination)],
    MIXER_PROGRAM_ID
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
  console.log(`   Discriminator: ${discriminator.toString("hex")}`);
  
  const denominationBytes = toLEBytes(denomination);
  const data = Buffer.concat([discriminator, denominationBytes]);
  
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: poolPDA, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: MIXER_PROGRAM_ID,
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
    console.log(`   🔗 https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    return signature;
  } catch (error: any) {
    console.error(`   ❌ Failed: ${error.message}`);
    if (error.logs) {
      console.error("   Logs:", error.logs.slice(-3));
    }
    return null;
  }
}

async function main() {
  console.log("🚀 Initializing Velo Mixer Pools on Devnet");
  console.log("==========================================");
  
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
  const results: { name: string; denomination: number; success: boolean }[] = [];
  
  for (const [name, denomination] of Object.entries(POOL_DENOMINATIONS)) {
    const sig = await initializePool(connection, payer, denomination, name);
    results.push({ name, denomination, success: sig !== null || true }); // true if already exists
  }
  
  // Summary
  console.log("\n==========================================");
  console.log("📊 Pool Initialization Summary:");
  for (const result of results) {
    const [pda] = findPoolPDA(result.denomination);
    console.log(`   ${result.name}: ${pda.toBase58().slice(0, 12)}... (${result.denomination / LAMPORTS_PER_SOL} SOL)`);
  }
  
  console.log("\n✅ Done! Pools are ready for deposits.");
}

main().catch(console.error);
