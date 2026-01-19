'use client';

import React, { useState, useRef, useEffect, ReactNode } from 'react';
import { Shield, Zap, Lock, Eye, Coins, ArrowRightLeft, Users, Settings, LogOut, Copy, Check } from 'lucide-react';

interface TerminalProps {
  username: string;
  publicKey: string;
  tier: string;
  onLogout: () => void;
}

export default function VeloTerminal({ username, publicKey, tier, onLogout }: TerminalProps) {
  const [history, setHistory] = useState<Array<{ command: string; output: string | ReactNode }>>([
    { command: '/welcome', output: getWelcomeMessage(username, publicKey, tier) },
  ]);
  const [currentCommand, setCurrentCommand] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const commands: Record<string, () => string | ReactNode> = {
    'help': () => `
╔══════════════════════════════════════════════════════════════════╗
║                    VELO COMMAND REFERENCE                        ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  WALLET COMMANDS                                                 ║
║  ─────────────────                                               ║
║  balance      Display SOL and token balances                     ║
║  wallet       Show wallet address and details                    ║
║  deposit      Generate deposit instructions                      ║
║                                                                  ║
║  PRIVACY COMMANDS                                                ║
║  ─────────────────                                               ║
║  transfer     Initiate private transfer                          ║
║  mix          Enter mixing pool for anonymity                    ║
║  stealth      Generate stealth address                           ║
║                                                                  ║
║  ACCOUNT COMMANDS                                                ║
║  ─────────────────                                               ║
║  status       Show system and privacy status                     ║
║  tier         Display subscription tier info                     ║
║  upgrade      Upgrade subscription plan                          ║
║                                                                  ║
║  SYSTEM COMMANDS                                                 ║
║  ─────────────────                                               ║
║  clear        Clear terminal screen                              ║
║  logout       End session securely                               ║
║  help         Display this help message                          ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
`,
    'balance': () => `
┌─────────────────────────────────────────────────────────────────┐
│                        WALLET BALANCE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ◎ SOL Balance:           0.000000 SOL                         │
│  ◈ USDC Balance:          0.00 USDC                            │
│  ◆ Shielded Balance:      0.000000 SOL                         │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  STATUS: Wallet empty - deposit funds to begin                  │
│  Use 'deposit' command to add funds                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
`,
    'wallet': () => `
┌─────────────────────────────────────────────────────────────────┐
│                       WALLET DETAILS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Public Key:                                                    │
│  ${publicKey}                                                   │
│                                                                 │
│  Network:        Solana Mainnet                                 │
│  Status:         ● Active                                       │
│  Created:        ${new Date().toLocaleDateString()}                                       │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  [!] Never share your private key                               │
│  [!] Velo uses ZK-proofs for transaction privacy                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
`,
    'deposit': () => `
┌─────────────────────────────────────────────────────────────────┐
│                      DEPOSIT INSTRUCTIONS                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Send SOL to your Velo wallet address:                          │
│                                                                 │
│  ${publicKey}                                                   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  SUPPORTED ASSETS:                                              │
│  • SOL (Native)                                                 │
│  • USDC (SPL Token)                                             │
│  • USDT (SPL Token)                                             │
│                                                                 │
│  [i] Min deposit: 0.01 SOL                                      │
│  [i] Confirmations required: 32                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
`,
    'transfer': () => `
┌─────────────────────────────────────────────────────────────────┐
│                      PRIVATE TRANSFER                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  USAGE: transfer <recipient> <amount>                           │
│                                                                 │
│  PRIVACY LEVELS (based on your tier: ${tier.toUpperCase()}):                     │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  • Basic mixing: ${tier === 'basic' || tier === 'standard' || tier === 'premium' || tier === 'maximum' ? '✓ Enabled' : '✗ Upgrade required'}                                      │
│  • Stealth addresses: ${tier === 'standard' || tier === 'premium' || tier === 'maximum' ? '✓ Enabled' : '✗ Upgrade required'}                                  │
│  • ZK-proofs: ${tier === 'premium' || tier === 'maximum' ? '✓ Enabled' : '✗ Upgrade required'}                                          │
│  • Full obfuscation: ${tier === 'maximum' ? '✓ Enabled' : '✗ Upgrade required'}                                   │
│                                                                 │
│  [!] Insufficient balance for transfer                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
`,
    'mix': () => `
┌─────────────────────────────────────────────────────────────────┐
│                        MIXING POOL                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  AVAILABLE POOLS:                                               │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Pool A │ 0.1 SOL  │ 847 participants  │ 2 min avg             │
│  Pool B │ 1.0 SOL  │ 234 participants  │ 5 min avg             │
│  Pool C │ 10 SOL   │ 56 participants   │ 12 min avg            │
│                                                                 │
│  USAGE: mix <pool> <amount>                                     │
│                                                                 │
│  [i] Mixing provides anonymity through random note shuffling    │
│  [i] Uses nullifiers to prevent double-spend attacks            │
│                                                                 │
│  [!] Insufficient balance to join pool                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
`,
    'stealth': () => `
┌─────────────────────────────────────────────────────────────────┐
│                     STEALTH ADDRESS                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Generating one-time stealth address...                         │
│                                                                 │
│  STEALTH ADDRESS:                                               │
│  Velo${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}                     │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  HOW IT WORKS:                                                  │
│  • Uses ECDH key exchange for unlinkable addresses              │
│  • Each transaction uses a unique receiving address             │
│  • Only you can scan and detect incoming payments               │
│                                                                 │
│  [i] Share this address for receiving private payments          │
│  [i] Address expires after use or in 24 hours                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
`,
    'status': () => `
┌─────────────────────────────────────────────────────────────────┐
│                       SYSTEM STATUS                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  NETWORK                                                        │
│  ├─ Solana RPC:      ● Online (< 400ms latency)                │
│  ├─ Light Protocol:  ● Connected                                │
│  └─ Mixer Network:   ● 1,247 active nodes                       │
│                                                                 │
│  PRIVACY METRICS                                                │
│  ├─ Anonymity Set:   ${tier === 'maximum' ? '████████████████████ 100%' : tier === 'premium' ? '████████████████     80%' : tier === 'standard' ? '████████████         60%' : '████████             40%'}              │
│  ├─ ZK Proof Gen:    ~2.3s average                              │
│  └─ Mixing Rounds:   ${tier === 'maximum' ? '8' : tier === 'premium' ? '5' : tier === 'standard' ? '3' : '1'} rounds configured                            │
│                                                                 │
│  SESSION                                                        │
│  ├─ User:            ${username}                                 │
│  ├─ Tier:            ${tier.toUpperCase()}                                          │
│  └─ Connected:       ${new Date().toLocaleTimeString()}                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
`,
    'tier': () => `
┌─────────────────────────────────────────────────────────────────┐
│                    SUBSCRIPTION TIERS                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  YOUR TIER: ${tier.toUpperCase()} ${tier === 'basic' ? '←' : ''}                                              │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  BASIC        Free                                              │
│  ├─ Basic mixing (1 round)                                      │
│  └─ Standard transaction obfuscation                            │
│                                                                 │
│  STANDARD     5 SOL/month                                       │
│  ├─ Enhanced mixing (3 rounds)                                  │
│  ├─ Stealth addresses                                           │
│  └─ Priority transaction processing                             │
│                                                                 │
│  PREMIUM      15 SOL/month                                      │
│  ├─ Advanced mixing (5 rounds)                                  │
│  ├─ ZK-proof transactions                                       │
│  └─ Cross-chain privacy bridges                                 │
│                                                                 │
│  MAXIMUM      50 SOL/month                                      │
│  ├─ Maximum mixing (8 rounds)                                   │
│  ├─ Full transaction obfuscation                                │
│  ├─ Enterprise reliability                                      │
│  └─ Dedicated relayer nodes                                     │
│                                                                 │
│  Use 'upgrade <tier>' to change your plan                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
`,
    'upgrade': () => `
┌─────────────────────────────────────────────────────────────────┐
│                       UPGRADE PLAN                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  USAGE: upgrade <standard|premium|maximum>                      │
│                                                                 │
│  AVAILABLE UPGRADES:                                            │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  standard  │ 5 SOL/month  │ Stealth + 3x mixing                 │
│  premium   │ 15 SOL/month │ ZK-proofs + 5x mixing               │
│  maximum   │ 50 SOL/month │ Full obfuscation + 8x mixing        │
│                                                                 │
│  [!] Insufficient balance for upgrade                           │
│  [i] Deposit funds first using 'deposit' command                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
`,
    'clear': () => {
      setHistory([]);
      return '';
    },
    'logout': () => {
      onLogout();
      return 'Ending session securely...';
    },
  };

  const handleCommand = () => {
    const cmd = currentCommand.trim().toLowerCase();
    const commandFn = commands[cmd as keyof typeof commands];
    const output = commandFn ? commandFn() : `
┌─────────────────────────────────────────────────────────────────┐
│  Command not found: ${cmd.padEnd(44)}│
│  Type 'help' to see available commands                          │
└─────────────────────────────────────────────────────────────────┘
`;

    if (cmd !== 'clear' && cmd !== 'logout') {
      setHistory(prev => [...prev, { command: currentCommand, output }]);
    }
    
    setCurrentCommand('');
    setHistoryIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHistoryIndex(prev => {
        const newIndex = Math.min(prev + 1, history.length - 1);
        if (history.length > 0) {
          setCurrentCommand(history[history.length - 1 - newIndex]?.command || '');
        }
        return newIndex;
      });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHistoryIndex(prev => {
        const newIndex = Math.max(prev - 1, -1);
        setCurrentCommand(newIndex === -1 ? '' : history[history.length - 1 - newIndex]?.command || '');
        return newIndex;
      });
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  useEffect(() => {
    const handleClick = () => {
      inputRef.current?.focus();
    };
    
    if (terminalRef.current) {
      terminalRef.current.addEventListener('click', handleClick);
    }
    
    return () => {
      if (terminalRef.current) {
        terminalRef.current.removeEventListener('click', handleClick);
      }
    };
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#030712] p-4 font-mono">
      <div className="w-full max-w-5xl bg-[#0a0f1a] rounded-2xl overflow-hidden shadow-2xl border border-cyan-500/20">
        {/* Terminal Header */}
        <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-[#0d1117] to-[#0a0f1a] border-b border-cyan-500/10">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-400 transition-colors cursor-pointer" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80 hover:bg-yellow-400 transition-colors cursor-pointer" />
            <div className="w-3 h-3 rounded-full bg-emerald-500/80 hover:bg-emerald-400 transition-colors cursor-pointer" />
          </div>
          <div className="flex-1 flex items-center justify-center gap-2 text-xs text-zinc-400">
            <Shield className="w-4 h-4 text-cyan-400" />
            <span className="font-semibold bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              {username}@velo-terminal
            </span>
            <span className="text-zinc-600">|</span>
            <span>Privacy Dashboard v1.0</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-emerald-400 animate-pulse">●</span>
            <span className="text-zinc-500">ENCRYPTED</span>
          </div>
        </div>

        {/* Quick Actions Bar */}
        <div className="flex items-center gap-1 px-4 py-2 bg-[#0d1117]/50 border-b border-cyan-500/5 overflow-x-auto">
          {[
            { icon: Coins, label: 'Balance', cmd: 'balance' },
            { icon: ArrowRightLeft, label: 'Transfer', cmd: 'transfer' },
            { icon: Eye, label: 'Stealth', cmd: 'stealth' },
            { icon: Lock, label: 'Mix', cmd: 'mix' },
            { icon: Zap, label: 'Status', cmd: 'status' },
            { icon: Settings, label: 'Tier', cmd: 'tier' },
          ].map(({ icon: Icon, label, cmd }) => (
            <button
              key={cmd}
              onClick={() => {
                setHistory(prev => [...prev, { command: cmd, output: commands[cmd]() }]);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-cyan-400 hover:bg-cyan-500/10 transition-all"
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => copyToClipboard(publicKey)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied!' : 'Copy Address'}</span>
          </button>
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </div>

        {/* Terminal Output */}
        <div 
          ref={terminalRef} 
          className="h-[65vh] overflow-y-auto p-4 space-y-4 bg-[#030712] cursor-text"
        >
          {history.map((entry, i) => (
            <div key={i} className="space-y-2">
              <div className="flex gap-2">
                <span className="text-cyan-400 font-semibold">{username}@velo:~$</span>
                <span className="text-white">{entry.command}</span>
              </div>
              <div className="whitespace-pre-wrap text-emerald-400/90 pl-4 leading-relaxed text-sm">
                {entry.output}
              </div>
            </div>
          ))}

          {/* Current Command Input */}
          <div className="flex gap-2 items-center">
            <span className="text-cyan-400 font-semibold">{username}@velo:~$</span>
            <input
              ref={inputRef}
              type="text"
              value={currentCommand}
              onChange={e => setCurrentCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent outline-none text-white caret-cyan-400"
              autoFocus
              spellCheck="false"
            />
            <span className="text-cyan-400 animate-pulse">█</span>
          </div>

          <div ref={bottomRef} />
        </div>
        
        {/* Terminal Footer */}
        <div className="bg-gradient-to-r from-[#0d1117] to-[#0a0f1a] px-4 py-2.5 text-xs border-t border-cyan-500/10">
          <div className="flex justify-between items-center text-zinc-600">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-cyan-500/50" />
                Tier: <span className="text-cyan-400">{tier.toUpperCase()}</span>
              </span>
              <span>Type <span className="text-emerald-400">help</span> for commands</span>
            </div>
            <div className="flex items-center gap-4">
              <span>↑/↓ history</span>
              <span>Enter to execute</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getWelcomeMessage(username: string, publicKey: string, tier: string): string {
  return `
██╗   ██╗███████╗██╗      ██████╗ 
██║   ██║██╔════╝██║     ██╔═══██╗
██║   ██║█████╗  ██║     ██║   ██║
╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║
 ╚████╔╝ ███████╗███████╗╚██████╔╝
  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ 

╔══════════════════════════════════════════════════════════════════╗
║           PRIVATE SOLANA TRANSFERS & TRADING                     ║
║                                                                  ║
║  [SYSTEM INITIALIZED] - Encrypted Session Active                 ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Welcome, ${username.padEnd(54)}║
║                                                                  ║
║  Wallet:  ${publicKey.substring(0, 20)}...${publicKey.substring(publicKey.length - 10)}                    ║
║  Tier:    ${tier.toUpperCase().padEnd(54)}║
║  Status:  ● Connected to Solana Mainnet                          ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Your privacy is protected by:                                   ║
║  • Zero-Knowledge Proofs (ZK-SNARKs)                             ║
║  • Stealth Address Generation                                    ║
║  • Multi-Round Mixing Pools                                      ║
║  • Transaction Obfuscation                                       ║
║                                                                  ║
║  Type 'help' to see available commands                           ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
`;
}
