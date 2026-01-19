/**
 * Proof Generation Script for Velo Mixer
 * 
 * Generates a ZK-SNARK proof for a mixer withdrawal.
 * This is used by the client to create withdrawal proofs.
 */

const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");

const BUILD_DIR = path.join(__dirname, "..", "build");
const WASM_FILE = path.join(BUILD_DIR, "withdraw_js", "withdraw.wasm");
const ZKEY_FILE = path.join(BUILD_DIR, "withdraw_final.zkey");

/**
 * Generate a withdrawal proof
 * 
 * @param {Object} input - The circuit inputs
 * @param {string} input.root - Merkle tree root (as decimal string)
 * @param {string} input.nullifierHash - Nullifier hash (as decimal string)
 * @param {string} input.recipient - Recipient address (as decimal string)
 * @param {string} input.relayer - Relayer address (as decimal string)
 * @param {string} input.fee - Fee amount (as decimal string)
 * @param {string} input.refund - Refund amount (as decimal string)
 * @param {string} input.nullifier - Private nullifier (as decimal string)
 * @param {string} input.secret - Private secret (as decimal string)
 * @param {string[]} input.pathElements - Merkle proof elements (as decimal strings)
 * @param {number[]} input.pathIndices - Merkle proof indices (0 or 1)
 * @returns {Promise<{proof: Object, publicSignals: string[]}>}
 */
async function generateProof(input) {
    console.log("🔐 Generating ZK proof...\n");
    
    // Validate input
    if (!input.root || !input.nullifierHash || !input.nullifier || !input.secret) {
        throw new Error("Missing required input fields");
    }
    
    if (!input.pathElements || input.pathElements.length !== 20) {
        throw new Error("pathElements must have 20 elements for depth-20 tree");
    }
    
    if (!input.pathIndices || input.pathIndices.length !== 20) {
        throw new Error("pathIndices must have 20 elements");
    }
    
    // Check files exist
    if (!fs.existsSync(WASM_FILE)) {
        throw new Error("WASM file not found. Run 'npm run compile' first.");
    }
    if (!fs.existsSync(ZKEY_FILE)) {
        throw new Error("ZKey file not found. Run 'npm run setup' first.");
    }
    
    console.log("Inputs:");
    console.log("  root:", input.root.substring(0, 20) + "...");
    console.log("  nullifierHash:", input.nullifierHash.substring(0, 20) + "...");
    console.log("  recipient:", input.recipient);
    console.log("  relayer:", input.relayer);
    console.log("  fee:", input.fee);
    console.log("  refund:", input.refund);
    console.log("");
    
    const startTime = Date.now();
    
    // Generate proof
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        WASM_FILE,
        ZKEY_FILE
    );
    
    const duration = Date.now() - startTime;
    console.log(`✅ Proof generated in ${duration}ms\n`);
    
    // Format proof for Solana (bytes)
    const formattedProof = {
        a: [proof.pi_a[0], proof.pi_a[1]],
        b: [
            [proof.pi_b[0][1], proof.pi_b[0][0]], // Note: order is reversed for Solana
            [proof.pi_b[1][1], proof.pi_b[1][0]]
        ],
        c: [proof.pi_c[0], proof.pi_c[1]]
    };
    
    return {
        proof: formattedProof,
        publicSignals,
        rawProof: proof
    };
}

/**
 * Verify a proof locally (for testing)
 */
async function verifyProof(proof, publicSignals) {
    const vKeyPath = path.join(BUILD_DIR, "verification_key.json");
    const vKey = JSON.parse(fs.readFileSync(vKeyPath));
    
    const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);
    return isValid;
}

// Export for use as module
module.exports = { generateProof, verifyProof };

// CLI usage
if (require.main === module) {
    // Example usage
    const exampleInput = {
        root: "12345678901234567890123456789012345678901234567890123456789012",
        nullifierHash: "98765432109876543210987654321098765432109876543210987654321098",
        recipient: "11111111111111111111111111111111",
        relayer: "22222222222222222222222222222222",
        fee: "1000000",
        refund: "0",
        nullifier: "11111111111111111111111111111111111111111111111111111111111111",
        secret: "22222222222222222222222222222222222222222222222222222222222222",
        pathElements: Array(20).fill("0"),
        pathIndices: Array(20).fill(0)
    };
    
    console.log("⚠️  Running with example inputs (will fail without proper Merkle proof)\n");
    console.log("For actual usage, import and call generateProof() with real inputs.");
}
