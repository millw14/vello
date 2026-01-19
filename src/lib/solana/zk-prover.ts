/**
 * ZK Proof Generation for Velo Mixer
 * 
 * Client-side proof generation using snarkjs.
 * Integrates with the Circom circuits for mixer withdrawals.
 */

// @ts-ignore - snarkjs doesn't have types
import * as snarkjs from 'snarkjs';
import bs58 from 'bs58';
import { poseidonHash, poseidonHash2 } from './light-protocol';

// Types
export interface ProofInput {
  root: string;
  nullifierHash: string;
  recipient: string;
  relayer: string;
  fee: string;
  refund: string;
  nullifier: string;
  secret: string;
  pathElements: string[];
  pathIndices: number[];
}

export interface Groth16Proof {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
}

export interface ProofResult {
  proof: Groth16Proof;
  publicSignals: string[];
}

// Circuit file paths (loaded at runtime)
const CIRCUIT_WASM_URL = '/circuits/withdraw.wasm';
const CIRCUIT_ZKEY_URL = '/circuits/withdraw_final.zkey';

/**
 * Convert bytes to field element (big integer decimal string)
 */
export function bytesToFieldElement(bytes: Uint8Array): string {
  let hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return BigInt('0x' + hex).toString();
}

/**
 * Convert Solana public key to field element
 */
export function pubkeyToFieldElement(pubkey: string): string {
  const bytes = bs58.decode(pubkey);
  return bytesToFieldElement(bytes);
}

/**
 * Generate commitment from nullifier and secret
 */
export function generateCommitmentHash(nullifier: Uint8Array, secret: Uint8Array): {
  commitment: Uint8Array;
  commitmentField: string;
} {
  const commitment = poseidonHash2(nullifier, secret);
  return {
    commitment,
    commitmentField: bytesToFieldElement(commitment),
  };
}

/**
 * Generate nullifier hash
 */
export function generateNullifierHashField(nullifier: Uint8Array): {
  nullifierHash: Uint8Array;
  nullifierHashField: string;
} {
  const nullifierHash = poseidonHash([nullifier]);
  return {
    nullifierHash,
    nullifierHashField: bytesToFieldElement(nullifierHash),
  };
}

/**
 * Generate a mixer withdrawal proof
 * 
 * @param nullifier - The secret nullifier (32 bytes)
 * @param secret - The secret random value (32 bytes)
 * @param merkleRoot - The Merkle tree root (32 bytes)
 * @param pathElements - The Merkle proof siblings (20 x 32 bytes)
 * @param pathIndices - The path indices (20 bits, 0 = left, 1 = right)
 * @param recipient - The recipient Solana address
 * @param relayer - The relayer Solana address
 * @param fee - The relayer fee in lamports
 * @param refund - The gas refund in lamports
 */
export async function generateWithdrawalProof(
  nullifier: Uint8Array,
  secret: Uint8Array,
  merkleRoot: Uint8Array,
  pathElements: Uint8Array[],
  pathIndices: number[],
  recipient: string,
  relayer: string,
  fee: number,
  refund: number = 0
): Promise<ProofResult> {
  // Validate inputs
  if (nullifier.length !== 32) throw new Error('Nullifier must be 32 bytes');
  if (secret.length !== 32) throw new Error('Secret must be 32 bytes');
  if (merkleRoot.length !== 32) throw new Error('Merkle root must be 32 bytes');
  if (pathElements.length !== 20) throw new Error('Path elements must have 20 items');
  if (pathIndices.length !== 20) throw new Error('Path indices must have 20 items');
  
  // Generate nullifier hash
  const { nullifierHashField } = generateNullifierHashField(nullifier);
  
  // Prepare circuit input
  const input: ProofInput = {
    root: bytesToFieldElement(merkleRoot),
    nullifierHash: nullifierHashField,
    recipient: pubkeyToFieldElement(recipient),
    relayer: pubkeyToFieldElement(relayer),
    fee: fee.toString(),
    refund: refund.toString(),
    nullifier: bytesToFieldElement(nullifier),
    secret: bytesToFieldElement(secret),
    pathElements: pathElements.map(pe => bytesToFieldElement(pe)),
    pathIndices: pathIndices,
  };
  
  console.log('Generating ZK proof...');
  const startTime = Date.now();
  
  // Generate proof using snarkjs
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    CIRCUIT_WASM_URL,
    CIRCUIT_ZKEY_URL
  );
  
  const duration = Date.now() - startTime;
  console.log(`Proof generated in ${duration}ms`);
  
  // Format proof for Solana verification
  const formattedProof: Groth16Proof = {
    a: [proof.pi_a[0], proof.pi_a[1]],
    b: [
      [proof.pi_b[0][1], proof.pi_b[0][0]], // Note: swapped for Solana
      [proof.pi_b[1][1], proof.pi_b[1][0]]
    ],
    c: [proof.pi_c[0], proof.pi_c[1]]
  };
  
  return {
    proof: formattedProof,
    publicSignals,
  };
}

/**
 * Verify a proof locally (for testing)
 */
export async function verifyProofLocally(
  proof: any,
  publicSignals: string[],
  verificationKey: any
): Promise<boolean> {
  return await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
}

/**
 * Convert proof to bytes for on-chain verification
 */
export function proofToBytes(proof: Groth16Proof): Uint8Array {
  const result = new Uint8Array(256); // 8 field elements * 32 bytes
  
  // Helper to convert decimal string to 32-byte big-endian
  const decimalToBytes32 = (decimal: string): Uint8Array => {
    const hex = BigInt(decimal).toString(16).padStart(64, '0');
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  };
  
  // Pack proof elements
  let offset = 0;
  
  // A (2 elements)
  result.set(decimalToBytes32(proof.a[0]), offset); offset += 32;
  result.set(decimalToBytes32(proof.a[1]), offset); offset += 32;
  
  // B (4 elements, 2x2)
  result.set(decimalToBytes32(proof.b[0][0]), offset); offset += 32;
  result.set(decimalToBytes32(proof.b[0][1]), offset); offset += 32;
  result.set(decimalToBytes32(proof.b[1][0]), offset); offset += 32;
  result.set(decimalToBytes32(proof.b[1][1]), offset); offset += 32;
  
  // C (2 elements)
  result.set(decimalToBytes32(proof.c[0]), offset); offset += 32;
  result.set(decimalToBytes32(proof.c[1]), offset); offset += 32;
  
  return result;
}

/**
 * Download and cache circuit files
 * Call this on app initialization
 */
export async function initializeCircuits(): Promise<void> {
  console.log('Initializing ZK circuits...');
  
  try {
    // Check if files are accessible
    const wasmResponse = await fetch(CIRCUIT_WASM_URL, { method: 'HEAD' });
    const zkeyResponse = await fetch(CIRCUIT_ZKEY_URL, { method: 'HEAD' });
    
    if (!wasmResponse.ok) {
      console.warn('Circuit WASM file not found. Proof generation will fail.');
      console.warn('Run "cd circuits && npm install && npm run compile && npm run setup"');
    }
    
    if (!zkeyResponse.ok) {
      console.warn('Circuit zkey file not found. Proof generation will fail.');
      console.warn('Run "cd circuits && npm run setup"');
    }
    
    console.log('ZK circuits ready');
  } catch (error) {
    console.warn('Failed to initialize circuits:', error);
    console.warn('ZK proofs will not work until circuits are compiled and deployed');
  }
}
