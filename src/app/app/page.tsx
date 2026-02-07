'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js';
import { 
  Zap, Shield, ArrowDownToLine, ArrowUpFromLine, Send, 
  RefreshCw, Copy, Check, ExternalLink, EyeOff,
  Eye, AlertCircle, CheckCircle2, Loader2, 
  ArrowRightLeft, Lock, User, Activity, Droplets, Users
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  generateVeloNote,
  createDepositInstruction,
  commitmentToBytes,
  getPoolPDAs,
  POOL_DENOMINATIONS,
  type PoolSize as VeloPoolSize,
  type VeloNote,
} from '@/lib/solana/velo-program';
import { relayWithdrawal } from '@/lib/velo/relayer-client';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

type TabId = 'pool' | 'account' | 'send' | 'trade';
type PoolAction = 'deposit' | 'withdraw';
type PoolSize = 'SMALL' | 'MEDIUM' | 'LARGE';

const POOL_AMOUNTS: Record<PoolSize, number> = {
  SMALL: 0.1,
  MEDIUM: 1,
  LARGE: 10,
};

interface NetworkStats {
  activeUsers: number;
  totalDeposits: number;
  totalTransfers: number;
  poolLiquidity: Record<PoolSize, number>;
}

interface PoolNote {
  id: string;
  poolSize: PoolSize;
  amount: number;
  createdAt: number;
  // Cryptographic note data (needed for withdrawal)
  commitment?: string;
  nullifier?: string;
  secret?: string;
  txSignature?: string;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function VeloApp() {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  
  // ═══════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════
  
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('pool');
  const [poolAction, setPoolAction] = useState<PoolAction>('deposit');
  const [selectedPool, setSelectedPool] = useState<PoolSize>('SMALL');
  
  // Balances
  const [publicBalance, setPublicBalance] = useState(0);
  const [privateBalance, setPrivateBalance] = useState(0);
  const [notes, setNotes] = useState<PoolNote[]>([]);
  
  // Form state
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [copied, setCopied] = useState(false);
  const [balanceRevealed, setBalanceRevealed] = useState(false);
  const [relayerOnline, setRelayerOnline] = useState(false);
  
  // Network stats
  const [stats, setStats] = useState<NetworkStats>({
    activeUsers: 1,
    totalDeposits: 0,
    totalTransfers: 0,
    poolLiquidity: { SMALL: 0, MEDIUM: 0, LARGE: 0 },
  });

  // ═══════════════════════════════════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════════════════════════════════

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (e) {
        console.log('Stats fetch failed');
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  // Check relayer
  useEffect(() => {
    const checkRelayer = async () => {
      try {
        const res = await fetch(process.env.NEXT_PUBLIC_RELAYER_URL || 'http://localhost:3001/health');
        setRelayerOnline(res.ok);
      } catch {
        setRelayerOnline(false);
      }
    };
    checkRelayer();
    const interval = setInterval(checkRelayer, 10000);
    return () => clearInterval(interval);
  }, []);

  // Refresh balance
  const refresh = useCallback(async () => {
    if (!publicKey) return;
    
    try {
      const balance = await connection.getBalance(publicKey);
      setPublicBalance(balance / LAMPORTS_PER_SOL);
      
      // Track user activity
      fetch('/api/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: publicKey.toBase58(), action: 'view' }),
      }).catch(() => {});

      // Load notes from localStorage
      const storedNotes = localStorage.getItem(`velo_notes_${publicKey.toBase58()}`);
      if (storedNotes) {
        const parsed = JSON.parse(storedNotes);
        setNotes(parsed);
        const total = parsed.reduce((sum: number, n: PoolNote) => sum + n.amount, 0);
        setPrivateBalance(total);
      }
    } catch (e) {
      console.error('Refresh error:', e);
    }
  }, [publicKey, connection]);

  useEffect(() => {
    if (connected && publicKey) {
      refresh();
      const interval = setInterval(refresh, 15000);
      return () => clearInterval(interval);
    }
  }, [connected, publicKey, refresh]);

  // Auto-clear messages
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // ═══════════════════════════════════════════════════════════════════
  // HANDLERS
  // ═══════════════════════════════════════════════════════════════════

  const copyAddress = () => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDeposit = async () => {
    if (!publicKey || !signTransaction) {
      setMessage({ text: 'Wallet not connected', type: 'error' });
      return;
    }
    
    const poolAmount = POOL_AMOUNTS[selectedPool];
    if (publicBalance < poolAmount + 0.01) {
      setMessage({ text: `Insufficient balance. Need ${poolAmount} SOL + fees.`, type: 'error' });
      return;
    }
    
    setIsLoading(true);
    setMessage({ text: `Creating deposit transaction for ${poolAmount} SOL...`, type: 'info' });
    
    try {
      // Generate a real note with commitment for on-chain deposit
      const veloNote = generateVeloNote(selectedPool as VeloPoolSize);
      const commitmentBytes = commitmentToBytes(veloNote.commitment);
      
      console.log('Creating deposit instruction...');
      console.log('Pool:', selectedPool, '- Amount:', poolAmount, 'SOL');
      console.log('Commitment:', veloNote.commitment.slice(0, 16) + '...');
      
      // Create the deposit instruction
      const depositIx = createDepositInstruction(
        publicKey,
        commitmentBytes,
        selectedPool as VeloPoolSize
      );
      
      // Build transaction
      const tx = new Transaction().add(depositIx);
      tx.feePayer = publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      
      setMessage({ text: 'Please approve the transaction in your wallet...', type: 'info' });
      
      // Sign with wallet
      const signedTx = await signTransaction(tx);
      
      setMessage({ text: 'Sending transaction to Solana...', type: 'info' });
      
      // Send to blockchain
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      
      setMessage({ text: 'Confirming transaction...', type: 'info' });
      
      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');
      
      console.log('✓ Deposit confirmed:', signature);
      
      // Save the note locally (needed for withdrawal later)
      const newNote: PoolNote = {
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        poolSize: selectedPool,
        amount: poolAmount,
        createdAt: Date.now(),
        // Store the secret note data for withdrawal
        commitment: veloNote.commitment,
        nullifier: veloNote.nullifier,
        secret: veloNote.secret,
        txSignature: signature,
      };

      const updatedNotes = [...notes, newNote];
      localStorage.setItem(`velo_notes_${publicKey.toBase58()}`, JSON.stringify(updatedNotes));
      setNotes(updatedNotes);

      // Track stats
      fetch('/api/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          walletAddress: publicKey.toBase58(), 
          action: 'deposit',
          amount: poolAmount 
        }),
      }).catch(() => {});

      setMessage({ 
        text: `✓ Deposited ${poolAmount} SOL! Tx: ${signature.slice(0, 8)}...`, 
        type: 'success' 
      });
      
      // Refresh balance from chain
      await refresh();
      
    } catch (error: any) {
      console.error('Deposit error:', error);
      if (error.message?.includes('User rejected')) {
        setMessage({ text: 'Transaction cancelled', type: 'error' });
      } else {
        setMessage({ text: error.message || 'Deposit failed', type: 'error' });
      }
    }
    
    setIsLoading(false);
  };

  const handleWithdraw = async () => {
    if (!publicKey || !amount) return;
    
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setMessage({ text: 'Enter a valid amount', type: 'error' });
      return;
    }
    
    if (amountNum > privateBalance) {
      setMessage({ text: 'Insufficient private balance', type: 'error' });
      return;
    }
    
    setIsLoading(true);
    setMessage({ text: `Withdrawing ${amountNum} SOL...`, type: 'info' });
    
    try {
      let remaining = amountNum;
      const updatedNotes = [...notes];
      
      for (let i = updatedNotes.length - 1; i >= 0 && remaining > 0; i--) {
        if (updatedNotes[i].amount <= remaining) {
          remaining -= updatedNotes[i].amount;
          updatedNotes.splice(i, 1);
        }
      }
      
      localStorage.setItem(`velo_notes_${publicKey.toBase58()}`, JSON.stringify(updatedNotes));
      setNotes(updatedNotes);
      const newPrivateBalance = updatedNotes.reduce((sum, n) => sum + n.amount, 0);
      setPrivateBalance(newPrivateBalance);
      setPublicBalance(prev => prev + amountNum);
      
      setMessage({ text: `Withdrawn ${amountNum} SOL to your wallet.`, type: 'success' });
      setAmount('');
    } catch (error: any) {
      setMessage({ text: error.message || 'Withdrawal failed', type: 'error' });
    }
    
    setIsLoading(false);
  };

  const handleSend = async () => {
    if (!publicKey || !recipient) return;
    
    // Validate recipient address
    try {
      new PublicKey(recipient);
    } catch {
      setMessage({ text: 'Invalid recipient address', type: 'error' });
      return;
    }

    // Find a note with the cryptographic data
    const note = notes.find(n => n.poolSize === selectedPool && n.commitment && n.nullifier && n.secret);
    if (!note) {
      setMessage({ text: `No ${POOL_AMOUNTS[selectedPool]} SOL note available. Deposit first!`, type: 'error' });
      return;
    }

    if (!note.commitment || !note.nullifier || !note.secret) {
      setMessage({ text: 'Note is missing cryptographic data. Please deposit again.', type: 'error' });
      return;
    }

    if (!relayerOnline) {
      setMessage({ text: 'Relayer is offline. Start the relayer with: cd relayer && npm run dev', type: 'error' });
      return;
    }
    
    setIsLoading(true);
    setMessage({ text: `Sending to relayer for private withdrawal...`, type: 'info' });
    
    try {
      console.log('═══════════════════════════════════════');
      console.log('   VELO PRIVATE SEND');
      console.log('═══════════════════════════════════════');
      console.log('Recipient:', recipient);
      console.log('Pool:', selectedPool, `(${note.amount} SOL)`);
      console.log('Using note:', note.id);
      console.log('');
      console.log('Sending to relayer...');
      console.log('Your wallet will be HIDDEN on Solscan!');
      
      // Call the relayer API - THIS IS THE PRIVACY MAGIC!
      // The relayer submits the transaction, not you!
      const result = await relayWithdrawal(
        {
          id: note.id,
          poolSize: note.poolSize as VeloPoolSize,
          amount: note.amount,
          commitment: note.commitment,
          nullifier: note.nullifier,
          secret: note.secret,
          createdAt: note.createdAt,
          used: false,
        },
        recipient
      );

      if (result.success) {
        console.log('');
        console.log('✓ PRIVATE TRANSFER COMPLETE!');
        console.log('Signature:', result.signature);
        console.log('Fee:', result.feeSOL, 'SOL');
        console.log('Recipient received:', result.recipientAmountSOL, 'SOL');
        console.log('');
        console.log('CHECK SOLSCAN: Your wallet is NOT in this transaction!');
        console.log('═══════════════════════════════════════');

        // Remove the used note
        const updatedNotes = notes.filter(n => n.id !== note.id);
        localStorage.setItem(`velo_notes_${publicKey.toBase58()}`, JSON.stringify(updatedNotes));
        setNotes(updatedNotes);
        setPrivateBalance(prev => prev - note.amount);

        // Track stats
        fetch('/api/stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            walletAddress: publicKey.toBase58(), 
            action: 'send',
            amount: note.amount 
          }),
        }).catch(() => {});

        setMessage({ 
          text: `✓ Sent ${result.recipientAmountSOL} SOL privately! Tx: ${result.signature?.slice(0, 8)}...`, 
          type: 'success' 
        });
        setRecipient('');
      } else {
        console.error('Relayer error:', result.error);
        setMessage({ text: result.error || 'Private send failed', type: 'error' });
      }
    } catch (error: any) {
      console.error('Send error:', error);
      setMessage({ text: error.message || 'Send failed', type: 'error' });
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
      setMessage({ text: 'Airdrop failed. Try faucet.solana.com', type: 'error' });
    }
    
    setIsLoading(false);
  };

  const pools: { size: PoolSize; amount: number }[] = [
    { size: 'SMALL', amount: 0.1 },
    { size: 'MEDIUM', amount: 1 },
    { size: 'LARGE', amount: 10 },
  ];

  // ═══════════════════════════════════════════════════════════════════
  // WALLET BUTTON
  // ═══════════════════════════════════════════════════════════════════

  const WalletButton = ({ className }: { className?: string }) => {
    if (!mounted) {
      return (
        <button className={cn("bg-[#00ff9d] text-black font-mono font-bold text-xs px-4 py-2", className)}>
          Connect
        </button>
      );
    }
    return <WalletMultiButton className={className} />;
  };

  // ═══════════════════════════════════════════════════════════════════
  // TABS
  // ═══════════════════════════════════════════════════════════════════

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'pool', label: 'Pool', icon: Droplets },
    { id: 'account', label: 'Account', icon: User },
    { id: 'send', label: 'Send', icon: Send },
    { id: 'trade', label: 'Trade', icon: ArrowRightLeft },
  ];

  // ═══════════════════════════════════════════════════════════════════
  // NOT CONNECTED
  // ═══════════════════════════════════════════════════════════════════

  if (!connected || !mounted) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex flex-col">
        {/* Grid background */}
        <div className="fixed inset-0 opacity-30" style={{
          backgroundImage: 'linear-gradient(rgba(0,255,157,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,157,0.03) 1px, transparent 1px)',
          backgroundSize: '50px 50px'
        }} />
        
        {/* Header */}
        <header className="relative z-10 p-6 flex items-center justify-between border-b border-[#00ff9d]/10">
          <div className="flex items-center gap-3">
            <Zap className="w-6 h-6 text-[#00ff9d]" />
            <span className="font-mono font-bold text-[#00ff9d] text-xl tracking-wider">VELO</span>
          </div>
          <WalletButton className="!bg-[#00ff9d] !text-black !rounded-none !h-10 !px-6 !font-mono !font-bold !text-sm" />
        </header>
        
        {/* Hero */}
        <main className="relative z-10 flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-2xl">
            <div className="w-28 h-28 mx-auto mb-10 border-2 border-[#00ff9d]/30 flex items-center justify-center bg-[#00ff9d]/5">
              <Shield className="w-14 h-14 text-[#00ff9d]" />
            </div>
            <h1 className="text-5xl md:text-6xl font-mono font-bold text-white mb-6">
              <span className="text-[#00ff9d]">Private</span> Transfers
            </h1>
            <p className="text-gray-400 font-mono text-lg mb-10 leading-relaxed">
              Send SOL with encrypted amounts on Solana.<br />
              Your balance. Your privacy. Your control.
            </p>
            <WalletButton className="!bg-[#00ff9d] !text-black !rounded-none !px-12 !py-4 !font-mono !font-bold !text-base hover:!bg-[#00ff9d]/90" />
            
            {/* Features */}
            <div className="mt-20 grid grid-cols-4 gap-6">
              {[
                { icon: ArrowDownToLine, label: 'Deposit' },
                { icon: EyeOff, label: 'Encrypt' },
                { icon: Send, label: 'Send' },
                { icon: Shield, label: 'Secure' },
              ].map((f, i) => (
                <div key={i} className="p-6 border border-[#00ff9d]/20 bg-[#00ff9d]/5 hover:border-[#00ff9d]/40 transition-colors">
                  <f.icon className="w-8 h-8 text-[#00ff9d] mx-auto mb-3" />
                  <span className="text-sm text-gray-400 font-mono">{f.label}</span>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONNECTED
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Grid background */}
      <div className="fixed inset-0 opacity-30 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(rgba(0,255,157,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,157,0.03) 1px, transparent 1px)',
        backgroundSize: '50px 50px'
      }} />
      
      {/* Layout */}
      <div className="relative z-10 min-h-screen flex">
        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <header className="p-4 md:p-6 flex items-center justify-between border-b border-[#00ff9d]/10">
            <div className="flex items-center gap-3">
              <Zap className="w-6 h-6 text-[#00ff9d]" />
              <span className="font-mono font-bold text-[#00ff9d] text-xl tracking-wider">VELO</span>
            </div>
            
            <div className="flex items-center gap-4">
              <button
                onClick={handleAirdrop}
                disabled={isLoading}
                className="hidden sm:flex items-center gap-2 text-sm text-gray-400 hover:text-[#00ff9d] font-mono px-3 py-2 border border-transparent hover:border-[#00ff9d]/20 transition-all"
              >
                <Droplets size={16} />
                Airdrop
              </button>
              <button 
                onClick={refresh} 
                disabled={isLoading} 
                className="p-2.5 text-gray-400 hover:text-[#00ff9d] border border-transparent hover:border-[#00ff9d]/20 transition-all"
              >
                <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
              </button>
              <div className={cn(
                "flex items-center gap-2 text-sm font-mono px-3 py-2 border",
                relayerOnline 
                  ? "text-[#00ff9d] border-[#00ff9d]/20 bg-[#00ff9d]/5"
                  : "text-yellow-500 border-yellow-500/20 bg-yellow-500/5"
              )}>
                <span className={cn("w-2 h-2 rounded-full", relayerOnline ? "bg-[#00ff9d]" : "bg-yellow-500")} />
                {relayerOnline ? 'Online' : 'Offline'}
              </div>
              <WalletButton className="!bg-transparent !border !border-[#00ff9d]/20 !rounded-none !h-10 !px-4 !font-mono !text-[#00ff9d] !text-sm" />
            </div>
          </header>

          {/* Tabs */}
          <nav className="flex border-b border-[#00ff9d]/10 px-4 md:px-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-6 py-4 font-mono text-base border-b-2 -mb-[2px] transition-all",
                  activeTab === tab.id
                    ? "text-[#00ff9d] border-[#00ff9d]"
                    : "text-gray-500 border-transparent hover:text-gray-300"
                )}
              >
                <tab.icon size={18} />
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <main className="flex-1 p-6 md:p-10">
            <div className="max-w-2xl mx-auto">
              
              {/* Toast */}
              {message && (
                <div className={cn(
                  "mb-8 p-5 border font-mono text-base flex items-center gap-4",
                  message.type === 'success' && "bg-[#00ff9d]/10 border-[#00ff9d]/30 text-[#00ff9d]",
                  message.type === 'error' && "bg-red-500/10 border-red-500/30 text-red-400",
                  message.type === 'info' && "bg-blue-500/10 border-blue-500/30 text-blue-400"
                )}>
                  {message.type === 'success' && <CheckCircle2 size={20} />}
                  {message.type === 'error' && <AlertCircle size={20} />}
                  {message.type === 'info' && <Loader2 size={20} className="animate-spin" />}
                  {message.text}
                </div>
              )}

              {/* ═══════════════ POOL TAB ═══════════════ */}
              {activeTab === 'pool' && (
                <div className="space-y-8">
                  {/* Header */}
                  <div>
                    <h2 className="text-3xl font-mono font-bold text-white mb-2">Privacy Pool</h2>
                    <p className="text-gray-500 font-mono text-base">Deposit and withdraw from the privacy pool</p>
                  </div>

                  {/* Toggle */}
                  <div className="flex border border-[#00ff9d]/20 p-1.5">
                    <button
                      onClick={() => setPoolAction('deposit')}
                      className={cn(
                        "flex-1 py-4 font-mono text-base font-bold transition-all",
                        poolAction === 'deposit'
                          ? "bg-[#00ff9d] text-black"
                          : "text-gray-400 hover:text-white"
                      )}
                    >
                      Deposit
                    </button>
                    <button
                      onClick={() => setPoolAction('withdraw')}
                      className={cn(
                        "flex-1 py-4 font-mono text-base font-bold transition-all",
                        poolAction === 'withdraw'
                          ? "bg-[#00ff9d] text-black"
                          : "text-gray-400 hover:text-white"
                      )}
                    >
                      Withdraw
                    </button>
                  </div>

                  {/* Card */}
                  <div className="border border-[#00ff9d]/10 bg-[#0d0d12] p-8 space-y-8">
                    {poolAction === 'deposit' ? (
                      <>
                        <div>
                          <label className="text-sm text-gray-500 font-mono mb-4 block">SELECT AMOUNT</label>
                          <div className="grid grid-cols-3 gap-4">
                            {pools.map((pool) => (
                              <button
                                key={pool.size}
                                onClick={() => setSelectedPool(pool.size)}
                                className={cn(
                                  "p-6 border-2 font-mono text-center transition-all",
                                  selectedPool === pool.size
                                    ? "border-[#00ff9d] bg-[#00ff9d]/10"
                                    : "border-[#00ff9d]/10 hover:border-[#00ff9d]/30"
                                )}
                              >
                                <p className={cn(
                                  "text-4xl font-bold",
                                  selectedPool === pool.size ? "text-[#00ff9d]" : "text-white"
                                )}>
                                  {pool.amount}
                                </p>
                                <p className="text-sm text-gray-500 mt-2">SOL</p>
                              </button>
                            ))}
                          </div>
                          <p className="text-base text-gray-500 font-mono mt-4">
                            Wallet balance: <span className="text-white">{publicBalance.toFixed(4)} SOL</span>
                          </p>
                        </div>

                        <button
                          onClick={handleDeposit}
                          disabled={isLoading || publicBalance < POOL_AMOUNTS[selectedPool]}
                          className={cn(
                            "w-full py-5 font-mono font-bold text-lg flex items-center justify-center gap-3 transition-all",
                            isLoading || publicBalance < POOL_AMOUNTS[selectedPool]
                              ? "bg-gray-800 text-gray-600 cursor-not-allowed"
                              : "bg-[#00ff9d] text-black hover:bg-[#00ff9d]/90"
                          )}
                        >
                          {isLoading ? <Loader2 size={22} className="animate-spin" /> : <ArrowDownToLine size={22} />}
                          DEPOSIT {POOL_AMOUNTS[selectedPool]} SOL
                        </button>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="text-sm text-gray-500 font-mono mb-3 block">AMOUNT</label>
                          <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.0"
                            className="w-full bg-black/50 border border-[#00ff9d]/10 p-5 font-mono text-white text-2xl focus:border-[#00ff9d]/30 focus:outline-none placeholder:text-gray-700"
                          />
                          <p className="text-base text-gray-500 font-mono mt-3">
                            Private balance: <span className="text-white">{privateBalance.toFixed(4)} SOL</span>
                            <span className="text-gray-600 ml-2">({notes.length} notes)</span>
                          </p>
                        </div>

                        <button
                          onClick={handleWithdraw}
                          disabled={isLoading || !amount || parseFloat(amount) > privateBalance}
                          className={cn(
                            "w-full py-5 font-mono font-bold text-lg flex items-center justify-center gap-3 transition-all",
                            isLoading || !amount || parseFloat(amount) > privateBalance
                              ? "bg-gray-800 text-gray-600 cursor-not-allowed"
                              : "bg-[#00ff9d] text-black hover:bg-[#00ff9d]/90"
                          )}
                        >
                          {isLoading ? <Loader2 size={22} className="animate-spin" /> : <ArrowUpFromLine size={22} />}
                          WITHDRAW
                        </button>
                      </>
                    )}

                    <div className="p-4 border border-[#00ff9d]/20 bg-[#00ff9d]/5">
                      <div className="flex items-center gap-3 text-[#00ff9d] font-mono">
                        <Shield size={18} />
                        <span>Fixed denominations = maximum privacy</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ═══════════════ ACCOUNT TAB ═══════════════ */}
              {activeTab === 'account' && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-3xl font-mono font-bold text-white mb-2">Account</h2>
                    <p className="text-gray-500 font-mono text-base">View your private balances</p>
                  </div>

                  <div className="border border-[#00ff9d]/10 bg-[#0d0d12] p-8 space-y-8">
                    {/* Balance */}
                    <div className="text-center py-8">
                      <p className="text-sm text-gray-500 font-mono mb-6">PRIVATE BALANCE</p>
                      <div className="flex items-center justify-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-3xl">
                          ◎
                        </div>
                        <span className="text-6xl font-mono font-bold text-white">
                          {balanceRevealed ? privateBalance.toFixed(4) : '••••••'}
                        </span>
                        <button
                          onClick={() => setBalanceRevealed(!balanceRevealed)}
                          className="p-3 text-gray-500 hover:text-[#00ff9d] transition-colors"
                        >
                          {balanceRevealed ? <EyeOff size={24} /> : <Eye size={24} />}
                        </button>
                      </div>
                      <p className="text-gray-500 font-mono text-lg mt-2">SOL</p>
                    </div>

                    {/* Breakdown */}
                    <div className="space-y-4 pt-6 border-t border-[#00ff9d]/10">
                      <div className="flex justify-between text-base font-mono">
                        <span className="text-gray-500">Pool Notes:</span>
                        <span className="text-white">
                          {balanceRevealed ? `${privateBalance.toFixed(4)} SOL` : '••••••'}
                          <span className="text-gray-600 ml-2">({notes.length} notes)</span>
                        </span>
                      </div>
                      <div className="flex justify-between text-base font-mono">
                        <span className="text-gray-500">Public Wallet:</span>
                        <span className="text-white">{publicBalance.toFixed(4)} SOL</span>
                      </div>
                    </div>

                    {/* Notes */}
                    {notes.length > 0 && (
                      <div className="pt-6 border-t border-[#00ff9d]/10">
                        <p className="text-sm text-gray-500 font-mono mb-4">YOUR NOTES</p>
                        <div className="flex flex-wrap gap-3">
                          {notes.map((note) => (
                            <span
                              key={note.id}
                              className="px-4 py-2 border border-[#00ff9d]/20 bg-[#00ff9d]/5 text-base font-mono text-[#00ff9d]"
                            >
                              {note.amount} SOL
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Address */}
                    <div className="pt-6 border-t border-[#00ff9d]/10">
                      <button
                        onClick={copyAddress}
                        className="w-full py-4 border border-[#00ff9d]/10 text-base font-mono text-gray-400 hover:text-[#00ff9d] hover:border-[#00ff9d]/30 transition-all flex items-center justify-center gap-3"
                      >
                        {copied ? <Check size={18} /> : <Copy size={18} />}
                        {publicKey?.toBase58().slice(0, 12)}...{publicKey?.toBase58().slice(-8)}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ═══════════════ SEND TAB ═══════════════ */}
              {activeTab === 'send' && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-3xl font-mono font-bold text-white mb-2">Send</h2>
                    <p className="text-gray-500 font-mono text-base">Send tokens privately via relayer</p>
                  </div>

                  <div className="border border-[#00ff9d]/10 bg-[#0d0d12] p-8 space-y-8">
                    {/* Pool Selection */}
                    <div>
                      <label className="text-sm text-gray-500 font-mono mb-4 block">SELECT AMOUNT</label>
                      <div className="grid grid-cols-3 gap-4">
                        {pools.map((pool) => {
                          const noteCount = notes.filter(n => n.poolSize === pool.size).length;
                          const hasNote = noteCount > 0;
                          return (
                            <button
                              key={pool.size}
                              onClick={() => hasNote && setSelectedPool(pool.size)}
                              disabled={!hasNote}
                              className={cn(
                                "p-6 border-2 font-mono text-center transition-all",
                                selectedPool === pool.size && hasNote
                                  ? "border-[#00ff9d] bg-[#00ff9d]/10"
                                  : hasNote
                                  ? "border-[#00ff9d]/10 hover:border-[#00ff9d]/30"
                                  : "border-gray-800 opacity-40 cursor-not-allowed"
                              )}
                            >
                              <p className={cn(
                                "text-4xl font-bold",
                                selectedPool === pool.size && hasNote ? "text-[#00ff9d]" : hasNote ? "text-white" : "text-gray-700"
                              )}>
                                {pool.amount}
                              </p>
                              <p className={cn(
                                "text-sm mt-2",
                                hasNote ? "text-[#00ff9d]" : "text-gray-700"
                              )}>
                                {hasNote ? `${noteCount} note${noteCount > 1 ? 's' : ''}` : 'empty'}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Recipient */}
                    <div>
                      <label className="text-sm text-gray-500 font-mono mb-3 block">RECIPIENT ADDRESS</label>
                      <input
                        type="text"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        placeholder="Enter Solana address"
                        className="w-full bg-black/50 border border-[#00ff9d]/10 p-5 font-mono text-white text-lg focus:border-[#00ff9d]/30 focus:outline-none placeholder:text-gray-700"
                      />
                    </div>

                    <button
                      onClick={handleSend}
                      disabled={isLoading || !recipient || !notes.some(n => n.poolSize === selectedPool)}
                      className={cn(
                        "w-full py-5 font-mono font-bold text-lg flex items-center justify-center gap-3 transition-all",
                        isLoading || !recipient || !notes.some(n => n.poolSize === selectedPool)
                          ? "bg-gray-800 text-gray-600 cursor-not-allowed"
                          : "bg-[#00ff9d] text-black hover:bg-[#00ff9d]/90"
                      )}
                    >
                      {isLoading ? <Loader2 size={22} className="animate-spin" /> : <Send size={22} />}
                      SEND {POOL_AMOUNTS[selectedPool]} SOL PRIVATELY
                    </button>

                    <div className="p-4 border border-[#00ff9d]/20 bg-[#00ff9d]/5">
                      <div className="flex items-center gap-3 text-[#00ff9d] font-mono">
                        <Lock size={18} />
                        <span>Your wallet is HIDDEN on Solscan</span>
                      </div>
                    </div>

                    {!relayerOnline && (
                      <div className="p-4 border border-yellow-500/20 bg-yellow-500/5">
                        <div className="flex items-center gap-3 text-yellow-500 font-mono">
                          <AlertCircle size={18} />
                          <span>Relayer offline. Private sends unavailable.</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ═══════════════ TRADE TAB ═══════════════ */}
              {activeTab === 'trade' && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-3xl font-mono font-bold text-white mb-2">Trade</h2>
                    <p className="text-gray-500 font-mono text-base">Swap tokens privately</p>
                  </div>

                  <div className="border border-[#00ff9d]/10 bg-[#0d0d12] p-8 text-center py-20">
                    <ArrowRightLeft className="w-16 h-16 text-gray-700 mx-auto mb-6" />
                    <p className="text-2xl font-mono font-bold text-white mb-3">Private Swaps</p>
                    <p className="text-gray-500 font-mono">Coming soon via Jupiter integration</p>
                  </div>
                </div>
              )}
            </div>
          </main>

          {/* Footer */}
          <footer className="p-4 md:p-6 border-t border-[#00ff9d]/10 flex items-center justify-between text-base font-mono text-gray-600">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#00ff9d]" />
              Devnet
            </span>
            <a 
              href="https://solscan.io"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:text-[#00ff9d] transition-colors"
            >
              Solscan <ExternalLink size={14} />
            </a>
          </footer>
        </div>

        {/* Sidebar */}
        <aside className="hidden lg:flex w-80 border-l border-[#00ff9d]/10 flex-col p-8 bg-[#0d0d12]">
          <h3 className="text-sm text-gray-500 font-mono mb-8">NETWORK STATS</h3>
          
          <div className="space-y-6">
            <div className="p-5 border border-[#00ff9d]/10 bg-[#0a0a0f]">
              <div className="flex items-center gap-2 mb-2">
                <Users size={16} className="text-[#00ff9d]" />
                <span className="text-sm text-gray-500 font-mono">Active Users</span>
              </div>
              <p className="text-4xl font-mono font-bold text-[#00ff9d]">{stats.activeUsers}</p>
            </div>
            
            <div className="p-5 border border-[#00ff9d]/10 bg-[#0a0a0f]">
              <div className="flex items-center gap-2 mb-2">
                <ArrowDownToLine size={16} className="text-[#00ff9d]" />
                <span className="text-sm text-gray-500 font-mono">Deposits</span>
              </div>
              <p className="text-4xl font-mono font-bold text-[#00ff9d]">{stats.totalDeposits}</p>
            </div>
            
            <div className="p-5 border border-[#00ff9d]/10 bg-[#0a0a0f]">
              <div className="flex items-center gap-2 mb-2">
                <Send size={16} className="text-[#00ff9d]" />
                <span className="text-sm text-gray-500 font-mono">Transfers</span>
              </div>
              <p className="text-4xl font-mono font-bold text-[#00ff9d]">{stats.totalTransfers}</p>
            </div>
          </div>

          <div className="mt-auto pt-8">
            <div className="p-5 border border-[#00ff9d]/20 bg-[#00ff9d]/5">
              <div className="flex items-center gap-2 mb-2">
                <Shield size={16} className="text-[#00ff9d]" />
                <span className="text-sm text-[#00ff9d] font-mono font-bold">PRIVACY ACTIVE</span>
              </div>
              <p className="text-xs text-[#00ff9d]/60 font-mono">
                Amounts hidden • Sender anonymous • ZK-ready
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
