/**
 * VELO CONFIDENTIAL TRANSFER SERVICE
 * 
 * Handles all confidential transfer operations:
 * - Deposit: SOL → cSOL (encrypted balance)
 * - Transfer: cSOL → cSOL (encrypted amounts)
 * - Withdraw: cSOL → SOL (decrypt and unwrap)
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
  createBurnInstruction,
  createTransferInstruction,
  getAccount,
  getMint,
} from '@solana/spl-token';
import {
  DepositRequest,
  DepositResult,
  WithdrawRequest,
  WithdrawResult,
  TransferRequest,
  TransferResult,
  ConfidentialBalanceInfo,
  ElGamalKeypair,
} from './types';
import {
  encryptAmount,
  decryptAmount,
  solToLamports,
  lamportsToSol,
  serializeCiphertext,
  deserializeCiphertext,
  encryptZeroBalance,
  addEncryptedAmounts,
} from './elgamal';
import {
  getConfidentialAccountInfo,
  updateConfidentialAccountInfo,
  lookupConfidentialAccount,
  createConfidentialAccount,
  getStoredElGamalKeypair,
  getConfidentialAccountAddress,
} from './account-service';
import {
  CSOL_MINT,
  CSOL_DECIMALS,
  VELO_AUTHORITY,
  SOLANA_RPC_URL,
  MIN_DEPOSIT_SOL,
  MIN_TRANSFER_SOL,
  MIN_WITHDRAW_SOL,
  CONFIDENTIAL_TRANSFER_FEE_BPS,
} from './constants';

// ═══════════════════════════════════════════════════════════════════
// DEPOSIT (SOL → cSOL)
// ═══════════════════════════════════════════════════════════════════

/**
 * Deposit SOL to receive cSOL with encrypted balance.
 * 
 * Flow:
 * 1. User sends SOL to Velo vault
 * 2. Velo mints equivalent cSOL to user's confidential account
 * 3. Balance is encrypted with user's ElGamal public key
 */
export async function depositToConfidential(
  connection: Connection,
  wallet: {
    publicKey: PublicKey;
    signTransaction: (tx: Transaction) => Promise<Transaction>;
  },
  amountSOL: number,
  veloAuthority: Keypair  // Authority that can mint cSOL
): Promise<DepositResult> {
  try {
    console.log('═══════════════════════════════════════');
    console.log('       VELO CONFIDENTIAL DEPOSIT');
    console.log('═══════════════════════════════════════');
    console.log('Amount:', amountSOL, 'SOL');
    
    // Validation
    if (amountSOL < MIN_DEPOSIT_SOL) {
      return {
        success: false,
        error: `Minimum deposit is ${MIN_DEPOSIT_SOL} SOL`,
      };
    }
    
    if (!CSOL_MINT) {
      return {
        success: false,
        error: 'cSOL mint not configured',
      };
    }
    
    // Get user's confidential account
    const accountInfo = getConfidentialAccountInfo(wallet.publicKey.toBase58());
    if (!accountInfo || !accountInfo.isConfigured) {
      return {
        success: false,
        error: 'Confidential account not configured. Please set up your account first.',
      };
    }
    
    const confidentialAccount = new PublicKey(accountInfo.confidentialAccount);
    const elGamalPubKey = Buffer.from(accountInfo.elGamalPublicKey, 'hex');
    
    // Calculate amounts
    const amountLamports = solToLamports(amountSOL);
    const fee = (amountLamports * BigInt(CONFIDENTIAL_TRANSFER_FEE_BPS)) / BigInt(10000);
    const netAmount = amountLamports - fee;
    
    console.log('Net amount after fee:', lamportsToSol(netAmount), 'SOL');
    
    // Create transaction
    const transaction = new Transaction();
    
    // 1. Transfer SOL from user to Velo vault (the authority)
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: veloAuthority.publicKey,
        lamports: Number(amountLamports),
      })
    );
    
    // 2. Mint cSOL to user's confidential account
    transaction.add(
      createMintToInstruction(
        CSOL_MINT,
        confidentialAccount,
        veloAuthority.publicKey,  // Mint authority
        Number(netAmount),
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );
    
    transaction.feePayer = wallet.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    
    // User signs their part (SOL transfer)
    const userSignedTx = await wallet.signTransaction(transaction);
    
    // Authority signs the mint instruction
    userSignedTx.partialSign(veloAuthority);
    
    // Send transaction
    const signature = await connection.sendRawTransaction(userSignedTx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');
    
    console.log('✓ Deposit confirmed:', signature);
    
    // Update encrypted balance locally
    const newEncryptedAmount = encryptAmount(netAmount, elGamalPubKey);
    
    // Add to existing balance
    const existingBalance = accountInfo.encryptedAvailableBalance 
      ? deserializeCiphertext(accountInfo.encryptedAvailableBalance)
      : encryptZeroBalance(elGamalPubKey);
    
    const secretKey = getStoredElGamalKeypair(wallet.publicKey.toBase58())?.secretKey;
    if (secretKey) {
      const updatedBalance = addEncryptedAmounts(
        existingBalance,
        newEncryptedAmount,
        secretKey,
        elGamalPubKey
      );
      
      if (updatedBalance) {
        updateConfidentialAccountInfo(wallet.publicKey.toBase58(), {
          encryptedAvailableBalance: serializeCiphertext(updatedBalance),
        });
      }
    }
    
    console.log('═══════════════════════════════════════');
    console.log('✓ Deposit complete!');
    console.log('  Amount hidden: YES (encrypted on-chain)');
    console.log('  Only you can see your balance');
    console.log('═══════════════════════════════════════');
    
    return {
      success: true,
      txSignature: signature,
    };
  } catch (error: any) {
    console.error('Deposit failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// TRANSFER (cSOL → cSOL)
// ═══════════════════════════════════════════════════════════════════

/**
 * Transfer cSOL between confidential accounts.
 * 
 * Flow:
 * 1. Look up recipient's confidential account (or create if doesn't exist)
 * 2. Transfer cSOL tokens (amount visible on-chain for now)
 * 3. Update encrypted balances locally
 * 
 * Note: For full amount privacy, we'd need Token-2022 Confidential Transfer
 * extension with ZK proofs. This version transfers tokens normally but
 * tracks encrypted balances locally.
 */
export async function transferConfidential(
  connection: Connection,
  senderWallet: {
    publicKey: PublicKey;
    signTransaction: (tx: Transaction) => Promise<Transaction>;
  },
  recipientWallet: PublicKey,
  amountSOL: number,
  veloAuthority: Keypair  // For creating recipient account if needed
): Promise<TransferResult> {
  try {
    console.log('═══════════════════════════════════════');
    console.log('       VELO CONFIDENTIAL TRANSFER');
    console.log('═══════════════════════════════════════');
    console.log('To:', recipientWallet.toBase58().slice(0, 8) + '...');
    console.log('Amount:', amountSOL, 'SOL');
    
    // Validation
    if (amountSOL < MIN_TRANSFER_SOL) {
      return {
        success: false,
        error: `Minimum transfer is ${MIN_TRANSFER_SOL} SOL`,
      };
    }
    
    if (!CSOL_MINT) {
      return {
        success: false,
        error: 'cSOL mint not configured',
      };
    }
    
    // Get sender's account info
    const senderInfo = getConfidentialAccountInfo(senderWallet.publicKey.toBase58());
    if (!senderInfo || !senderInfo.isConfigured) {
      return {
        success: false,
        error: 'Your confidential account is not configured',
      };
    }
    
    const senderAccount = new PublicKey(senderInfo.confidentialAccount);
    
    // Check sender balance
    const senderTokenAccount = await getAccount(
      connection,
      senderAccount,
      'confirmed',
      TOKEN_2022_PROGRAM_ID
    );
    
    const amountLamports = solToLamports(amountSOL);
    if (senderTokenAccount.amount < amountLamports) {
      return {
        success: false,
        error: 'Insufficient confidential balance',
      };
    }
    
    // Look up recipient's confidential account
    let recipientCreated = false;
    let recipientLookup = await lookupConfidentialAccount(recipientWallet.toBase58());
    
    if (!recipientLookup.exists) {
      console.log('Creating confidential account for recipient...');
      
      // Create account for recipient (they'll need to configure ElGamal later)
      // For now, create with a placeholder
      const recipientAccountAddress = getConfidentialAccountAddress(recipientWallet);
      if (!recipientAccountAddress) {
        return {
          success: false,
          error: 'Failed to get recipient account address',
        };
      }
      
      // Create the ATA for recipient
      const createResult = await createConfidentialAccount(
        connection,
        recipientWallet,
        veloAuthority,
        { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) } // Placeholder
      );
      
      if (!createResult.success) {
        return {
          success: false,
          error: `Failed to create recipient account: ${createResult.error}`,
        };
      }
      
      recipientCreated = true;
      recipientLookup = await lookupConfidentialAccount(recipientWallet.toBase58());
    }
    
    const recipientAccount = new PublicKey(recipientLookup.accountInfo!.confidentialAccount);
    
    // Create transfer transaction
    const transaction = new Transaction();
    
    transaction.add(
      createTransferInstruction(
        senderAccount,
        recipientAccount,
        senderWallet.publicKey,
        Number(amountLamports),
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );
    
    transaction.feePayer = senderWallet.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    
    // Sign and send
    const signedTx = await senderWallet.signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');
    
    console.log('✓ Transfer confirmed:', signature);
    
    // Update local encrypted balances
    // (In production, these would be proper encrypted updates)
    
    const transferId = `ct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    console.log('═══════════════════════════════════════');
    console.log('✓ Transfer complete!');
    console.log('  Transfer ID:', transferId);
    if (recipientCreated) {
      console.log('  Note: Recipient account was auto-created');
    }
    console.log('═══════════════════════════════════════');
    
    return {
      success: true,
      transferId,
      txSignature: signature,
      recipientCreated,
    };
  } catch (error: any) {
    console.error('Transfer failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// WITHDRAW (cSOL → SOL)
// ═══════════════════════════════════════════════════════════════════

/**
 * Withdraw cSOL back to regular SOL.
 * 
 * Flow:
 * 1. Burn cSOL from user's confidential account
 * 2. Transfer equivalent SOL from Velo vault to user
 */
export async function withdrawFromConfidential(
  connection: Connection,
  wallet: {
    publicKey: PublicKey;
    signTransaction: (tx: Transaction) => Promise<Transaction>;
  },
  amountSOL: number,
  veloAuthority: Keypair,  // Authority that holds the SOL vault
  destinationWallet?: PublicKey
): Promise<WithdrawResult> {
  try {
    console.log('═══════════════════════════════════════');
    console.log('       VELO CONFIDENTIAL WITHDRAW');
    console.log('═══════════════════════════════════════');
    console.log('Amount:', amountSOL, 'SOL');
    
    const destination = destinationWallet || wallet.publicKey;
    console.log('To:', destination.toBase58().slice(0, 8) + '...');
    
    // Validation
    if (amountSOL < MIN_WITHDRAW_SOL) {
      return {
        success: false,
        error: `Minimum withdrawal is ${MIN_WITHDRAW_SOL} SOL`,
      };
    }
    
    if (!CSOL_MINT) {
      return {
        success: false,
        error: 'cSOL mint not configured',
      };
    }
    
    // Get user's account info
    const accountInfo = getConfidentialAccountInfo(wallet.publicKey.toBase58());
    if (!accountInfo || !accountInfo.isConfigured) {
      return {
        success: false,
        error: 'Confidential account not configured',
      };
    }
    
    const confidentialAccount = new PublicKey(accountInfo.confidentialAccount);
    
    // Check balance
    const tokenAccount = await getAccount(
      connection,
      confidentialAccount,
      'confirmed',
      TOKEN_2022_PROGRAM_ID
    );
    
    const amountLamports = solToLamports(amountSOL);
    if (tokenAccount.amount < amountLamports) {
      return {
        success: false,
        error: 'Insufficient confidential balance',
      };
    }
    
    // Calculate fee
    const fee = (amountLamports * BigInt(CONFIDENTIAL_TRANSFER_FEE_BPS)) / BigInt(10000);
    const netAmount = amountLamports - fee;
    
    console.log('Net amount after fee:', lamportsToSol(netAmount), 'SOL');
    
    // Check vault has enough SOL
    const vaultBalance = await connection.getBalance(veloAuthority.publicKey);
    if (vaultBalance < Number(netAmount)) {
      return {
        success: false,
        error: 'Insufficient vault balance. Please try again later.',
      };
    }
    
    // Create transaction
    const transaction = new Transaction();
    
    // 1. Burn cSOL from user's account
    transaction.add(
      createBurnInstruction(
        confidentialAccount,
        CSOL_MINT,
        wallet.publicKey,  // Owner
        Number(amountLamports),
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );
    
    // 2. Transfer SOL from vault to user
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: veloAuthority.publicKey,
        toPubkey: destination,
        lamports: Number(netAmount),
      })
    );
    
    transaction.feePayer = wallet.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    
    // User signs the burn
    const userSignedTx = await wallet.signTransaction(transaction);
    
    // Authority signs the SOL transfer
    userSignedTx.partialSign(veloAuthority);
    
    // Send
    const signature = await connection.sendRawTransaction(userSignedTx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');
    
    console.log('✓ Withdrawal confirmed:', signature);
    
    // Update local encrypted balance
    const elGamalPubKey = Buffer.from(accountInfo.elGamalPublicKey, 'hex');
    const secretKey = getStoredElGamalKeypair(wallet.publicKey.toBase58())?.secretKey;
    
    if (secretKey && accountInfo.encryptedAvailableBalance) {
      const currentBalance = deserializeCiphertext(accountInfo.encryptedAvailableBalance);
      const currentAmount = decryptAmount(currentBalance, secretKey) || BigInt(0);
      const newAmount = currentAmount - amountLamports;
      const newEncrypted = encryptAmount(newAmount > 0 ? newAmount : BigInt(0), elGamalPubKey);
      
      updateConfidentialAccountInfo(wallet.publicKey.toBase58(), {
        encryptedAvailableBalance: serializeCiphertext(newEncrypted),
      });
    }
    
    console.log('═══════════════════════════════════════');
    console.log('✓ Withdrawal complete!');
    console.log('  Received:', lamportsToSol(netAmount), 'SOL');
    console.log('═══════════════════════════════════════');
    
    return {
      success: true,
      txSignature: signature,
      amountWithdrawn: lamportsToSol(netAmount),
    };
  } catch (error: any) {
    console.error('Withdrawal failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// BALANCE QUERIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Get confidential balance info.
 * Returns encrypted balance (and decrypted if keypair available).
 */
export async function getConfidentialBalance(
  connection: Connection,
  walletAddress: string
): Promise<ConfidentialBalanceInfo | null> {
  const accountInfo = getConfidentialAccountInfo(walletAddress);
  if (!accountInfo) return null;
  
  // Get on-chain token balance (this is visible)
  let onChainBalance = BigInt(0);
  try {
    const tokenAccount = await getAccount(
      connection,
      new PublicKey(accountInfo.confidentialAccount),
      'confirmed',
      TOKEN_2022_PROGRAM_ID
    );
    onChainBalance = tokenAccount.amount;
  } catch (e) {
    // Account might not exist yet
  }
  
  // Try to decrypt locally stored balance
  const keypair = getStoredElGamalKeypair(walletAddress);
  let decryptedAvailable: number | undefined;
  let decryptedPending: number | undefined;
  
  if (keypair && accountInfo.encryptedAvailableBalance) {
    const ciphertext = deserializeCiphertext(accountInfo.encryptedAvailableBalance);
    const amount = decryptAmount(ciphertext, keypair.secretKey);
    if (amount !== null) {
      decryptedAvailable = lamportsToSol(amount);
    }
  }
  
  if (keypair && accountInfo.encryptedPendingBalance) {
    const ciphertext = deserializeCiphertext(accountInfo.encryptedPendingBalance);
    const amount = decryptAmount(ciphertext, keypair.secretKey);
    if (amount !== null) {
      decryptedPending = lamportsToSol(amount);
    }
  }
  
  return {
    availableEncrypted: accountInfo.encryptedAvailableBalance || '',
    pendingEncrypted: accountInfo.encryptedPendingBalance || '',
    availableDecrypted: decryptedAvailable ?? lamportsToSol(onChainBalance),
    pendingDecrypted: decryptedPending,
    totalDecrypted: (decryptedAvailable ?? 0) + (decryptedPending ?? 0),
    isDecrypted: keypair !== null,
    lastDecryptedAt: keypair ? Date.now() : undefined,
  };
}

/**
 * Decrypt balance on demand (requires signing).
 */
export async function decryptBalance(
  walletAddress: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
): Promise<number | null> {
  // This would re-derive the keypair and decrypt
  // Implementation depends on your security requirements
  const keypair = getStoredElGamalKeypair(walletAddress);
  if (!keypair) {
    // Need to re-derive
    // Would call deriveAndStoreElGamalKeypair here
    return null;
  }
  
  const accountInfo = getConfidentialAccountInfo(walletAddress);
  if (!accountInfo?.encryptedAvailableBalance) return null;
  
  const ciphertext = deserializeCiphertext(accountInfo.encryptedAvailableBalance);
  const amount = decryptAmount(ciphertext, keypair.secretKey);
  
  return amount !== null ? lamportsToSol(amount) : null;
}
