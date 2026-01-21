#!/bin/bash
set -e

echo "=== Cleaning up old build ==="
rm -rf ~/velo_build
mkdir -p ~/velo_build

echo "=== Copying project from Windows ==="
cp -r /mnt/c/Users/1/Documents/milla\ projects/velo/programs ~/velo_build/

echo "=== Creating workspace Cargo.toml ==="
cat > ~/velo_build/Cargo.toml << 'EOF'
[workspace]
members = [
    "programs/velo_mixer",
    "programs/velo_private_tx",
    "programs/velo_subscription",
    "programs/velo_stealth"
]
resolver = "2"

[workspace.dependencies]
constant_time_eq = "=0.3.1"
EOF

echo "=== Copying Anchor.toml ==="
cp /mnt/c/Users/1/Documents/milla\ projects/velo/programs/Anchor.toml ~/velo_build/

cd ~/velo_build

echo "=== Adding constant_time_eq to each program ==="
for prog in programs/velo_mixer programs/velo_private_tx programs/velo_subscription programs/velo_stealth; do
  if [ -f "$prog/Cargo.toml" ]; then
    if ! grep -q "constant_time_eq" $prog/Cargo.toml; then
      sed -i '/\[dependencies\]/a constant_time_eq = { workspace = true }' $prog/Cargo.toml
    fi
    echo "Updated $prog/Cargo.toml"
  else
    echo "WARNING: $prog/Cargo.toml not found"
  fi
done

echo "=== Clearing cargo cache for constant_time_eq ==="
rm -rf ~/.cargo/registry/src/*/constant_time_eq*
rm -rf ~/.cargo/registry/cache/*/constant_time_eq*

echo "=== Generating lockfile ==="
cargo generate-lockfile

echo "=== Fixing lockfile version ==="
sed -i 's/version = 4/version = 3/' Cargo.lock

echo "=== constant_time_eq version in Cargo.lock ==="
grep -A1 'name = "constant_time_eq"' Cargo.lock || echo "constant_time_eq not found in lockfile"

echo "=== Starting anchor build ==="
anchor build
