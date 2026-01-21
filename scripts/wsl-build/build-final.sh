#!/bin/bash
set -e

cd ~/velo_build

# Fix Cargo.toml
cat > programs/velo_mixer/Cargo.toml << 'EOF'
[package]
name = "velo_mixer"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "velo_mixer"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []

[dependencies]
anchor-lang = "0.28.0"
EOF

# Add toolchain to Anchor.toml to suppress warning
cat > Anchor.toml << 'EOF'
[toolchain]
anchor_version = "0.28.0"

[features]
seeds = false
skip-lint = false

[programs.localnet]
velo_mixer = "GKNcUmNacSJo4S2Kq3DuYRYRGw3sNUfJ4tyqd198t6vQ"

[programs.devnet]
velo_mixer = "GKNcUmNacSJo4S2Kq3DuYRYRGw3sNUfJ4tyqd198t6vQ"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"
EOF

echo "=== Building with --no-idl ==="
anchor build --no-idl

echo "=== BUILD SUCCESS ==="
ls -la target/deploy/

echo "=== Program keypair ==="
if [ -f target/deploy/velo_mixer-keypair.json ]; then
    solana address -k target/deploy/velo_mixer-keypair.json
fi
