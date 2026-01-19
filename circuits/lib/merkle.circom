pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/switcher.circom";

// Merkle tree inclusion proof verifier
// Verifies that a leaf is part of a Merkle tree with given root

// Hash two children to get parent
template HashLeftRight() {
    signal input left;
    signal input right;
    signal output hash;
    
    component hasher = Poseidon(2);
    hasher.inputs[0] <== left;
    hasher.inputs[1] <== right;
    
    hash <== hasher.out;
}

// Select left/right based on path bit
// If s == 0: out = [in[0], in[1]] (in[0] is left)
// If s == 1: out = [in[1], in[0]] (in[1] is left)
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];
    
    s * (1 - s) === 0; // s must be 0 or 1
    
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

// Verify Merkle proof
// levels: depth of the Merkle tree
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    
    component selectors[levels];
    component hashers[levels];
    
    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;
    
    for (var i = 0; i < levels; i++) {
        selectors[i] = DualMux();
        selectors[i].in[0] <== levelHashes[i];
        selectors[i].in[1] <== pathElements[i];
        selectors[i].s <== pathIndices[i];
        
        hashers[i] = HashLeftRight();
        hashers[i].left <== selectors[i].out[0];
        hashers[i].right <== selectors[i].out[1];
        
        levelHashes[i + 1] <== hashers[i].hash;
    }
    
    // Final computed root must match provided root
    root === levelHashes[levels];
}

// Check if a value is in a set (used for root history)
template IsInSet(n) {
    signal input element;
    signal input set[n];
    signal output isIn;
    
    signal products[n];
    signal diff[n];
    
    var prod = 1;
    for (var i = 0; i < n; i++) {
        diff[i] <== element - set[i];
        if (i == 0) {
            products[i] <== diff[i];
        } else {
            products[i] <== products[i-1] * diff[i];
        }
    }
    
    // If element is in set, at least one diff is 0, so product is 0
    // isIn = 1 if products[n-1] == 0, else 0
    component isZero = IsZero();
    isZero.in <== products[n-1];
    isIn <== isZero.out;
}

template IsZero() {
    signal input in;
    signal output out;
    
    signal inv;
    
    inv <-- in != 0 ? 1/in : 0;
    
    out <== -in * inv + 1;
    in * out === 0;
}
