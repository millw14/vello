/**
 * VELO CONFIDENTIAL ACCOUNT SERVICE
 * 
 * Manages user confidential accounts:
 * - Create new confidential token accounts
 * - Map wallet addresses to confidential accounts
 * - Handle ElGamal keypair derivation and storage
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
  TokenAccountNotFoundError,
} from '@solana/spl-token';
import {
  ConfidentialAccountInfo,
  CreateAccountResponse,
  AccountLookupResponse,
  ElGamalKeypair,
} from './types';
import {
  deriveElGamalKeypair,
  serializeKeypair,
  deserializeKeypair,
  encryptZeroBalance,
  serializeCiphertext,
} from './elgamal';
import {
  CSOL_MINT,
  SOLANA_RPC_URL,
  CONFIDENTIAL_ACCOUNT_RENT_SOL,
  ELGAMAL_DERIVATION_MESSAGE,
} from './constants';

// ═══════════════════════════════════════════════════════════════════
// LOCAL STORAGE KEYS
// ═══════════════════════════════════════════════════════════════════

const STORAGE_KEY_PREFIX = 'velo_confidential_';
const ACCOUNTS_KEY = `${STORAGE_KEY_PREFIX}accounts`;
const KEYPAIRS_KEY = `${STORAGE_KEY_PREFIX}keypairs`;

// ═══════════════════════════════════════════════════════════════════
// ACCOUNT STORAGE (Local - for client-side)
// ═══════════════════════════════════════════════════════════════════

interface StoredAccounts {
  [walletAddress: string]: ConfidentialAccountInfo;
}

interface StoredKeypairs {
  [walletAddress: string]: {
    publicKey: string;
    secretKey: string; // Encrypted with user's wallet signature
  };
}

/**
 * Get stored accounts from localStorage.
 */
function getStoredAccounts(): StoredAccounts {
  if (typeof window === 'undefined') return {};
  try {
    const data = localStorage.getItem(ACCOUNTS_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

/**
 * Save accounts to localStorage.
 */
function saveStoredAccounts(accounts: StoredAccounts): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

/**
 * Get stored ElGamal keypairs from localStorage.
 */
function getStoredKeypairs(): StoredKeypairs {
  if (typeof window === 'undefined') return {};
  try {
    const data = localStorage.getItem(KEYPAIRS_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

/**
 * Save ElGamal keypairs to localStorage.
 */
function saveStoredKeypairs(keypairs: StoredKeypairs): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYPAIRS_KEY, JSON.stringify(keypairs));
}

// ═══════════════════════════════════════════════════════════════════
// ELGAMAL KEYPAIR MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

/**
 * Derive and store ElGamal keypair from wallet signature.
 * The signature proves wallet ownership and provides entropy.
 */
export async function deriveAndStoreElGamalKeypair(
  walletAddress: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
): Promise<ElGamalKeypair> {
  // Check if we already have a keypair
  const stored = getStoredKeypairs();
  if (stored[walletAddress]) {
    return deserializeKeypair(stored[walletAddress]);
  }
  
  // Derive new keypair from wallet signature
  const message = new TextEncoder().encode(ELGAMAL_DERIVATION_MESSAGE);
  const signature = await signMessage(message);
  const keypair = deriveElGamalKeypair(signature);
  
  // Store the keypair
  stored[walletAddress] = serializeKeypair(keypair);
  saveStoredKeypairs(stored);
  
  return keypair;
}

/**
 * Get stored ElGamal keypair (if exists).
 */
export function getStoredElGamalKeypair(walletAddress: string): ElGamalKeypair | null {
  const stored = getStoredKeypairs();
  if (stored[walletAddress]) {
    return deserializeKeypair(stored[walletAddress]);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// ACCOUNT CREATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a confidential token account for a user.
 * 
 * This creates:
 * 1. Associated Token Account for cSOL (Token-2022)
 * 2. Stores ElGamal public key for receiving encrypted transfers
 */
export async function createConfidentialAccount(
  connection: Connection,
  ownerWallet: PublicKey,
  payer: Keypair,
  elGamalKeypair: ElGamalKeypair
): Promise<CreateAccountResponse> {
  try {
    if (!CSOL_MINT) {
      return {
        success: false,
        error: 'cSOL mint not configured. Run init-confidential-mint.ts first.',
      };
    }
    
    // Get the associated token account address
    const associatedTokenAccount = getAssociatedTokenAddressSync(
      CSOL_MINT,
      ownerWallet,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    // Check if account already exists
    try {
      await getAccount(connection, associatedTokenAccount, 'confirmed', TOKEN_2022_PROGRAM_ID);
      
      // Account exists, just return it
      const accounts = getStoredAccounts();
      const existingAccount = accounts[ownerWallet.toBase58()];
      
      return {
        success: true,
        accountAddress: associatedTokenAccount.toBase58(),
        elGamalPublicKey: existingAccount?.elGamalPublicKey || 
          Buffer.from(elGamalKeypair.publicKey).toString('hex'),
      };
    } catch (e) {
      if (!(e instanceof TokenAccountNotFoundError)) {
        throw e;
      }
      // Account doesn't exist, create it
    }
    
    // Create the associated token account
    const createAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      associatedTokenAccount,
      ownerWallet,
      CSOL_MINT,
      TOKEN_2022_PROGRAM_ID
    );
    
    const transaction = new Transaction().add(createAtaIx);
    transaction.feePayer = payer.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [payer],
      { commitment: 'confirmed' }
    );
    
    // Store account info locally
    const accountInfo: ConfidentialAccountInfo = {
      ownerWallet: ownerWallet.toBase58(),
      confidentialAccount: associatedTokenAccount.toBase58(),
      elGamalPublicKey: Buffer.from(elGamalKeypair.publicKey).toString('hex'),
      encryptedAvailableBalance: serializeCiphertext(
        encryptZeroBalance(elGamalKeypair.publicKey)
      ),
      encryptedPendingBalance: serializeCiphertext(
        encryptZeroBalance(elGamalKeypair.publicKey)
      ),
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      isConfigured: true,
    };
    
    const accounts = getStoredAccounts();
    accounts[ownerWallet.toBase58()] = accountInfo;
    saveStoredAccounts(accounts);
    
    console.log('Confidential account created:', {
      owner: ownerWallet.toBase58(),
      account: associatedTokenAccount.toBase58(),
      signature,
    });
    
    return {
      success: true,
      accountAddress: associatedTokenAccount.toBase58(),
      elGamalPublicKey: accountInfo.elGamalPublicKey,
    };
  } catch (error: any) {
    console.error('Failed to create confidential account:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// ACCOUNT LOOKUP
// ═══════════════════════════════════════════════════════════════════

/**
 * Look up a user's confidential account by their wallet address.
 */
export async function lookupConfidentialAccount(
  walletAddress: string
): Promise<AccountLookupResponse> {
  // Check local storage first
  const accounts = getStoredAccounts();
  const accountInfo = accounts[walletAddress];
  
  if (accountInfo) {
    return {
      exists: true,
      accountInfo,
    };
  }
  
  // Check if account exists on-chain but not in local storage
  if (CSOL_MINT) {
    try {
      const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
      const ownerWallet = new PublicKey(walletAddress);
      
      const associatedTokenAccount = getAssociatedTokenAddressSync(
        CSOL_MINT,
        ownerWallet,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      
      const account = await getAccount(
        connection,
        associatedTokenAccount,
        'confirmed',
        TOKEN_2022_PROGRAM_ID
      );
      
      // Account exists on-chain but not locally - create minimal info
      // User will need to re-derive their ElGamal keypair
      return {
        exists: true,
        accountInfo: {
          ownerWallet: walletAddress,
          confidentialAccount: associatedTokenAccount.toBase58(),
          elGamalPublicKey: '', // Unknown - user needs to re-derive
          encryptedAvailableBalance: '',
          encryptedPendingBalance: '',
          createdAt: Date.now(),
          lastUpdated: Date.now(),
          isConfigured: false, // Needs configuration
        },
      };
    } catch (e) {
      // Account doesn't exist
    }
  }
  
  return {
    exists: false,
  };
}

/**
 * Get account info for a wallet (or null if doesn't exist).
 */
export function getConfidentialAccountInfo(walletAddress: string): ConfidentialAccountInfo | null {
  const accounts = getStoredAccounts();
  return accounts[walletAddress] || null;
}

/**
 * Update stored account info.
 */
export function updateConfidentialAccountInfo(
  walletAddress: string,
  update: Partial<ConfidentialAccountInfo>
): void {
  const accounts = getStoredAccounts();
  const existing = accounts[walletAddress];
  
  if (existing) {
    accounts[walletAddress] = {
      ...existing,
      ...update,
      lastUpdated: Date.now(),
    };
    saveStoredAccounts(accounts);
  }
}

// ═══════════════════════════════════════════════════════════════════
// BATCH OPERATIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Get all stored confidential accounts.
 */
export function getAllConfidentialAccounts(): ConfidentialAccountInfo[] {
  const accounts = getStoredAccounts();
  return Object.values(accounts);
}

/**
 * Check if a wallet has a confidential account.
 */
export function hasConfidentialAccount(walletAddress: string): boolean {
  const accounts = getStoredAccounts();
  return !!accounts[walletAddress];
}

/**
 * Remove a confidential account from local storage.
 * Note: This doesn't delete the on-chain account.
 */
export function removeConfidentialAccount(walletAddress: string): void {
  const accounts = getStoredAccounts();
  delete accounts[walletAddress];
  saveStoredAccounts(accounts);
  
  const keypairs = getStoredKeypairs();
  delete keypairs[walletAddress];
  saveStoredKeypairs(keypairs);
}

// ═══════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the ATA address for a wallet (without creating).
 */
export function getConfidentialAccountAddress(ownerWallet: PublicKey): PublicKey | null {
  if (!CSOL_MINT) return null;
  
  return getAssociatedTokenAddressSync(
    CSOL_MINT,
    ownerWallet,
    false,
    TOKEN_2022_PROGRAM_ID
  );
}

/**
 * Estimate the cost to create a new confidential account.
 */
export async function estimateAccountCreationCost(
  connection: Connection
): Promise<number> {
  // Get rent for token account
  const rentExemption = await connection.getMinimumBalanceForRentExemption(165);
  return rentExemption / LAMPORTS_PER_SOL;
}
