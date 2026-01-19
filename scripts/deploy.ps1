# Velo Program Deployment Script (PowerShell)
# Run this from the project root: .\scripts\deploy.ps1

param(
    [string]$Cluster = "devnet"
)

Write-Host "🚀 Velo Deployment Script" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan

# Check if Solana CLI is installed
try {
    $null = Get-Command solana -ErrorAction Stop
} catch {
    Write-Host "❌ Solana CLI not found. Please install it first:" -ForegroundColor Red
    Write-Host "   Visit: https://docs.solana.com/cli/install-solana-cli-tools" -ForegroundColor Yellow
    exit 1
}

# Check if Anchor is installed
try {
    $null = Get-Command anchor -ErrorAction Stop
} catch {
    Write-Host "❌ Anchor not found. Please install it first:" -ForegroundColor Red
    Write-Host "   cargo install --git https://github.com/coral-xyz/anchor avm --locked" -ForegroundColor Yellow
    Write-Host "   avm install latest" -ForegroundColor Yellow
    Write-Host "   avm use latest" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "📡 Target cluster: $Cluster" -ForegroundColor Green

# Configure Solana CLI
Write-Host ""
Write-Host "⚙️  Configuring Solana CLI..." -ForegroundColor Yellow
solana config set --url $Cluster

# Check wallet balance
$balance = (solana balance) -replace ' SOL', ''
Write-Host "💰 Wallet balance: $balance SOL" -ForegroundColor Green

if ([decimal]$balance -lt 2) {
    Write-Host "⚠️  Low balance! You need at least 2 SOL for deployment." -ForegroundColor Yellow
    Write-Host "   Run: solana airdrop 2 (for devnet)" -ForegroundColor Yellow
    exit 1
}

# Build programs
Write-Host ""
Write-Host "🔨 Building Anchor programs..." -ForegroundColor Yellow
Set-Location programs
anchor build

# Generate program keypairs if they don't exist
Write-Host ""
Write-Host "🔑 Checking program keypairs..." -ForegroundColor Yellow

$programs = @("velo_mixer", "velo_private_tx", "velo_subscription", "velo_stealth")
$programIds = @{}

foreach ($program in $programs) {
    $keypair = "target/deploy/$program-keypair.json"
    
    if (-not (Test-Path $keypair)) {
        Write-Host "   Generating keypair for $program..." -ForegroundColor Gray
        solana-keygen new -o $keypair --no-bip39-passphrase --force
    }
    
    $programId = solana-keygen pubkey $keypair
    $programIds[$program] = $programId
    Write-Host "   $program : $programId" -ForegroundColor Cyan
}

# Deploy programs
Write-Host ""
Write-Host "📦 Deploying programs to $Cluster..." -ForegroundColor Yellow

foreach ($program in $programs) {
    Write-Host "   Deploying $program..." -ForegroundColor Gray
    anchor deploy --program-name $program --provider.cluster $Cluster
}

# Display results
Write-Host ""
Write-Host "✅ Deployment complete! Program IDs:" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Green

foreach ($program in $programs) {
    $keypair = "target/deploy/$program-keypair.json"
    $programId = solana-keygen pubkey $keypair
    Write-Host "$program : $programId" -ForegroundColor Cyan
}

# Generate TypeScript config update
Write-Host ""
Write-Host "📝 TypeScript config to update (src/lib/solana/programs/index.ts):" -ForegroundColor Yellow
Write-Host ""
Write-Host "export const PROGRAM_IDS = {" -ForegroundColor White
foreach ($program in $programs) {
    $keypair = "target/deploy/$program-keypair.json"
    $programId = solana-keygen pubkey $keypair
    $shortName = $program -replace "velo_", ""
    Write-Host "  $shortName: new PublicKey('$programId')," -ForegroundColor White
}
Write-Host "};" -ForegroundColor White

Write-Host ""
Write-Host "📝 Next steps:" -ForegroundColor Yellow
Write-Host "1. Copy the program IDs above" -ForegroundColor Gray
Write-Host "2. Update src/lib/solana/programs/index.ts with the new IDs" -ForegroundColor Gray
Write-Host "3. Update .env.local with any new configuration" -ForegroundColor Gray
Write-Host "4. Run 'npm run build' to verify everything works" -ForegroundColor Gray

Set-Location ..
