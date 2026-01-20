# Velo Build and Deploy Script
# Run this script as Administrator!

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  VELO - Build & Deploy to Devnet" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as administrator'" -ForegroundColor Yellow
    exit 1
}

Write-Host "Running as Administrator" -ForegroundColor Green
Write-Host ""

# Navigate to programs directory
Set-Location "c:\Users\1\Documents\milla projects\velo\programs"

# Ensure we're on devnet
Write-Host "Step 1: Configuring Solana for devnet..." -ForegroundColor Yellow
solana config set --url devnet

# Build programs
Write-Host ""
Write-Host "Step 2: Building Anchor programs..." -ForegroundColor Yellow
anchor build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed! Check errors above." -ForegroundColor Red
    exit 1
}

Write-Host "Build successful!" -ForegroundColor Green

# Check wallet balance
Write-Host ""
Write-Host "Step 3: Checking wallet balance..." -ForegroundColor Yellow
$balance = solana balance
Write-Host "Current balance: $balance"

# Request airdrop if needed
if ([double]($balance -replace " SOL", "") -lt 2) {
    Write-Host "Requesting airdrop..." -ForegroundColor Yellow
    solana airdrop 2
    Start-Sleep -Seconds 5
}

# Deploy programs
Write-Host ""
Write-Host "Step 4: Deploying to devnet..." -ForegroundColor Yellow
anchor deploy

if ($LASTEXITCODE -ne 0) {
    Write-Host "Deploy failed! You may need more SOL for deployment." -ForegroundColor Red
    Write-Host "Try: solana airdrop 2" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green  
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Program IDs have been saved to Anchor.toml"
Write-Host "Check target/deploy/ for the deployed program files"
Write-Host ""
