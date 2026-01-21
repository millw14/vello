#!/bin/bash
# Velo Build Script for WSL
# Run with: wsl bash ./wsl-build.sh

set -e

echo "========================================"
echo "  VELO - Build & Deploy via WSL"
echo "========================================"

cd /mnt/c/Users/1/Documents/milla\ projects/velo/programs

# Check if Solana is installed in WSL
if ! command -v solana &> /dev/null; then
    echo "Installing Solana CLI in WSL..."
    sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi

# Check if Anchor is installed
if ! command -v anchor &> /dev/null; then
    echo "Installing Anchor CLI..."
    cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked
fi

# Configure Solana for devnet
echo ""
echo "Configuring Solana for devnet..."
solana config set --url devnet

# Check/create keypair
if [ ! -f ~/.config/solana/id.json ]; then
    echo "Generating new keypair..."
    solana-keygen new --no-bip39-passphrase
fi

echo "Wallet: $(solana address)"
echo "Balance: $(solana balance)"

# Build programs
echo ""
echo "Building Anchor programs..."
anchor build

echo ""
echo "Build complete! Deploy with: anchor deploy"
