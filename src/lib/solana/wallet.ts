/**
 * Wallet Integration for Velo
 * 
 * Handles:
 * - Keypair management from user's stored keys
 * - Balance fetching
 * - Transaction signing and sending
 * - Connection to Solana network
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { getConnection, switchRpcEndpoint, VELO_CONSTANTS, FAUCET_URLS } from './config';

export interface WalletBalance {
  sol: number;
  lamports: number;
  usdValue: number;
}

export interface TransactionResult {
  success: boolean;
  signature?: string;
  error?: string;
  faucetUrl?: string;
}

/**
 * Get wallet keypair from stored secret key
 */
export function getKeypairFromSecret(secretKeyBase58: string): Keypair {
  const secretKey = bs58.decode(secretKeyBase58);
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Fetch wallet balance with retry logic
 */
export async function getWalletBalance(publicKey: string, retries = 3): Promise<WalletBalance> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < retries; i++) {
    try {
      const connection = getConnection();
      const pubkey = new PublicKey(publicKey);
      const lamports = await connection.getBalance(pubkey);
      const sol = lamports / LAMPORTS_PER_SOL;
      
      // Fetch SOL price (mock for now - in production use an oracle)
      const solPrice = 150; // Mock price
      
      return {
        sol,
        lamports,
        usdValue: sol * solPrice,
      };
    } catch (error) {
      lastError = error as Error;
      console.warn(`Balance fetch attempt ${i + 1} failed:`, error);
      
      // Switch to backup RPC if rate limited
      if ((error as Error).message?.includes('429') || (error as Error).message?.includes('rate')) {
        switchRpcEndpoint();
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  
  console.error('Failed to fetch balance after retries:', lastError);
  return { sol: 0, lamports: 0, usdValue: 0 };
}

/**
 * Send SOL transaction with retry logic
 */
export async function sendSol(
  fromKeypair: Keypair,
  toAddress: string,
  amountSol: number,
  retries = 2
): Promise<TransactionResult> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < retries; i++) {
    try {
      const connection = getConnection();
      const toPublicKey = new PublicKey(toAddress);
      const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
      
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: fromKeypair.publicKey,
          toPubkey: toPublicKey,
          lamports,
        })
      );
      
      const signature = await sendAndConfirmTransaction(connection, transaction, [fromKeypair]);
      
      return { success: true, signature };
    } catch (error) {
      lastError = error as Error;
      console.warn(`Transaction attempt ${i + 1} failed:`, error);
      
      if ((error as Error).message?.includes('429')) {
        switchRpcEndpoint();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  
  return { 
    success: false, 
    error: lastError?.message || 'Transaction failed after retries' 
  };
}

/**
 * Send private transaction with obfuscation
 */
export async function sendPrivateTransaction(
  fromKeypair: Keypair,
  toAddress: string,
  amountSol: number,
  tier: string
): Promise<TransactionResult> {
  const connection = getConnection();
  const tierConfig = VELO_CONSTANTS.TIER_CONFIG[tier as keyof typeof VELO_CONSTANTS.TIER_CONFIG];
  
  try {
    const toPublicKey = new PublicKey(toAddress);
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
    
    const transaction = new Transaction();
    
    // Add obfuscation if tier supports it
    if (tierConfig?.obfuscation) {
      const noiseData = Buffer.from(generateNoiseData());
      transaction.add(
        new TransactionInstruction({
          keys: [],
          programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
          data: noiseData,
        })
      );
    }
    
    // Main transfer
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey: toPublicKey,
        lamports,
      })
    );
    
    // Add more noise instructions for higher tiers
    if (tierConfig?.obfuscation) {
      for (let i = 0; i < tierConfig.mixingRounds; i++) {
        const noise = Buffer.from(generateNoiseData());
        transaction.add(
          new TransactionInstruction({
            keys: [],
            programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
            data: noise,
          })
        );
      }
    }
    
    const signature = await sendAndConfirmTransaction(connection, transaction, [fromKeypair]);
    
    return { success: true, signature };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Transaction failed' 
    };
  }
}

/**
 * Generate random noise data for obfuscation
 */
function generateNoiseData(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Get recent transactions for an address
 */
export async function getRecentTransactions(
  publicKey: string,
  limit: number = 10
): Promise<Array<{
  signature: string;
  timestamp: number;
  type: 'send' | 'receive';
  amount: number;
  status: 'success' | 'failed';
}>> {
  try {
    const connection = getConnection();
    const pubkey = new PublicKey(publicKey);
    const signatures = await connection.getSignaturesForAddress(pubkey, { limit });
    
    const transactions = await Promise.all(
      signatures.map(async (sig) => {
        const tx = await connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });
        
        let type: 'send' | 'receive' = 'receive';
        let amount = 0;
        
        if (tx?.meta) {
          const preBalance = tx.meta.preBalances[0] || 0;
          const postBalance = tx.meta.postBalances[0] || 0;
          const diff = postBalance - preBalance;
          
          type = diff < 0 ? 'send' : 'receive';
          amount = Math.abs(diff) / LAMPORTS_PER_SOL;
        }
        
        return {
          signature: sig.signature,
          timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now(),
          type,
          amount,
          status: sig.err ? 'failed' as const : 'success' as const,
        };
      })
    );
    
    return transactions;
  } catch (error) {
    console.error('Failed to fetch transactions:', error);
    return [];
  }
}

/**
 * Request airdrop with multiple retries and fallback
 */
export async function requestAirdrop(
  publicKey: string, 
  amountSol: number = 1
): Promise<TransactionResult> {
  // Try RPC airdrop first with retries
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const connection = getConnection();
      const pubkey = new PublicKey(publicKey);
      
      console.log(`Airdrop attempt ${attempt + 1}...`);
      
      const signature = await connection.requestAirdrop(
        pubkey,
        amountSol * LAMPORTS_PER_SOL
      );
      
      // Wait for confirmation with timeout
      const confirmation = await Promise.race([
        connection.confirmTransaction(signature),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Confirmation timeout')), 30000)
        ),
      ]);
      
      return { success: true, signature };
    } catch (error) {
      const errorMsg = (error as Error).message || '';
      console.warn(`Airdrop attempt ${attempt + 1} failed:`, errorMsg);
      
      // If rate limited, switch endpoint and try again
      if (errorMsg.includes('429') || errorMsg.includes('rate') || errorMsg.includes('Too Many')) {
        switchRpcEndpoint();
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
        continue;
      }
      
      // For other errors, don't retry
      if (!errorMsg.includes('timeout')) {
        break;
      }
    }
  }
  
  // If all RPC attempts fail, return faucet URL as fallback
  return {
    success: false,
    error: 'RPC airdrop rate limited. Please use the web faucet.',
    faucetUrl: FAUCET_URLS.devnet[0],
  };
}

/**
 * Check if address is valid Solana address
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}
