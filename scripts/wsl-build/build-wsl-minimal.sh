#!/bin/bash
set -e

cd ~

echo "=== Cleaning up ==="
rm -rf ~/velo_build
mkdir -p ~/velo_build
cd ~/velo_build

echo "=== Creating minimal velo_mixer ==="
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
anchor-lang = "0.29.0"
EOF

cat > programs/velo_mixer/src/lib.rs << 'EOF'
use anchor_lang::prelude::*;

declare_id!("GKNcUmNacSJo4S2Kq3DuYRYRGw3sNUfJ4tyqd198t6vQ");

#[program]
pub mod velo_mixer {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, merkle_depth: u8) -> Result<()> {
        let pool = &mut ctx.accounts.mixer_pool;
        pool.authority = ctx.accounts.authority.key();
        pool.merkle_depth = merkle_depth;
        pool.next_index = 0;
        pool.deposit_amount = 1_000_000_000;
        msg!("Mixer pool initialized");
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, commitment: [u8; 32]) -> Result<()> {
        let pool = &mut ctx.accounts.mixer_pool;
        
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.pool_vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, pool.deposit_amount)?;
        
        pool.next_index += 1;
        emit!(DepositEvent { commitment, leaf_index: pool.next_index - 1 });
        
        msg!("Deposit #{}", pool.next_index - 1);
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, nullifier_hash: [u8; 32], _root: [u8; 32]) -> Result<()> {
        let pool = &mut ctx.accounts.mixer_pool;
        
        // Transfer SOL from vault to recipient
        **ctx.accounts.pool_vault.to_account_info().try_borrow_mut_lamports()? -= pool.deposit_amount;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += pool.deposit_amount;
        
        emit!(WithdrawEvent { nullifier_hash, recipient: ctx.accounts.recipient.key() });
        
        msg!("Withdrawal complete");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 1 + 4 + 8, seeds = [b"mixer"], bump)]
    pub mixer_pool: Account<'info, MixerPool>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"mixer"], bump)]
    pub mixer_pool: Account<'info, MixerPool>,
    /// CHECK: vault
    #[account(mut, seeds = [b"vault"], bump)]
    pub pool_vault: AccountInfo<'info>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"mixer"], bump)]
    pub mixer_pool: Account<'info, MixerPool>,
    /// CHECK: vault
    #[account(mut, seeds = [b"vault"], bump)]
    pub pool_vault: AccountInfo<'info>,
    /// CHECK: recipient
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
}

#[account]
pub struct MixerPool {
    pub authority: Pubkey,
    pub merkle_depth: u8,
    pub next_index: u32,
    pub deposit_amount: u64,
}

#[event]
pub struct DepositEvent {
    pub commitment: [u8; 32],
    pub leaf_index: u32,
}

#[event]
pub struct WithdrawEvent {
    pub nullifier_hash: [u8; 32],
    pub recipient: Pubkey,
}
EOF

echo "=== Creating workspace Cargo.toml ==="
cat > Cargo.toml << 'EOF'
[workspace]
members = ["programs/velo_mixer"]
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
velo_mixer = "GKNcUmNacSJo4S2Kq3DuYRYRGw3sNUfJ4tyqd198t6vQ"

[programs.devnet]
velo_mixer = "GKNcUmNacSJo4S2Kq3DuYRYRGw3sNUfJ4tyqd198t6vQ"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"
EOF

echo "=== Clearing cargo cache ==="
rm -rf ~/.cargo/registry/cache/*/constant_time_eq*
rm -rf ~/.cargo/registry/src/*/constant_time_eq*

echo "=== Generating lockfile ==="
cargo generate-lockfile
sed -i 's/version = 4/version = 3/' Cargo.lock

echo "=== Checking deps ==="
if grep -q "constant_time_eq" Cargo.lock; then
  echo "Found constant_time_eq:"
  grep -A1 "constant_time_eq" Cargo.lock
else
  echo "No constant_time_eq - good!"
fi

echo "=== Building ==="
anchor build

echo "=== Done! ==="
ls -la target/deploy/
