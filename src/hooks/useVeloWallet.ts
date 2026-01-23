'use client';

import { useState, useEffect, useCallback } from 'react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
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
  scanStealthPayments,
  deriveStealthPrivateKey,
  createMetaAddress,
  StealthAddress,
  StealthKeys,
  StealthPayment,
} from '@/lib/solana/stealth';
import {
  MixerPool,
} from '@/lib/solana/mixer';
import {
  generateMixerNote,
  depositToMixer as depositToMixerOnChain,
  withdrawFromMixer as withdrawFromMixerOnChain,
  withdrawToStealthOnChain,
  sendPrivateAuto,
  getMixerPoolInfo,
  getAllPoolInfos,
  getPoolPDAs,
  getPoolSizeFromDenomination,
  MixerNote,
  PoolSize,
  POOL_DENOMINATIONS,
} from '@/lib/solana/velo-program';
import {
  createVeloConfidentialAccount,
  confidentialDeposit,
  confidentialTransfer,
  confidentialWithdraw,
  confidentialTransferToAny,
  claimConfidentialTransfer,
  getPendingTransfersForWallet,
  loadVeloAccount,
  storeVeloAccount,
  lookupVeloUser,
  VeloConfidentialAccount,
  PendingConfidentialTransfer,
} from '@/lib/solana/confidential-token';
import {
  generateStealthMetaAddress,
  loadStealthKeypair,
  saveStealthKeypair,
  scanAllPayments,
  StealthKeypair,
  ScannedPayment,
} from '@/lib/solana/stealth-v2';
import { getConnection } from '@/lib/solana/config';
import { Tier } from '@/lib/solana/config';
import {
  createMockSubscription,
  getTierFeatures,
  getMixingRounds,
  Subscription,
} from '@/lib/solana/subscription';
// ZK proof imports - to be used when relayer is ready
// import { initializePrivacySDK, createWithdrawalProof } from '@/lib/solana/programs';
// import { VeloPrivacySDK, type ZKProof } from '@/lib/solana/light-protocol';

interface VeloWalletState {
  publicKey: string;
  secretKey: string;
  balance: WalletBalance;
  subscription: Subscription;
  stealthKeys: StealthKeys | null;
  mixerNotes: MixerNote[];
  confidentialAccount: VeloConfidentialAccount | null;
  confidentialBalance: number; // in SOL (decrypted locally)
  pendingTransfers: PendingConfidentialTransfer[]; // Pending claims
  isLoading: boolean;
  error: string | null;
}

interface DepositResult {
  note: MixerNote;
  signature: string;
}

interface VeloWalletActions {
  refreshBalance: () => Promise<void>;
  sendPrivate: (to: string, amount: number) => Promise<TransactionResult>;
  sendToStealth: (recipientMetaAddress: string, amount: number) => Promise<TransactionResult>;
  generateStealth: () => StealthAddress | null;
  depositToMixer: (poolSize: PoolSize) => Promise<DepositResult | null>;
  withdrawFromMixer: (note: MixerNote, recipient: string) => Promise<TransactionResult>;
  requestDevnetAirdrop: () => Promise<TransactionResult>;
  getPoolStats: () => MixerPool[];
  validateAddress: (address: string) => boolean;
  scanIncomingPayments: (payments: StealthPayment[]) => StealthPayment[];
  getMetaAddress: () => string | null;
  getStealthMetaAddress: () => string | null;
  scanStealthPayments: () => ScannedPayment[];
  // Token-2022 Confidential Transfer functions
  initConfidentialAccount: () => Promise<boolean>;
  depositConfidential: (amount: number) => Promise<TransactionResult>;
  sendConfidential: (recipientVeloAddress: string, amount: number) => Promise<TransactionResult>;
  sendConfidentialToAny: (recipientAddress: string, amount: number) => Promise<{
    success: boolean;
    signature?: string;
    pendingTransfer?: PendingConfidentialTransfer;
    error?: string;
  }>;
  withdrawConfidential: (amount: number) => Promise<TransactionResult>;
  lookupVeloAddress: (address: string) => Promise<{ found: boolean; elGamalPublicKey?: string }>;
  refreshPendingTransfers: () => void;
  claimTransfer: (transferId: string) => Promise<{ success: boolean; amount?: number; error?: string }>;
}

export function useVeloWallet(
  publicKey: string,
  secretKey: string,
  tier: string
): VeloWalletState & VeloWalletActions {
  const [balance, setBalance] = useState<WalletBalance>({ sol: 0, lamports: 0, usdValue: 0 });
  const [subscription, setSubscription] = useState<Subscription>(createMockSubscription(tier as Tier));
  const [stealthKeys, setStealthKeys] = useState<StealthKeys | null>(null);
  const [stealthKeypairV2, setStealthKeypairV2] = useState<StealthKeypair | null>(null);
  const [mixerNotes, setMixerNotes] = useState<MixerNote[]>([]);
  const [confidentialAccount, setConfidentialAccount] = useState<VeloConfidentialAccount | null>(null);
  const [confidentialBalance, setConfidentialBalance] = useState<number>(0);
  const [pendingTransfers, setPendingTransfers] = useState<PendingConfidentialTransfer[]>([]);
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

        // Generate stealth keys if not exists (legacy)
        const keys = generateStealthKeys();
        setStealthKeys(keys);

        // Initialize stealth v2 keypair (for maximum privacy)
        let stealthV2 = loadStealthKeypair(publicKey);
        if (!stealthV2) {
          stealthV2 = generateStealthMetaAddress();
          saveStealthKeypair(stealthV2, publicKey);
        }
        setStealthKeypairV2(stealthV2);

        // Load saved mixer notes from localStorage
        const savedNotes = localStorage.getItem(`velo_notes_${publicKey}`);
        if (savedNotes) {
          setMixerNotes(JSON.parse(savedNotes));
        }

        // Load confidential account if exists
        const savedConfidential = loadVeloAccount(publicKey);
        if (savedConfidential) {
          setConfidentialAccount(savedConfidential);
          // Load encrypted balance (in production, decrypt from chain)
          const savedBalance = localStorage.getItem(`velo_cbal_${publicKey}`);
          if (savedBalance) {
            setConfidentialBalance(parseFloat(savedBalance));
          }
        }

        // Load pending confidential transfers for this wallet
        const pending = getPendingTransfersForWallet(publicKey);
        setPendingTransfers(pending);

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

  // Send private transaction - FULLY AUTOMATIC
  // 1. Finds matching mixer note
  // 2. Withdraws to fresh intermediate wallet
  // 3. Intermediate wallet sends to recipient
  // 4. Recipient sees transfer from random wallet - NO CONNECTION TO YOU!
  const sendPrivate = useCallback(async (to: string, amount: number): Promise<TransactionResult> => {
    if (!secretKey) {
      return { success: false, error: 'Wallet not initialized' };
    }

    if (!isValidSolanaAddress(to)) {
      return { success: false, error: 'Invalid recipient address' };
    }

    try {
      const amountLamports = amount * LAMPORTS_PER_SOL;

      // Find a matching mixer note for this amount
      const matchingNote = mixerNotes.find(note => note.denomination === amountLamports);

      if (matchingNote) {
        // DIRECT private transfer via Velo program
        const poolSize = matchingNote.poolSize || getPoolSizeFromDenomination(matchingNote.denomination);
        console.log('');
        console.log('🔒 VELO PRIVATE TRANSFER');
        console.log('   Pool:', poolSize, '(' + amount + ' SOL)');
        console.log('   Recipient:', to.slice(0, 16) + '...');
        console.log('');
        console.log('   Flow: Velo Program → Recipient (DIRECT)');
        console.log('   On Solscan: "Interact with Velo"');
        console.log('   Recipient gets SOL automatically - no claim!');

        const keypair = getKeypairFromSecret(secretKey);

        // DIRECT transfer via Velo program to recipient
        const result = await sendPrivateAuto(
          getConnection(),
          keypair,
          matchingNote,
          to
        );

        if (result.success) {
          // Remove used note
          const updatedNotes = mixerNotes.filter(n => n.commitment !== matchingNote.commitment);
          setMixerNotes(updatedNotes);
          localStorage.setItem(`velo_notes_${publicKey}`, JSON.stringify(updatedNotes));
          await refreshBalance();

          return {
            success: true,
            signature: result.signature,
          };
        } else {
          return { success: false, error: result.error };
        }
      } else {
        // No matching note - show available options
        const availableNotes = mixerNotes.map(n => n.denomination / LAMPORTS_PER_SOL);
        const uniqueAmounts = [...new Set(availableNotes)];

        if (mixerNotes.length === 0) {
          return {
            success: false,
            error: `No mixer notes available. Deposit ${amount} SOL to mixer first for private transfers.`
          };
        } else {
          return {
            success: false,
            error: `No ${amount} SOL note available. You have notes for: ${uniqueAmounts.join(', ')} SOL`
          };
        }
      }
    } catch (err) {
      console.error('Private transfer error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Transaction failed' };
    }
  }, [secretKey, publicKey, mixerNotes, refreshBalance]);

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

  // Deposit to mixer pool (on-chain with multi-pool support)
  const depositToMixer = useCallback(async (poolSize: PoolSize): Promise<{ note: MixerNote; signature: string } | null> => {
    try {
      setError(null);

      // Get deposit amount based on pool size
      const denominationLamports = POOL_DENOMINATIONS[poolSize];
      const denominationSol = denominationLamports / LAMPORTS_PER_SOL;
      const txFee = 0.01; // Estimated transaction fee buffer

      // Check balance including fee buffer
      if (balance.sol < denominationSol + txFee) {
        const err = `Insufficient balance. Need ${denominationSol} SOL + fees. You have ${balance.sol.toFixed(4)} SOL`;
        setError(err);
        return null;
      }

      // Generate note for this specific pool size
      const note = generateMixerNote(poolSize);

      // Get keypair for signing
      const keypair = getKeypairFromSecret(secretKey);

      // Get PDAs for this pool
      const { poolPDA, vaultPDA } = getPoolPDAs(poolSize);

      // Deposit on-chain
      console.log('Depositing to mixer...');
      console.log('Pool Size:', poolSize, `(${denominationSol} SOL)`);
      console.log('Pool PDA:', poolPDA.toBase58());
      console.log('Vault PDA:', vaultPDA.toBase58());
      console.log('Commitment:', note.commitment);

      const result = await depositToMixerOnChain(
        getConnection(),
        keypair,
        note
      );

      if (!result.success) {
        setError(result.error || 'Deposit failed');
        return null;
      }

      console.log('Deposit successful! Signature:', result.signature);

      // Save note to localStorage (encrypted in production)
      const updatedNotes = [...mixerNotes, note];
      setMixerNotes(updatedNotes);
      localStorage.setItem(`velo_notes_${publicKey}`, JSON.stringify(updatedNotes));

      // Refresh balance
      await refreshBalance();

      return { note, signature: result.signature! };
    } catch (err) {
      console.error('Deposit error:', err);
      setError(err instanceof Error ? err.message : 'Failed to create mixer deposit');
      return null;
    }
  }, [mixerNotes, publicKey, secretKey, balance.sol, refreshBalance]);

  // Request devnet airdrop
  const requestDevnetAirdrop = useCallback(async (): Promise<TransactionResult> => {
    const result = await requestAirdrop(publicKey, 1); // 1 SOL more reliable
    if (result.success) {
      await refreshBalance();
    }
    return result;
  }, [publicKey, refreshBalance]);

  // Get pool stats (real on-chain data)
  const getPoolStats = useCallback((): MixerPool[] => {
    // Return mock stats with real PDAs
    // In the future, this would fetch actual on-chain stats
    return [
      {
        id: 'pool-small',
        denomination: POOL_DENOMINATIONS.SMALL,
        totalDeposits: 0, // Would be fetched from chain
        activeNotes: 0,
        lastActivity: Date.now(),
      },
      {
        id: 'pool-medium',
        denomination: POOL_DENOMINATIONS.MEDIUM,
        totalDeposits: 0,
        activeNotes: 0,
        lastActivity: Date.now(),
      },
      {
        id: 'pool-large',
        denomination: POOL_DENOMINATIONS.LARGE,
        totalDeposits: 0,
        activeNotes: 0,
        lastActivity: Date.now(),
      },
    ];
  }, []);

  // Validate address
  const validateAddress = useCallback((address: string): boolean => {
    return isValidSolanaAddress(address);
  }, []);

  // Withdraw from mixer (test mode - uses your wallet as fee payer)
  // In production, this would go through a relayer for full privacy
  const withdrawFromMixer = useCallback(async (
    note: MixerNote,
    recipient: string
  ): Promise<TransactionResult> => {
    try {
      if (!isValidSolanaAddress(recipient)) {
        return { success: false, error: 'Invalid recipient address' };
      }

      console.log('Withdrawing from mixer...');
      console.log('Note commitment:', note.commitment);
      console.log('Pool Size:', note.poolSize);
      console.log('Recipient:', recipient);

      const keypair = getKeypairFromSecret(secretKey);
      const recipientPubkey = new PublicKey(recipient);

      const result = await withdrawFromMixerOnChain(
        getConnection(),
        keypair, // Fee payer (in production, this would be a relayer)
        note,
        recipientPubkey
      );

      if (result.success) {
        console.log('Withdrawal successful! Signature:', result.signature);

        // Remove note from local storage
        const updatedNotes = mixerNotes.filter(n => n.commitment !== note.commitment);
        setMixerNotes(updatedNotes);
        localStorage.setItem(`velo_notes_${publicKey}`, JSON.stringify(updatedNotes));

        // Refresh balance
        await refreshBalance();

        return { success: true, signature: result.signature };
      } else {
        return { success: false, error: result.error };
      }
    } catch (err) {
      console.error('Withdrawal error:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Withdrawal failed'
      };
    }
  }, [publicKey, secretKey, mixerNotes, refreshBalance]);

  // Scan for incoming stealth payments
  const scanIncomingPayments = useCallback((payments: StealthPayment[]): StealthPayment[] => {
    if (!stealthKeys) {
      console.error('Stealth keys not initialized');
      return [];
    }

    return scanStealthPayments(
      stealthKeys.viewKey.secretKey,
      stealthKeys.spendKey.publicKey,
      payments
    );
  }, [stealthKeys]);

  // Get meta-address for publishing (legacy)
  const getMetaAddress = useCallback((): string | null => {
    if (!stealthKeys) {
      return null;
    }
    return createMetaAddress(stealthKeys);
  }, [stealthKeys]);

  // ═══════════════════════════════════════════════════════════════════
  // STEALTH V2 FUNCTIONS (Maximum Privacy)
  // ═══════════════════════════════════════════════════════════════════

  // Get stealth meta-address for receiving (v2)
  const getStealthMetaAddress = useCallback((): string | null => {
    if (!stealthKeypairV2) {
      return null;
    }
    return stealthKeypairV2.metaAddress.encoded;
  }, [stealthKeypairV2]);

  // Send to stealth address (maximum privacy - recipient is HIDDEN)
  const sendToStealth = useCallback(async (
    recipientMetaAddress: string,
    amount: number
  ): Promise<TransactionResult> => {
    if (!secretKey) {
      return { success: false, error: 'Wallet not initialized' };
    }

    try {
      const amountLamports = amount * LAMPORTS_PER_SOL;

      // Find a matching note
      const noteIndex = mixerNotes.findIndex(note => note.denomination === amountLamports);
      if (noteIndex === -1) {
        const availableAmounts = [...new Set(mixerNotes.map(n => n.denomination / LAMPORTS_PER_SOL))];
        if (mixerNotes.length === 0) {
          return {
            success: false,
            error: `No mixer notes available. Deposit ${amount} SOL to mixer first.`
          };
        }
        return {
          success: false,
          error: `No ${amount} SOL note available. You have: ${availableAmounts.join(', ')} SOL`
        };
      }

      const note = mixerNotes[noteIndex];
      const keypair = getKeypairFromSecret(secretKey);

      console.log('🔒 Sending to STEALTH address...');
      console.log('   Recipient meta-address:', recipientMetaAddress.slice(0, 30) + '...');
      console.log('   Amount:', amount, 'SOL');

      const result = await withdrawToStealthOnChain(
        getConnection(),
        keypair,
        note,
        recipientMetaAddress
      );

      if (result.success) {
        console.log('✅ Stealth transfer complete!');
        console.log('   Signature:', result.signature);
        console.log('   Stealth address:', result.stealthInfo?.stealthAddress);

        // Remove used note
        const updatedNotes = mixerNotes.filter((_, i) => i !== noteIndex);
        setMixerNotes(updatedNotes);
        localStorage.setItem(`velo_notes_${publicKey}`, JSON.stringify(updatedNotes));

        await refreshBalance();

        return {
          success: true,
          signature: result.signature,
        };
      } else {
        return { success: false, error: result.error };
      }
    } catch (err) {
      console.error('Stealth transfer error:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Stealth transfer failed'
      };
    }
  }, [secretKey, publicKey, mixerNotes, refreshBalance]);

  // Scan for incoming stealth payments (v2)
  const scanStealthPaymentsV2 = useCallback((): ScannedPayment[] => {
    if (!stealthKeypairV2) {
      console.error('Stealth v2 keypair not initialized');
      return [];
    }
    return scanAllPayments(stealthKeypairV2);
  }, [stealthKeypairV2]);

  // ═══════════════════════════════════════════════════════════════════
  // TOKEN-2022 CONFIDENTIAL TRANSFER FUNCTIONS
  // Both sender and recipient need Velo accounts for encrypted amounts
  // ═══════════════════════════════════════════════════════════════════

  // Initialize confidential account (creates ElGamal keys + Token-2022 account)
  const initConfidentialAccount = useCallback(async (): Promise<boolean> => {
    if (!secretKey) {
      setError('Wallet not initialized');
      return false;
    }

    try {
      const keypair = getKeypairFromSecret(secretKey);
      const connection = getConnection();

      // Create a placeholder mint (in production, use the real cSOL mint)
      const placeholderMint = new PublicKey('11111111111111111111111111111111');

      console.log('═══════════════════════════════════════');
      console.log('    CREATING VELO CONFIDENTIAL ACCOUNT');
      console.log('═══════════════════════════════════════');

      const account = await createVeloConfidentialAccount(
        connection,
        keypair,
        placeholderMint
      );

      // Store account
      storeVeloAccount(account);
      setConfidentialAccount(account);

      console.log('');
      console.log('✅ Velo confidential account created!');
      console.log('   You can now send/receive with encrypted amounts');
      console.log('   ElGamal Public Key:', account.elGamalPublicKey.slice(0, 20) + '...');

      return true;
    } catch (err) {
      console.error('Failed to create confidential account:', err);
      setError(err instanceof Error ? err.message : 'Failed to create confidential account');
      return false;
    }
  }, [secretKey]);

  // Deposit SOL to get cSOL (confidential wrapped SOL)
  const depositConfidential = useCallback(async (amount: number): Promise<TransactionResult> => {
    if (!secretKey) {
      return { success: false, error: 'Wallet not initialized' };
    }

    if (!confidentialAccount) {
      return { success: false, error: 'No confidential account. Call initConfidentialAccount() first.' };
    }

    if (balance.sol < amount) {
      return { success: false, error: `Insufficient balance. You have ${balance.sol.toFixed(4)} SOL` };
    }

    try {
      const keypair = getKeypairFromSecret(secretKey);
      const connection = getConnection();
      const placeholderMint = new PublicKey('11111111111111111111111111111111');

      const result = await confidentialDeposit(
        connection,
        keypair,
        amount,
        placeholderMint,
        confidentialAccount
      );

      if (result.success) {
        // Update local confidential balance
        const newBalance = confidentialBalance + amount;
        setConfidentialBalance(newBalance);
        localStorage.setItem(`velo_cbal_${publicKey}`, newBalance.toString());

        await refreshBalance();
        return { success: true, signature: result.signature };
      }

      return { success: false, error: result.error };
    } catch (err) {
      console.error('Confidential deposit failed:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Deposit failed' };
    }
  }, [secretKey, confidentialAccount, confidentialBalance, balance.sol, publicKey, refreshBalance]);

  // Send cSOL confidentially to another Velo user
  const sendConfidential = useCallback(async (
    recipientVeloAddress: string,
    amount: number
  ): Promise<TransactionResult> => {
    if (!secretKey) {
      return { success: false, error: 'Wallet not initialized' };
    }

    if (!confidentialAccount) {
      return { success: false, error: 'No confidential account. Call initConfidentialAccount() first.' };
    }

    if (confidentialBalance < amount) {
      return {
        success: false,
        error: `Insufficient cSOL balance. You have ${confidentialBalance.toFixed(4)} cSOL`
      };
    }

    try {
      // Look up recipient's Velo account
      const connection = getConnection();
      const recipientAccount = await lookupVeloUser(connection, recipientVeloAddress);

      if (!recipientAccount.found) {
        return {
          success: false,
          error: 'Recipient does not have a Velo account. They need to create one first.'
        };
      }

      const keypair = getKeypairFromSecret(secretKey);

      // Create mock recipient account for the transfer
      const mockRecipientAccount: VeloConfidentialAccount = {
        solanaPublicKey: recipientVeloAddress,
        solanaSecretKey: '',
        elGamalPublicKey: recipientAccount.elGamalPublicKey!,
        elGamalSecretKey: '',
        cSolTokenAccount: '',
        createdAt: 0,
        lastActivity: 0,
      };

      const result = await confidentialTransfer(
        connection,
        keypair,
        confidentialAccount,
        mockRecipientAccount,
        amount
      );

      if (result.success) {
        // Update local confidential balance
        const newBalance = confidentialBalance - amount;
        setConfidentialBalance(newBalance);
        localStorage.setItem(`velo_cbal_${publicKey}`, newBalance.toString());

        return { success: true, signature: result.signature };
      }

      return { success: false, error: result.error };
    } catch (err) {
      console.error('Confidential transfer failed:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Transfer failed' };
    }
  }, [secretKey, confidentialAccount, confidentialBalance, publicKey]);

  // Withdraw cSOL back to regular SOL
  const withdrawConfidential = useCallback(async (amount: number): Promise<TransactionResult> => {
    if (!secretKey) {
      return { success: false, error: 'Wallet not initialized' };
    }

    if (!confidentialAccount) {
      return { success: false, error: 'No confidential account.' };
    }

    if (confidentialBalance < amount) {
      return {
        success: false,
        error: `Insufficient cSOL balance. You have ${confidentialBalance.toFixed(4)} cSOL`
      };
    }

    try {
      const keypair = getKeypairFromSecret(secretKey);
      const connection = getConnection();

      const result = await confidentialWithdraw(
        connection,
        keypair,
        confidentialAccount,
        amount
      );

      if (result.success) {
        // Update local confidential balance
        const newBalance = confidentialBalance - amount;
        setConfidentialBalance(newBalance);
        localStorage.setItem(`velo_cbal_${publicKey}`, newBalance.toString());

        await refreshBalance();
        return { success: true, signature: result.signature };
      }

      return { success: false, error: result.error };
    } catch (err) {
      console.error('Confidential withdraw failed:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Withdraw failed' };
    }
  }, [secretKey, confidentialAccount, confidentialBalance, publicKey, refreshBalance]);

  // Look up a Velo user's public info
  const lookupVeloAddress = useCallback(async (
    address: string
  ): Promise<{ found: boolean; elGamalPublicKey?: string }> => {
    try {
      const connection = getConnection();
      return await lookupVeloUser(connection, address);
    } catch (err) {
      return { found: false };
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // SEND TO ANY WALLET (Creates pending transfer for non-Velo recipients)
  // ═══════════════════════════════════════════════════════════════════

  // Send confidential transfer to ANY wallet (not just Velo users)
  const sendConfidentialToAny = useCallback(async (
    recipientAddress: string,
    amount: number
  ): Promise<{
    success: boolean;
    signature?: string;
    pendingTransfer?: PendingConfidentialTransfer;
    error?: string;
  }> => {
    if (!secretKey) {
      return { success: false, error: 'Wallet not initialized' };
    }

    if (!confidentialAccount) {
      return { success: false, error: 'No confidential account. Create one first.' };
    }

    if (confidentialBalance < amount) {
      return {
        success: false,
        error: `Insufficient cSOL balance. You have ${confidentialBalance.toFixed(4)} cSOL`
      };
    }

    try {
      const keypair = getKeypairFromSecret(secretKey);
      const connection = getConnection();

      const result = await confidentialTransferToAny(
        connection,
        keypair,
        confidentialAccount,
        recipientAddress,
        amount
      );

      if (result.success) {
        // Update local confidential balance
        const newBalance = confidentialBalance - amount;
        setConfidentialBalance(newBalance);
        localStorage.setItem(`velo_cbal_${publicKey}`, newBalance.toString());

        return {
          success: true,
          signature: result.signature,
          pendingTransfer: result.pendingTransfer,
        };
      }

      return { success: false, error: result.error };
    } catch (err) {
      console.error('Confidential transfer to any failed:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Transfer failed' };
    }
  }, [secretKey, confidentialAccount, confidentialBalance, publicKey]);

  // Refresh pending transfers for this wallet
  const refreshPendingTransfers = useCallback(() => {
    const pending = getPendingTransfersForWallet(publicKey);
    setPendingTransfers(pending);
  }, [publicKey]);

  // Claim a pending confidential transfer
  const claimTransfer = useCallback(async (
    transferId: string
  ): Promise<{ success: boolean; amount?: number; error?: string }> => {
    if (!secretKey) {
      return { success: false, error: 'Wallet not initialized' };
    }

    try {
      const keypair = getKeypairFromSecret(secretKey);
      const connection = getConnection();

      const result = await claimConfidentialTransfer(
        connection,
        keypair,
        transferId
      );

      if (result.success) {
        // Refresh pending transfers list
        refreshPendingTransfers();
        // Refresh balance
        await refreshBalance();

        return {
          success: true,
          amount: result.amount,
        };
      }

      return { success: false, error: result.error };
    } catch (err) {
      console.error('Claim transfer failed:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Claim failed' };
    }
  }, [secretKey, refreshPendingTransfers, refreshBalance]);

  return {
    publicKey,
    secretKey,
    balance,
    subscription,
    stealthKeys,
    mixerNotes,
    confidentialAccount,
    confidentialBalance,
    pendingTransfers,
    isLoading,
    error,
    refreshBalance,
    sendPrivate,
    sendToStealth,
    generateStealth,
    depositToMixer,
    withdrawFromMixer,
    requestDevnetAirdrop,
    getPoolStats,
    validateAddress,
    scanIncomingPayments,
    getMetaAddress,
    getStealthMetaAddress,
    scanStealthPayments: scanStealthPaymentsV2,
    // Token-2022 Confidential Transfer functions
    initConfidentialAccount,
    depositConfidential,
    sendConfidential,
    sendConfidentialToAny,
    withdrawConfidential,
    lookupVeloAddress,
    refreshPendingTransfers,
    claimTransfer,
  };
}
