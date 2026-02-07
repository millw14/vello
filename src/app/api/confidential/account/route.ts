/**
 * VELO CONFIDENTIAL ACCOUNT API
 * 
 * Endpoints:
 * - POST: Create/register confidential account
 * - GET: Get account info by wallet address
 */

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';

// MongoDB model for confidential accounts
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
// POST - Create/Register Account
// ═══════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  try {
    await dbConnect();
    
    const {
      ownerWallet,
      confidentialAccount,
      elGamalPublicKey,
    } = await request.json();
    
    // Validation
    if (!ownerWallet || !confidentialAccount || !elGamalPublicKey) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Check if account already exists
    const existing = await ConfidentialAccount.findOne({ ownerWallet });
    
    if (existing) {
      // Update existing account
      existing.confidentialAccount = confidentialAccount;
      existing.elGamalPublicKey = elGamalPublicKey;
      existing.isConfigured = true;
      existing.lastUpdated = new Date();
      await existing.save();
      
      return NextResponse.json({
        success: true,
        account: existing,
        message: 'Account updated',
      });
    }
    
    // Create new account
    const account = await ConfidentialAccount.create({
      ownerWallet,
      confidentialAccount,
      elGamalPublicKey,
      isConfigured: true,
    });
    
    return NextResponse.json({
      success: true,
      account,
      message: 'Account created',
    }, { status: 201 });
    
  } catch (error: any) {
    console.error('Create account error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create account' },
      { status: 500 }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// GET - Get Account Info
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
        account: null,
      });
    }
    
    return NextResponse.json({
      exists: true,
      account: {
        ownerWallet: account.ownerWallet,
        confidentialAccount: account.confidentialAccount,
        elGamalPublicKey: account.elGamalPublicKey,
        encryptedAvailableBalance: account.encryptedAvailableBalance,
        encryptedPendingBalance: account.encryptedPendingBalance,
        isConfigured: account.isConfigured,
        createdAt: account.createdAt,
        lastUpdated: account.lastUpdated,
      },
    });
    
  } catch (error: any) {
    console.error('Get account error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get account' },
      { status: 500 }
    );
  }
}
