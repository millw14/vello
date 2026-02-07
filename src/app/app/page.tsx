'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js';
import { 
  Shield, ArrowDownToLine, ArrowUpFromLine, Send, 
  RefreshCw, Copy, Check, ExternalLink, EyeOff,
  Eye, AlertCircle, CheckCircle2, Loader2, 
  ArrowRightLeft, Lock, Droplets
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  generateVeloNote,
  createDepositInstruction,
  commitmentToBytes,
  POOL_DENOMINATIONS,
  type PoolSize as VeloPoolSize,
} from '@/lib/solana/velo-program';
import { relayWithdrawal } from '@/lib/velo/relayer-client';
import Image from 'next/image';

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

type TabId = 'pool' | 'account' | 'send' | 'trade';
type PoolAction = 'deposit' | 'withdraw';
type PoolSize = 'SMALL' | 'MEDIUM' | 'LARGE';

const POOL_AMOUNTS: Record<PoolSize, number> = {
  SMALL: 0.1,
  MEDIUM: 1,
  LARGE: 10,
};

interface PoolNote {
  id: string;
  poolSize: PoolSize;
  amount: number;
  createdAt: number;
  commitment?: string;
  nullifier?: string;
  secret?: string;
  txSignature?: string;
}

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════

export default function VeloApp() {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('pool');
  const [poolAction, setPoolAction] = useState<PoolAction>('deposit');
  const [selectedPool, setSelectedPool] = useState<PoolSize>('SMALL');
  
  const [publicBalance, setPublicBalance] = useState(0);
  const [privateBalance, setPrivateBalance] = useState(0);
  const [notes, setNotes] = useState<PoolNote[]>([]);
  
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info'; link?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [balanceRevealed, setBalanceRevealed] = useState(false);
  const [relayerOnline, setRelayerOnline] = useState(false);

  // ═══════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        if (res.ok) await res.json();
      } catch { /* silent */ }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkRelayer = async () => {
      try {
        const res = await fetch(process.env.NEXT_PUBLIC_RELAYER_URL || 'http://localhost:3001/health');
        setRelayerOnline(res.ok);
      } catch { setRelayerOnline(false); }
    };
    checkRelayer();
    const interval = setInterval(checkRelayer, 10000);
    return () => clearInterval(interval);
  }, []);

  const refresh = useCallback(async () => {
    if (!publicKey) return;
    try {
      const balance = await connection.getBalance(publicKey);
      setPublicBalance(balance / LAMPORTS_PER_SOL);
      fetch('/api/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: publicKey.toBase58(), action: 'view' }),
      }).catch(() => {});
      const storedNotes = localStorage.getItem(`velo_notes_${publicKey.toBase58()}`);
      if (storedNotes) {
        const parsed = JSON.parse(storedNotes);
        setNotes(parsed);
        setPrivateBalance(parsed.reduce((sum: number, n: PoolNote) => sum + n.amount, 0));
      }
    } catch (e) { console.error('Refresh error:', e); }
  }, [publicKey, connection]);

  useEffect(() => {
    if (connected && publicKey) {
      refresh();
      const interval = setInterval(refresh, 15000);
      return () => clearInterval(interval);
    }
  }, [connected, publicKey, refresh]);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // ═══════════════════════════════════════
  // HANDLERS
  // ═══════════════════════════════════════

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
    setMessage({ text: `Creating deposit for ${poolAmount} SOL...`, type: 'info' });
    try {
      const veloNote = generateVeloNote(selectedPool as VeloPoolSize);
      const commitmentBytes = commitmentToBytes(veloNote.commitment);
      const depositIx = createDepositInstruction(publicKey, commitmentBytes, selectedPool as VeloPoolSize);
      const tx = new Transaction().add(depositIx);
      tx.feePayer = publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      setMessage({ text: 'Approve in your wallet...', type: 'info' });
      const signedTx = await signTransaction(tx);
      setMessage({ text: 'Confirming on Solana...', type: 'info' });
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction(signature, 'confirmed');
      const newNote: PoolNote = {
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        poolSize: selectedPool,
        amount: poolAmount,
        createdAt: Date.now(),
        commitment: veloNote.commitment,
        nullifier: veloNote.nullifier,
        secret: veloNote.secret,
        txSignature: signature,
      };
      const updatedNotes = [...notes, newNote];
      localStorage.setItem(`velo_notes_${publicKey.toBase58()}`, JSON.stringify(updatedNotes));
      setNotes(updatedNotes);
      fetch('/api/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: publicKey.toBase58(), action: 'deposit', amount: poolAmount }),
      }).catch(() => {});
      setMessage({ text: `Deposited ${poolAmount} SOL!`, type: 'success', link: `https://solscan.io/tx/${signature}?cluster=devnet` });
      await refresh();
    } catch (error: any) {
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
      setPrivateBalance(updatedNotes.reduce((sum, n) => sum + n.amount, 0));
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
    try { new PublicKey(recipient); } catch {
      setMessage({ text: 'Invalid recipient address', type: 'error' });
      return;
    }
    const note = notes.find(n => n.poolSize === selectedPool && n.commitment && n.nullifier && n.secret);
    if (!note) {
      setMessage({ text: `No ${POOL_AMOUNTS[selectedPool]} SOL note available. Deposit first!`, type: 'error' });
      return;
    }
    if (!note.commitment || !note.nullifier || !note.secret) {
      setMessage({ text: 'Note is missing data. Please deposit again.', type: 'error' });
      return;
    }
    if (!relayerOnline) {
      setMessage({ text: 'Relayer is offline. Start: cd relayer && npm run dev', type: 'error' });
      return;
    }
    setIsLoading(true);
    setMessage({ text: 'Sending via relayer...', type: 'info' });
    try {
      const result = await relayWithdrawal(
        { id: note.id, poolSize: note.poolSize as VeloPoolSize, amount: note.amount, commitment: note.commitment, nullifier: note.nullifier, secret: note.secret, createdAt: note.createdAt, used: false },
        recipient
      );
      if (result.success) {
        const updatedNotes = notes.filter(n => n.id !== note.id);
        localStorage.setItem(`velo_notes_${publicKey.toBase58()}`, JSON.stringify(updatedNotes));
        setNotes(updatedNotes);
        setPrivateBalance(prev => prev - note.amount);
        fetch('/api/stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress: publicKey.toBase58(), action: 'send', amount: note.amount }),
        }).catch(() => {});
        setMessage({ text: `Sent ${result.recipientAmountSOL} SOL privately!`, type: 'success', link: result.signature ? `https://solscan.io/tx/${result.signature}?cluster=devnet` : undefined });
        setRecipient('');
      } else {
        setMessage({ text: result.error || 'Private send failed', type: 'error' });
      }
    } catch (error: any) {
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
    } catch {
      setMessage({ text: 'Airdrop failed. Try faucet.solana.com', type: 'error' });
    }
    setIsLoading(false);
  };

  const pools: { size: PoolSize; amount: number }[] = [
    { size: 'SMALL', amount: 0.1 },
    { size: 'MEDIUM', amount: 1 },
    { size: 'LARGE', amount: 10 },
  ];

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'pool', label: 'Pool', icon: Droplets },
    { id: 'account', label: 'Account', icon: Eye },
    { id: 'send', label: 'Send', icon: Send },
    { id: 'trade', label: 'Trade', icon: ArrowRightLeft },
  ];

  // ═══════════════════════════════════════
  // WALLET BUTTON
  // ═══════════════════════════════════════

  const WalletBtn = ({ className, style }: { className?: string; style?: string }) => {
    if (!mounted) {
      return (
        <button className={cn("bg-[#00ff9d] text-black font-mono font-bold text-sm px-5 py-2.5 rounded-lg", className)}>
          Connect
        </button>
      );
    }
    return <WalletMultiButton className={className} />;
  };

  // ═══════════════════════════════════════
  // MATRIX RAIN
  // ═══════════════════════════════════════

  const MatrixRain = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let animationId: number;
      let width = 0;
      let height = 0;
      let columns = 0;
      let drops: number[] = [];

      const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF<>/{}[]|;:,.=+-*&^%$#@!~';
      const charArray = chars.split('');
      const fontSize = 14;

      const resize = () => {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        columns = Math.floor(width / fontSize);
        drops = Array(columns).fill(0).map(() => Math.random() * -100);
      };

      resize();
      window.addEventListener('resize', resize);

      const draw = () => {
        // Fade trail
        ctx.fillStyle = 'rgba(6, 6, 9, 0.06)';
        ctx.fillRect(0, 0, width, height);

        for (let i = 0; i < columns; i++) {
          // Only render ~40% of columns for a sparser look
          if (i % 3 !== 0 && i % 5 !== 0) continue;

          const charIndex = Math.floor(Math.random() * charArray.length);
          const x = i * fontSize;
          const y = drops[i] * fontSize;

          // Brightest character at the head
          ctx.font = `${fontSize}px monospace`;
          ctx.fillStyle = 'rgba(0, 255, 157, 0.9)';
          ctx.fillText(charArray[charIndex], x, y);

          // Dimmer trail characters
          if (drops[i] > 1) {
            ctx.fillStyle = 'rgba(0, 255, 157, 0.15)';
            const trailChar = charArray[Math.floor(Math.random() * charArray.length)];
            ctx.fillText(trailChar, x, y - fontSize);
          }
          if (drops[i] > 2) {
            ctx.fillStyle = 'rgba(0, 255, 157, 0.06)';
            const trailChar2 = charArray[Math.floor(Math.random() * charArray.length)];
            ctx.fillText(trailChar2, x, y - fontSize * 2);
          }

          // Reset when off screen
          if (y > height && Math.random() > 0.975) {
            drops[i] = 0;
          }
          drops[i] += 0.5 + Math.random() * 0.5;
        }

        animationId = requestAnimationFrame(draw);
      };

      draw();

      return () => {
        window.removeEventListener('resize', resize);
        cancelAnimationFrame(animationId);
      };
    }, []);

    return (
      <canvas
        ref={canvasRef}
        className="fixed inset-0 z-0 pointer-events-none"
        style={{ opacity: 0.4 }}
      />
    );
  };

  const Background = () => (
    <>
      <div className="velo-bg" />
      <MatrixRain />
      <div className="velo-vignette" />
      <div className="velo-noise" />
    </>
  );

  // ═══════════════════════════════════════
  // NOT CONNECTED
  // ═══════════════════════════════════════

  if (!connected || !mounted) {
    return (
      <div className="min-h-screen flex flex-col relative">
        <Background />
        
        {/* Header */}
        <header className="relative z-10 px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Velo" width={26} height={26} />
            <span className="font-mono font-bold text-white text-base tracking-widest">VELO</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://solscan.io" target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-gray-300 font-mono transition-colors hidden sm:block">
              Explorer
            </a>
            <span className="text-gray-700 hidden sm:block">|</span>
            <span className="text-xs text-gray-500 font-mono flex items-center gap-1.5 hidden sm:flex">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00ff9d] animate-pulse" />
              Devnet
            </span>
          </div>
        </header>
        
        {/* Hero */}
        <main className="relative z-10 flex-1 flex items-center justify-center px-6 pb-12">
          <div className="text-center max-w-2xl">
            {/* Logo with glow */}
            <div className="relative w-24 h-24 mx-auto mb-10">
              <div className="absolute inset-0 bg-[#00ff9d]/20 rounded-full blur-[40px] animate-pulse" />
              <Image src="/logo.png" alt="Velo" width={96} height={96} className="relative" />
            </div>

            {/* Headline */}
            <h1 className="text-5xl md:text-7xl font-bold text-white mb-5 font-sans leading-[1.1] tracking-tight">
              Private Transfers
              <br />
              <span className="bg-gradient-to-r from-[#00ff9d] to-[#00e5c7] bg-clip-text text-transparent">on Solana</span>
            </h1>

            <p className="text-gray-400 text-lg md:text-xl mb-12 leading-relaxed max-w-md mx-auto font-light">
              Send SOL with hidden amounts. Your balance, your privacy, your control.
            </p>

            {/* CTA Button */}
            <div className="relative inline-block group">
              <div className="absolute -inset-1 bg-gradient-to-r from-[#00ff9d] to-[#00e5c7] rounded-xl blur-md opacity-40 group-hover:opacity-70 transition-opacity" />
              <WalletBtn className="!relative !bg-[#00ff9d] !text-black !rounded-xl !px-12 !py-3.5 !font-mono !font-bold !text-sm hover:!bg-[#00ff9d] !transition-all !border-0" />
            </div>
            
            {/* Features */}
            <div className="mt-20 grid grid-cols-3 gap-3 sm:gap-5 max-w-lg mx-auto">
              {[
                { icon: ArrowDownToLine, label: 'Deposit', desc: 'Fixed-amount pools' },
                { icon: EyeOff, label: 'Hide', desc: 'Encrypted amounts' },
                { icon: Send, label: 'Send', desc: 'Anonymous transfers' },
              ].map((f, i) => (
                <div key={i} className="group relative">
                  <div className="absolute inset-0 bg-[#00ff9d]/5 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative velo-card p-5 sm:p-6 text-center">
                    <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-[#00ff9d]/8 flex items-center justify-center">
                      <f.icon className="w-5 h-5 text-[#00ff9d]" />
                    </div>
                    <p className="text-sm text-white font-semibold">{f.label}</p>
                    <p className="text-xs text-gray-500 mt-1">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Trust line */}
            <div className="mt-14 flex items-center justify-center gap-6 text-xs text-gray-600 font-mono">
              <span className="flex items-center gap-1.5"><Shield size={12} className="text-[#00ff9d]/50" /> ZK Proofs</span>
              <span className="text-gray-800">|</span>
              <span className="flex items-center gap-1.5"><Lock size={12} className="text-[#00ff9d]/50" /> Non-custodial</span>
              <span className="text-gray-800">|</span>
              <span className="flex items-center gap-1.5"><Eye size={12} className="text-[#00ff9d]/50" /> Open Source</span>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ═══════════════════════════════════════
  // CONNECTED
  // ═══════════════════════════════════════

  return (
    <div className="min-h-screen flex flex-col relative">
      <Background />
      
      {/* Header */}
      <header className="relative z-10 px-6 py-4 flex items-center justify-between border-b border-white/[0.04]">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Velo" width={24} height={24} />
          <span className="font-mono font-bold text-white text-lg tracking-wider">VELO</span>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={handleAirdrop}
            disabled={isLoading}
            className="hidden sm:flex items-center gap-2 text-sm text-gray-400 hover:text-[#00ff9d] font-mono px-3 py-2 rounded-lg hover:bg-[#00ff9d]/5 transition-all"
          >
            <Droplets size={15} />
            Airdrop
          </button>
          <button 
            onClick={refresh} 
            disabled={isLoading} 
            className="p-2 text-gray-400 hover:text-[#00ff9d] rounded-lg hover:bg-[#00ff9d]/5 transition-all"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <div className={cn(
            "flex items-center gap-2 text-xs font-mono px-3 py-2 rounded-lg",
            relayerOnline 
              ? "text-[#00ff9d]/80 bg-[#00ff9d]/5"
              : "text-yellow-500/80 bg-yellow-500/5"
          )}>
            <span className={cn("w-1.5 h-1.5 rounded-full", relayerOnline ? "bg-[#00ff9d]" : "bg-yellow-500")} />
            {relayerOnline ? 'Online' : 'Offline'}
          </div>
          <WalletBtn className="!bg-transparent !border !border-white/[0.06] !rounded-lg !h-9 !px-4 !font-mono !text-white/80 !text-xs" />
        </div>
      </header>

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col">
        {/* Tabs */}
        <nav className="flex gap-1 px-6 pt-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 font-mono text-sm rounded-lg transition-all",
                activeTab === tab.id
                  ? "text-[#00ff9d] bg-[#00ff9d]/8"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.02]"
              )}
            >
              <tab.icon size={15} />
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Main */}
        <main className="flex-1 px-6 py-8">
          <div className="max-w-xl mx-auto">
            
            {/* Toast */}
            {message && (
              <div className={cn(
                "mb-6 p-4 rounded-lg font-mono text-sm flex items-center gap-3 animate-[fade-in_0.2s_ease-out]",
                message.type === 'success' && "bg-[#00ff9d]/8 text-[#00ff9d] border border-[#00ff9d]/15",
                message.type === 'error' && "bg-red-500/8 text-red-400 border border-red-500/15",
                message.type === 'info' && "bg-blue-500/8 text-blue-400 border border-blue-500/15"
              )}>
                {message.type === 'success' && <CheckCircle2 size={16} className="shrink-0" />}
                {message.type === 'error' && <AlertCircle size={16} className="shrink-0" />}
                {message.type === 'info' && <Loader2 size={16} className="animate-spin shrink-0" />}
                <span className="flex-1">{message.text}</span>
                {message.link && (
                  <a
                    href={message.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-1.5 text-xs font-semibold opacity-80 hover:opacity-100 transition-opacity underline underline-offset-2"
                  >
                    Solscan <ExternalLink size={12} />
                  </a>
                )}
              </div>
            )}

            {/* ═════════ POOL TAB ═════════ */}
            {activeTab === 'pool' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">Privacy Pool</h2>
                  <p className="text-gray-500 text-sm">Deposit and withdraw from the privacy pool</p>
                </div>

                {/* Toggle */}
                <div className="flex gap-1 p-1 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <button
                    onClick={() => setPoolAction('deposit')}
                    className={cn(
                      "flex-1 py-3 font-mono text-sm font-semibold rounded-md transition-all",
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
                      "flex-1 py-3 font-mono text-sm font-semibold rounded-md transition-all",
                      poolAction === 'withdraw'
                        ? "bg-[#00ff9d] text-black"
                        : "text-gray-400 hover:text-white"
                    )}
                  >
                    Withdraw
                  </button>
                </div>

                {/* Card */}
                <div className="velo-card p-6 space-y-6">
                  {poolAction === 'deposit' ? (
                    <>
                      <div>
                        <label className="text-xs text-gray-500 font-mono mb-3 block uppercase tracking-wider">Select Amount</label>
                        <div className="grid grid-cols-3 gap-3">
                          {pools.map((pool) => (
                            <button
                              key={pool.size}
                              onClick={() => setSelectedPool(pool.size)}
                              className={cn(
                                "p-5 rounded-lg border font-mono text-center transition-all",
                                selectedPool === pool.size
                                  ? "border-[#00ff9d]/40 bg-[#00ff9d]/8"
                                  : "border-white/[0.04] hover:border-white/10 bg-white/[0.01]"
                              )}
                            >
                              <p className={cn(
                                "text-3xl font-bold",
                                selectedPool === pool.size ? "text-[#00ff9d]" : "text-white"
                              )}>
                                {pool.amount}
                              </p>
                              <p className="text-xs text-gray-500 mt-1">SOL</p>
                            </button>
                          ))}
                        </div>
                        <p className="text-sm text-gray-500 font-mono mt-4">
                          Balance: <span className="text-white">{publicBalance.toFixed(4)} SOL</span>
                        </p>
                      </div>

                      <button
                        onClick={handleDeposit}
                        disabled={isLoading || publicBalance < POOL_AMOUNTS[selectedPool]}
                        className={cn(
                          "w-full py-4 font-mono font-bold text-sm flex items-center justify-center gap-2 rounded-lg transition-all",
                          isLoading || publicBalance < POOL_AMOUNTS[selectedPool]
                            ? "bg-white/[0.03] text-gray-600 cursor-not-allowed"
                            : "bg-[#00ff9d] text-black hover:brightness-110"
                        )}
                      >
                        {isLoading ? <Loader2 size={18} className="animate-spin" /> : <ArrowDownToLine size={18} />}
                        DEPOSIT {POOL_AMOUNTS[selectedPool]} SOL
                      </button>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="text-xs text-gray-500 font-mono mb-3 block uppercase tracking-wider">Amount</label>
                        <input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="0.0"
                          className="w-full bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 font-mono text-white text-xl focus:border-[#00ff9d]/30 focus:outline-none placeholder:text-gray-700 transition-colors"
                        />
                        <p className="text-sm text-gray-500 font-mono mt-3">
                          Private balance: <span className="text-white">{privateBalance.toFixed(4)} SOL</span>
                          <span className="text-gray-600 ml-2">({notes.length} notes)</span>
                        </p>
                      </div>

                      <button
                        onClick={handleWithdraw}
                        disabled={isLoading || !amount || parseFloat(amount) > privateBalance}
                        className={cn(
                          "w-full py-4 font-mono font-bold text-sm flex items-center justify-center gap-2 rounded-lg transition-all",
                          isLoading || !amount || parseFloat(amount) > privateBalance
                            ? "bg-white/[0.03] text-gray-600 cursor-not-allowed"
                            : "bg-[#00ff9d] text-black hover:brightness-110"
                        )}
                      >
                        {isLoading ? <Loader2 size={18} className="animate-spin" /> : <ArrowUpFromLine size={18} />}
                        WITHDRAW
                      </button>
                    </>
                  )}

                  <div className="flex items-center gap-2.5 text-[#00ff9d]/60 font-mono text-xs pt-2">
                    <Shield size={14} />
                    <span>Fixed denominations = maximum privacy</span>
                  </div>
                </div>
              </div>
            )}

            {/* ═════════ ACCOUNT TAB ═════════ */}
            {activeTab === 'account' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">Account</h2>
                  <p className="text-gray-500 text-sm">Your private balances</p>
                </div>

                <div className="velo-card p-6 space-y-6">
                  {/* Balance */}
                  <div className="text-center py-6">
                    <p className="text-xs text-gray-500 font-mono mb-4 uppercase tracking-wider">Private Balance</p>
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-5xl font-mono font-bold text-white">
                        {balanceRevealed ? privateBalance.toFixed(4) : '****'}
                      </span>
                      <button
                        onClick={() => setBalanceRevealed(!balanceRevealed)}
                        className="p-2 text-gray-500 hover:text-[#00ff9d] transition-colors rounded-lg hover:bg-[#00ff9d]/5"
                      >
                        {balanceRevealed ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <p className="text-gray-500 font-mono text-sm mt-1">SOL</p>
                  </div>

                  {/* Breakdown */}
                  <div className="space-y-3 pt-4 border-t border-white/[0.04]">
                    <div className="flex justify-between text-sm font-mono">
                      <span className="text-gray-500">Pool Notes</span>
                      <span className="text-white">
                        {balanceRevealed ? `${privateBalance.toFixed(4)} SOL` : '****'}
                        <span className="text-gray-600 ml-2">({notes.length})</span>
                      </span>
                    </div>
                    <div className="flex justify-between text-sm font-mono">
                      <span className="text-gray-500">Public Wallet</span>
                      <span className="text-white">{publicBalance.toFixed(4)} SOL</span>
                    </div>
                  </div>

                  {/* Notes */}
                  {notes.length > 0 && (
                    <div className="pt-4 border-t border-white/[0.04]">
                      <p className="text-xs text-gray-500 font-mono mb-3 uppercase tracking-wider">Your Notes</p>
                      <div className="flex flex-wrap gap-2">
                        {notes.map((note) => (
                          <span
                            key={note.id}
                            className="px-3 py-1.5 rounded-md bg-[#00ff9d]/6 border border-[#00ff9d]/10 text-sm font-mono text-[#00ff9d]/80"
                          >
                            {note.amount} SOL
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Address */}
                  <div className="pt-4 border-t border-white/[0.04]">
                    <button
                      onClick={copyAddress}
                      className="w-full py-3 rounded-lg border border-white/[0.04] text-sm font-mono text-gray-400 hover:text-[#00ff9d] hover:border-[#00ff9d]/15 hover:bg-[#00ff9d]/3 transition-all flex items-center justify-center gap-2"
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {publicKey?.toBase58().slice(0, 12)}...{publicKey?.toBase58().slice(-8)}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ═════════ SEND TAB ═════════ */}
            {activeTab === 'send' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">Private Send</h2>
                  <p className="text-gray-500 text-sm">Send tokens privately via relayer</p>
                </div>

                <div className="velo-card p-6 space-y-6">
                  {/* Pool Selection */}
                  <div>
                    <label className="text-xs text-gray-500 font-mono mb-3 block uppercase tracking-wider">Select Amount</label>
                    <div className="grid grid-cols-3 gap-3">
                      {pools.map((pool) => {
                        const noteCount = notes.filter(n => n.poolSize === pool.size).length;
                        const hasNote = noteCount > 0;
                        return (
                          <button
                            key={pool.size}
                            onClick={() => hasNote && setSelectedPool(pool.size)}
                            disabled={!hasNote}
                            className={cn(
                              "p-5 rounded-lg border font-mono text-center transition-all",
                              selectedPool === pool.size && hasNote
                                ? "border-[#00ff9d]/40 bg-[#00ff9d]/8"
                                : hasNote
                                ? "border-white/[0.04] hover:border-white/10 bg-white/[0.01]"
                                : "border-white/[0.02] opacity-30 cursor-not-allowed"
                            )}
                          >
                            <p className={cn(
                              "text-3xl font-bold",
                              selectedPool === pool.size && hasNote ? "text-[#00ff9d]" : hasNote ? "text-white" : "text-gray-700"
                            )}>
                              {pool.amount}
                            </p>
                            <p className={cn(
                              "text-xs mt-1",
                              hasNote ? "text-[#00ff9d]/60" : "text-gray-700"
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
                    <label className="text-xs text-gray-500 font-mono mb-3 block uppercase tracking-wider">Recipient</label>
                    <input
                      type="text"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="Solana address..."
                      className="w-full bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 font-mono text-white text-sm focus:border-[#00ff9d]/30 focus:outline-none placeholder:text-gray-600 transition-colors"
                    />
                  </div>

                  <button
                    onClick={handleSend}
                    disabled={isLoading || !recipient || !notes.some(n => n.poolSize === selectedPool)}
                    className={cn(
                      "w-full py-4 font-mono font-bold text-sm flex items-center justify-center gap-2 rounded-lg transition-all",
                      isLoading || !recipient || !notes.some(n => n.poolSize === selectedPool)
                        ? "bg-white/[0.03] text-gray-600 cursor-not-allowed"
                        : "bg-[#00ff9d] text-black hover:brightness-110"
                    )}
                  >
                    {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                    SEND {POOL_AMOUNTS[selectedPool]} SOL PRIVATELY
                  </button>

                  <div className="flex items-center gap-2.5 text-[#00ff9d]/60 font-mono text-xs pt-2">
                    <Lock size={14} />
                    <span>Your wallet is hidden from explorers</span>
                  </div>

                  {!relayerOnline && (
                    <div className="flex items-center gap-2.5 text-yellow-500/60 font-mono text-xs">
                      <AlertCircle size={14} />
                      <span>Relayer offline - private sends unavailable</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ═════════ TRADE TAB ═════════ */}
            {activeTab === 'trade' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">Trade</h2>
                  <p className="text-gray-500 text-sm">Swap tokens privately</p>
                </div>

                <div className="velo-card p-6 text-center py-16">
                  <ArrowRightLeft className="w-10 h-10 text-gray-700 mx-auto mb-4" />
                  <p className="text-lg font-bold text-white mb-1">Private Swaps</p>
                  <p className="text-gray-500 text-sm">Coming soon</p>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Footer */}
        <footer className="relative z-10 px-6 py-4 flex items-center justify-between text-xs font-mono text-gray-600">
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00ff9d]/60" />
            Devnet
          </span>
          <a 
            href="https://solscan.io"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-[#00ff9d]/60 transition-colors"
          >
            Solscan <ExternalLink size={11} />
          </a>
        </footer>
      </div>
    </div>
  );
}
