// Re-export all Solana utilities
export * from './config';
export * from './stealth';
export * from './mixer';
export * from './wallet';
export * from './subscription';

// Light Protocol exports (ZK compression)
export {
  poseidonHash,
  poseidonHash2,
  generateCommitment,
  generateNullifierHash,
  PoseidonMerkleTree,
  VeloPrivacySDK,
  type ZKProof,
  type MixerProofInput,
} from './light-protocol';

// Program SDK exports
export {
  PROGRAM_IDS,
  POOL_DENOMINATIONS,
  SUBSCRIPTION_TIERS,
  initializePrivacySDK,
  generateMixerCommitment,
  createMixerNote,
  createWithdrawalProof,
  getSubscriptionPDA,
  getStealthMetaPDA,
  getRelayerInfo,
  estimateRelayerFee,
  relayWithdrawal,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
} from './programs';
