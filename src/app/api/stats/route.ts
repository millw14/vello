/**
 * VELO NETWORK STATS API
 * 
 * Tracks real-time network statistics
 */

import { NextRequest, NextResponse } from 'next/server';

// In-memory stats (in production, use Redis/MongoDB)
let stats = {
  activeUsers: 0,
  totalDeposits: 0,
  totalTransfers: 0,
  totalVolume: 0,
  lastUpdated: Date.now(),
  recentUsers: new Set<string>(),
};

// Track user activity (called when users interact)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { walletAddress, action, amount } = body;

    if (!walletAddress) {
      return NextResponse.json({ error: 'Missing wallet address' }, { status: 400 });
    }

    // Track this user as active
    stats.recentUsers.add(walletAddress);
    stats.activeUsers = stats.recentUsers.size;

    // Track activity
    if (action === 'deposit') {
      stats.totalDeposits++;
      stats.totalVolume += amount || 0;
    } else if (action === 'transfer' || action === 'send') {
      stats.totalTransfers++;
      stats.totalVolume += amount || 0;
    }

    stats.lastUpdated = Date.now();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Get current stats
export async function GET() {
  // Clean up old users (inactive for > 5 minutes)
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  if (stats.lastUpdated < fiveMinutesAgo) {
    stats.recentUsers.clear();
    stats.activeUsers = 0;
  }

  return NextResponse.json({
    activeUsers: Math.max(1, stats.activeUsers), // At least 1 (current user)
    totalDeposits: stats.totalDeposits,
    totalTransfers: stats.totalTransfers,
    totalVolume: stats.totalVolume,
    poolLiquidity: {
      SMALL: 12.5,  // Mock for now
      MEDIUM: 45.0,
      LARGE: 230.0,
    },
    lastUpdated: stats.lastUpdated,
  });
}
