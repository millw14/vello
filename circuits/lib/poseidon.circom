pragma circom 2.1.6;

// Poseidon hash function for ZK-friendly hashing
// Uses the Poseidon permutation with t=3 (2 inputs + 1 capacity)
// Based on the circomlib implementation

include "circomlib/circuits/poseidon.circom";

// Wrapper for 2-input Poseidon hash (used in Merkle tree)
template Poseidon2() {
    signal input in[2];
    signal output out;
    
    component hasher = Poseidon(2);
    hasher.inputs[0] <== in[0];
    hasher.inputs[1] <== in[1];
    
    out <== hasher.out;
}

// Wrapper for 3-input Poseidon hash
template Poseidon3() {
    signal input in[3];
    signal output out;
    
    component hasher = Poseidon(3);
    hasher.inputs[0] <== in[0];
    hasher.inputs[1] <== in[1];
    hasher.inputs[2] <== in[2];
    
    out <== hasher.out;
}

// Commitment = Poseidon(nullifier, secret)
template CommitmentHasher() {
    signal input nullifier;
    signal input secret;
    signal output commitment;
    signal output nullifierHash;
    
    // Compute commitment = Poseidon(nullifier, secret)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;
    commitment <== commitmentHasher.out;
    
    // Compute nullifierHash = Poseidon(nullifier)
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash <== nullifierHasher.out;
}
