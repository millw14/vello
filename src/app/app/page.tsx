'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import { 
  Zap, Shield, ArrowDownToLine, Send, Inbox, RefreshCw, 
  Copy, Check, ExternalLink, Wallet, EyeOff,
  AlertCircle, CheckCircle2, Loader2
} from 'lucide-react';
import {
  deposit,
  sendPrivate,
  getEncryptedBalance,
  loadAvailableNotes,
  getPendingForRecipient,
  initializeWallet,
  POOL_AMOUNTS,
  VELO_PROGRAM_ID,
  isRelayerAvailable,
} from '@/lib/velo/velo-service';
import { PoolSize, PendingTransfer, VeloNote } from '@/lib/velo/types';
import { cn } from '@/lib/utils';

export default function VeloApp() {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  
  // State
  const [mounted, setMounted] = useState(false);
  const [solBalance, setSolBalance] = useState<number>(0);
  const [veloBalance, setVeloBalance] = useState<{ total: number; noteCount: number }>({ total: 0, noteCount: 0 });
  const [notes, setNotes] = useState<VeloNote[]>([]);
  const [pendingIncoming, setPendingIncoming] = useState<PendingTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [relayerOnline, setRelayerOnline] = useState<boolean | null>(null);
  
  // Form state
  const [activeTab, setActiveTab] = useState<'deposit' | 'send' | 'history'>('deposit');
  const [selectedPool, setSelectedPool] = useState<PoolSize>('SMALL');
  const [recipient, setRecipient] = useState('');

  // Fix hydration mismatch - only render wallet button after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Initialize wallet and database
  useEffect(() => {
    if (connected && publicKey && !isInitialized) {
      initializeWallet(publicKey.toBase58()).then(() => {
        setIsInitialized(true);
      });
    }
  }, [connected, publicKey, isInitialized]);

  // Refresh data
  const refresh = useCallback(async () => {
    if (!publicKey) return;
    
    try {
      const bal = await connection.getBalance(publicKey);
      setSolBalance(bal / LAMPORTS_PER_SOL);
      
      const veloBal = await getEncryptedBalance(publicKey.toBase58());
      setVeloBalance({ total: veloBal.total, noteCount: veloBal.noteCount });
      
      const loadedNotes = await loadAvailableNotes(publicKey.toBase58());
      setNotes(loadedNotes);
      
      const pending = await getPendingForRecipient(publicKey.toBase58());
      setPendingIncoming(pending);
      
      // Check relayer status
      const relayerStatus = await isRelayerAvailable();
      setRelayerOnline(relayerStatus);
    } catch (error) {
      console.error('Refresh error:', error);
    }
  }, [publicKey, connection]);

  useEffect(() => {
    if (connected && publicKey && isInitialized) {
      refresh();
      const interval = setInterval(refresh, 10000); // Check every 10s
      return () => clearInterval(interval);
    }
  }, [connected, publicKey, isInitialized, refresh]);

  // No auto-claim needed! SOL is sent directly via Velo program
  // The "Claim" tab just shows transfer history

  // Auto-clear messages
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Copy address
  const copyAddress = () => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Handlers
  const handleDeposit = async () => {
    if (!publicKey || !signTransaction) return;
    
    setIsLoading(true);
    setMessage({ text: `Depositing ${POOL_AMOUNTS[selectedPool]} SOL...`, type: 'info' });
    
    const result = await deposit(connection, { publicKey, signTransaction }, selectedPool);
    
    if (result.success) {
      setMessage({ text: `Deposited ${POOL_AMOUNTS[selectedPool]} SOL!`, type: 'success' });
      refresh();
    } else {
      setMessage({ text: result.error || 'Deposit failed', type: 'error' });
    }
    
    setIsLoading(false);
  };

  const handleSend = async () => {
    if (!publicKey || !signTransaction || !recipient.trim()) {
      setMessage({ text: 'Enter recipient address', type: 'error' });
      return;
    }
    
    const tempKeypair = Keypair.generate();
    
    setIsLoading(true);
    setMessage({ text: `Sending ${POOL_AMOUNTS[selectedPool]} SOL privately...`, type: 'info' });
    
    const result = await sendPrivate(
      connection,
      { publicKey, signTransaction },
      tempKeypair,
      recipient.trim(),
      selectedPool
    );
    
    if (result.success) {
      setMessage({ text: `Sent privately! Your wallet is hidden on Solscan.`, type: 'success' });
      setRecipient('');
      refresh();
    } else {
      setMessage({ text: result.error || 'Send failed', type: 'error' });
    }
    
    setIsLoading(false);
  };


  const handleAirdrop = async () => {
    if (!publicKey) return;
    
    setIsLoading(true);
    setMessage({ text: 'Requesting airdrop...', type: 'info' });
    
    try {
      const sig = await connection.requestAirdrop(publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, 'confirmed');
      setMessage({ text: 'Received 2 SOL!', type: 'success' });
      refresh();
    } catch (error: any) {
      setMessage({ text: 'Airdrop failed, try again', type: 'error' });
    }
    
    setIsLoading(false);
  };


  // Pool amounts for display
  const pools: { size: PoolSize; amount: number }[] = [
    { size: 'SMALL', amount: 0.1 },
    { size: 'MEDIUM', amount: 1 },
    { size: 'LARGE', amount: 10 },
  ];

  // Placeholder button for SSR
  const WalletButton = ({ className }: { className?: string }) => {
    if (!mounted) {
      return (
        <button className={cn("bg-[#00ff9d] text-black rounded-none h-9 px-4 font-mono font-bold text-xs", className)}>
          Connect
        </button>
      );
    }
    return <WalletMultiButton className={className} />;
  };

  // Not connected view
  if (!connected || !mounted) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col">
        {/* Grid background */}
        <div className="fixed inset-0 opacity-20" style={{
          backgroundImage: 'linear-gradient(rgba(0,255,157,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,157,0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }} />
        
        {/* Header */}
        <header className="relative z-10 p-4 flex items-center justify-between border-b border-gray-900">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-[#00ff9d]" />
            <span className="font-mono font-bold text-[#00ff9d]">VELO</span>
          </div>
          <WalletButton className="!bg-[#00ff9d] !text-black !rounded-none !h-9 !px-4 !font-mono !font-bold !text-xs" />
        </header>
        
        {/* Hero */}
        <main className="relative z-10 flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 mx-auto mb-6 border border-[#00ff9d]/30 flex items-center justify-center">
              <Shield className="w-8 h-8 text-[#00ff9d]" />
            </div>
            <h1 className="text-2xl md:text-3xl font-mono font-bold text-white mb-3">
              <span className="text-[#00ff9d]">Private</span> Transfers
            </h1>
            <p className="text-gray-500 font-mono text-sm mb-8">
              Send SOL with encrypted amounts on Solana
            </p>
            <WalletButton className="!bg-[#00ff9d] !text-black !rounded-none !px-8 !py-3 !font-mono !font-bold hover:!bg-[#00ff9d]/80" />
            
            {/* Features */}
            <div className="mt-12 grid grid-cols-3 gap-3 text-center">
              {[
                { icon: ArrowDownToLine, label: 'Deposit' },
                { icon: EyeOff, label: 'Encrypt' },
                { icon: Send, label: 'Send' },
              ].map((f, i) => (
                <div key={i} className="p-3 border border-gray-800">
                  <f.icon className="w-5 h-5 text-[#00ff9d]/50 mx-auto mb-2" />
                  <span className="text-[0.65rem] text-gray-600 font-mono">{f.label}</span>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Connected view
  return (
    <div className="min-h-screen bg-[#050505] flex flex-col">
      {/* Grid background */}
      <div className="fixed inset-0 opacity-20 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(rgba(0,255,157,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,157,0.03) 1px, transparent 1px)',
        backgroundSize: '40px 40px'
      }} />
      
      {/* Header */}
      <header className="relative z-10 p-3 md:p-4 flex items-center justify-between border-b border-gray-900 bg-black/50 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-[#00ff9d]" />
          <span className="font-mono font-bold text-[#00ff9d] text-sm md:text-base">VELO</span>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleAirdrop}
            disabled={isLoading}
            className="hidden sm:flex text-[0.65rem] text-gray-500 hover:text-[#00ff9d] font-mono items-center gap-1 px-2 py-1"
          >
            +AIRDROP
          </button>
          <button onClick={refresh} disabled={isLoading} className="p-2 text-gray-600 hover:text-[#00ff9d]">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <WalletButton className="!bg-transparent !border !border-[#00ff9d]/30 !rounded-none !h-8 !px-3 !font-mono !text-[#00ff9d] !text-[0.65rem]" />
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col max-w-lg mx-auto w-full p-3 md:p-4 gap-3">
        
        {/* Balance Cards */}
        <div className="grid grid-cols-2 gap-2">
          {/* Wallet */}
          <div className="p-3 md:p-4 border border-gray-800 bg-black/40">
            <div className="flex items-center gap-1.5 mb-2">
              <Wallet size={12} className="text-gray-500" />
              <span className="text-[0.55rem] text-gray-500 font-mono">WALLET</span>
            </div>
            <p className="text-xl md:text-2xl font-mono font-bold text-white">
              {solBalance.toFixed(3)}
              <span className="text-sm text-gray-600 ml-1">SOL</span>
            </p>
            <button onClick={copyAddress} className="text-[0.5rem] text-gray-600 font-mono mt-1 flex items-center gap-1">
              {copied ? <Check size={8} /> : <Copy size={8} />}
              {publicKey?.toBase58().slice(0, 6)}...{publicKey?.toBase58().slice(-4)}
            </button>
          </div>
          
          {/* Velo Balance */}
          <div className="p-3 md:p-4 border border-[#00ff9d]/20 bg-[#00ff9d]/5">
            <div className="flex items-center gap-1.5 mb-2">
              <Shield size={12} className="text-[#00ff9d]" />
              <span className="text-[0.55rem] text-[#00ff9d] font-mono">VELO</span>
              <span className="ml-auto text-[0.45rem] text-[#00ff9d]/60 font-mono bg-[#00ff9d]/10 px-1">ENCRYPTED</span>
            </div>
            <p className="text-xl md:text-2xl font-mono font-bold text-[#00ff9d]">
              {veloBalance.total.toFixed(1)}
              <span className="text-sm text-[#00ff9d]/50 ml-1">SOL</span>
            </p>
            <p className="text-[0.5rem] text-[#00ff9d]/50 font-mono mt-1">
              {veloBalance.noteCount} note{veloBalance.noteCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Toast Message */}
        {message && (
          <div className={cn(
            "p-3 border font-mono text-xs flex items-center gap-2",
            message.type === 'success' && "bg-[#00ff9d]/10 border-[#00ff9d]/30 text-[#00ff9d]",
            message.type === 'error' && "bg-red-500/10 border-red-500/30 text-red-400",
            message.type === 'info' && "bg-blue-500/10 border-blue-500/30 text-blue-400"
          )}>
            {message.type === 'success' && <CheckCircle2 size={14} />}
            {message.type === 'error' && <AlertCircle size={14} />}
            {message.type === 'info' && <Loader2 size={14} className="animate-spin" />}
            {message.text}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          {[
            { id: 'deposit', label: 'Deposit', icon: ArrowDownToLine },
            { id: 'send', label: 'Send', icon: Send },
            { id: 'history', label: 'History', icon: Inbox },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={cn(
                "flex-1 py-3 font-mono text-xs flex items-center justify-center gap-1.5 border-b-2 -mb-[2px] transition-colors",
                activeTab === tab.id
                  ? "text-[#00ff9d] border-[#00ff9d]"
                  : "text-gray-600 border-transparent hover:text-gray-400"
              )}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 border border-gray-800 bg-black/30 p-4">
          
          {/* DEPOSIT TAB */}
          {activeTab === 'deposit' && (
            <div className="space-y-4">
              <div>
                <label className="text-[0.6rem] text-gray-500 font-mono mb-2 block">AMOUNT</label>
                <div className="grid grid-cols-3 gap-2">
                  {pools.map((pool) => (
                    <button
                      key={pool.size}
                      onClick={() => setSelectedPool(pool.size)}
                      className={cn(
                        "p-3 border font-mono text-center transition-all",
                        selectedPool === pool.size
                          ? "border-[#00ff9d] bg-[#00ff9d]/10 text-[#00ff9d]"
                          : "border-gray-800 text-gray-500 hover:border-gray-600"
                      )}
                    >
                      <p className="text-lg font-bold">{pool.amount}</p>
                      <p className="text-[0.55rem] opacity-60">SOL</p>
                    </button>
                  ))}
                </div>
              </div>
              
              <button
                onClick={handleDeposit}
                disabled={isLoading || solBalance < POOL_AMOUNTS[selectedPool]}
                className={cn(
                  "w-full py-3 font-mono font-bold text-sm flex items-center justify-center gap-2 transition-all",
                  isLoading || solBalance < POOL_AMOUNTS[selectedPool]
                    ? "bg-gray-800 text-gray-600 cursor-not-allowed"
                    : "bg-[#00ff9d] text-black hover:bg-[#00ff9d]/80"
                )}
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <ArrowDownToLine size={16} />}
                DEPOSIT {POOL_AMOUNTS[selectedPool]} SOL
              </button>
              
              <p className="text-[0.55rem] text-gray-600 font-mono text-center">
                Deposits create encrypted notes for private transfers
              </p>
            </div>
          )}

          {/* SEND TAB */}
          {activeTab === 'send' && (
            <div className="space-y-4">
              <div>
                <label className="text-[0.6rem] text-gray-500 font-mono mb-2 block">AMOUNT (FROM NOTES)</label>
                <div className="grid grid-cols-3 gap-2">
                  {pools.map((pool) => {
                    const hasNote = notes.some(n => n.poolSize === pool.size);
                    const count = notes.filter(n => n.poolSize === pool.size).length;
                    return (
                      <button
                        key={pool.size}
                        onClick={() => hasNote && setSelectedPool(pool.size)}
                        disabled={!hasNote}
                        className={cn(
                          "p-3 border font-mono text-center transition-all",
                          selectedPool === pool.size && hasNote
                            ? "border-[#00ff9d] bg-[#00ff9d]/10 text-[#00ff9d]"
                            : hasNote
                            ? "border-gray-800 text-gray-500 hover:border-gray-600"
                            : "border-gray-900 text-gray-800 cursor-not-allowed"
                        )}
                      >
                        <p className="text-lg font-bold">{pool.amount}</p>
                        <p className={cn(
                          "text-[0.5rem]",
                          hasNote ? "text-[#00ff9d]" : "text-gray-700"
                        )}>
                          {hasNote ? `${count} note${count > 1 ? 's' : ''}` : 'empty'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-[0.6rem] text-gray-500 font-mono mb-2 block">RECIPIENT</label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="Solana wallet address"
                  className="w-full bg-black/50 border border-gray-800 p-3 font-mono text-sm text-white placeholder:text-gray-700 focus:border-[#00ff9d]/50 focus:outline-none"
                />
              </div>
              
              <button
                onClick={handleSend}
                disabled={isLoading || !recipient.trim() || !notes.some(n => n.poolSize === selectedPool)}
                className={cn(
                  "w-full py-3 font-mono font-bold text-sm flex items-center justify-center gap-2 transition-all",
                  isLoading || !recipient.trim() || !notes.some(n => n.poolSize === selectedPool)
                    ? "bg-gray-800 text-gray-600 cursor-not-allowed"
                    : "bg-[#00ff9d] text-black hover:bg-[#00ff9d]/80"
                )}
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                SEND PRIVATE
              </button>
              
              <div className="p-3 border border-[#00ff9d]/20 bg-[#00ff9d]/5 space-y-1">
                <p className="text-[0.55rem] text-[#00ff9d]/80 font-mono flex items-center gap-1.5">
                  <EyeOff size={10} />
                  Your wallet is HIDDEN - transfer via Velo Relayer
                </p>
                <p className="text-[0.5rem] text-[#00ff9d]/60 font-mono">
                  {relayerOnline === null ? 'Checking relayer...' : 
                   relayerOnline ? '✓ Relayer online' : '⚠ Relayer offline'}
                </p>
              </div>
            </div>
          )}

          {/* HISTORY TAB */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              {/* Privacy info */}
              <div className="p-4 border border-[#00ff9d]/20 bg-[#00ff9d]/5">
                <div className="flex items-center gap-2 mb-2">
                  <Shield size={16} className="text-[#00ff9d]" />
                  <span className="text-[#00ff9d] font-mono text-sm font-bold">
                    PRIVACY ACTIVE
                  </span>
                </div>
                <p className="text-[0.6rem] text-[#00ff9d]/70 font-mono">
                  Transfers via Velo program hide sender identity on Solscan
                </p>
              </div>

              {/* Transfer History */}
              <div>
                <label className="text-[0.6rem] text-gray-500 font-mono mb-2 block">
                  INCOMING TRANSFERS ({pendingIncoming.length})
                </label>
                
                {pendingIncoming.length === 0 ? (
                  <div className="text-center py-8 border border-gray-800 border-dashed">
                    <Inbox className="w-8 h-8 text-gray-800 mx-auto mb-2" />
                    <p className="text-gray-600 font-mono text-xs mb-1">No transfers yet</p>
                    <p className="text-[0.5rem] text-gray-700 font-mono">Share your address to receive</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pendingIncoming.map((transfer) => (
                      <div
                        key={transfer.id}
                        className="p-3 border border-[#00ff9d]/30 bg-[#00ff9d]/5"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <CheckCircle2 size={10} className="text-[#00ff9d]" />
                              <span className="text-[0.5rem] text-[#00ff9d] font-mono">RECEIVED</span>
                            </div>
                            <p className="text-lg font-mono font-bold text-white">
                              {POOL_AMOUNTS[transfer.amountHint as PoolSize] || '?'} SOL
                            </p>
                            <p className="text-[0.45rem] text-gray-600 font-mono mt-1">
                              from Velo (sender hidden)
                            </p>
                          </div>
                          <a
                            href={`https://solscan.io/tx/${transfer.txSignature}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-2 border border-[#00ff9d]/30 text-[#00ff9d] font-mono text-xs flex items-center gap-1 hover:bg-[#00ff9d]/10"
                          >
                            <ExternalLink size={12} />
                            VIEW
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Share address */}
              <div className="pt-2 border-t border-gray-800">
                <button
                  onClick={copyAddress}
                  className="w-full py-2 border border-gray-800 text-[0.6rem] font-mono text-gray-500 hover:text-[#00ff9d] hover:border-[#00ff9d]/30 transition-all flex items-center justify-center gap-1.5"
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  Copy Your Address to Receive
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Notes indicator (mobile-friendly) */}
        {notes.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {notes.map((note) => (
              <span
                key={note.id}
                className="px-2 py-1 border border-[#00ff9d]/20 bg-[#00ff9d]/5 text-[0.55rem] font-mono text-[#00ff9d]"
              >
                {note.amount} SOL
              </span>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 p-3 border-t border-gray-900 flex items-center justify-between">
        <span className="text-[0.5rem] text-gray-700 font-mono">DEVNET</span>
        <div className="flex items-center gap-3">
          <button
            onClick={handleAirdrop}
            disabled={isLoading}
            className="sm:hidden text-[0.55rem] text-gray-600 font-mono"
          >
            +Airdrop
          </button>
          <a 
            href={`https://solscan.io/account/${VELO_PROGRAM_ID.toBase58()}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[0.5rem] text-gray-700 hover:text-[#00ff9d] font-mono flex items-center gap-1"
          >
            Velo Program <ExternalLink size={8} />
          </a>
        </div>
      </footer>
    </div>
  );
}
