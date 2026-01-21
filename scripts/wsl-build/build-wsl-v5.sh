#!/bin/bash
set -e

echo "========================================"
echo "  VELO Build Script v5"
echo "========================================"

source ~/.cargo/env 2>/dev/null || true
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

echo "Anchor: $(anchor --version)"
echo "Solana: $(solana --version)"
echo ""

# Clear ALL cargo registry cache to force fresh downloads
echo "Clearing cargo cache..."
rm -rf ~/.cargo/registry/src/*
rm -rf ~/.cargo/registry/cache/*

# Fresh copy
echo "Setting up fresh project..."
rm -rf ~/velo_build
mkdir -p ~/velo_build
cp -r "/mnt/c/Users/1/Documents/milla projects/velo/programs/"* ~/velo_build/
cd ~/velo_build

# Add explicit dependency on older constant_time_eq in workspace
cat > Cargo.toml << 'EOF'
[workspace]
members = [
    "velo_mixer",
    "velo_private_tx",
    "velo_subscription",
    "velo_stealth"
]
resolver = "2"

[workspace.dependencies]
constant_time_eq = "=0.3.0"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1

[profile.release.build-override]
opt-level = 3
incremental = false
codegen-units = 1
EOF

# Add constant_time_eq to each program
for dir in velo_mixer velo_private_tx velo_subscription velo_stealth; do
    if ! grep -q "constant_time_eq" $dir/Cargo.toml; then
        sed -i '/\[dependencies\]/a constant_time_eq = { workspace = true }' $dir/Cargo.toml
    fi
done

echo "Updated Cargo.toml:"
cat Cargo.toml
echo ""

# Generate lockfile with older cargo to avoid version 4
echo "Generating lockfile..."
rm -f Cargo.lock
cargo generate-lockfile

# Force version 3
sed -i 's/version = 4/version = 3/' Cargo.lock

echo "Lockfile version:"
head -3 Cargo.lock

echo "constant_time_eq in lockfile:"
grep -A2 'name = "constant_time_eq"' Cargo.lock | head -3 || echo "Not found directly - checking dependencies..."

echo ""
echo "Building programs..."
anchor build

echo ""
echo "========================================"
echo "  BUILD SUCCESSFUL!"
echo "========================================"
ls -la ~/velo_build/target/deploy/*.so
