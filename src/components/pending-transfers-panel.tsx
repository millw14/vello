'use client';

import { useState, useEffect } from 'react';
import { Download, Clock, CheckCircle, XCircle, RefreshCw, Loader2 } from 'lucide-react';
import { PendingConfidentialTransfer, getPendingTransfersForWallet } from '@/lib/solana/confidential-token';

interface PendingTransfersPanelProps {
    walletAddress: string;
    onClaim: (transferId: string) => Promise<{ success: boolean; amount?: number; error?: string }>;
}

export function PendingTransfersPanel({ walletAddress, onClaim }: PendingTransfersPanelProps) {
    const [transfers, setTransfers] = useState<PendingConfidentialTransfer[]>([]);
    const [loading, setLoading] = useState(false);
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

    // Load pending transfers on mount and when wallet changes
    useEffect(() => {
        loadPendingTransfers();
    }, [walletAddress]);

    const loadPendingTransfers = () => {
        setLoading(true);
        try {
            const pending = getPendingTransfersForWallet(walletAddress);
            setTransfers(pending);
        } catch (error) {
            console.error('Failed to load pending transfers:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleClaim = async (transferId: string) => {
        setClaimingId(transferId);
        setMessage({ text: 'Claiming transfer...', type: 'info' });

        try {
            const result = await onClaim(transferId);

            if (result.success) {
                setMessage({
                    text: `Successfully claimed ${result.amount?.toFixed(4) || ''} SOL!`,
                    type: 'success'
                });
                // Remove claimed transfer from list
                setTransfers(prev => prev.filter(t => t.id !== transferId));
            } else {
                setMessage({ text: result.error || 'Claim failed', type: 'error' });
            }
        } catch (error: any) {
            setMessage({ text: error.message || 'Claim failed', type: 'error' });
        } finally {
            setClaimingId(null);
        }
    };

    const formatTimeAgo = (timestamp: number) => {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return 'Just now';
    };

    const formatAmount = (lamports: number) => {
        return (lamports / 1_000_000_000).toFixed(4);
    };

    return (
        <div className="bg-gradient-to-br from-green-900/30 to-emerald-900/30 rounded-2xl p-6 border border-green-500/20">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                        <Download className="w-5 h-5 text-green-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white">Pending Transfers</h3>
                        <p className="text-xs text-gray-400">Claim confidential transfers sent to you</p>
                    </div>
                </div>
                <button
                    onClick={loadPendingTransfers}
                    disabled={loading}
                    className="p-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400 transition-colors disabled:opacity-50"
                    title="Refresh"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Message display */}
            {message && (
                <div className={`mb-4 p-3 rounded-lg text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                        message.type === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                            'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    }`}>
                    {message.type === 'success' && <CheckCircle className="w-4 h-4" />}
                    {message.type === 'error' && <XCircle className="w-4 h-4" />}
                    {message.type === 'info' && <Loader2 className="w-4 h-4 animate-spin" />}
                    {message.text}
                </div>
            )}

            {loading && transfers.length === 0 ? (
                <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-green-400" />
                    <p className="text-gray-400 text-sm">Loading pending transfers...</p>
                </div>
            ) : transfers.length === 0 ? (
                <div className="text-center py-8">
                    <div className="w-16 h-16 mx-auto rounded-full bg-green-500/10 flex items-center justify-center mb-4">
                        <CheckCircle className="w-8 h-8 text-green-400/50" />
                    </div>
                    <h4 className="text-white font-medium mb-2">No Pending Transfers</h4>
                    <p className="text-gray-400 text-sm">
                        When someone sends you a confidential transfer, it will appear here for you to claim.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {transfers.map((transfer) => (
                        <div
                            key={transfer.id}
                            className="bg-black/30 rounded-xl p-4 border border-green-500/10 hover:border-green-500/30 transition-colors"
                        >
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                                        <Download className="w-4 h-4 text-green-400" />
                                    </div>
                                    <div>
                                        <p className="text-white text-sm font-medium">Confidential Transfer</p>
                                        <p className="text-xs text-gray-500">
                                            From: {transfer.senderAddress.slice(0, 8)}...{transfer.senderAddress.slice(-4)}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="flex items-center gap-1 text-xs text-gray-400">
                                        <Clock className="w-3 h-3" />
                                        {formatTimeAgo(transfer.timestamp)}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-purple-400 bg-purple-500/20 px-2 py-0.5 rounded">
                                        ENCRYPTED
                                    </span>
                                    <span className="text-gray-400 text-sm">
                                        ~{formatAmount(transfer.amountLamports)} SOL
                                    </span>
                                </div>
                                <button
                                    onClick={() => handleClaim(transfer.id)}
                                    disabled={claimingId === transfer.id}
                                    className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                                >
                                    {claimingId === transfer.id ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Claiming...
                                        </>
                                    ) : (
                                        <>
                                            <Download className="w-4 h-4" />
                                            Claim
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Help text */}
            <div className="mt-6 p-4 bg-green-500/10 rounded-xl border border-green-500/20">
                <h4 className="text-green-400 font-medium text-sm mb-2">How Claiming Works</h4>
                <ul className="text-xs text-gray-400 space-y-1">
                    <li>• Senders can send confidential transfers to any Solana wallet</li>
                    <li>• Amounts are encrypted - only you can see the real value</li>
                    <li>• Click Claim to receive the funds to your wallet</li>
                    <li>• Unclaimed transfers expire after 7 days</li>
                </ul>
            </div>
        </div>
    );
}
