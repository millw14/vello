#!/bin/bash
# Velo Program Deployment Script
# Run this from the project root: ./scripts/deploy.sh

set -e

echo "🚀 Velo Deployment Script"
echo "========================="

# Check if Solana CLI is installed
if ! command -v solana &> /dev/null; then
    echo "❌ Solana CLI not found. Please install it first:"
    echo "   sh -c \"\$(curl -sSfL https://release.solana.com/stable/install)\""
    exit 1
fi

# Check if Anchor is installed
if ! command -v anchor &> /dev/null; then
    echo "❌ Anchor not found. Please install it first:"
    echo "   cargo install --git https://github.com/coral-xyz/anchor avm --locked"
    echo "   avm install latest"
    echo "   avm use latest"
    exit 1
fi

# Get cluster from argument or default to devnet
CLUSTER=${1:-devnet}
echo "📡 Target cluster: $CLUSTER"

# Configure Solana CLI
echo ""
echo "⚙️  Configuring Solana CLI..."
solana config set --url $CLUSTER

# Check wallet balance
BALANCE=$(solana balance | awk '{print $1}')
echo "💰 Wallet balance: $BALANCE SOL"

if (( $(echo "$BALANCE < 2" | bc -l) )); then
    echo "⚠️  Low balance! You need at least 2 SOL for deployment."
    echo "   Run: solana airdrop 2 (for devnet)"
    exit 1
fi

# Build programs
echo ""
echo "🔨 Building Anchor programs..."
cd programs
anchor build

# Generate program keypairs if they don't exist
echo ""
echo "🔑 Checking program keypairs..."

PROGRAMS=("velo_mixer" "velo_private_tx" "velo_subscription" "velo_stealth")
for program in "${PROGRAMS[@]}"; do
    KEYPAIR="target/deploy/${program}-keypair.json"
    if [ ! -f "$KEYPAIR" ]; then
        echo "   Generating keypair for $program..."
        solana-keygen new -o "$KEYPAIR" --no-bip39-passphrase
    fi
    
    # Get program ID
    PROGRAM_ID=$(solana-keygen pubkey "$KEYPAIR")
    echo "   $program: $PROGRAM_ID"
done

# Deploy programs
echo ""
echo "📦 Deploying programs to $CLUSTER..."

for program in "${PROGRAMS[@]}"; do
    echo "   Deploying $program..."
    anchor deploy --program-name $program --provider.cluster $CLUSTER
done

# Get deployed program IDs
echo ""
echo "✅ Deployment complete! Program IDs:"
echo "=================================="

for program in "${PROGRAMS[@]}"; do
    KEYPAIR="target/deploy/${program}-keypair.json"
    PROGRAM_ID=$(solana-keygen pubkey "$KEYPAIR")
    echo "$program: $PROGRAM_ID"
done

echo ""
echo "📝 Next steps:"
echo "1. Copy the program IDs above"
echo "2. Update src/lib/solana/programs/index.ts with the new IDs"
echo "3. Update .env.local with any new configuration"
echo "4. Run 'npm run build' to verify everything works"
