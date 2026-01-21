#!/bin/bash
set -e

echo "========================================"
echo "  VELO Build Script v3"
echo "========================================"

# Install system dependencies
echo "Installing system dependencies..."
sudo apt-get update
sudo apt-get install -y libudev-dev pkg-config build-essential

# Setup environment
source ~/.cargo/env 2>/dev/null || true
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

# Install anchor 0.32.1
echo ""
echo "Installing Anchor CLI 0.32.1 (this takes ~3 minutes)..."
cargo install --git https://github.com/coral-xyz/anchor --tag v0.32.1 anchor-cli --locked --force

# Verify
echo ""
echo "Anchor version: $(anchor --version)"
echo "Solana version: $(solana --version)"
echo ""

# Fresh copy of project
echo "Setting up fresh project copy..."
rm -rf ~/velo_build
mkdir -p ~/velo_build
cp -r "/mnt/c/Users/1/Documents/milla projects/velo/programs/"* ~/velo_build/
cd ~/velo_build

# Generate lockfile and fix version
echo "Generating Cargo.lock..."
rm -f Cargo.lock
cargo generate-lockfile
sed -i 's/version = 4/version = 3/' Cargo.lock

echo "Cargo.lock version:"
head -3 Cargo.lock
echo ""

# Build
echo "Building programs (this takes 3-5 minutes)..."
anchor build

echo ""
echo "========================================"
echo "  BUILD SUCCESSFUL!"
echo "========================================"
ls -la ~/velo_build/target/deploy/*.so 2>/dev/null || echo "Check target/deploy for .so files"

echo ""
echo "To deploy run: cd ~/velo_build && anchor deploy"
