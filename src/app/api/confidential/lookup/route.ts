/**
 * VELO CONFIDENTIAL ACCOUNT LOOKUP API
 * 
 * Look up a user's confidential account by their regular wallet address.
 * Used when sending to another user - Velo automatically finds their confidential account.
 */

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import mongoose from 'mongoose';

// Reuse the schema
const ConfidentialAccountSchema = new mongoose.Schema({
  ownerWallet: { type: String, required: true, unique: true, index: true },
  confidentialAccount: { type: String, required: true },
  elGamalPublicKey: { type: String, required: true },
  encryptedAvailableBalance: { type: String, default: '' },
  encryptedPendingBalance: { type: String, default: '' },
  isConfigured: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  lastUpdated: { type: Date, default: Date.now },
});

const ConfidentialAccount = mongoose.models.ConfidentialAccount || 
  mongoose.model('ConfidentialAccount', ConfidentialAccountSchema);

export async function GET(request: NextRequest) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');
    
    if (!wallet) {
      return NextResponse.json(
        { error: 'Wallet address required' },
        { status: 400 }
      );
    }
    
    // Find the confidential account for this wallet
    const account = await ConfidentialAccount.findOne({ 
      ownerWallet: wallet,
      isConfigured: true,
    });
    
    if (!account) {
      return NextResponse.json({
        found: false,
        message: 'No configured confidential account found for this wallet',
        // Return minimal info for auto-creation flow
        canAutoCreate: true,
      });
    }
    
    return NextResponse.json({
      found: true,
      confidentialAccount: account.confidentialAccount,
      elGamalPublicKey: account.elGamalPublicKey,
      // Don't return balance info for lookups - privacy!
    });
    
  } catch (error: any) {
    console.error('Lookup error:', error);
    return NextResponse.json(
      { error: error.message || 'Lookup failed' },
      { status: 500 }
    );
  }
}

// Batch lookup for multiple wallets
export async function POST(request: NextRequest) {
  try {
    await dbConnect();
    
    const { wallets } = await request.json();
    
    if (!wallets || !Array.isArray(wallets)) {
      return NextResponse.json(
        { error: 'Array of wallet addresses required' },
        { status: 400 }
      );
    }
    
    if (wallets.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 wallets per request' },
        { status: 400 }
      );
    }
    
    // Find all matching accounts
    const accounts = await ConfidentialAccount.find({
      ownerWallet: { $in: wallets },
      isConfigured: true,
    });
    
    // Create a map for easy lookup
    const accountMap: Record<string, {
      confidentialAccount: string;
      elGamalPublicKey: string;
    }> = {};
    
    for (const account of accounts) {
      accountMap[account.ownerWallet] = {
        confidentialAccount: account.confidentialAccount,
        elGamalPublicKey: account.elGamalPublicKey,
      };
    }
    
    return NextResponse.json({
      found: accounts.length,
      total: wallets.length,
      accounts: accountMap,
    });
    
  } catch (error: any) {
    console.error('Batch lookup error:', error);
    return NextResponse.json(
      { error: error.message || 'Batch lookup failed' },
      { status: 500 }
    );
  }
}
