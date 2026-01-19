# Velo Privacy Protocol - Complete Setup Guide

A comprehensive guide to setting up and deploying the Velo privacy protocol on Solana.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Structure](#project-structure)
3. [Quick Start (Development)](#quick-start-development)
4. [ZK Circuits Setup](#zk-circuits-setup)
5. [Anchor Programs Deployment](#anchor-programs-deployment)
6. [Frontend Configuration](#frontend-configuration)
7. [Relayer Setup](#relayer-setup)
8. [Testing the Full Flow](#testing-the-full-flow)
9. [Production Deployment Checklist](#production-deployment-checklist)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

```bash
# 1. Node.js 18+ and npm
node --version  # Should be 18.x or higher

# 2. Rust and Cargo
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustc --version  # Should be 1.70+

# 3. Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
solana --version  # Should be 1.18+

# 4. Anchor Framework
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest
avm use latest
anchor --version  # Should be 0.29+

# 5. Circom (for ZK circuits)
# On Windows, use WSL or download from: https://github.com/iden3/circom/releases
cargo install --git https://github.com/iden3/circom
circom --version  # Should be 2.1+
```

### Solana Wallet Setup

```bash
# Generate a new wallet (or import existing)
solana-keygen new -o ~/.config/solana/id.json

# Set to devnet for testing
solana config set --url devnet

# Get some devnet SOL
solana airdrop 5

# Check balance
solana balance
```

---

## Project Structure

```
velo/
├── circuits/                 # Circom ZK circuits
│   ├── lib/                 # Reusable circuit components
│   │   ├── poseidon.circom  # Poseidon hash implementation
│   │   └── merkle.circom    # Merkle tree verifier
│   ├── mixer/
│   │   └── withdraw.circom  # Main withdrawal circuit
│   ├── scripts/             # Circuit build/setup scripts
│   │   ├── setup.js         # Trusted setup
│   │   └── prove.js         # Proof generation
│   └── package.json
│
├── programs/                 # Anchor/Rust smart contracts
│   ├── velo_mixer/          # Mixing pool program
│   ├── velo_private_tx/     # Private transaction program
│   ├── velo_subscription/   # Subscription tiers program
│   ├── velo_stealth/        # Stealth address program
│   └── Anchor.toml          # Anchor configuration
│
├── relayer/                  # Transaction relayer service
│   ├── src/
│   │   ├── index.ts         # Express server
│   │   └── services/        # Relayer logic
│   └── package.json
│
├── src/                      # Next.js frontend
│   ├── app/                 # Pages and API routes
│   ├── components/          # React components
│   ├── hooks/               # Custom React hooks
│   └── lib/solana/          # Solana SDK and utilities
│       ├── light-protocol.ts  # ZK compression
│       ├── zk-prover.ts       # Proof generation
│       ├── stealth.ts         # Stealth addresses
│       └── mixer.ts           # Mixer client
│
├── scripts/                  # Deployment scripts
│   ├── deploy.sh            # Unix deployment
│   └── deploy.ps1           # Windows deployment
│
└── public/circuits/         # Compiled circuit files (after build)
    ├── withdraw.wasm        # Circuit WASM
    └── withdraw_final.zkey  # Proving key
```

---

## Quick Start (Development)

```bash
# 1. Clone and install dependencies
git clone https://github.com/millw14/vello.git
cd vello
npm install

# 2. Set up environment variables
cp .env.example .env.local
# Edit .env.local with your values

# 3. Start the development server
npm run dev

# 4. Open http://localhost:3000
```

---

## ZK Circuits Setup

### Step 1: Install Circuit Dependencies

```bash
cd circuits
npm install
```

### Step 2: Compile the Circuits

```bash
# Create build directory
mkdir -p build

# Compile the withdrawal circuit
circom mixer/withdraw.circom --r1cs --wasm --sym -o build

# This generates:
# - build/withdraw.r1cs (constraint system)
# - build/withdraw_js/withdraw.wasm (WASM for proof generation)
# - build/withdraw.sym (symbol file for debugging)
```

### Step 3: Run Trusted Setup

⚠️ **IMPORTANT**: For production, use Powers of Tau from a trusted ceremony (Hermez, Zcash).

```bash
# For development (NOT secure for production!)
node scripts/setup.js

# This generates:
# - build/withdraw_final.zkey (proving key)
# - build/verification_key.json (verification key)
```

### Step 4: Copy to Public Directory

```bash
# From project root
mkdir -p public/circuits
cp circuits/build/withdraw_js/withdraw.wasm public/circuits/
cp circuits/build/withdraw_final.zkey public/circuits/
```

### For Production Trusted Setup

1. Download Powers of Tau from Hermez ceremony:
   ```
   https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_20.ptau
   ```

2. Run multi-party computation for phase 2 with multiple participants.

3. Verify the ceremony transcript.

---

## Anchor Programs Deployment

### Step 1: Build Programs

```bash
cd programs
anchor build
```

### Step 2: Generate Program Keypairs

```bash
# Generate keypairs for each program (if not exists)
solana-keygen new -o target/deploy/velo_mixer-keypair.json --no-bip39-passphrase
solana-keygen new -o target/deploy/velo_private_tx-keypair.json --no-bip39-passphrase
solana-keygen new -o target/deploy/velo_subscription-keypair.json --no-bip39-passphrase
solana-keygen new -o target/deploy/velo_stealth-keypair.json --no-bip39-passphrase
```

### Step 3: Get Program IDs

```bash
# Display program IDs
solana-keygen pubkey target/deploy/velo_mixer-keypair.json
solana-keygen pubkey target/deploy/velo_private_tx-keypair.json
solana-keygen pubkey target/deploy/velo_subscription-keypair.json
solana-keygen pubkey target/deploy/velo_stealth-keypair.json
```

### Step 4: Update Program IDs in Code

Update `programs/velo_mixer/src/lib.rs`:
```rust
declare_id!("YOUR_MIXER_PROGRAM_ID_HERE");
```

Update `Anchor.toml`:
```toml
[programs.devnet]
velo_mixer = "YOUR_MIXER_PROGRAM_ID_HERE"
# ... etc
```

### Step 5: Rebuild and Deploy

```bash
# Rebuild with new IDs
anchor build

# Ensure you have enough SOL
solana balance  # Need ~2 SOL for deployment

# Get airdrop if needed (devnet only)
solana airdrop 2

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

### Step 6: Update Frontend

Update `src/lib/solana/programs/index.ts`:
```typescript
export const PROGRAM_IDS = {
  mixer: new PublicKey('YOUR_MIXER_PROGRAM_ID'),
  privateTx: new PublicKey('YOUR_PRIVATE_TX_PROGRAM_ID'),
  subscription: new PublicKey('YOUR_SUBSCRIPTION_PROGRAM_ID'),
  stealth: new PublicKey('YOUR_STEALTH_PROGRAM_ID'),
};
```

### Using the Deployment Script

```powershell
# Windows
.\scripts\deploy.ps1 -Cluster devnet

# Unix/Mac
./scripts/deploy.sh devnet
```

---

## Frontend Configuration

### Environment Variables (.env.local)

```bash
# MongoDB (for user accounts)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/velo

# JWT Secret (generate a strong random string)
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters

# Solana Configuration
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_NETWORK=devnet

# Relayer URL (for private transactions)
NEXT_PUBLIC_RELAYER_URL=http://localhost:3001

# Program IDs (after deployment)
NEXT_PUBLIC_MIXER_PROGRAM_ID=YOUR_MIXER_PROGRAM_ID
NEXT_PUBLIC_STEALTH_PROGRAM_ID=YOUR_STEALTH_PROGRAM_ID
```

### Build and Start

```bash
npm run build
npm run start
```

---

## Relayer Setup

The relayer submits transactions on behalf of users to preserve privacy.

### Step 1: Configure Relayer

```bash
cd relayer
cp env.template .env

# Edit .env:
# SOLANA_RPC_URL=https://api.devnet.solana.com
# RELAYER_SECRET_KEY=[...] (your relayer wallet secret key as JSON array)
# PORT=3001
```

### Step 2: Fund Relayer Wallet

```bash
# Generate relayer wallet
solana-keygen new -o relayer-keypair.json

# Get SOL for transaction fees
solana airdrop 2 $(solana-keygen pubkey relayer-keypair.json)
```

### Step 3: Start Relayer

```bash
npm install
npm run dev
```

### Step 4: Verify Relayer

```bash
curl http://localhost:3001/health
# Should return: {"status":"ok","relayer":"<RELAYER_PUBLIC_KEY>"}
```

---

## Testing the Full Flow

### 1. Create an Account

1. Open http://localhost:3000
2. Click "Get Started"
3. Create an account with email/password
4. A Solana wallet is automatically created

### 2. Fund Your Wallet

```bash
# Copy your wallet address from the dashboard
solana airdrop 2 YOUR_WALLET_ADDRESS
```

Or use the "AIRDROP" button in the dashboard (devnet only).

### 3. Test Mixer Deposit

1. Click "MIX" in the dashboard
2. Select a pool denomination (0.1, 1, or 10 SOL)
3. Confirm the deposit
4. **SAVE YOUR COMMITMENT** - you need this to withdraw!

### 4. Test Mixer Withdrawal

1. Wait for other deposits (for anonymity)
2. Enter your commitment
3. The ZK proof is generated client-side
4. Proof is sent to relayer
5. Relayer submits the transaction

### 5. Test Stealth Address

1. Click "STEALTH" in the dashboard
2. Generate a new stealth address
3. Share the address with sender
4. Sender sends to the stealth address
5. Only you can detect and claim the payment

---

## Production Deployment Checklist

### Security

- [ ] Use Powers of Tau from trusted ceremony
- [ ] Run multi-party computation for phase 2
- [ ] Audit all smart contracts
- [ ] Audit ZK circuits
- [ ] Use hardware wallet for deployment keys
- [ ] Set up monitoring and alerts

### Infrastructure

- [ ] Use Helius or QuickNode for RPC
- [ ] Deploy relayer to cloud (Railway, Render, AWS)
- [ ] Set up database backups
- [ ] Configure SSL certificates
- [ ] Set up DDoS protection

### Configuration

- [ ] Update all program IDs
- [ ] Change JWT secret
- [ ] Use mainnet RPC URL
- [ ] Configure production MongoDB
- [ ] Set proper CORS origins

### Testing

- [ ] Test all flows on devnet
- [ ] Test with real users
- [ ] Load test the relayer
- [ ] Test error handling

---

## Troubleshooting

### "Circuit files not found"

```bash
# Compile and copy circuit files
cd circuits
npm install
npm run compile
npm run setup
cd ..
mkdir -p public/circuits
cp circuits/build/withdraw_js/withdraw.wasm public/circuits/
cp circuits/build/withdraw_final.zkey public/circuits/
```

### "Insufficient balance"

```bash
# Get devnet SOL
solana airdrop 2

# Or use web faucet: https://faucet.solana.com
```

### "Program deployment failed"

```bash
# Check balance
solana balance

# Check program size (max 10MB)
ls -la programs/target/deploy/*.so

# Try deploying with more compute budget
anchor deploy --provider.cluster devnet -- --with-compute-unit-price 1000
```

### "Invalid proof"

1. Ensure circuit files match the deployed verifier
2. Check that Merkle tree depth matches (20 levels)
3. Verify nullifier hasn't been used

### "Relayer connection refused"

```bash
# Check relayer is running
curl http://localhost:3001/health

# Check logs
cd relayer && npm run dev
```

---

## Commands Reference

```bash
# Development
npm run dev          # Start Next.js dev server
npm run build        # Build for production
npm run start        # Start production server

# Circuits
cd circuits
npm run compile      # Compile Circom to WASM
npm run setup        # Run trusted setup
npm run prove        # Generate proof (CLI)

# Programs
cd programs
anchor build         # Build Rust programs
anchor test          # Run tests
anchor deploy        # Deploy to configured cluster

# Relayer
cd relayer
npm run dev          # Start with hot reload
npm run build        # Build TypeScript
npm run start        # Start production
```

---

## Support

- GitHub Issues: https://github.com/millw14/vello/issues
- Documentation: This file
- Discord: [Coming soon]

---

**⚠️ DISCLAIMER**: This is experimental software. Use at your own risk. Always audit code before deploying to mainnet.
