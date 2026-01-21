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

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1

[profile.release.build-override]
opt-level = 3
incremental = false
codegen-units = 1
EOF

echo "=== Copying Anchor.toml ==="
cp /mnt/c/Users/1/Documents/milla\ projects/velo/programs/Anchor.toml ~/velo_build/

cd ~/velo_build

echo "=== Downgrading anchor-lang to avoid constant_time_eq 0.4.x ==="
for prog in programs/velo_mixer programs/velo_private_tx programs/velo_subscription programs/velo_stealth; do
  if [ -f "$prog/Cargo.toml" ]; then
    # Use anchor-lang 0.29.0 which doesn't pull in constant_time_eq 0.4.x
    sed -i 's/anchor-lang = "0.32.1"/anchor-lang = "0.29.0"/' $prog/Cargo.toml
    sed -i 's/anchor-spl = "0.32.1"/anchor-spl = "0.29.0"/' $prog/Cargo.toml
    echo "Downgraded $prog/Cargo.toml to anchor 0.29.0"
  fi
done

echo "=== Clearing cargo cache ==="
rm -rf ~/.cargo/registry/src/*/constant_time_eq-0.4*
rm -rf ~/.cargo/registry/cache/*/constant_time_eq-0.4*
rm -rf target Cargo.lock

echo "=== Generating lockfile ==="
cargo generate-lockfile

echo "=== Fixing lockfile version ==="
sed -i 's/version = 4/version = 3/' Cargo.lock

echo "=== constant_time_eq versions in Cargo.lock ==="
grep -A2 'name = "constant_time_eq"' Cargo.lock || echo "constant_time_eq not found"

echo "=== Starting anchor build ==="
anchor build
