/**
 * Test ZK Proof Generation for Velo Mixer
 * Uses real Poseidon hash from circomlib
 */

const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BUILD_DIR = path.join(__dirname, "..", "build");
const WASM_FILE = path.join(BUILD_DIR, "withdraw_js", "withdraw.wasm");
const ZKEY_FILE = path.join(BUILD_DIR, "withdraw_final.zkey");
const VKEY_FILE = path.join(BUILD_DIR, "verification_key.json");

// Field prime for BN128
const FIELD_SIZE = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

let poseidon;
let F;

async function initPoseidon() {
    const { buildPoseidon } = await import("circomlibjs");
    poseidon = await buildPoseidon();
    F = poseidon.F;
}

function poseidonHash(inputs) {
    const hash = poseidon(inputs.map(x => BigInt(x)));
    return F.toObject(hash);
}

async function generateTestInputs() {
    // Generate random nullifier and secret (must be < FIELD_SIZE)
    const nullifier = BigInt('0x' + crypto.randomBytes(31).toString('hex')) % FIELD_SIZE;
    const secret = BigInt('0x' + crypto.randomBytes(31).toString('hex')) % FIELD_SIZE;
    
    // Generate commitment = poseidon(nullifier, secret)
    const commitment = poseidonHash([nullifier, secret]);
    
    // Generate nullifier hash
    const nullifierHash = poseidonHash([nullifier]);
    
    // Build a simple Merkle tree with our commitment
    const TREE_DEPTH = 20;
    let currentHash = commitment;
    const pathElements = [];
    const pathIndices = [];
    
    // Create path going left (index 0) at each level
    // sibling at each level is 0
    for (let i = 0; i < TREE_DEPTH; i++) {
        const sibling = BigInt(0);
        pathElements.push(sibling.toString());
        pathIndices.push(0); // Our leaf is on the left
        // Hash: poseidon(currentHash, sibling) since we're on the left
        currentHash = poseidonHash([currentHash, sibling]);
    }
    
    const root = currentHash;
    
    // Test recipient and relayer addresses (as field elements)
    const recipient = BigInt('0x' + crypto.randomBytes(20).toString('hex')) % FIELD_SIZE;
    const relayer = BigInt('0x' + crypto.randomBytes(20).toString('hex')) % FIELD_SIZE;
    const fee = BigInt(1000000); // 0.001 SOL in lamports
    
    return {
        // Public inputs
        root: root.toString(),
        nullifierHash: nullifierHash.toString(),
        recipient: recipient.toString(),
        relayer: relayer.toString(),
        fee: fee.toString(),
        refund: "0",
        
        // Private inputs
        nullifier: nullifier.toString(),
        secret: secret.toString(),
        pathElements: pathElements,
        pathIndices: pathIndices,
    };
}

async function main() {
    console.log("🧪 Velo Mixer ZK Proof Test\n");
    console.log("=".repeat(50));
    
    // Check files exist
    if (!fs.existsSync(WASM_FILE)) {
        console.error("❌ WASM file not found:", WASM_FILE);
        process.exit(1);
    }
    if (!fs.existsSync(ZKEY_FILE)) {
        console.error("❌ ZKey file not found:", ZKEY_FILE);
        process.exit(1);
    }
    
    console.log("🔧 Initializing Poseidon hash...");
    await initPoseidon();
    
    console.log("📝 Generating test inputs...");
    const inputs = await generateTestInputs();
    console.log("   Root:", inputs.root.substring(0, 20) + "...");
    console.log("   NullifierHash:", inputs.nullifierHash.substring(0, 20) + "...");
    console.log("   Recipient:", inputs.recipient.substring(0, 20) + "...");
    
    console.log("\n🔐 Generating ZK proof (this may take 30-60 seconds)...");
    const startTime = Date.now();
    
    try {
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            inputs,
            WASM_FILE,
            ZKEY_FILE
        );
        
        const proofTime = Date.now() - startTime;
        console.log(`✅ Proof generated in ${(proofTime/1000).toFixed(1)}s`);
        
        console.log("\n📋 Proof:");
        console.log("   pi_a:", proof.pi_a[0].substring(0, 20) + "...");
        console.log("   pi_b:", proof.pi_b[0][0].substring(0, 20) + "...");
        console.log("   pi_c:", proof.pi_c[0].substring(0, 20) + "...");
        
        console.log("\n🔍 Verifying proof...");
        const vKey = JSON.parse(fs.readFileSync(VKEY_FILE));
        const verified = await snarkjs.groth16.verify(vKey, publicSignals, proof);
        
        if (verified) {
            console.log("✅ Proof VERIFIED!\n");
            console.log("=".repeat(50));
            console.log("🎉 SUCCESS! Your ZK mixer circuit is working!\n");
        } else {
            console.log("❌ Proof verification FAILED!\n");
            process.exit(1);
        }
        
        // Save test proof for reference
        const testOutput = {
            inputs,
            proof,
            publicSignals,
            verified,
            generationTime: proofTime,
        };
        fs.writeFileSync(
            path.join(BUILD_DIR, "test_proof.json"),
            JSON.stringify(testOutput, null, 2)
        );
        console.log("📁 Test proof saved to build/test_proof.json");
        
    } catch (error) {
        console.error("❌ Proof generation failed:", error.message);
        if (error.message.includes("Assert Failed")) {
            console.error("\n   Constraint violation - check circuit logic");
        }
        process.exit(1);
    }
}

main();
