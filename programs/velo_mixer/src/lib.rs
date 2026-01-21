use anchor_lang::prelude::*;

declare_id!("DSQt1z5wNcmE5h2XL1K1QAWHy28iJufg52aGy3kn8pEc");

#[program]
pub mod velo_mixer {
    use super::*;

    /// Initialize a new mixer pool with a specific denomination
    pub fn initialize_pool(ctx: Context<InitializePool>, denomination: u64) -> Result<()> {
        let pool = &mut ctx.accounts.mixer_pool;
        pool.authority = ctx.accounts.authority.key();
        pool.denomination = denomination;
        pool.next_index = 0;
        pool.total_deposits = 0;
        msg!("=== VELO PRIVACY PROTOCOL ===");
        msg!("VELO_POOL_INIT: {} lamports", denomination);
        Ok(())
    }

    /// Deposit to a pool
    pub fn deposit(ctx: Context<Deposit>, commitment: [u8; 32]) -> Result<()> {
        let pool = &mut ctx.accounts.mixer_pool;
        
        // Transfer SOL from depositor to vault
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.depositor.key(),
            &ctx.accounts.pool_vault.key(),
            pool.denomination,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.depositor.to_account_info(),
                ctx.accounts.pool_vault.to_account_info(),
            ],
        )?;
        
        pool.next_index += 1;
        pool.total_deposits += 1;
        
        msg!("=== VELO PRIVACY PROTOCOL ===");
        msg!("VELO_DEPOSIT: {} lamports to privacy pool", pool.denomination);
        msg!("VELO_POOL_INDEX: #{}", pool.next_index - 1);
        Ok(())
    }

    /// Withdraw from a pool
    pub fn withdraw(ctx: Context<Withdraw>, nullifier: [u8; 32]) -> Result<()> {
        let pool = &ctx.accounts.mixer_pool;
        let denomination = pool.denomination;
        
        // Transfer from vault to recipient
        **ctx.accounts.pool_vault.try_borrow_mut_lamports()? -= denomination;
        **ctx.accounts.recipient.try_borrow_mut_lamports()? += denomination;
        
        msg!("=== VELO PRIVACY PROTOCOL ===");
        msg!("VELO_WITHDRAW: {} lamports from privacy pool", denomination);
        msg!("VELO_PRIVATE_TRANSFER: Complete");
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(denomination: u64)]
pub struct InitializePool<'info> {
    #[account(
        init, 
        payer = authority, 
        space = 8 + MixerPool::SPACE,
        seeds = [b"pool", denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub mixer_pool: Account<'info, MixerPool>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"pool", mixer_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub mixer_pool: Account<'info, MixerPool>,
    /// CHECK: PDA vault for this pool
    #[account(
        mut,
        seeds = [b"vault", mixer_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub pool_vault: AccountInfo<'info>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        seeds = [b"pool", mixer_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub mixer_pool: Account<'info, MixerPool>,
    /// CHECK: PDA vault for this pool
    #[account(
        mut,
        seeds = [b"vault", mixer_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub pool_vault: AccountInfo<'info>,
    /// CHECK: any recipient
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
}

#[account]
pub struct MixerPool {
    pub authority: Pubkey,      // 32 bytes
    pub denomination: u64,       // 8 bytes
    pub next_index: u32,         // 4 bytes
    pub total_deposits: u64,     // 8 bytes
}

impl MixerPool {
    pub const SPACE: usize = 32 + 8 + 4 + 8;
}
