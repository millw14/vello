import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Transfer from '@/models/Transfer';

// POST - Claim a transfer (returns escrow secret for SOL transfer)
export async function POST(request: NextRequest) {
  try {
    await dbConnect();
    
    const body = await request.json();
    const { transferId, wallet } = body;
    
    if (!transferId || !wallet) {
      return NextResponse.json({ error: 'Transfer ID and wallet required' }, { status: 400 });
    }
    
    const transfer = await Transfer.findOne({ transferId });
    
    if (!transfer) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }
    
    if (transfer.recipient !== wallet) {
      return NextResponse.json({ error: 'Not authorized to claim this transfer' }, { status: 403 });
    }
    
    if (transfer.status === 'claimed') {
      return NextResponse.json({ error: 'Transfer already claimed' }, { status: 400 });
    }
    
    // Return escrow secret so client can transfer the SOL
    // Don't mark as claimed yet - that happens after successful transfer
    return NextResponse.json({ 
      success: true, 
      escrowSecret: transfer.escrowSecret,
      amount: transfer.amount,
      transferId: transfer.transferId,
    });
  } catch (error: any) {
    console.error('POST /api/transfers/claim error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH - Mark transfer as claimed after successful SOL transfer
export async function PATCH(request: NextRequest) {
  try {
    await dbConnect();
    
    const body = await request.json();
    const { transferId, txSignature } = body;
    
    if (!transferId) {
      return NextResponse.json({ error: 'Transfer ID required' }, { status: 400 });
    }
    
    const transfer = await Transfer.findOne({ transferId });
    
    if (!transfer) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }
    
    transfer.status = 'claimed';
    transfer.claimedAt = new Date();
    transfer.txSignature = txSignature || '';
    await transfer.save();
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('PATCH /api/transfers/claim error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
