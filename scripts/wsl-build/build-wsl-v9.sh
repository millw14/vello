#!/bin/bash
set -e

echo "=== Cleaning up old build ==="
rm -rf ~/velo_build
mkdir -p ~/velo_build

echo "=== Copying project from Windows ==="
cp -r /mnt/c/Users/1/Documents/milla\ projects/velo/programs ~/velo_build/

echo "=== Creating workspace Cargo.toml with patch ==="
cat > ~/velo_build/Cargo.toml << 'EOF'
[workspace]
members = [
    "programs/velo_mixer",
    "programs/velo_private_tx",
    "programs/velo_subscription",
    "programs/velo_stealth"
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

[patch.crates-io]
constant_time_eq = { git = "https://github.com/cesarb/constant_time_eq.git", tag = "v0.3.1" }
EOF

echo "=== Copying Anchor.toml ==="
cp /mnt/c/Users/1/Documents/milla\ projects/velo/programs/Anchor.toml ~/velo_build/

cd ~/velo_build

echo "=== Clearing cargo cache ==="
rm -rf ~/.cargo/registry/src/*/constant_time_eq*
rm -rf ~/.cargo/registry/cache/*/constant_time_eq*
rm -rf target Cargo.lock

echo "=== Generating lockfile ==="
cargo generate-lockfile

echo "=== Fixing lockfile version ==="
sed -i 's/version = 4/version = 3/' Cargo.lock

echo "=== constant_time_eq versions in Cargo.lock ==="
grep -A2 'name = "constant_time_eq"' Cargo.lock || echo "constant_time_eq not found"

echo "=== Starting anchor build ==="
anchor build
