#!/bin/bash
set -e

echo "========================================"
echo "  VELO Build Script v4"
echo "========================================"

source ~/.cargo/env 2>/dev/null || true
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

echo "Anchor: $(anchor --version)"
echo "Solana: $(solana --version)"
echo ""

# Clear the problematic crate from cache
echo "Clearing problematic crate cache..."
rm -rf ~/.cargo/registry/src/*/constant_time_eq-0.4.*
rm -rf ~/.cargo/registry/cache/*/constant_time_eq-0.4.*

# Fresh copy
echo "Setting up fresh project..."
rm -rf ~/velo_build
mkdir -p ~/velo_build
cp -r "/mnt/c/Users/1/Documents/milla projects/velo/programs/"* ~/velo_build/
cd ~/velo_build

# Add cargo config to use sparse registry (sometimes helps)
mkdir -p .cargo
cat > .cargo/config.toml << 'EOF'
[registries.crates-io]
protocol = "sparse"

[net]
git-fetch-with-cli = true
EOF

# Pin constant_time_eq to older version via patch
cat >> Cargo.toml << 'EOF'

[patch.crates-io]
constant_time_eq = { git = "https://github.com/cesarb/constant_time_eq.git", tag = "v0.3.1" }
EOF

echo "Updated Cargo.toml:"
cat Cargo.toml
echo ""

# Generate lockfile
rm -f Cargo.lock
cargo generate-lockfile
sed -i 's/version = 4/version = 3/' Cargo.lock

# Check what version of constant_time_eq we got
echo "constant_time_eq version in lockfile:"
grep -A3 'name = "constant_time_eq"' Cargo.lock | head -4

echo ""
echo "Building programs..."
anchor build

echo ""
echo "========================================"
echo "  BUILD SUCCESSFUL!"
echo "========================================"
ls -la ~/velo_build/target/deploy/*.so
