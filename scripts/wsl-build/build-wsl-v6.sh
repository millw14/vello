#!/bin/bash
set -e

echo "========================================"
echo "  VELO Build Script v6"
echo "========================================"

source ~/.cargo/env 2>/dev/null || true
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

echo "Anchor: $(anchor --version)"
echo "Solana: $(solana --version)"
echo ""

# Fresh copy
echo "Setting up fresh project..."
rm -rf ~/velo_build
mkdir -p ~/velo_build
cp -r "/mnt/c/Users/1/Documents/milla projects/velo/programs/"* ~/velo_build/
cd ~/velo_build

# Simple Cargo.toml
cat > Cargo.toml << 'EOF'
[workspace]
members = [
    "velo_mixer",
    "velo_private_tx",
    "velo_subscription",
    "velo_stealth"
]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1

[profile.release.build-override]
opt-level = 3
incremental = false
codegen-units = 1
EOF

# Generate lockfile
echo "Generating lockfile..."
rm -f Cargo.lock
cargo generate-lockfile
sed -i 's/version = 4/version = 3/' Cargo.lock

# CRITICAL: Remove problematic crate versions from cache AFTER lockfile generation
echo "Removing problematic crate versions..."
rm -rf ~/.cargo/registry/src/*/constant_time_eq-0.4.*
rm -rf ~/.cargo/registry/cache/*/constant_time_eq-0.4.*

# Also create a fake 0.4.2 that just re-exports 0.3.0
# This tricks cargo into thinking 0.4.2 exists
echo "Creating compatibility shim..."
mkdir -p ~/.cargo/registry/src/index.crates.io-6f17d22bba15001f/constant_time_eq-0.4.2/src
cat > ~/.cargo/registry/src/index.crates.io-6f17d22bba15001f/constant_time_eq-0.4.2/Cargo.toml << 'SHIM'
[package]
name = "constant_time_eq"
version = "0.4.2"
edition = "2021"

[dependencies]
SHIM

cat > ~/.cargo/registry/src/index.crates.io-6f17d22bba15001f/constant_time_eq-0.4.2/src/lib.rs << 'SHIM'
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut result = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        result |= x ^ y;
    }
    result == 0
}
SHIM

echo "Lockfile version:"
head -3 Cargo.lock

echo ""
echo "Building programs..."
anchor build

echo ""
echo "========================================"
echo "  BUILD SUCCESSFUL!"
echo "========================================"
ls -la ~/velo_build/target/deploy/*.so
