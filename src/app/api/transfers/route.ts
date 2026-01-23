import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Transfer from '@/models/Transfer';

// GET - Fetch pending transfers for a wallet
export async function GET(request: NextRequest) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');
    const type = searchParams.get('type') || 'incoming'; // 'incoming' or 'outgoing'
    
    if (!wallet) {
      return NextResponse.json({ error: 'Wallet address required' }, { status: 400 });
    }
    
    let query = {};
    if (type === 'incoming') {
      query = { recipient: wallet, status: 'pending' };
    } else {
      query = { sender: wallet };
    }
    
    const transfers = await Transfer.find(query).sort({ createdAt: -1 }).limit(50);
    
    return NextResponse.json({ transfers });
  } catch (error: any) {
    console.error('GET /api/transfers error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Create a new transfer
export async function POST(request: NextRequest) {
  try {
    await dbConnect();
    
    const body = await request.json();
    const { transferId, sender, recipient, amount, poolSize, escrowSecret } = body;
    
    if (!transferId || !sender || !recipient || !amount || !poolSize || !escrowSecret) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    // Check for duplicate
    const existing = await Transfer.findOne({ transferId });
    if (existing) {
      return NextResponse.json({ error: 'Transfer already exists' }, { status: 409 });
    }
    
    const transfer = await Transfer.create({
      transferId,
      sender,
      recipient,
      amount,
      poolSize,
      escrowSecret,
      status: 'pending',
    });
    
    return NextResponse.json({ transfer, success: true });
  } catch (error: any) {
    console.error('POST /api/transfers error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
