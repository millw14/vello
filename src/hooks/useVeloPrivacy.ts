/**
 * VELO PRIVACY HOOK
 * 
 * Unified hook for all Velo privacy operations:
 * - Manages user's confidential account
 * - Handles deposits, withdrawals, and transfers
 * - Integrates with mixer pools and relayer
 */

import { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import {
  deposit as mixerDeposit,
  sendPrivate as mixerSendPrivate,
  loadAvailableNotes,
  getEncryptedBalance,
  initializeWallet,
  POOL_AMOUNTS,
  isRelayerAvailable,
} from '@/lib/velo/velo-service';
import { VeloNote, PoolSize } from '@/lib/velo/types';
import {
  getFullVeloBalance,
  addToPrivateBalance,
  deductFromPrivateBalance,
  registerVeloUser,
  isVeloUser,
  logActivity,
} from '@/lib/db/velo-db';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface VeloBalances {
  public: number;          // Regular SOL in wallet
  private: number;         // Private balance (flexible amounts)
  poolBalance: number;     // Locked in mixer pool notes
  pending: number;         // Pending operations
  totalPrivate: number;    // private + poolBalance
  noteCount: number;       // Number of pool notes
  byPool: {
    SMALL: number;
    MEDIUM: number;
    LARGE: number;
  };
}

export interface VeloState {
  isInitialized: boolean;
  isLoading: boolean;
  balances: VeloBalances;
  notes: VeloNote[];
  relayerOnline: boolean;
  error: string | null;
}

export interface UseVeloPrivacyReturn extends VeloState {
  // Actions
  refresh: () => Promise<void>;
  deposit: (amount: number) => Promise<{ success: boolean; error?: string }>;
  withdraw: (amount: number) => Promise<{ success: boolean; error?: string }>;
  sendPrivate: (recipient: string, amount: number) => Promise<{ success: boolean; error?: string; signature?: string }>;
  
  // Pool-specific actions (fixed denominations)
  depositToPool: (poolSize: PoolSize) => Promise<{ success: boolean; error?: string }>;
  sendFromPool: (recipient: string, poolSize: PoolSize) => Promise<{ success: boolean; error?: string }>;
}

// ═══════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════

export function useVeloPrivacy(): UseVeloPrivacyReturn {
  const { publicKey, signTransaction, signMessage, connected } = useWallet();
  const { connection } = useConnection();

  // State
  const [state, setState] = useState<VeloState>({
    isInitialized: false,
    isLoading: false,
    balances: {
      public: 0,
      private: 0,
      poolBalance: 0,
      pending: 0,
      totalPrivate: 0,
      noteCount: 0,
      byPool: { SMALL: 0, MEDIUM: 0, LARGE: 0 },
    },
    notes: [],
    relayerOnline: false,
    error: null,
  });

  // ═══════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (connected && publicKey) {
      initializeUser();
    } else {
      setState(prev => ({
        ...prev,
        isInitialized: false,
        balances: {
          public: 0,
          private: 0,
          poolBalance: 0,
          pending: 0,
          totalPrivate: 0,
          noteCount: 0,
          byPool: { SMALL: 0, MEDIUM: 0, LARGE: 0 },
        },
        notes: [],
      }));
    }
  }, [connected, publicKey]);

  const initializeUser = async () => {
    if (!publicKey) return;

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const walletAddress = publicKey.toBase58();

      // Initialize wallet in velo-service (handles migration)
      await initializeWallet(walletAddress);

      // Check if user is registered
      const registered = await isVeloUser(walletAddress);
      if (!registered) {
        await registerVeloUser(walletAddress);
      }

      // Check relayer status
      const relayerStatus = await isRelayerAvailable();

      setState(prev => ({
        ...prev,
        isInitialized: true,
        relayerOnline: relayerStatus,
      }));

      // Fetch balances
      await refresh();
    } catch (error: any) {
      console.error('Init error:', error);
      setState(prev => ({
        ...prev,
        isInitialized: true,
        error: error.message,
      }));
    }

    setState(prev => ({ ...prev, isLoading: false }));
  };

  // ═══════════════════════════════════════════════════════════════════
  // REFRESH BALANCES
  // ═══════════════════════════════════════════════════════════════════

  const refresh = useCallback(async () => {
    if (!publicKey) return;

    try {
      const walletAddress = publicKey.toBase58();

      // Get public SOL balance
      const solBalance = await connection.getBalance(publicKey);

      // Get full Velo balance (private + pool notes)
      const veloBalance = await getFullVeloBalance(walletAddress);

      // Load available notes
      const notes = await loadAvailableNotes(walletAddress);

      // Check relayer
      const relayerStatus = await isRelayerAvailable();

      setState(prev => ({
        ...prev,
        balances: {
          public: solBalance / LAMPORTS_PER_SOL,
          private: veloBalance.privateBalance,
          poolBalance: veloBalance.poolBalance,
          pending: veloBalance.pendingBalance,
          totalPrivate: veloBalance.totalPrivate,
          noteCount: veloBalance.noteCount,
          byPool: veloBalance.byPool,
        },
        notes,
        relayerOnline: relayerStatus,
        error: null,
      }));
    } catch (error: any) {
      console.error('Refresh error:', error);
      setState(prev => ({ ...prev, error: error.message }));
    }
  }, [publicKey, connection]);

  // ═══════════════════════════════════════════════════════════════════
  // DEPOSIT (Flexible amount → Private balance)
  // ═══════════════════════════════════════════════════════════════════

  const deposit = async (amount: number): Promise<{ success: boolean; error?: string }> => {
    if (!publicKey || !signTransaction) {
      return { success: false, error: 'Wallet not connected' };
    }

    if (amount <= 0) {
      return { success: false, error: 'Invalid amount' };
    }

    if (amount > state.balances.public) {
      return { success: false, error: 'Insufficient balance' };
    }

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const walletAddress = publicKey.toBase58();

      // For now, we'll deposit to the mixer pool using the nearest pool size
      // This gives us the privacy of fixed denominations
      const poolSize = getOptimalPoolSize(amount);
      const poolAmount = POOL_AMOUNTS[poolSize];

      if (amount < poolAmount) {
        // Amount too small for any pool - add to private balance directly
        // (In production, this would go through a proper system)
        await addToPrivateBalance(walletAddress, amount);
        
        await logActivity({
          walletAddress,
          type: 'deposit',
          amount,
          timestamp: Date.now(),
        });

        await refresh();
        setState(prev => ({ ...prev, isLoading: false }));
        return { success: true };
      }

      // Deposit to mixer pool
      const result = await mixerDeposit(
        connection,
        { publicKey, signTransaction },
        poolSize
      );

      if (result.success) {
        // Remainder goes to private balance
        const remainder = amount - poolAmount;
        if (remainder > 0) {
          await addToPrivateBalance(walletAddress, remainder);
        }

        await refresh();
      }

      setState(prev => ({ ...prev, isLoading: false }));
      return result;
    } catch (error: any) {
      setState(prev => ({ ...prev, isLoading: false }));
      return { success: false, error: error.message };
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // DEPOSIT TO POOL (Fixed denomination)
  // ═══════════════════════════════════════════════════════════════════

  const depositToPool = async (poolSize: PoolSize): Promise<{ success: boolean; error?: string }> => {
    if (!publicKey || !signTransaction) {
      return { success: false, error: 'Wallet not connected' };
    }

    const poolAmount = POOL_AMOUNTS[poolSize];
    if (state.balances.public < poolAmount) {
      return { success: false, error: `Insufficient balance. Need ${poolAmount} SOL` };
    }

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const result = await mixerDeposit(
        connection,
        { publicKey, signTransaction },
        poolSize
      );

      if (result.success) {
        await refresh();
      }

      setState(prev => ({ ...prev, isLoading: false }));
      return result;
    } catch (error: any) {
      setState(prev => ({ ...prev, isLoading: false }));
      return { success: false, error: error.message };
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // WITHDRAW (Private balance → Public wallet)
  // ═══════════════════════════════════════════════════════════════════

  const withdraw = async (amount: number): Promise<{ success: boolean; error?: string }> => {
    if (!publicKey || !signTransaction) {
      return { success: false, error: 'Wallet not connected' };
    }

    if (amount <= 0) {
      return { success: false, error: 'Invalid amount' };
    }

    if (amount > state.balances.totalPrivate) {
      return { success: false, error: 'Insufficient private balance' };
    }

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const walletAddress = publicKey.toBase58();

      // First, use pool notes if available
      let remaining = amount;
      
      // Try to use pool notes (via relayer for privacy)
      for (const note of state.notes) {
        if (remaining <= 0) break;
        
        const noteAmount = POOL_AMOUNTS[note.poolSize];
        if (noteAmount <= remaining) {
          // Use this note - send to self via relayer
          const result = await mixerSendPrivate(
            connection,
            { publicKey, signTransaction },
            Keypair.generate(), // Not used with relayer
            publicKey.toBase58(), // Send to self
            note.poolSize
          );

          if (result.success) {
            remaining -= noteAmount;
          }
        }
      }

      // Deduct remainder from private balance
      if (remaining > 0 && state.balances.private >= remaining) {
        await deductFromPrivateBalance(walletAddress, remaining);
      }

      await logActivity({
        walletAddress,
        type: 'withdraw',
        amount,
        timestamp: Date.now(),
      });

      await refresh();
      setState(prev => ({ ...prev, isLoading: false }));
      return { success: true };
    } catch (error: any) {
      setState(prev => ({ ...prev, isLoading: false }));
      return { success: false, error: error.message };
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // SEND PRIVATE (Via relayer - sender hidden)
  // ═══════════════════════════════════════════════════════════════════

  const sendPrivate = async (
    recipient: string,
    amount: number
  ): Promise<{ success: boolean; error?: string; signature?: string }> => {
    if (!publicKey || !signTransaction) {
      return { success: false, error: 'Wallet not connected' };
    }

    if (!state.relayerOnline) {
      return { success: false, error: 'Relayer is offline. Try again later.' };
    }

    // Validate recipient
    try {
      new PublicKey(recipient);
    } catch {
      return { success: false, error: 'Invalid recipient address' };
    }

    if (amount <= 0) {
      return { success: false, error: 'Invalid amount' };
    }

    if (amount > state.balances.totalPrivate) {
      return { success: false, error: 'Insufficient private balance' };
    }

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      // Find best pool size for this amount
      const poolSize = getOptimalPoolSize(amount);
      const poolAmount = POOL_AMOUNTS[poolSize];

      // Check if we have a note for this pool
      const note = state.notes.find(n => n.poolSize === poolSize);
      
      if (!note) {
        setState(prev => ({ ...prev, isLoading: false }));
        return { 
          success: false, 
          error: `No deposit note for ${poolAmount} SOL pool. Deposit first!` 
        };
      }

      // Send via relayer (YOUR WALLET IS HIDDEN!)
      const result = await mixerSendPrivate(
        connection,
        { publicKey, signTransaction },
        Keypair.generate(), // Not used with relayer
        recipient,
        poolSize
      );

      await refresh();
      setState(prev => ({ ...prev, isLoading: false }));
      return result;
    } catch (error: any) {
      setState(prev => ({ ...prev, isLoading: false }));
      return { success: false, error: error.message };
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // SEND FROM POOL (Fixed denomination via relayer)
  // ═══════════════════════════════════════════════════════════════════

  const sendFromPool = async (
    recipient: string,
    poolSize: PoolSize
  ): Promise<{ success: boolean; error?: string }> => {
    if (!publicKey || !signTransaction) {
      return { success: false, error: 'Wallet not connected' };
    }

    if (!state.relayerOnline) {
      return { success: false, error: 'Relayer is offline' };
    }

    // Check if we have a note for this pool
    const note = state.notes.find(n => n.poolSize === poolSize);
    if (!note) {
      return { success: false, error: `No deposit for ${POOL_AMOUNTS[poolSize]} SOL pool` };
    }

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const result = await mixerSendPrivate(
        connection,
        { publicKey, signTransaction },
        Keypair.generate(),
        recipient,
        poolSize
      );

      if (result.success) {
        await refresh();
      }

      setState(prev => ({ ...prev, isLoading: false }));
      return result;
    } catch (error: any) {
      setState(prev => ({ ...prev, isLoading: false }));
      return { success: false, error: error.message };
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════

  return {
    ...state,
    refresh,
    deposit,
    withdraw,
    sendPrivate,
    depositToPool,
    sendFromPool,
  };
}

// ═══════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function getOptimalPoolSize(amount: number): PoolSize {
  if (amount >= 10) return 'LARGE';
  if (amount >= 1) return 'MEDIUM';
  return 'SMALL';
}

export default useVeloPrivacy;
