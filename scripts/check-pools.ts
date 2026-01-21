/**
 * Check Velo Pool Balances
 */
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const VELO_PROGRAM_ID = new PublicKey("AQgeVtAYEvigMbBW5gEiK4voELjFB94fDY9cFZqKHgZ8");

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

function findPoolPDA(denomination: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("velo_pool"), toLEBytes(denomination)],
    VELO_PROGRAM_ID
  )[0];
}

function findVaultPDA(denomination: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("velo_vault"), toLEBytes(denomination)],
    VELO_PROGRAM_ID
  )[0];
}

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  console.log("═══════════════════════════════════════");
  console.log("       VELO POOL STATUS CHECK");
  console.log("═══════════════════════════════════════");
  console.log(`Program: ${VELO_PROGRAM_ID.toBase58()}`);
  console.log("");
  
  for (const [name, denomination] of Object.entries(POOL_DENOMINATIONS)) {
    const poolPDA = findPoolPDA(denomination);
    const vaultPDA = findVaultPDA(denomination);
    
    console.log(`\n${name} Pool (${denomination / LAMPORTS_PER_SOL} SOL):`);
    console.log(`  Pool PDA:  ${poolPDA.toBase58()}`);
    console.log(`  Vault PDA: ${vaultPDA.toBase58()}`);
    
    try {
      // Check if pool exists
      const poolInfo = await connection.getAccountInfo(poolPDA);
      if (poolInfo) {
        console.log(`  Pool exists: ✅ (${poolInfo.data.length} bytes)`);
      } else {
        console.log(`  Pool exists: ❌ NOT INITIALIZED`);
      }
      
      // Check vault balance
      const vaultBalance = await connection.getBalance(vaultPDA);
      console.log(`  Vault balance: ${vaultBalance / LAMPORTS_PER_SOL} SOL (${vaultBalance} lamports)`);
      
      if (vaultBalance === 0) {
        console.log(`  ⚠️  EMPTY - deposits needed!`);
      } else {
        const numDeposits = vaultBalance / denomination;
        console.log(`  📊 Can service ~${Math.floor(numDeposits)} withdrawals`);
      }
    } catch (error: any) {
      console.log(`  Error: ${error.message}`);
    }
  }
  
  console.log("\n═══════════════════════════════════════");
}

main().catch(console.error);
