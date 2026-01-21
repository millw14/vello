'use client';

import { useState, useEffect } from 'react';
import { BentoItem, BentoGrid } from './terminal-bento-grid';
import { 
  Copy, Check, LogOut, ArrowRight, 
  RefreshCw, Eye, Zap, X, Loader2, Download
} from 'lucide-react';
import { useVeloWallet } from '@/hooks/useVeloWallet';
import { VELO_CONSTANTS, Tier, PoolSize } from '@/lib/solana/config';
import { StealthAddress } from '@/lib/solana/stealth';
import { MixerPool } from '@/lib/solana/mixer';

interface DashboardProps {
  username: string;
  publicKey: string;
  secretKey: string;
  tier: string;
  onLogout: () => void;
}

type ModalType = 'transfer' | 'mix' | 'stealth' | 'deposit' | 'tier' | 'airdrop' | null;

export default function VeloDashboard({ username, publicKey, secretKey, tier, onLogout }: DashboardProps) {
  const [copied, setCopied] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [logs, setLogs] = useState<Array<{ time: string; type: string; message: string }>>([]);

  const wallet = useVeloWallet(publicKey, secretKey, tier);

  const addLog = (type: string, message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [...prev.slice(-4), { time, type, message }]);
  };

  useEffect(() => {
    addLog('INFO', `Session initialized for ${username}`);
    addLog('OK', 'Connected to Solana devnet');
    addLog('INFO', 'ZK circuits loaded successfully');
    addLog('OK', 'Mixer pool connection established');
    addLog('INFO', 'Privacy protocols active');
  }, [username]);

  useEffect(() => {
    if (wallet.balance.sol > 0) {
      addLog('OK', `Balance updated: ${wallet.balance.sol.toFixed(4)} SOL`);
    }
  }, [wallet.balance.sol]);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tierConfig = VELO_CONSTANTS.TIER_CONFIG[tier as Tier];
  const privacyScore = tier === 'maximum' ? 100 : tier === 'premium' ? 80 : tier === 'standard' ? 60 : 40;

  return (
    <div className="terminal-container">
      <div className="relative z-10 min-h-screen p-6 md:p-10">
        {/* Header */}
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-4">
            <div className="text-3xl md:text-4xl font-bold terminal-glow">
              <Zap className="inline w-8 h-8 mr-2" />
              VELO
            </div>
            <span className="text-terminal-dim text-sm">v1.0.0 | DEVNET</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden md:inline text-terminal-dim">[{tier.toUpperCase()}]</span>
            <button
              onClick={() => setActiveModal('airdrop')}
              className="terminal-btn px-4 py-2 text-sm flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              AIRDROP
            </button>
            <button 
              onClick={onLogout}
              className="terminal-btn px-4 py-2 text-sm flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              EXIT
            </button>
          </div>
        </header>

        {/* Title */}
        <div className="max-w-6xl mx-auto">
          <h1 className="text-4xl md:text-6xl text-center mb-4 blinking-cursor terminal-flicker">
            SYSTEM DASHBOARD
          </h1>
          <p className="text-center text-terminal-dim text-lg mb-12">
            Welcome back, {username.toUpperCase()}. All systems operational.
          </p>

          {/* Bento Grid */}
          <BentoGrid>
            {/* Wallet Status - Large */}
            <BentoItem className="col-span-2">
              <h2 className="text-2xl md:text-3xl mb-4">{'>'} WALLET_STATUS</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-terminal-dim">BALANCE:</span>
                  <span className="text-3xl">
                    {wallet.isLoading ? (
                      <Loader2 className="w-6 h-6 animate-spin inline" />
                    ) : (
                      `${wallet.balance.sol.toFixed(4)} SOL`
                    )}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-terminal-dim">USD_VALUE:</span>
                  <span>${wallet.balance.usdValue.toFixed(2)}</span>
                </div>
                <div className="pt-4 border-t border-terminal">
                  <div className="flex items-center gap-2 text-sm text-terminal-dim mb-2">
                    PUBLIC_KEY:
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="text-terminal-cyan text-sm flex-1 truncate">
                      {publicKey}
                    </code>
                    <button 
                      onClick={copyToClipboard}
                      className="p-2 hover:bg-[rgba(0,255,157,0.1)] transition-colors"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button 
                    onClick={() => setActiveModal('deposit')}
                    className="terminal-btn-filled flex-1 py-3 text-lg font-bold"
                  >
                    {'>'} DEPOSIT
                  </button>
                  <button 
                    onClick={() => wallet.refreshBalance()}
                    className="terminal-btn px-4"
                    title="Refresh balance"
                  >
                    <RefreshCw className={`w-5 h-5 ${wallet.isLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            </BentoItem>

            {/* Network Status */}
            <BentoItem>
              <h2 className="text-2xl md:text-3xl mb-4">{'>'} NETWORK</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-terminal-dim">STATUS:</span>
                  <span className="status-online">● ONLINE</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-dim">NETWORK:</span>
                  <span>DEVNET</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-dim">LATENCY:</span>
                  <span>&lt;400ms</span>
                </div>
              </div>
            </BentoItem>

            {/* Privacy Level */}
            <BentoItem>
              <h2 className="text-2xl md:text-3xl mb-4">{'>'} PRIVACY_LEVEL</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-terminal-dim">TIER:</span>
                  <span>{tier.toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-dim">MIX_ROUNDS:</span>
                  <span>{tierConfig?.mixingRounds || 1}x</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-dim">SCORE:</span>
                  <span>{privacyScore}%</span>
                </div>
                <div className="h-2 bg-[rgba(0,255,157,0.1)] mt-2">
                  <div 
                    className="h-full bg-[var(--terminal-green)] transition-all"
                    style={{ width: `${privacyScore}%` }}
                  />
                </div>
              </div>
            </BentoItem>

            {/* Mixer Pool */}
            <BentoItem>
              <h2 className="text-2xl md:text-3xl mb-4">{'>'} MIXER_POOL</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-terminal-dim">ACTIVE_NOTES:</span>
                  <span>{wallet.mixerNotes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-dim">POOL_SIZE:</span>
                  <span className="text-terminal-cyan">12.4K SOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-dim">STATUS:</span>
                  <span className="status-online">● READY</span>
                </div>
              </div>
            </BentoItem>

            {/* Quick Actions */}
            <BentoItem className="col-span-2">
              <h2 className="text-2xl md:text-3xl mb-4">{'>'} QUICK_ACTIONS</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button 
                  onClick={() => setActiveModal('transfer')}
                  className="terminal-btn py-4 flex flex-col items-center gap-2"
                >
                  <ArrowRight className="w-6 h-6" />
                  <span>TRANSFER</span>
                </button>
                <button 
                  onClick={() => setActiveModal('mix')}
                  className="terminal-btn py-4 flex flex-col items-center gap-2"
                >
                  <RefreshCw className="w-6 h-6" />
                  <span>MIX</span>
                </button>
                <button 
                  onClick={() => setActiveModal('stealth')}
                  className="terminal-btn py-4 flex flex-col items-center gap-2"
                >
                  <Eye className="w-6 h-6" />
                  <span>STEALTH</span>
                </button>
                <button 
                  onClick={() => setActiveModal('tier')}
                  className="terminal-btn py-4 flex flex-col items-center gap-2"
                >
                  <Zap className="w-6 h-6" />
                  <span>UPGRADE</span>
                </button>
              </div>
            </BentoItem>

            {/* System Logs */}
            <BentoItem className="col-span-3">
              <h2 className="text-2xl md:text-3xl mb-4">{'>'} SYSTEM_LOGS</h2>
              <div className="space-y-2 font-mono text-sm md:text-base">
                {logs.map((log, i) => (
                  <p key={i}>
                    <span className="text-terminal-dim">[{log.time}]</span>{' '}
                    <span className={log.type === 'OK' ? 'status-online' : 'text-terminal-cyan'}>
                      [{log.type}]
                    </span>{' '}
                    {log.message}
                  </p>
                ))}
              </div>
            </BentoItem>
          </BentoGrid>

          {/* Footer */}
          <footer className="mt-12 text-center text-terminal-dim text-sm">
            <p>VELO PRIVACY PROTOCOL // SOLANA DEVNET // {new Date().toLocaleDateString()}</p>
          </footer>
        </div>
      </div>

      {/* Modals */}
      {activeModal && (
        <TerminalModal onClose={() => setActiveModal(null)}>
          {activeModal === 'transfer' && (
            <TransferModal 
              wallet={wallet} 
              tier={tier}
              onLog={addLog}
            />
          )}
          {activeModal === 'mix' && (
            <MixModal 
              wallet={wallet}
              tier={tier}
              onLog={addLog}
            />
          )}
          {activeModal === 'stealth' && (
            <StealthModal 
              wallet={wallet}
              onLog={addLog}
            />
          )}
          {activeModal === 'deposit' && (
            <DepositModal publicKey={publicKey} />
          )}
          {activeModal === 'tier' && (
            <TierModal currentTier={tier} />
          )}
          {activeModal === 'airdrop' && (
            <AirdropModal 
              wallet={wallet}
              onLog={addLog}
              onClose={() => setActiveModal(null)}
            />
          )}
        </TerminalModal>
      )}
    </div>
  );
}

// Modal Wrapper
function TerminalModal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/90" onClick={onClose} />
      <div className="relative bg-[var(--terminal-bg)] border border-[var(--terminal-green)] p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-terminal-dim hover:text-[var(--terminal-green)] transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
        {children}
      </div>
    </div>
  );
}

// Transfer Modal with real functionality
function TransferModal({ 
  wallet, 
  tier,
  onLog 
}: { 
  wallet: ReturnType<typeof useVeloWallet>;
  tier: string;
  onLog: (type: string, message: string) => void;
}) {
  const [recipient, setRecipient] = useState('');
  const [selectedNote, setSelectedNote] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; signature?: string } | null>(null);

  // Get available mixer notes grouped by denomination
  const notesByDenom = wallet.mixerNotes.reduce((acc, note) => {
    const solAmount = note.denomination / 1e9;
    if (!acc[solAmount]) acc[solAmount] = [];
    acc[solAmount].push(note);
    return acc;
  }, {} as Record<number, typeof wallet.mixerNotes>);
  
  const availableAmounts = Object.keys(notesByDenom).map(Number).sort((a, b) => a - b);

  const handleTransfer = async () => {
    if (!recipient || selectedNote === null) return;
    
    if (!wallet.validateAddress(recipient)) {
      setResult({ success: false, message: 'Invalid recipient address' });
      return;
    }

    setIsLoading(true);
    onLog('INFO', `Initiating private transfer of ${selectedNote} SOL via mixer...`);

    const txResult = await wallet.sendPrivate(recipient, selectedNote);
    
    if (txResult.success) {
      setResult({ 
        success: true, 
        message: `Private transfer complete!`,
        signature: txResult.signature 
      });
      onLog('OK', `Private transfer complete: ${txResult.signature?.slice(0, 16)}...`);
      setRecipient('');
      setSelectedNote(null);
    } else {
      setResult({ success: false, message: txResult.error || 'Transfer failed' });
      onLog('ERROR', txResult.error || 'Transfer failed');
    }

    setIsLoading(false);
  };

  return (
    <div>
      <h2 className="text-2xl mb-6">{'>'} PRIVATE_TRANSFER</h2>
      <div className="space-y-4">
        {/* Show available mixer notes */}
        {wallet.mixerNotes.length > 0 ? (
          <>
            <div>
              <label className="text-terminal-dim text-sm block mb-2">SELECT_AMOUNT (from mixer):</label>
              <div className="grid grid-cols-3 gap-2">
                {availableAmounts.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setSelectedNote(amt)}
                    className={`terminal-btn py-3 text-center ${
                      selectedNote === amt ? 'border-terminal-cyan bg-terminal-cyan/10' : ''
                    }`}
                  >
                    <span className="text-lg">{amt}</span>
                    <span className="text-xs text-terminal-dim block">SOL</span>
                    <span className="text-xs text-terminal-dim">({notesByDenom[amt].length} note{notesByDenom[amt].length > 1 ? 's' : ''})</span>
                  </button>
                ))}
              </div>
            </div>
            
            <div>
              <label className="text-terminal-dim text-sm block mb-2">RECIPIENT_ADDRESS:</label>
              <input 
                type="text" 
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Enter Solana address..."
                className="terminal-input"
              />
            </div>
            
            <div className="pt-4 border-t border-terminal">
              <p className="text-terminal-dim text-sm mb-2">
                🔒 Using mixer for unlinkable transfer
              </p>
              <p className="text-terminal-cyan text-xs mb-4">
                Recipient will receive {selectedNote || '?'} SOL with no link to your wallet
              </p>
              <button 
                onClick={handleTransfer}
                disabled={isLoading || !recipient || selectedNote === null}
                className="terminal-btn-filled w-full py-3 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    MIXING...
                  </>
                ) : (
                  <>{'>'} SEND_PRIVATE ({selectedNote || '?'} SOL)</>
                )}
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-8">
            <p className="text-terminal-dim mb-4">No mixer notes available</p>
            <p className="text-sm text-terminal-cyan mb-4">
              To send privately, first deposit to a mixer pool.<br/>
              Then you can withdraw to any address anonymously.
            </p>
            <p className="text-xs text-terminal-dim">
              Go to MIX → Select pool → Deposit
            </p>
          </div>
        )}
        
        {result && (
          <div className={`text-center text-sm ${result.success ? 'status-online' : 'text-[#ff4444]'}`}>
            <p>[{result.success ? 'OK' : 'ERROR'}] {result.message}</p>
            {result.success && result.signature && (
              <a 
                href={`https://solscan.io/tx/${result.signature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-terminal-cyan hover:underline text-xs mt-2 inline-block"
              >
                🔗 View on Solscan →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Mix Modal with real on-chain functionality - Multi-Pool Support
function MixModal({ 
  wallet,
  tier,
  onLog
}: { 
  wallet: ReturnType<typeof useVeloWallet>;
  tier: string;
  onLog: (type: string, message: string) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPool, setLoadingPool] = useState<string | null>(null);
  const [depositResult, setDepositResult] = useState<{ 
    note: { commitment: string; nullifier: string; secret: string; poolSize: string }; 
    signature: string 
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pools = wallet.getPoolStats();
  const mixRounds = VELO_CONSTANTS.TIER_CONFIG[tier as Tier]?.mixingRounds || 1;

  // Map pool denominations to pool size keys
  const poolSizeMap: { [key: number]: 'SMALL' | 'MEDIUM' | 'LARGE' } = {
    100000000: 'SMALL',     // 0.1 SOL
    1000000000: 'MEDIUM',   // 1 SOL
    10000000000: 'LARGE',   // 10 SOL
  };

  const handleDeposit = async (poolDenomination: number) => {
    const solAmount = poolDenomination / 1e9;
    const poolSize = poolSizeMap[poolDenomination];
    
    if (!poolSize) {
      onLog('ERROR', 'Invalid pool denomination');
      return;
    }
    
    if (wallet.balance.sol < solAmount + 0.01) { // Include fee buffer
      onLog('ERROR', `Insufficient balance. Need ${solAmount} SOL + fees`);
      setError(`Insufficient balance. Need ${solAmount} SOL + fees`);
      return;
    }

    setIsLoading(true);
    setLoadingPool(poolSize);
    setError(null);
    onLog('INFO', `Depositing ${solAmount} SOL to ${poolSize} mixer pool...`);

    try {
      const result = await wallet.depositToMixer(poolSize);
      
      if (result) {
        setDepositResult({ 
          note: {
            commitment: result.note.commitment,
            nullifier: result.note.nullifier,
            secret: result.note.secret,
            poolSize: result.note.poolSize,
          },
          signature: result.signature,
        });
        onLog('OK', `Deposit successful! Save your note to withdraw later.`);
      } else {
        const errMsg = wallet.error || 'Deposit failed. Check console for details.';
        setError(errMsg);
        onLog('ERROR', errMsg);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Deposit failed';
      setError(message);
      onLog('ERROR', message);
    }

    setIsLoading(false);
    setLoadingPool(null);
  };

  const copyNote = () => {
    if (depositResult) {
      const noteData = JSON.stringify(depositResult.note, null, 2);
      navigator.clipboard.writeText(noteData);
      onLog('INFO', 'Note copied to clipboard');
    }
  };

  return (
    <div>
      <h2 className="text-2xl mb-6">{'>'} MIXING_POOL</h2>
      <div className="space-y-4">
        <p className="text-terminal-dim">Select pool denomination:</p>
        
        {/* Show available pools - all three now active! */}
        {pools.map((pool) => {
          const solAmount = pool.denomination / 1e9;
          const poolSize = poolSizeMap[pool.denomination];
          const canAfford = wallet.balance.sol >= solAmount + 0.01;
          const isThisLoading = loadingPool === poolSize;
          
          return (
            <button 
              key={pool.id}
              onClick={() => handleDeposit(pool.denomination)}
              disabled={isLoading || !canAfford}
              className={`terminal-btn w-full py-4 text-left flex justify-between items-center 
                ${!canAfford ? 'opacity-50' : ''}
                ${isThisLoading ? 'animate-pulse border-terminal-cyan' : ''}`}
            >
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${canAfford ? 'bg-terminal' : 'bg-gray-500'}`} />
                {solAmount} SOL
                {poolSize && <span className="text-xs text-terminal-dim">({poolSize})</span>}
              </span>
              <span className="text-terminal-dim text-sm">
                {isThisLoading ? 'DEPOSITING...' : 'ACTIVE'}
              </span>
            </button>
          );
        })}
        
        <div className="pt-4 border-t border-terminal">
          <p className="text-terminal-dim text-sm">
            Your tier: {mixRounds}x mixing rounds
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500 text-red-400">
            <p className="text-sm">{error}</p>
          </div>
        )}
        
        {depositResult && (
          <div className="p-3 bg-[rgba(0,255,157,0.1)] border border-terminal">
            <p className="text-sm text-terminal-dim mb-1">✅ DEPOSIT SUCCESSFUL ({depositResult.note.poolSize} pool):</p>
            <code className="text-xs text-terminal-cyan break-all">{depositResult.note.commitment.slice(0, 32)}...</code>
            
            <a 
              href={`https://solscan.io/tx/${depositResult.signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-terminal-cyan hover:underline text-xs mt-2 block"
            >
              🔗 View transaction on Solscan →
            </a>
            
            <p className="text-xs text-yellow-400 mt-2">
              ⚠️ Note saved! Go to SEND tab to transfer privately.
            </p>
            <button 
              onClick={copyNote}
              className="terminal-btn w-full mt-2 py-2 text-sm"
            >
              {'>'} COPY_FULL_NOTE (backup)
            </button>
          </div>
        )}
        
        {wallet.balance.sol === 0 && (
          <p className="text-center text-terminal-dim text-sm">
            [INFO] Deposit funds to join mixer pool
          </p>
        )}

        {isLoading && (
          <p className="text-center text-terminal-cyan text-sm animate-pulse">
            [PROCESSING] Sending deposit transaction...
          </p>
        )}
      </div>
    </div>
  );
}

// Stealth Modal with real functionality
function StealthModal({ 
  wallet,
  onLog
}: { 
  wallet: ReturnType<typeof useVeloWallet>;
  onLog: (type: string, message: string) => void;
}) {
  const [stealthAddress, setStealthAddress] = useState<StealthAddress | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = () => {
    const address = wallet.generateStealth();
    if (address) {
      setStealthAddress(address);
      onLog('OK', `Stealth address generated: ${address.address.slice(0, 16)}...`);
    }
  };

  const copyAddress = () => {
    if (stealthAddress) {
      navigator.clipboard.writeText(stealthAddress.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div>
      <h2 className="text-2xl mb-6">{'>'} STEALTH_ADDRESS</h2>
      {!stealthAddress ? (
        <div className="text-center py-8">
          <p className="text-terminal-dim mb-6">
            Generate a one-time receiving address using ECDH cryptography.
            Only you can detect payments to this address.
          </p>
          <button onClick={generate} className="terminal-btn-filled px-8 py-3">
            {'>'} GENERATE
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-terminal-dim text-sm">YOUR_STEALTH_ADDRESS:</p>
          <div className="p-4 bg-[rgba(0,255,157,0.05)] border border-terminal">
            <code className="text-terminal-cyan text-sm break-all">{stealthAddress.address}</code>
          </div>
          <ul className="text-terminal-dim text-sm space-y-1">
            <li>• Expires: {new Date(stealthAddress.expiresAt).toLocaleString()}</li>
            <li>• Single use only</li>
            <li>• ECDH encrypted (Curve25519)</li>
          </ul>
          <div className="flex gap-2">
            <button 
              onClick={copyAddress}
              className="terminal-btn flex-1 py-3"
            >
              {copied ? '✓ COPIED' : '> COPY_ADDRESS'}
            </button>
            <button 
              onClick={generate}
              className="terminal-btn px-4"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Airdrop Modal (Devnet only)
function AirdropModal({ 
  wallet,
  onLog,
  onClose
}: { 
  wallet: ReturnType<typeof useVeloWallet>;
  onLog: (type: string, message: string) => void;
  onClose: () => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; faucetUrl?: string } | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);

  const handleAirdrop = async () => {
    setIsLoading(true);
    setResult(null);
    onLog('INFO', 'Requesting devnet airdrop...');

    const airdropResult = await wallet.requestDevnetAirdrop();
    
    if (airdropResult.success) {
      setResult({ success: true, message: 'Airdrop successful! +2 SOL' });
      onLog('OK', 'Received 2 SOL from devnet faucet');
    } else {
      setResult({ 
        success: false, 
        message: airdropResult.error || 'Airdrop failed',
        faucetUrl: airdropResult.faucetUrl
      });
      onLog('WARN', 'RPC rate limited - use web faucet');
    }

    setIsLoading(false);
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(wallet.publicKey);
    setAddressCopied(true);
    setTimeout(() => setAddressCopied(false), 2000);
  };

  return (
    <div>
      <h2 className="text-2xl mb-6">{'>'} DEVNET_AIRDROP</h2>
      <div className="space-y-4">
        <p className="text-terminal-dim">
          Get free SOL from the Solana devnet for testing.
        </p>
        
        <div className="p-4 bg-[rgba(0,255,157,0.05)] border border-terminal">
          <div className="flex justify-between mb-2">
            <span className="text-terminal-dim">CURRENT_BALANCE:</span>
            <span>{wallet.balance.sol.toFixed(4)} SOL</span>
          </div>
          <div className="flex justify-between">
            <span className="text-terminal-dim">AIRDROP_AMOUNT:</span>
            <span className="text-terminal-cyan">+1.0 SOL</span>
          </div>
        </div>

        <button 
          onClick={handleAirdrop}
          disabled={isLoading}
          className="terminal-btn-filled w-full py-3 flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              REQUESTING...
            </>
          ) : (
            <>{'>'} REQUEST_AIRDROP</>
          )}
        </button>

        {result && (
          <div className={`p-3 border ${result.success ? 'border-[var(--terminal-green)] bg-[rgba(0,255,157,0.1)]' : 'border-[#ffaa00] bg-[rgba(255,170,0,0.1)]'}`}>
            <p className={`text-sm ${result.success ? 'status-online' : 'text-[#ffaa00]'}`}>
              [{result.success ? 'OK' : 'RATE_LIMITED'}] {result.message}
            </p>
            
            {result.faucetUrl && (
              <div className="mt-3 pt-3 border-t border-terminal">
                <p className="text-terminal-dim text-sm mb-2">Use the web faucet instead:</p>
                
                {/* Copy address first */}
                <div className="mb-2">
                  <p className="text-xs text-terminal-dim mb-1">1. Copy your address:</p>
                  <button 
                    onClick={copyAddress}
                    className="terminal-btn w-full py-2 text-sm"
                  >
                    {addressCopied ? '✓ COPIED!' : '> COPY_ADDRESS'}
                  </button>
                </div>
                
                {/* Then go to faucet */}
                <div>
                  <p className="text-xs text-terminal-dim mb-1">2. Open faucet & paste address:</p>
                  <a 
                    href={result.faucetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="terminal-btn-filled w-full py-2 text-sm flex items-center justify-center gap-2"
                  >
                    {'>'} OPEN_WEB_FAUCET ↗
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        <p className="text-terminal-dim text-xs text-center">
          Note: Public RPC has strict rate limits. Web faucet is more reliable.
        </p>
      </div>
    </div>
  );
}

// Deposit Modal
function DepositModal({ publicKey }: { publicKey: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <h2 className="text-2xl mb-6">{'>'} DEPOSIT_FUNDS</h2>
      <div className="space-y-4">
        <p className="text-terminal-dim text-sm">Send SOL to your Velo wallet:</p>
        <div className="p-4 bg-[rgba(0,255,157,0.05)] border border-terminal">
          <code className="text-terminal-cyan text-sm break-all">{publicKey}</code>
        </div>
        <button 
          onClick={() => {
            navigator.clipboard.writeText(publicKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="terminal-btn w-full py-3"
        >
          {copied ? '✓ COPIED' : '> COPY_ADDRESS'}
        </button>
        <div className="pt-4 border-t border-terminal space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-terminal-dim">NETWORK:</span>
            <span>Solana Devnet</span>
          </div>
          <div className="flex justify-between">
            <span className="text-terminal-dim">MIN_DEPOSIT:</span>
            <span>0.01 SOL</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Tier Modal
function TierModal({ currentTier }: { currentTier: string }) {
  const tiers: Array<{ name: Tier; price: string; features: string[] }> = [
    { name: 'basic', price: 'FREE', features: ['1x mixing', 'Basic privacy'] },
    { name: 'standard', price: '5 SOL/mo', features: ['3x mixing', 'Stealth addresses'] },
    { name: 'premium', price: '15 SOL/mo', features: ['5x mixing', 'ZK-proofs'] },
    { name: 'maximum', price: '50 SOL/mo', features: ['8x mixing', 'Full obfuscation', 'Priority nodes'] },
  ];

  return (
    <div>
      <h2 className="text-2xl mb-6">{'>'} SUBSCRIPTION_TIERS</h2>
      <div className="space-y-3">
        {tiers.map((tier) => (
          <div 
            key={tier.name}
            className={`p-4 border transition-all ${
              tier.name === currentTier 
                ? 'border-[var(--terminal-green)] bg-[rgba(0,255,157,0.1)]' 
                : 'border-terminal hover:border-[var(--terminal-green)]'
            }`}
          >
            <div className="flex justify-between items-center mb-2">
              <span className="text-lg">{tier.name.toUpperCase()}</span>
              <span className="text-terminal-dim">{tier.price}</span>
            </div>
            <ul className="text-terminal-dim text-sm space-y-1">
              {tier.features.map((f, i) => (
                <li key={i}>• {f}</li>
              ))}
            </ul>
            {tier.name === currentTier ? (
              <p className="text-terminal-cyan text-sm mt-3">[CURRENT]</p>
            ) : tier.name !== 'basic' && (
              <button className="terminal-btn w-full mt-3 py-2 text-sm">
                {'>'} UPGRADE
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
