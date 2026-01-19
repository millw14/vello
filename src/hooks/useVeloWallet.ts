'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getWalletBalance,
  getKeypairFromSecret,
  sendPrivateTransaction,
  requestAirdrop,
  getRecentTransactions,
  isValidSolanaAddress,
  WalletBalance,
  TransactionResult,
} from '@/lib/solana/wallet';
import {
  generateStealthAddress,
  generateStealthKeys,
  StealthAddress,
  StealthKeys,
} from '@/lib/solana/stealth';
import {
  generateMixerNote,
  getMockPoolStats,
  MixerNote,
  MixerPool,
  PoolSize,
} from '@/lib/solana/mixer';
import {
  createMockSubscription,
  getTierFeatures,
  getMixingRounds,
  Subscription,
  Tier,
} from '@/lib/solana/subscription';

interface VeloWalletState {
  publicKey: string;
  secretKey: string;
  balance: WalletBalance;
  subscription: Subscription;
  stealthKeys: StealthKeys | null;
  mixerNotes: MixerNote[];
  isLoading: boolean;
  error: string | null;
}

interface VeloWalletActions {
  refreshBalance: () => Promise<void>;
  sendPrivate: (to: string, amount: number) => Promise<TransactionResult>;
  generateStealth: () => StealthAddress | null;
  depositToMixer: (poolSize: PoolSize) => Promise<MixerNote | null>;
  requestDevnetAirdrop: () => Promise<TransactionResult>;
  getPoolStats: () => MixerPool[];
  validateAddress: (address: string) => boolean;
}

export function useVeloWallet(
  publicKey: string,
  secretKey: string,
  tier: string
): VeloWalletState & VeloWalletActions {
  const [balance, setBalance] = useState<WalletBalance>({ sol: 0, lamports: 0, usdValue: 0 });
  const [subscription, setSubscription] = useState<Subscription>(createMockSubscription(tier as Tier));
  const [stealthKeys, setStealthKeys] = useState<StealthKeys | null>(null);
  const [mixerNotes, setMixerNotes] = useState<MixerNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize wallet
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        // Fetch balance
        const bal = await getWalletBalance(publicKey);
        setBalance(bal);

        // Generate stealth keys if not exists
        const keys = generateStealthKeys();
        setStealthKeys(keys);

        // Load saved mixer notes from localStorage
        const savedNotes = localStorage.getItem(`velo_notes_${publicKey}`);
        if (savedNotes) {
          setMixerNotes(JSON.parse(savedNotes));
        }

        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize wallet');
      } finally {
        setIsLoading(false);
      }
    };

    if (publicKey) {
      init();
    }
  }, [publicKey]);

  // Refresh balance
  const refreshBalance = useCallback(async () => {
    try {
      const bal = await getWalletBalance(publicKey);
      setBalance(bal);
    } catch (err) {
      console.error('Failed to refresh balance:', err);
    }
  }, [publicKey]);

  // Send private transaction
  const sendPrivate = useCallback(async (to: string, amount: number): Promise<TransactionResult> => {
    if (!secretKey) {
      return { success: false, error: 'Wallet not initialized' };
    }

    try {
      const keypair = getKeypairFromSecret(secretKey);
      const result = await sendPrivateTransaction(keypair, to, amount, tier);
      
      if (result.success) {
        // Refresh balance after successful send
        await refreshBalance();
      }
      
      return result;
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Transaction failed' };
    }
  }, [secretKey, tier, refreshBalance]);

  // Generate stealth address
  const generateStealth = useCallback((): StealthAddress | null => {
    if (!stealthKeys) {
      setError('Stealth keys not initialized');
      return null;
    }

    try {
      const address = generateStealthAddress(stealthKeys.viewKey.publicKey);
      return address;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate stealth address');
      return null;
    }
  }, [stealthKeys]);

  // Deposit to mixer pool
  const depositToMixer = useCallback(async (poolSize: PoolSize): Promise<MixerNote | null> => {
    try {
      const note = generateMixerNote(poolSize);
      
      // Save note to localStorage (encrypted in production)
      const updatedNotes = [...mixerNotes, note];
      setMixerNotes(updatedNotes);
      localStorage.setItem(`velo_notes_${publicKey}`, JSON.stringify(updatedNotes));
      
      return note;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create mixer deposit');
      return null;
    }
  }, [mixerNotes, publicKey]);

  // Request devnet airdrop
  const requestDevnetAirdrop = useCallback(async (): Promise<TransactionResult> => {
    const result = await requestAirdrop(publicKey, 1); // 1 SOL more reliable
    if (result.success) {
      await refreshBalance();
    }
    return result;
  }, [publicKey, refreshBalance]);

  // Get pool stats
  const getPoolStats = useCallback((): MixerPool[] => {
    return getMockPoolStats();
  }, []);

  // Validate address
  const validateAddress = useCallback((address: string): boolean => {
    return isValidSolanaAddress(address);
  }, []);

  return {
    publicKey,
    secretKey,
    balance,
    subscription,
    stealthKeys,
    mixerNotes,
    isLoading,
    error,
    refreshBalance,
    sendPrivate,
    generateStealth,
    depositToMixer,
    requestDevnetAirdrop,
    getPoolStats,
    validateAddress,
  };
}
