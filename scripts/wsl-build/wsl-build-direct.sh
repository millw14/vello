#!/bin/bash
set -e
source ~/.cargo/env
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo "=========================================="
echo "  Building Velo Programs in WSL"
echo "=========================================="
echo "Anchor: $(anchor --version)"
echo "Solana: $(solana --version)"
cd "/mnt/c/Users/1/Documents/milla projects/velo/programs"
echo ""
echo "Building..."
anchor build
echo ""
echo "BUILD SUCCESSFUL!"
ls -la target/deploy/*.so 2>/dev/null && echo "" || echo "No .so files found"
