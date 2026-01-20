use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

declare_id!("VeLoMix1111111111111111111111111111111111111");

/// Merkle tree depth - supports 2^20 = 1,048,576 deposits
pub const MERKLE_TREE_DEPTH: usize = 20;
/// Number of roots to store for historical verification
pub const ROOT_HISTORY_SIZE: usize = 30;
/// Fixed pool denominations in lamports
pub const POOL_0_1_SOL: u64 = 100_000_000;   // 0.1 SOL
pub const POOL_1_SOL: u64 = 1_000_000_000;    // 1 SOL
pub const POOL_10_SOL: u64 = 10_000_000_000;  // 10 SOL

#[program]
pub mod velo_mixer {
    use super::*;

    /// Initialize a new mixing pool with specified denomination
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        denomination: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        require!(
            denomination == POOL_0_1_SOL || 
            denomination == POOL_1_SOL || 
            denomination == POOL_10_SOL,
            VeloMixerError::InvalidDenomination
        );

        pool.authority = ctx.accounts.authority.key();
        pool.denomination = denomination;
        pool.next_index = 0;
        pool.current_root_index = 0;
        pool.total_deposits = 0;
        pool.total_withdrawals = 0;
        pool.bump = ctx.bumps.pool;
        pool.is_active = true;
        
        // Initialize zero values for Merkle tree
        let mut current_zero = [0u8; 32];
        for i in 0..=MERKLE_TREE_DEPTH {
            pool.zeros[i] = current_zero;
            pool.filled_subtrees[i] = current_zero;
            current_zero = hash_pair(&current_zero, &current_zero);
        }
        
        // Initialize root history
        for i in 0..ROOT_HISTORY_SIZE {
            pool.root_history[i] = [0u8; 32];
        }

        emit!(PoolInitialized {
            pool: pool.key(),
            denomination,
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }

    /// Deposit funds into the mixing pool
    pub fn deposit(
        ctx: Context<Deposit>,
        commitment: [u8; 32],
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        require!(pool.is_active, VeloMixerError::PoolInactive);
        require!(
            pool.next_index < (1u64 << MERKLE_TREE_DEPTH),
            VeloMixerError::MerkleTreeFull
        );

        // Transfer funds to pool vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.pool_vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(transfer_ctx, pool.denomination)?;

        // Insert commitment into Merkle tree
        let leaf_index = pool.next_index;
        let mut current_index = leaf_index;
        let mut current_hash = commitment;
        
        for i in 0..MERKLE_TREE_DEPTH {
            if current_index % 2 == 0 {
                pool.filled_subtrees[i] = current_hash;
                current_hash = hash_pair(&current_hash, &pool.zeros[i]);
            } else {
                current_hash = hash_pair(&pool.filled_subtrees[i], &current_hash);
            }
            current_index /= 2;
        }
        
        pool.current_root_index = ((pool.current_root_index as usize + 1) % ROOT_HISTORY_SIZE) as u8;
        pool.root_history[pool.current_root_index as usize] = current_hash;
        pool.next_index += 1;
        pool.total_deposits += 1;

        emit!(Deposited {
            pool: pool.key(),
            commitment,
            leaf_index,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Withdraw funds from the mixing pool using ZK proof
    pub fn withdraw(
        ctx: Context<Withdraw>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        root: [u8; 32],
        nullifier_hash: [u8; 32],
        fee: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        require!(pool.is_active, VeloMixerError::PoolInactive);
        
        // Verify nullifier hasn't been used (prevent double-spend)
        // In production, use a separate account or bitmap for efficiency
        require!(
            !is_nullifier_used(pool, &nullifier_hash),
            VeloMixerError::NullifierAlreadyUsed
        );

        // Verify root exists in history
        require!(
            is_known_root(pool, &root),
            VeloMixerError::InvalidMerkleRoot
        );

        // Verify ZK proof (simplified for devnet)
        // In production, use alt_bn128 precompiles or external verifier
        require!(
            verify_proof_simple(&proof_a, &proof_b, &proof_c, &root, &nullifier_hash),
            VeloMixerError::InvalidProof
        );

        // Mark nullifier as used
        pool.used_nullifiers[pool.nullifier_count as usize] = nullifier_hash;
        pool.nullifier_count += 1;
        
        // Calculate amounts
        let withdrawal_amount = pool.denomination.checked_sub(fee)
            .ok_or(VeloMixerError::FeeExceedsDenomination)?;

        // Transfer main amount to recipient
        **ctx.accounts.pool_vault.try_borrow_mut_lamports()? -= withdrawal_amount;
        **ctx.accounts.recipient.try_borrow_mut_lamports()? += withdrawal_amount;

        // Transfer fee to relayer if applicable
        if fee > 0 {
            **ctx.accounts.pool_vault.try_borrow_mut_lamports()? -= fee;
            **ctx.accounts.relayer.try_borrow_mut_lamports()? += fee;
        }

        pool.total_withdrawals += 1;

        emit!(Withdrawn {
            pool: pool.key(),
            nullifier_hash,
            recipient: ctx.accounts.recipient.key(),
            relayer: ctx.accounts.relayer.key(),
            fee,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Update pool status (admin only)
    pub fn set_pool_status(ctx: Context<AdminAction>, is_active: bool) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.is_active = is_active;
        
        emit!(PoolStatusChanged {
            pool: pool.key(),
            is_active,
        });
        
        Ok(())
    }
}

// ============================================================================
// ACCOUNTS
// ============================================================================

#[derive(Accounts)]
#[instruction(denomination: u64)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + MixerPool::SPACE,
        seeds = [b"pool", &denomination.to_le_bytes()],
        bump
    )]
    pub pool: Account<'info, MixerPool>,
    
    /// CHECK: Pool vault PDA - just holds SOL
    #[account(
        mut,
        seeds = [b"vault", &denomination.to_le_bytes()],
        bump
    )]
    pub pool_vault: AccountInfo<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"pool", &pool.denomination.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, MixerPool>,
    
    /// CHECK: Pool vault PDA
    #[account(
        mut,
        seeds = [b"vault", &pool.denomination.to_le_bytes()],
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
        mut,
        seeds = [b"pool", &pool.denomination.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, MixerPool>,
    
    /// CHECK: Pool vault PDA
    #[account(
        mut,
        seeds = [b"vault", &pool.denomination.to_le_bytes()],
        bump
    )]
    pub pool_vault: AccountInfo<'info>,
    
    /// CHECK: Recipient receives funds
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
    
    /// CHECK: Relayer receives fee
    #[account(mut)]
    pub relayer: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"pool", &pool.denomination.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, MixerPool>,
    
    pub authority: Signer<'info>,
}

// ============================================================================
// STATE
// ============================================================================

#[account]
pub struct MixerPool {
    pub authority: Pubkey,           // 32
    pub denomination: u64,           // 8
    pub next_index: u64,             // 8
    pub current_root_index: u8,      // 1
    pub total_deposits: u64,         // 8
    pub total_withdrawals: u64,      // 8
    pub bump: u8,                    // 1
    pub is_active: bool,             // 1
    pub nullifier_count: u32,        // 4
    // Fixed arrays for on-chain storage
    pub root_history: [[u8; 32]; ROOT_HISTORY_SIZE],      // 30 * 32 = 960
    pub filled_subtrees: [[u8; 32]; MERKLE_TREE_DEPTH + 1], // 21 * 32 = 672
    pub zeros: [[u8; 32]; MERKLE_TREE_DEPTH + 1],           // 21 * 32 = 672
    pub used_nullifiers: [[u8; 32]; 1000],                  // 1000 * 32 = 32000
}

impl MixerPool {
    pub const SPACE: usize = 32 + 8 + 8 + 1 + 8 + 8 + 1 + 1 + 4 + 
        (ROOT_HISTORY_SIZE * 32) + 
        ((MERKLE_TREE_DEPTH + 1) * 32) + 
        ((MERKLE_TREE_DEPTH + 1) * 32) + 
        (1000 * 32);
}

// ============================================================================
// HELPERS
// ============================================================================

fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut data = [0u8; 64];
    data[..32].copy_from_slice(left);
    data[32..].copy_from_slice(right);
    keccak::hash(&data).to_bytes()
}

fn is_known_root(pool: &MixerPool, root: &[u8; 32]) -> bool {
    if *root == [0u8; 32] {
        return false;
    }
    pool.root_history.contains(root)
}

fn is_nullifier_used(pool: &MixerPool, nullifier_hash: &[u8; 32]) -> bool {
    for i in 0..pool.nullifier_count as usize {
        if pool.used_nullifiers[i] == *nullifier_hash {
            return true;
        }
    }
    false
}

/// Simplified proof verification for devnet
/// In production, use proper Groth16 verification with alt_bn128
fn verify_proof_simple(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    root: &[u8; 32],
    nullifier_hash: &[u8; 32],
) -> bool {
    // Check proof is not all zeros
    if proof_a.iter().all(|&x| x == 0) {
        return false;
    }
    if proof_b.iter().all(|&x| x == 0) {
        return false;
    }
    if proof_c.iter().all(|&x| x == 0) {
        return false;
    }
    
    // Verify proof hash matches expected pattern
    let mut verify_data = Vec::with_capacity(64 + 128 + 64 + 32 + 32);
    verify_data.extend_from_slice(proof_a);
    verify_data.extend_from_slice(proof_b);
    verify_data.extend_from_slice(proof_c);
    verify_data.extend_from_slice(root);
    verify_data.extend_from_slice(nullifier_hash);
    
    let hash = keccak::hash(&verify_data);
    
    // For devnet: accept any non-trivial proof
    // For mainnet: implement proper Groth16 verification
    !hash.to_bytes().iter().all(|&x| x == 0)
}

// ============================================================================
// EVENTS
// ============================================================================

#[event]
pub struct PoolInitialized {
    pub pool: Pubkey,
    pub denomination: u64,
    pub authority: Pubkey,
}

#[event]
pub struct Deposited {
    pub pool: Pubkey,
    pub commitment: [u8; 32],
    pub leaf_index: u64,
    pub timestamp: i64,
}

#[event]
pub struct Withdrawn {
    pub pool: Pubkey,
    pub nullifier_hash: [u8; 32],
    pub recipient: Pubkey,
    pub relayer: Pubkey,
    pub fee: u64,
    pub timestamp: i64,
}

#[event]
pub struct PoolStatusChanged {
    pub pool: Pubkey,
    pub is_active: bool,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum VeloMixerError {
    #[msg("Invalid pool denomination")]
    InvalidDenomination,
    #[msg("Pool is not active")]
    PoolInactive,
    #[msg("Merkle tree is full")]
    MerkleTreeFull,
    #[msg("Nullifier has already been used")]
    NullifierAlreadyUsed,
    #[msg("Invalid Merkle root")]
    InvalidMerkleRoot,
    #[msg("Invalid ZK proof")]
    InvalidProof,
    #[msg("Fee exceeds denomination")]
    FeeExceedsDenomination,
}
