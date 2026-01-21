#!/bin/bash
set -e

# Load Solana PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
source ~/.cargo/env 2>/dev/null || true

cd ~/velo_build

echo "=== Updating program ID to match keypair ==="
PROGRAM_ID=$(solana address -k target/deploy/velo_mixer-keypair.json)
echo "Program ID: $PROGRAM_ID"

# Update lib.rs with correct program ID
sed -i "s/declare_id!(\".*\")/declare_id!(\"$PROGRAM_ID\")/" programs/velo_mixer/src/lib.rs

echo "=== Verifying update ==="
grep "declare_id" programs/velo_mixer/src/lib.rs

echo "=== Downgrading blake3 to avoid constant_time_eq issue ==="
cargo update -p blake3 --precise 1.5.0
sed -i 's/version = 4/version = 3/' Cargo.lock

echo "=== Rebuilding ==="
anchor build --no-idl

echo "=== Upgrading deployed program ==="
solana program deploy target/deploy/velo_mixer.so --program-id target/deploy/velo_mixer-keypair.json --upgrade-authority ~/.config/solana/id.json

echo "=== Done! ==="
echo "Program ID: $PROGRAM_ID"
