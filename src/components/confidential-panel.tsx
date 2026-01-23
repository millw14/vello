'use client';

import { useState, useEffect } from 'react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TransactionResult } from '@/lib/solana/wallet';
import { VeloConfidentialAccount, PendingConfidentialTransfer } from '@/lib/solana/confidential-token';

interface ConfidentialPanelProps {
  confidentialAccount: VeloConfidentialAccount | null;
  confidentialBalance: number;
  solBalance: number;
  pendingTransfers: PendingConfidentialTransfer[];
  initConfidentialAccount: () => Promise<boolean>;
  depositConfidential: (amount: number) => Promise<TransactionResult>;
  sendConfidential: (recipient: string, amount: number) => Promise<TransactionResult>;
  sendConfidentialToAny: (recipient: string, amount: number) => Promise<{
    success: boolean;
    signature?: string;
    pendingTransfer?: PendingConfidentialTransfer;
    error?: string;
  }>;
  withdrawConfidential: (amount: number) => Promise<TransactionResult>;
  lookupVeloAddress: (address: string) => Promise<{ found: boolean; elGamalPublicKey?: string }>;
  claimTransfer: (transferId: string) => Promise<{ success: boolean; amount?: number; error?: string }>;
  refreshPendingTransfers: () => void;
}

export function ConfidentialPanel({
  confidentialAccount,
  confidentialBalance,
  solBalance,
  pendingTransfers,
  initConfidentialAccount,
  depositConfidential,
  sendConfidential,
  sendConfidentialToAny,
  withdrawConfidential,
  lookupVeloAddress,
  claimTransfer,
  refreshPendingTransfers,
}: ConfidentialPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  
  // Form states
  const [depositAmount, setDepositAmount] = useState('');
  const [sendRecipient, setSendRecipient] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [recipientStatus, setRecipientStatus] = useState<{ text: string; isVelo: boolean } | null>(null);
  const [activeTab, setActiveTab] = useState<'send' | 'receive'>('send');

  // Refresh pending transfers on mount
  useEffect(() => {
    refreshPendingTransfers();
  }, [refreshPendingTransfers]);

  const handleCreateAccount = async () => {
    setIsLoading(true);
    setMessage({ text: 'Creating Velo confidential account...', type: 'info' });
    
    const success = await initConfidentialAccount();
    
    if (success) {
      setMessage({ text: 'Velo account created! You can now use confidential transfers.', type: 'success' });
    } else {
      setMessage({ text: 'Failed to create account. Please try again.', type: 'error' });
    }
    
    setIsLoading(false);
  };

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      setMessage({ text: 'Please enter a valid amount', type: 'error' });
      return;
    }

    if (amount > solBalance) {
      setMessage({ text: `Insufficient SOL balance. You have ${solBalance.toFixed(4)} SOL`, type: 'error' });
      return;
    }

    setIsLoading(true);
    setMessage({ text: `Depositing ${amount} SOL → cSOL...`, type: 'info' });

    const result = await depositConfidential(amount);
    
    if (result.success) {
      setMessage({ text: `Deposited ${amount} SOL to confidential balance`, type: 'success' });
      setDepositAmount('');
    } else {
      setMessage({ text: result.error || 'Deposit failed', type: 'error' });
    }

    setIsLoading(false);
  };

  const handleLookupRecipient = async () => {
    if (!sendRecipient || sendRecipient.length < 32) {
      setRecipientStatus(null);
      return;
    }
    
    setRecipientStatus({ text: 'Checking...', isVelo: false });
    const result = await lookupVeloAddress(sendRecipient);
    
    if (result.found) {
      setRecipientStatus({ text: '✓ Velo user (instant encrypted transfer)', isVelo: true });
    } else {
      setRecipientStatus({ text: '◐ Any wallet (creates pending transfer)', isVelo: false });
    }
  };

  const handleSend = async () => {
    const amount = parseFloat(sendAmount);
    if (isNaN(amount) || amount <= 0) {
      setMessage({ text: 'Please enter a valid amount', type: 'error' });
      return;
    }

    if (!sendRecipient) {
      setMessage({ text: 'Please enter a recipient address', type: 'error' });
      return;
    }

    if (amount > confidentialBalance) {
      setMessage({ text: `Insufficient cSOL balance. You have ${confidentialBalance.toFixed(4)} cSOL`, type: 'error' });
      return;
    }

    setIsLoading(true);

    // Check if recipient is Velo user
    const lookup = await lookupVeloAddress(sendRecipient);

    if (lookup.found) {
      // Direct encrypted transfer to Velo user
      setMessage({ text: `Sending ${amount} cSOL encrypted to Velo user...`, type: 'info' });
      const result = await sendConfidential(sendRecipient, amount);
      
      if (result.success) {
        setMessage({ text: `✓ Sent ${amount} cSOL - Amount ENCRYPTED on-chain!`, type: 'success' });
        setSendRecipient('');
        setSendAmount('');
        setRecipientStatus(null);
      } else {
        setMessage({ text: result.error || 'Transfer failed', type: 'error' });
      }
    } else {
      // Create pending transfer for any wallet
      setMessage({ text: `Creating encrypted transfer for any wallet...`, type: 'info' });
      const result = await sendConfidentialToAny(sendRecipient, amount);
      
      if (result.success) {
        setMessage({ 
          text: `✓ Transfer created! Recipient can claim at Velo. Amount hidden.`, 
          type: 'success' 
        });
        setSendRecipient('');
        setSendAmount('');
        setRecipientStatus(null);
      } else {
        setMessage({ text: result.error || 'Transfer failed', type: 'error' });
      }
    }

    setIsLoading(false);
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      setMessage({ text: 'Please enter a valid amount', type: 'error' });
      return;
    }

    if (amount > confidentialBalance) {
      setMessage({ text: `Insufficient cSOL balance. You have ${confidentialBalance.toFixed(4)} cSOL`, type: 'error' });
      return;
    }

    setIsLoading(true);
    setMessage({ text: `Withdrawing ${amount} cSOL → SOL...`, type: 'info' });

    const result = await withdrawConfidential(amount);
    
    if (result.success) {
      setMessage({ text: `Withdrew ${amount} cSOL to regular SOL`, type: 'success' });
      setWithdrawAmount('');
    } else {
      setMessage({ text: result.error || 'Withdraw failed', type: 'error' });
    }

    setIsLoading(false);
  };

  const handleClaim = async (transferId: string) => {
    setIsLoading(true);
    setMessage({ text: 'Claiming transfer...', type: 'info' });

    const result = await claimTransfer(transferId);

    if (result.success) {
      setMessage({ 
        text: `✓ Claimed ${result.amount?.toFixed(4)} SOL!`, 
        type: 'success' 
      });
    } else {
      setMessage({ text: result.error || 'Claim failed', type: 'error' });
    }

    setIsLoading(false);
  };

  return (
    <div className="bg-gradient-to-br from-purple-900/30 to-indigo-900/30 rounded-2xl p-6 border border-purple-500/20">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
          <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">Confidential Transfers</h3>
          <p className="text-xs text-gray-400">Encrypted amounts • Send to ANY wallet</p>
        </div>
      </div>

      {/* Message display */}
      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
          message.type === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
          'bg-blue-500/20 text-blue-400 border border-blue-500/30'
        }`}>
          {message.text}
        </div>
      )}

      {!confidentialAccount ? (
        /* No account - show create button */
        <div className="text-center py-8">
          <div className="mb-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-purple-500/20 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            </div>
            <h4 className="text-white font-medium mb-2">Create Velo Account</h4>
            <p className="text-gray-400 text-sm mb-4">
              Set up your confidential account to send encrypted transfers to <strong>any wallet</strong>.
            </p>
          </div>
          
          <button
            onClick={handleCreateAccount}
            disabled={isLoading}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 text-white rounded-xl font-medium transition-colors"
          >
            {isLoading ? 'Creating...' : 'Create Velo Account'}
          </button>

          {/* Show pending transfers even without account (for claiming) */}
          {pendingTransfers.length > 0 && (
            <div className="mt-6 text-left">
              <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></span>
                Pending Transfers for You
              </h4>
              <div className="space-y-2">
                {pendingTransfers.map((transfer) => (
                  <div key={transfer.id} className="bg-black/30 rounded-lg p-3 border border-yellow-500/30">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm text-white">
                          {(transfer.amountLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL
                        </p>
                        <p className="text-xs text-gray-500">
                          From: {transfer.senderAddress.slice(0, 8)}...
                        </p>
                      </div>
                      <button
                        onClick={() => handleClaim(transfer.id)}
                        disabled={isLoading}
                        className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 text-white text-sm rounded-lg"
                      >
                        Claim
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Has account - show full features */
        <div className="space-y-6">
          {/* Balance display */}
          <div className="bg-black/30 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">Confidential Balance (cSOL)</span>
              <span className="text-xs text-purple-400 bg-purple-500/20 px-2 py-0.5 rounded">ENCRYPTED</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {confidentialBalance.toFixed(4)} <span className="text-lg text-gray-400">cSOL</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Only you can see this balance. On-chain it&apos;s encrypted.
            </p>
          </div>

          {/* Tab switcher */}
          <div className="flex gap-2 p-1 bg-black/30 rounded-lg">
            <button
              onClick={() => setActiveTab('send')}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'send' 
                  ? 'bg-purple-600 text-white' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Send
            </button>
            <button
              onClick={() => { setActiveTab('receive'); refreshPendingTransfers(); }}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors relative ${
                activeTab === 'receive' 
                  ? 'bg-purple-600 text-white' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Receive
              {pendingTransfers.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-500 text-black text-xs rounded-full flex items-center justify-center font-bold">
                  {pendingTransfers.length}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'send' ? (
            <>
              {/* Deposit SOL → cSOL */}
              <div className="space-y-2">
                <label className="text-sm text-gray-300 font-medium">Deposit SOL → cSOL</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="Amount in SOL"
                    className="flex-1 bg-black/30 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                    step="0.01"
                    min="0"
                  />
                  <button
                    onClick={handleDeposit}
                    disabled={isLoading || !depositAmount}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 text-white rounded-lg font-medium transition-colors"
                  >
                    Deposit
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Available: {solBalance.toFixed(4)} SOL
                </p>
              </div>

              {/* Send cSOL (to ANY wallet) */}
              <div className="space-y-2">
                <label className="text-sm text-gray-300 font-medium">Send cSOL (Encrypted)</label>
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      type="text"
                      value={sendRecipient}
                      onChange={(e) => {
                        setSendRecipient(e.target.value);
                        setRecipientStatus(null);
                      }}
                      onBlur={handleLookupRecipient}
                      placeholder="Any Solana wallet address"
                      className="w-full bg-black/30 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                  {recipientStatus && (
                    <p className={`text-xs ${
                      recipientStatus.isVelo ? 'text-green-400' : 'text-yellow-400'
                    }`}>
                      {recipientStatus.text}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={sendAmount}
                      onChange={(e) => setSendAmount(e.target.value)}
                      placeholder="Amount in cSOL"
                      className="flex-1 bg-black/30 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                      step="0.01"
                      min="0"
                    />
                    <button
                      onClick={handleSend}
                      disabled={isLoading || !sendRecipient || !sendAmount}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 text-white rounded-lg font-medium transition-colors"
                    >
                      Send
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Works with ANY wallet! Non-Velo users can claim at velo.app
                </p>
              </div>

              {/* Withdraw cSOL → SOL */}
              <div className="space-y-2">
                <label className="text-sm text-gray-300 font-medium">Withdraw cSOL → SOL</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="Amount in cSOL"
                    className="flex-1 bg-black/30 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                    step="0.01"
                    min="0"
                  />
                  <button
                    onClick={handleWithdraw}
                    disabled={isLoading || !withdrawAmount}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded-lg font-medium transition-colors"
                  >
                    Withdraw
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Available: {confidentialBalance.toFixed(4)} cSOL
                </p>
              </div>
            </>
          ) : (
            /* Receive Tab - Show pending transfers */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-white font-medium">Pending Transfers</h4>
                <button 
                  onClick={refreshPendingTransfers}
                  className="text-xs text-purple-400 hover:text-purple-300"
                >
                  Refresh
                </button>
              </div>

              {pendingTransfers.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 mx-auto rounded-full bg-gray-800 flex items-center justify-center mb-3">
                    <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                  </div>
                  <p className="text-gray-500 text-sm">No pending transfers</p>
                  <p className="text-gray-600 text-xs mt-1">
                    Share your wallet address to receive encrypted transfers
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingTransfers.map((transfer) => (
                    <div 
                      key={transfer.id} 
                      className="bg-black/30 rounded-xl p-4 border border-yellow-500/30"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></span>
                            <span className="text-yellow-400 text-xs font-medium">PENDING</span>
                          </div>
                          <p className="text-xl font-bold text-white">
                            {(transfer.amountLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL
                          </p>
                        </div>
                        <button
                          onClick={() => handleClaim(transfer.id)}
                          disabled={isLoading}
                          className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-700 text-white text-sm rounded-lg font-medium transition-colors"
                        >
                          {isLoading ? '...' : 'Claim'}
                        </button>
                      </div>
                      <div className="text-xs text-gray-500 space-y-1">
                        <p>From: {transfer.senderAddress.slice(0, 12)}...{transfer.senderAddress.slice(-8)}</p>
                        <p>Created: {new Date(transfer.timestamp).toLocaleString()}</p>
                        <p className="text-purple-400">Amount encrypted on-chain ✓</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* How to receive */}
              <div className="p-4 bg-purple-500/10 rounded-xl border border-purple-500/20">
                <h5 className="text-purple-400 font-medium text-sm mb-2">How to Receive</h5>
                <p className="text-xs text-gray-400">
                  Share your wallet address with anyone. They can send you encrypted 
                  transfers through Velo, and you&apos;ll see them here to claim.
                </p>
              </div>
            </div>
          )}

          {/* Account info */}
          <div className="border-t border-gray-700/50 pt-4">
            <details className="text-sm">
              <summary className="text-gray-400 cursor-pointer hover:text-gray-300">
                Account Details
              </summary>
              <div className="mt-2 space-y-1 text-xs text-gray-500">
                <p>ElGamal Key: {confidentialAccount.elGamalPublicKey.slice(0, 20)}...</p>
                <p>Token Account: {confidentialAccount.cSolTokenAccount.slice(0, 20)}...</p>
                <p>Created: {new Date(confidentialAccount.createdAt).toLocaleDateString()}</p>
              </div>
            </details>
          </div>
        </div>
      )}

      {/* Privacy explanation */}
      <div className="mt-6 p-4 bg-purple-500/10 rounded-xl border border-purple-500/20">
        <h4 className="text-purple-400 font-medium text-sm mb-2">🔒 Privacy Features</h4>
        <ul className="text-xs text-gray-400 space-y-1">
          <li>• <strong>Encrypted Amounts</strong> - Only sender & recipient can see</li>
          <li>• <strong>Any Wallet</strong> - Recipients don&apos;t need Velo to receive</li>
          <li>• <strong>Stealth Delivery</strong> - Fresh addresses break on-chain links</li>
          <li>• <strong>ZK Proofs</strong> - Validity verified without revealing data</li>
        </ul>
      </div>
    </div>
  );
}
