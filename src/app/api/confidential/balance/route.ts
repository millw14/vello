/**
 * VELO CONFIDENTIAL BALANCE API
 * 
 * Get and update encrypted balances.
 */

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import mongoose from 'mongoose';

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

// ═══════════════════════════════════════════════════════════════════
// GET - Get Balance Info
// ═══════════════════════════════════════════════════════════════════

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
    
    const account = await ConfidentialAccount.findOne({ ownerWallet: wallet });
    
    if (!account) {
      return NextResponse.json({
        exists: false,
        balance: {
          encryptedAvailable: '',
          encryptedPending: '',
          isConfigured: false,
        },
      });
    }
    
    return NextResponse.json({
      exists: true,
      balance: {
        encryptedAvailable: account.encryptedAvailableBalance,
        encryptedPending: account.encryptedPendingBalance,
        isConfigured: account.isConfigured,
        lastUpdated: account.lastUpdated,
      },
    });
    
  } catch (error: any) {
    console.error('Get balance error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get balance' },
      { status: 500 }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// PATCH - Update Encrypted Balance
// ═══════════════════════════════════════════════════════════════════

export async function PATCH(request: NextRequest) {
  try {
    await dbConnect();
    
    const {
      wallet,
      encryptedAvailableBalance,
      encryptedPendingBalance,
    } = await request.json();
    
    if (!wallet) {
      return NextResponse.json(
        { error: 'Wallet address required' },
        { status: 400 }
      );
    }
    
    const update: any = { lastUpdated: new Date() };
    
    if (encryptedAvailableBalance !== undefined) {
      update.encryptedAvailableBalance = encryptedAvailableBalance;
    }
    if (encryptedPendingBalance !== undefined) {
      update.encryptedPendingBalance = encryptedPendingBalance;
    }
    
    const account = await ConfidentialAccount.findOneAndUpdate(
      { ownerWallet: wallet },
      { $set: update },
      { new: true }
    );
    
    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      balance: {
        encryptedAvailable: account.encryptedAvailableBalance,
        encryptedPending: account.encryptedPendingBalance,
        lastUpdated: account.lastUpdated,
      },
    });
    
  } catch (error: any) {
    console.error('Update balance error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update balance' },
      { status: 500 }
    );
  }
}
