#!/bin/bash
set -e

echo "========================================"
echo "  VELO Build Script for WSL"
echo "========================================"

# Setup environment
source ~/.cargo/env 2>/dev/null || true
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

echo "Anchor: $(anchor --version)"
echo "Solana: $(solana --version)"
echo ""

# Clean and copy to WSL home
echo "Copying project to WSL home directory..."
rm -rf ~/velo_build
mkdir -p ~/velo_build
cp -r "/mnt/c/Users/1/Documents/milla projects/velo/programs/"* ~/velo_build/

cd ~/velo_build
echo "Working in: $(pwd)"

# Downgrade to anchor 0.29.0 (compatible with older toolchain)
echo "Setting anchor-lang to 0.29.0 for compatibility..."
sed -i 's/anchor-lang = "0.32.1"/anchor-lang = "0.29.0"/g' velo_*/Cargo.toml
sed -i 's/anchor-spl = "0.32.1"/anchor-spl = "0.29.0"/g' velo_*/Cargo.toml
sed -i 's/anchor_version = "0.32.1"/anchor_version = "0.29.0"/g' Anchor.toml

# Remove old artifacts
rm -rf Cargo.lock target

# Generate lockfile and fix version
echo "Generating Cargo.lock..."
cargo generate-lockfile
sed -i 's/version = 4/version = 3/' Cargo.lock
echo "Cargo.lock version: $(head -3 Cargo.lock | tail -1)"

# Build
echo ""
echo "Building programs (this takes 3-5 minutes)..."
anchor build

echo ""
echo "========================================"
echo "  BUILD SUCCESSFUL!"
echo "========================================"
ls -la ~/velo_build/target/deploy/*.so

echo ""
echo "To deploy, run:"
echo "  cd ~/velo_build && anchor deploy"
