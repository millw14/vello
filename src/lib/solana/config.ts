import { Connection, clusterApiUrl, Commitment } from '@solana/web3.js';

// Network configuration
export const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
export const COMMITMENT: Commitment = 'confirmed';

// RPC endpoints with fallbacks (public endpoints - no API key needed)
const RPC_ENDPOINTS = {
  'mainnet-beta': [
    'https://api.mainnet-beta.solana.com',
  ],
  'devnet': [
    'https://api.devnet.solana.com',
    clusterApiUrl('devnet'),
  ],
  'testnet': [
    clusterApiUrl('testnet'),
  ],
};

let connectionInstance: Connection | null = null;
let currentEndpointIndex = 0;

// Get connection with fallback
export function getConnection(): Connection {
  if (!connectionInstance) {
    const endpoints = RPC_ENDPOINTS[NETWORK as keyof typeof RPC_ENDPOINTS] || RPC_ENDPOINTS.devnet;
    connectionInstance = new Connection(endpoints[currentEndpointIndex], {
      commitment: COMMITMENT,
      confirmTransactionInitialTimeout: 60000,
    });
  }
  return connectionInstance;
}

// Switch to next RPC endpoint on failure
export function switchRpcEndpoint(): Connection {
  const endpoints = RPC_ENDPOINTS[NETWORK as keyof typeof RPC_ENDPOINTS] || RPC_ENDPOINTS.devnet;
  currentEndpointIndex = (currentEndpointIndex + 1) % endpoints.length;
  connectionInstance = new Connection(endpoints[currentEndpointIndex], {
    commitment: COMMITMENT,
    confirmTransactionInitialTimeout: 60000,
  });
  console.log(`Switched to RPC endpoint: ${endpoints[currentEndpointIndex]}`);
  return connectionInstance;
}

// Velo protocol constants
export const VELO_CONSTANTS = {
  // Mixing pool denominations (in lamports)
  POOL_DENOMINATIONS: {
    SMALL: 0.1 * 1e9,   // 0.1 SOL
    MEDIUM: 1 * 1e9,     // 1 SOL
    LARGE: 10 * 1e9,     // 10 SOL
  },
  
  // Subscription prices (in SOL)
  TIER_PRICES: {
    basic: 0,
    standard: 5,
    premium: 15,
    maximum: 50,
  },
  
  // Privacy settings per tier
  TIER_CONFIG: {
    basic: {
      mixingRounds: 1,
      stealthAddresses: false,
      zkProofs: false,
      obfuscation: false,
    },
    standard: {
      mixingRounds: 3,
      stealthAddresses: true,
      zkProofs: false,
      obfuscation: false,
    },
    premium: {
      mixingRounds: 5,
      stealthAddresses: true,
      zkProofs: true,
      obfuscation: false,
    },
    maximum: {
      mixingRounds: 8,
      stealthAddresses: true,
      zkProofs: true,
      obfuscation: true,
    },
  },
  
  // Protocol fees
  PROTOCOL_FEE_BPS: 50, // 0.5%
  MIN_DEPOSIT: 0.01 * 1e9, // 0.01 SOL minimum
};

// Web faucet URLs for when RPC airdrop is rate limited
export const FAUCET_URLS = {
  devnet: [
    'https://faucet.solana.com/', // Official Solana faucet
    'https://solfaucet.com/',     // Alternative faucet
  ],
};

export type Tier = keyof typeof VELO_CONSTANTS.TIER_CONFIG;
export type PoolSize = keyof typeof VELO_CONSTANTS.POOL_DENOMINATIONS;
