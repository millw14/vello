#!/bin/bash
set -e

cd ~/velo_build

# Add constant_time_eq 0.3.1 as a workspace dependency to force it
cat >> Cargo.toml << 'EOF'

[workspace.dependencies]
constant_time_eq = "=0.3.1"
EOF

# Add it to each program's Cargo.toml
for prog in programs/velo_mixer programs/velo_private_tx programs/velo_subscription programs/velo_stealth; do
  if ! grep -q "constant_time_eq" $prog/Cargo.toml; then
    sed -i '/\[dependencies\]/a constant_time_eq = { workspace = true }' $prog/Cargo.toml
  fi
done

# Clear and rebuild
rm -rf target Cargo.lock ~/.cargo/registry/src/*/constant_time_eq*
cargo generate-lockfile
sed -i 's/version = 4/version = 3/' Cargo.lock

# Check what version of constant_time_eq is being used
echo "=== constant_time_eq version in Cargo.lock ==="
grep -A1 'name = "constant_time_eq"' Cargo.lock

echo "=== Starting anchor build ==="
anchor build
