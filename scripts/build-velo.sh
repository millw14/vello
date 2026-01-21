#!/bin/bash
set -e

# VELO Privacy Protocol - Build Script

echo "═══════════════════════════════════════"
echo "       VELO PRIVACY PROTOCOL"
echo "           Build Script"
echo "═══════════════════════════════════════"

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH="$HOME/.avm/bin:$PATH"
source "$HOME/.cargo/env" 2>/dev/null || true

BUILD_DIR="/home/freemell/velo_build"

echo ""
echo "📁 Setting up build directory..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/programs/velo/src"

# Copy program files
echo "📋 Copying Velo program..."
cp "/mnt/c/Users/1/Documents/milla projects/velo/programs/velo/src/lib.rs" "$BUILD_DIR/programs/velo/src/"

# Ensure the correct program ID is in lib.rs (in case build overwrites it)
CORRECT_ID="AQgeVtAYEvigMbBW5gEiK4voELjFB94fDY9cFZqKHgZ8"
sed -i "s/declare_id!(\"[^\"]*\")/declare_id!(\"$CORRECT_ID\")/" "$BUILD_DIR/programs/velo/src/lib.rs"
echo "📌 Program ID set to: $CORRECT_ID"

# Create program Cargo.toml 
cat > "$BUILD_DIR/programs/velo/Cargo.toml" << 'EOF'
[package]
name = "velo"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "velo"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []

[dependencies]
anchor-lang = "0.28.0"
constant_time_eq = "=0.3.1"
blake3 = "=1.5.0"
EOF

# Create workspace Cargo.toml
cat > "$BUILD_DIR/Cargo.toml" << 'EOF'
[workspace]
members = ["programs/velo"]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
EOF

# Create Anchor.toml with CORRECT program ID
cat > "$BUILD_DIR/Anchor.toml" << 'EOF'
[features]
seeds = false
skip-lint = false

[programs.devnet]
velo = "AQgeVtAYEvigMbBW5gEiK4voELjFB94fDY9cFZqKHgZ8"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"
EOF

cd "$BUILD_DIR"

# Clear cargo cache for constant_time_eq
rm -rf ~/.cargo/registry/src/*/constant_time_eq-0.4* 2>/dev/null || true
rm -rf ~/.cargo/registry/cache/*/constant_time_eq-0.4* 2>/dev/null || true

echo ""
echo "🔨 Building Velo program with cargo build-sbf (preserving program ID)..."

# Use cargo build-sbf directly to avoid anchor auto-updating the program ID
cd programs/velo
mkdir -p ../../target/deploy

cargo build-sbf --manifest-path Cargo.toml -- --locked 2>&1 || cargo build-sbf 2>&1

# Move the built file to the expected location
if [ -f "../../target/deploy/velo.so" ]; then
    echo "Build artifact found in target/deploy"
elif [ -f "../../target/sbf-solana-solana/release/velo.so" ]; then
    cp "../../target/sbf-solana-solana/release/velo.so" "../../target/deploy/"
elif [ -f "target/sbf-solana-solana/release/velo.so" ]; then
    cp "target/sbf-solana-solana/release/velo.so" "../../target/deploy/"
fi

cd "$BUILD_DIR"

echo ""
echo "✅ Build complete!"

if [ -f "$BUILD_DIR/target/deploy/velo.so" ]; then
    echo "📦 Program binary: $BUILD_DIR/target/deploy/velo.so"
    ls -la "$BUILD_DIR/target/deploy/velo.so"
    
    mkdir -p "/mnt/c/Users/1/Documents/milla projects/velo/target/deploy/"
    cp "$BUILD_DIR/target/deploy/velo.so" "/mnt/c/Users/1/Documents/milla projects/velo/target/deploy/"
    
    if [ -f "$BUILD_DIR/target/deploy/velo-keypair.json" ]; then
        cp "$BUILD_DIR/target/deploy/velo-keypair.json" "/mnt/c/Users/1/Documents/milla projects/velo/target/deploy/"
        echo ""
        echo "🔑 Program ID:"
        solana address -k "$BUILD_DIR/target/deploy/velo-keypair.json"
    fi
    
    echo ""
    echo "📤 Copied to Windows target/deploy/"
fi

echo ""
echo "═══════════════════════════════════════"
echo "       BUILD COMPLETE"
echo "═══════════════════════════════════════"
