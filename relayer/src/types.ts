/**
 * Velo Relayer Type Definitions
 */

export interface RelayerConfig {
  rpcUrl: string;
  relayerKeypairPath: string;
  minFee: number;
  maxFee: number;
  feePercent: number;
  mixerProgramId: string;
  privateTxProgramId: string;
  stealthProgramId: string;
}

export interface WithdrawRequest {
  // ZK Proof
  proof: {
    a: string; // Base64 encoded G1 point
    b: string; // Base64 encoded G2 point
    c: string; // Base64 encoded G1 point
  };
  // Public inputs
  root: string;           // Merkle root (hex)
  nullifierHash: string;  // Nullifier hash (hex)
  recipient: string;      // Recipient public key (base58)
  fee: number;           // Fee in lamports
  poolDenomination: number; // Pool size in lamports
}

export interface TransferRequest {
  // ZK Proof
  proof: {
    proofData: string;  // Base64 encoded proof
    merkleRoot: string; // Merkle root (hex)
  };
  // Inputs and outputs
  inputNullifiers: string[];    // Hex encoded nullifiers
  outputCommitments: string[];  // Hex encoded commitments
  encryptedOutputs: string[];   // Base64 encoded encrypted data
  publicAmount: number;         // Positive = deposit, negative = withdraw
  recipient?: string;           // Required if withdrawing
}

export interface StealthPaymentRequest {
  recipientMeta: string;       // Recipient's stealth meta-address account
  stealthAddress: string;      // Generated stealth address
  ephemeralPublicKey: string;  // Ephemeral public key (hex)
  encryptedViewTag: string;    // View tag (hex)
  amount: number;              // Amount in lamports
}

export interface RelayResult {
  success: boolean;
  signature?: string;
  error?: string;
  fee?: number;
  timestamp?: number;
}

export interface ProofVerificationResult {
  valid: boolean;
  error?: string;
}

export interface PoolInfo {
  denomination: number;
  totalDeposits: number;
  anonymitySet: number;
  isActive: boolean;
}
