#!/bin/bash
set -e

# Go to home first to avoid getcwd errors
cd ~

echo "=== Cleaning up old build ==="
rm -rf ~/velo_build
mkdir -p ~/velo_build
cd ~/velo_build

echo "=== Copying programs from Windows ==="
cp -r /mnt/c/Users/1/Documents/milla\ projects/velo/programs ./

echo "=== Creating SIMPLIFIED velo_mixer without ZK deps ==="
cat > programs/velo_mixer/Cargo.toml << 'EOF'
[package]
name = "velo_mixer"
version = "0.1.0"
description = "Velo Privacy Mixer"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "velo_mixer"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []

[dependencies]
anchor-lang = "0.29.0"
anchor-spl = "0.29.0"
EOF

echo "=== Creating SIMPLIFIED velo_mixer lib.rs ==="
cat > programs/velo_mixer/src/lib.rs << 'EOF'
use anchor_lang::prelude::*;

declare_id!("VELOmxr1111111111111111111111111111111111111");

#[program]
pub mod velo_mixer {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, merkle_depth: u8) -> Result<()> {
        let pool = &mut ctx.accounts.mixer_pool;
        pool.authority = ctx.accounts.authority.key();
        pool.merkle_depth = merkle_depth;
        pool.next_index = 0;
        pool.deposit_amount = 1_000_000_000; // 1 SOL
        msg!("Mixer pool initialized");
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, commitment: [u8; 32]) -> Result<()> {
        let pool = &mut ctx.accounts.mixer_pool;
        
        // Transfer SOL to pool
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.pool_vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, pool.deposit_amount)?;
        
        // Store commitment (simplified - real version uses Merkle tree)
        pool.commitments[pool.next_index as usize] = commitment;
        pool.next_index += 1;
        
        msg!("Deposit successful, commitment stored at index {}", pool.next_index - 1);
        Ok(())
    }

    pub fn withdraw(
        ctx: Context<Withdraw>,
        nullifier_hash: [u8; 32],
        _proof: Vec<u8>,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.mixer_pool;
        
        // Check nullifier not used (simplified)
        require!(!pool.nullifiers.contains(&nullifier_hash), MixerError::NullifierAlreadyUsed);
        
        // Mark nullifier as used
        pool.nullifiers.push(nullifier_hash);
        
        // Transfer SOL to recipient
        let pool_vault = &ctx.accounts.pool_vault;
        **pool_vault.to_account_info().try_borrow_mut_lamports()? -= pool.deposit_amount;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += pool.deposit_amount;
        
        msg!("Withdrawal successful");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + MixerPool::INIT_SPACE,
        seeds = [b"mixer_pool"],
        bump
    )]
    pub mixer_pool: Account<'info, MixerPool>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"mixer_pool"], bump)]
    pub mixer_pool: Account<'info, MixerPool>,
    /// CHECK: Pool vault PDA
    #[account(mut, seeds = [b"pool_vault"], bump)]
    pub pool_vault: AccountInfo<'info>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"mixer_pool"], bump)]
    pub mixer_pool: Account<'info, MixerPool>,
    /// CHECK: Pool vault PDA
    #[account(mut, seeds = [b"pool_vault"], bump)]
    pub pool_vault: AccountInfo<'info>,
    /// CHECK: Recipient can be any account
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct MixerPool {
    pub authority: Pubkey,
    pub merkle_depth: u8,
    pub next_index: u32,
    pub deposit_amount: u64,
    #[max_len(1024)]
    pub commitments: Vec<[u8; 32]>,
    #[max_len(1024)]
    pub nullifiers: Vec<[u8; 32]>,
}

#[error_code]
pub enum MixerError {
    #[msg("Nullifier has already been used")]
    NullifierAlreadyUsed,
    #[msg("Invalid proof")]
    InvalidProof,
}
EOF

echo "=== Simplifying other programs ==="
for prog in velo_private_tx velo_subscription velo_stealth; do
  cat > programs/$prog/Cargo.toml << EOF
[package]
name = "$prog"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "$prog"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []

[dependencies]
anchor-lang = "0.29.0"
anchor-spl = "0.29.0"
EOF
done

echo "=== Creating workspace Cargo.toml ==="
cat > Cargo.toml << 'EOF'
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
EOF

echo "=== Creating Anchor.toml ==="
cat > Anchor.toml << 'EOF'
[features]
seeds = false
skip-lint = false

[programs.localnet]
velo_mixer = "VELOmxr1111111111111111111111111111111111111"
velo_private_tx = "VELOprv1111111111111111111111111111111111111"
velo_subscription = "VELOsub1111111111111111111111111111111111111"
velo_stealth = "VELOstl1111111111111111111111111111111111111"

[programs.devnet]
velo_mixer = "VELOmxr1111111111111111111111111111111111111"
velo_private_tx = "VELOprv1111111111111111111111111111111111111"
velo_subscription = "VELOsub1111111111111111111111111111111111111"
velo_stealth = "VELOstl1111111111111111111111111111111111111"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
EOF

echo "=== Generating lockfile ==="
cargo generate-lockfile
sed -i 's/version = 4/version = 3/' Cargo.lock

echo "=== Checking for problematic deps ==="
if grep -q 'constant_time_eq.*0.4' Cargo.lock; then
  echo "WARNING: constant_time_eq 0.4.x still present!"
  grep -B2 -A2 'constant_time_eq' Cargo.lock
else
  echo "SUCCESS: No constant_time_eq 0.4.x found!"
fi

echo "=== Building with anchor ==="
anchor build

echo "=== BUILD COMPLETE ==="
ls -la target/deploy/
