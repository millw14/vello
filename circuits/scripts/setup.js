/**
 * Trusted Setup Script for Velo Mixer Circuit
 * 
 * This script performs the Powers of Tau ceremony and circuit-specific setup.
 * In production, the Powers of Tau should come from a multi-party computation ceremony.
 * 
 * Steps:
 * 1. Generate Powers of Tau (or download from Hermez/Zcash ceremony)
 * 2. Prepare phase 2 (circuit-specific)
 * 3. Contribute randomness
 * 4. Generate final zkey and verification key
 */

const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");

const BUILD_DIR = path.join(__dirname, "..", "build");
const R1CS_FILE = path.join(BUILD_DIR, "withdraw.r1cs");
const PTAU_FILE = path.join(BUILD_DIR, "powersOfTau28_hez_final_20.ptau");
const ZKEY_0_FILE = path.join(BUILD_DIR, "withdraw_0.zkey");
const ZKEY_FINAL_FILE = path.join(BUILD_DIR, "withdraw_final.zkey");
const VKEY_FILE = path.join(BUILD_DIR, "verification_key.json");

async function downloadPTAU() {
    console.log("📥 Downloading Powers of Tau file...");
    console.log("   Using Hermez ceremony (20 powers = supports 2^20 constraints)");
    
    // In production, download from:
    // https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_20.ptau
    
    // For development, we'll generate a new one (NOT secure for production!)
    if (!fs.existsSync(PTAU_FILE)) {
        console.log("⚠️  Generating development PTAU (NOT for production!)");
        
        const ptauTmp = path.join(BUILD_DIR, "ptau_tmp.ptau");
        
        // Start new ceremony
        await snarkjs.powersOfTau.newAccumulator(
            snarkjs.curves.bn128,
            20, // 2^20 constraints
            ptauTmp
        );
        
        // Contribute randomness
        await snarkjs.powersOfTau.contribute(
            ptauTmp,
            path.join(BUILD_DIR, "ptau_contribute.ptau"),
            "velo-dev-contribution",
            "random-entropy-" + Date.now()
        );
        
        // Prepare phase 2
        await snarkjs.powersOfTau.preparePhase2(
            path.join(BUILD_DIR, "ptau_contribute.ptau"),
            PTAU_FILE
        );
        
        // Clean up
        fs.unlinkSync(ptauTmp);
        fs.unlinkSync(path.join(BUILD_DIR, "ptau_contribute.ptau"));
        
        console.log("✅ Development PTAU generated");
    } else {
        console.log("✅ PTAU file exists");
    }
}

async function generateZKey() {
    console.log("\n🔐 Generating proving key (zkey)...");
    
    // Check if r1cs exists
    if (!fs.existsSync(R1CS_FILE)) {
        console.error("❌ R1CS file not found. Run 'npm run compile' first.");
        process.exit(1);
    }
    
    // Generate initial zkey
    console.log("   Phase 1: Creating initial zkey from r1cs and ptau...");
    await snarkjs.zKey.newZKey(R1CS_FILE, PTAU_FILE, ZKEY_0_FILE);
    
    // Contribute to phase 2 (circuit-specific randomness)
    console.log("   Phase 2: Contributing circuit-specific randomness...");
    await snarkjs.zKey.contribute(
        ZKEY_0_FILE,
        ZKEY_FINAL_FILE,
        "velo-mixer-contribution",
        "velo-mixer-entropy-" + Date.now()
    );
    
    // Export verification key
    console.log("   Exporting verification key...");
    const vKey = await snarkjs.zKey.exportVerificationKey(ZKEY_FINAL_FILE);
    fs.writeFileSync(VKEY_FILE, JSON.stringify(vKey, null, 2));
    
    // Clean up intermediate file
    fs.unlinkSync(ZKEY_0_FILE);
    
    console.log("✅ Proving key generated:", ZKEY_FINAL_FILE);
    console.log("✅ Verification key exported:", VKEY_FILE);
}

async function main() {
    console.log("🚀 Velo Mixer Trusted Setup\n");
    console.log("=".repeat(50));
    
    // Ensure build directory exists
    if (!fs.existsSync(BUILD_DIR)) {
        fs.mkdirSync(BUILD_DIR, { recursive: true });
    }
    
    try {
        await downloadPTAU();
        await generateZKey();
        
        console.log("\n" + "=".repeat(50));
        console.log("✅ Setup complete!\n");
        console.log("Files generated:");
        console.log("  - build/withdraw_final.zkey (proving key)");
        console.log("  - build/verification_key.json (verification key)");
        console.log("\n⚠️  For production:");
        console.log("  1. Use Powers of Tau from a trusted ceremony");
        console.log("  2. Run multi-party computation for phase 2");
        console.log("  3. Verify the ceremony transcript");
    } catch (error) {
        console.error("❌ Setup failed:", error.message);
        process.exit(1);
    }
}

main();
