pragma circom 2.0.0;

include "poseidon.circom";

/*
 * Merkle Tree Proof Verifier
 * 
 * Verifies that a leaf exists in a Merkle tree with a given root
 * Uses Poseidon hash for efficiency in ZK circuits
 */

// Select left or right based on selector
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0;  // s must be 0 or 1
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

// Merkle tree inclusion proof checker
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component selectors[levels];
    component hashers[levels];

    signal computedPath[levels + 1];
    computedPath[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        selectors[i] = DualMux();
        selectors[i].in[0] <== computedPath[i];
        selectors[i].in[1] <== pathElements[i];
        selectors[i].s <== pathIndices[i];

        hashers[i] = HashLeftRight();
        hashers[i].left <== selectors[i].out[0];
        hashers[i].right <== selectors[i].out[1];
        
        computedPath[i + 1] <== hashers[i].hash;
    }

    // Verify computed root matches expected root
    root === computedPath[levels];
}

// Merkle tree updater (for inserting new leaves)
template MerkleTreeUpdater(levels) {
    signal input oldRoot;
    signal input newRoot;
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // Verify old path leads to zero (empty slot)
    component oldChecker = MerkleTreeChecker(levels);
    oldChecker.leaf <== 0;  // Empty leaves are 0
    oldChecker.root <== oldRoot;
    for (var i = 0; i < levels; i++) {
        oldChecker.pathElements[i] <== pathElements[i];
        oldChecker.pathIndices[i] <== pathIndices[i];
    }

    // Verify new path leads to new root with leaf inserted
    component newChecker = MerkleTreeChecker(levels);
    newChecker.leaf <== leaf;
    newChecker.root <== newRoot;
    for (var i = 0; i < levels; i++) {
        newChecker.pathElements[i] <== pathElements[i];
        newChecker.pathIndices[i] <== pathIndices[i];
    }
}
