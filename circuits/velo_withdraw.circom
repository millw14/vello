pragma circom 2.0.0;

include "poseidon.circom";
include "merkleTree.circom";

/*
 * VELO Privacy Protocol - ZK Withdrawal Circuit
 * 
 * This circuit proves:
 * 1. You know a secret and nullifier that hash to a commitment
 * 2. That commitment exists in the Merkle tree (anonymity set)
 * 3. The nullifier is correctly derived (prevents double-spend)
 * 
 * Public inputs:
 *   - root: Merkle tree root (contains all deposit commitments)
 *   - nullifierHash: Hash of nullifier (stored on-chain to prevent reuse)
 *   - recipient: Address receiving the funds
 *   - denomination: Pool size (0.1, 1, or 10 SOL)
 * 
 * Private inputs:
 *   - nullifier: Random value known only to depositor
 *   - secret: Random value known only to depositor
 *   - pathElements: Merkle proof path
 *   - pathIndices: Merkle proof indices (left/right)
 */

template VeloWithdraw(levels) {
    // Public inputs
    signal input root;
    signal input nullifierHash;
    signal input recipient;
    signal input denomination;

    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // Step 1: Compute commitment = Poseidon(nullifier, secret)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;
    signal commitment <== commitmentHasher.out;

    // Step 2: Compute nullifierHash = Poseidon(nullifier)
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    
    // Verify nullifierHash matches public input
    nullifierHash === nullifierHasher.out;

    // Step 3: Verify commitment is in the Merkle tree
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== commitment;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // Step 4: Prevent recipient manipulation (add to computation)
    // This ensures the proof is bound to a specific recipient
    signal recipientSquare <== recipient * recipient;
    signal denominationSquare <== denomination * denomination;
}

// Merkle tree with 20 levels = 2^20 = ~1 million deposits capacity
component main {public [root, nullifierHash, recipient, denomination]} = VeloWithdraw(20);
