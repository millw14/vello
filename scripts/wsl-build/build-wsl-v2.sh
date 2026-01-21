#!/bin/bash
set -e

echo "========================================"
echo "  VELO Build Script v2"
echo "========================================"

# Setup
source ~/.cargo/env 2>/dev/null || true
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

# Fresh copy
rm -rf ~/velo_build
mkdir -p ~/velo_build
cp -r "/mnt/c/Users/1/Documents/milla projects/velo/programs/"* ~/velo_build/
cd ~/velo_build

# Use anchor 0.30.1 with matching CLI
echo "Configuring for anchor 0.30.1..."
sed -i 's/anchor-lang = "0.32.1"/anchor-lang = "0.30.1"/g' velo_*/Cargo.toml
sed -i 's/anchor-spl = "0.32.1"/anchor-spl = "0.30.1"/g' velo_*/Cargo.toml

# Update Anchor.toml
cat > Anchor.toml << 'TOML'
[toolchain]
anchor_version = "0.30.1"

[features]
seeds = false
skip-lint = false

[programs.devnet]
velo_mixer = "VeLoMix1111111111111111111111111111111111111"
velo_private_tx = "VeLoPrv1111111111111111111111111111111111111"
velo_subscription = "VeLoSub1111111111111111111111111111111111111"
velo_stealth = "VeLoStl1111111111111111111111111111111111111"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
TOML

# Fix workspace resolver
sed -i 's/\[workspace\]/[workspace]\nresolver = "2"/' Cargo.toml

# Install anchor 0.30.1 via avm
echo "Installing anchor 0.30.1..."
avm install 0.30.1 --force || true
avm use 0.30.1

echo "Using: $(anchor --version)"

# Generate lockfile
rm -rf Cargo.lock target
cargo generate-lockfile
sed -i 's/version = 4/version = 3/' Cargo.lock

echo "Cargo.lock version:"
head -3 Cargo.lock

# Build
echo ""
echo "Building (this takes 3-5 minutes)..."
anchor build

echo ""
echo "========================================"
echo "  BUILD COMPLETE!"
echo "========================================"
ls -la target/deploy/*.so
