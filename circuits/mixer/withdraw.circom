pragma circom 2.1.6;

/*
 * Velo Mixer Withdrawal Circuit
 * 
 * This circuit proves that:
 * 1. The prover knows (nullifier, secret) such that commitment = Poseidon(nullifier, secret)
 * 2. The commitment is a leaf in the Merkle tree with the given root
 * 3. The nullifierHash is correctly computed from the nullifier
 * 
 * Public inputs:
 * - root: Merkle tree root (from on-chain)
 * - nullifierHash: Hash of nullifier (to prevent double-spend)
 * - recipient: Address receiving the withdrawal
 * - relayer: Address of relayer (for fees)
 * - fee: Fee amount for relayer
 * - refund: Refund amount (for gas)
 * 
 * Private inputs:
 * - nullifier: Secret nullifier
 * - secret: Secret random value
 * - pathElements[levels]: Merkle proof siblings
 * - pathIndices[levels]: Merkle proof path (0 = left, 1 = right)
 */

include "../lib/poseidon.circom";
include "../lib/merkle.circom";

template Withdraw(levels) {
    // Public inputs
    signal input root;
    signal input nullifierHash;
    signal input recipient;
    signal input relayer;
    signal input fee;
    signal input refund;
    
    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    
    // Compute commitment and nullifierHash
    component hasher = CommitmentHasher();
    hasher.nullifier <== nullifier;
    hasher.secret <== secret;
    
    // Verify the computed nullifierHash matches the public input
    hasher.nullifierHash === nullifierHash;
    
    // Verify the commitment is in the Merkle tree
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== hasher.commitment;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    
    // Prevent tampering with recipient/relayer/fee/refund
    // These are public inputs bound to the proof
    signal recipientSquare;
    signal relayerSquare;
    signal feeSquare;
    signal refundSquare;
    
    recipientSquare <== recipient * recipient;
    relayerSquare <== relayer * relayer;
    feeSquare <== fee * fee;
    refundSquare <== refund * refund;
}

// Main component with 20 levels (supports 2^20 = 1,048,576 deposits)
component main {public [root, nullifierHash, recipient, relayer, fee, refund]} = Withdraw(20);
