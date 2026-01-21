#!/bin/bash
set -e

cd ~

echo "=== Cleaning up ==="
rm -rf ~/velo_build ~/.cargo/registry/cache/* ~/.cargo/registry/src/*
mkdir -p ~/velo_build
cd ~/velo_build

echo "=== Creating minimal mixer with anchor 0.28.0 ==="
mkdir -p programs/velo_mixer/src

cat > programs/velo_mixer/Cargo.toml << 'EOF'
[package]
name = "velo_mixer"
version = "0.1.0"
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
anchor-lang = "0.28.0"
EOF

cat > programs/velo_mixer/src/lib.rs << 'EOF'
use anchor_lang::prelude::*;

declare_id!("GKNcUmNacSJo4S2Kq3DuYRYRGw3sNUfJ4tyqd198t6vQ");

#[program]
pub mod velo_mixer {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, deposit_amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.mixer_pool;
        pool.authority = ctx.accounts.authority.key();
        pool.next_index = 0;
        pool.deposit_amount = deposit_amount;
        msg!("Mixer initialized with deposit: {}", deposit_amount);
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, commitment: [u8; 32]) -> Result<()> {
        let pool = &mut ctx.accounts.mixer_pool;
        
        // Transfer SOL
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.depositor.key(),
            &ctx.accounts.pool_vault.key(),
            pool.deposit_amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.depositor.to_account_info(),
                ctx.accounts.pool_vault.to_account_info(),
            ],
        )?;
        
        pool.next_index += 1;
        msg!("Deposit #{}: {:?}", pool.next_index - 1, commitment);
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, nullifier: [u8; 32]) -> Result<()> {
        let pool = &ctx.accounts.mixer_pool;
        
        // Transfer from vault to recipient
        **ctx.accounts.pool_vault.try_borrow_mut_lamports()? -= pool.deposit_amount;
        **ctx.accounts.recipient.try_borrow_mut_lamports()? += pool.deposit_amount;
        
        msg!("Withdraw to {}: nullifier {:?}", ctx.accounts.recipient.key(), nullifier);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 4 + 8, seeds = [b"mixer"], bump)]
    pub mixer_pool: Account<'info, MixerPool>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"mixer"], bump)]
    pub mixer_pool: Account<'info, MixerPool>,
    /// CHECK: PDA vault
    #[account(mut, seeds = [b"vault"], bump)]
    pub pool_vault: AccountInfo<'info>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(seeds = [b"mixer"], bump)]
    pub mixer_pool: Account<'info, MixerPool>,
    /// CHECK: PDA vault
    #[account(mut, seeds = [b"vault"], bump)]
    pub pool_vault: AccountInfo<'info>,
    /// CHECK: any recipient
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
}

#[account]
pub struct MixerPool {
    pub authority: Pubkey,
    pub next_index: u32,
    pub deposit_amount: u64,
}
EOF

cat > Cargo.toml << 'EOF'
[workspace]
members = ["programs/velo_mixer"]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
EOF

cat > Anchor.toml << 'EOF'
[features]
seeds = false
skip-lint = false

[programs.localnet]
velo_mixer = "GKNcUmNacSJo4S2Kq3DuYRYRGw3sNUfJ4tyqd198t6vQ"

[programs.devnet]
velo_mixer = "GKNcUmNacSJo4S2Kq3DuYRYRGw3sNUfJ4tyqd198t6vQ"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"
EOF

echo "=== Generating lockfile ==="
cargo generate-lockfile
sed -i 's/version = 4/version = 3/' Cargo.lock

echo "=== Checking for constant_time_eq ==="
grep "constant_time_eq" Cargo.lock || echo "Not found - good!"

echo "=== Building ==="
anchor build

echo "=== SUCCESS ==="
ls -la target/deploy/
