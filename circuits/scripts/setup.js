/**
 * Trusted Setup Script for Velo Mixer Circuit
 * Downloads pre-computed Powers of Tau and generates circuit-specific keys
 */

const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");
const https = require("https");

const BUILD_DIR = path.join(__dirname, "..", "build");
const R1CS_FILE = path.join(BUILD_DIR, "withdraw.r1cs");
const PTAU_FILE = path.join(BUILD_DIR, "pot15_final.ptau");
const ZKEY_0_FILE = path.join(BUILD_DIR, "withdraw_0.zkey");
const ZKEY_FINAL_FILE = path.join(BUILD_DIR, "withdraw_final.zkey");
const VKEY_FILE = path.join(BUILD_DIR, "verification_key.json");

// Use smaller ptau for faster setup (pot15 supports up to 2^15 constraints)
// For production, use pot20 or higher
const PTAU_URL = "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau";

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        console.log(`   Downloading from ${url}...`);
        const file = fs.createWriteStream(dest);
        
        https.get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                // Handle redirect
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            
            const totalBytes = parseInt(response.headers['content-length'], 10);
            let downloadedBytes = 0;
            
            response.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
                process.stdout.write(`\r   Progress: ${percent}%`);
            });
            
            response.pipe(file);
            
            file.on('finish', () => {
                file.close();
                console.log('\n   Download complete!');
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {}); // Delete the file on error
            reject(err);
        });
    });
}

async function downloadPTAU() {
    console.log("📥 Downloading Powers of Tau file...");
    
    if (fs.existsSync(PTAU_FILE)) {
        console.log("✅ PTAU file already exists, skipping download");
        return;
    }
    
    await downloadFile(PTAU_URL, PTAU_FILE);
    console.log("✅ PTAU downloaded successfully");
}

async function generateZKey() {
    console.log("\n🔐 Generating proving key (zkey)...");
    
    // Check if r1cs exists
    if (!fs.existsSync(R1CS_FILE)) {
        console.error("❌ R1CS file not found. Run circuit compilation first.");
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
    if (fs.existsSync(ZKEY_0_FILE)) {
        fs.unlinkSync(ZKEY_0_FILE);
    }
    
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
        console.log("  1. Use Powers of Tau with more powers (pot20+)");
        console.log("  2. Run multi-party computation for phase 2");
    } catch (error) {
        console.error("❌ Setup failed:", error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();
