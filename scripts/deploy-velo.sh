#!/bin/bash
set -e

echo "═══════════════════════════════════════"
echo "       VELO - DEPLOY TO DEVNET"
echo "═══════════════════════════════════════"

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
source "$HOME/.cargo/env" 2>/dev/null || true

BUILD_DIR="/home/freemell/velo_build"
PROGRAM_SO="$BUILD_DIR/target/deploy/velo.so"
KEYPAIR="$BUILD_DIR/target/deploy/velo-keypair.json"

if [ ! -f "$PROGRAM_SO" ]; then
    echo "Error: Program binary not found at $PROGRAM_SO"
    exit 1
fi

PROGRAM_ID=$(solana address -k "$KEYPAIR")
echo "📍 Program ID: $PROGRAM_ID"

echo ""
echo "🚀 Deploying to devnet..."
solana program deploy "$PROGRAM_SO" --program-id "$KEYPAIR" -u devnet -v

echo ""
echo "✅ Checking deployment..."
solana program show "$PROGRAM_ID" -u devnet

echo ""
echo "═══════════════════════════════════════"
echo "       DEPLOYMENT COMPLETE"
echo "═══════════════════════════════════════"
echo ""
echo "Program ID: $PROGRAM_ID"
echo "Solscan: https://solscan.io/account/$PROGRAM_ID?cluster=devnet"
