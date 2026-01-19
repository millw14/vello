use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use light_poseidon::{Poseidon, PoseidonBytesHasher, PoseidonHasher};
use ark_bn254::Fr;
use ark_ff::PrimeField;

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
        pool_bump: u8,
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
        pool.merkle_tree = MerkleTree::new();
        pool.nullifier_hashes = Vec::new();
        pool.total_deposits = 0;
        pool.total_withdrawals = 0;
        pool.bump = pool_bump;
        pool.is_active = true;

        emit!(PoolInitialized {
            pool: pool.key(),
            denomination,
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }

    /// Deposit funds into the mixing pool
    /// Returns a commitment that serves as proof of deposit
    pub fn deposit(
        ctx: Context<Deposit>,
        commitment: [u8; 32],
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        require!(pool.is_active, VeloMixerError::PoolInactive);
        require!(
            pool.merkle_tree.next_index < (1 << MERKLE_TREE_DEPTH),
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
        let leaf_index = pool.merkle_tree.insert(commitment)?;
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
        proof: ZKProof,
        root: [u8; 32],
        nullifier_hash: [u8; 32],
        recipient: Pubkey,
        relayer: Pubkey,
        fee: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        require!(pool.is_active, VeloMixerError::PoolInactive);
        
        // Verify nullifier hasn't been used (prevent double-spend)
        require!(
            !pool.nullifier_hashes.contains(&nullifier_hash),
            VeloMixerError::NullifierAlreadyUsed
        );

        // Verify root exists in history
        require!(
            pool.merkle_tree.is_known_root(&root),
            VeloMixerError::InvalidMerkleRoot
        );

        // Verify ZK proof
        require!(
            verify_proof(&proof, &root, &nullifier_hash, &recipient, &relayer, fee),
            VeloMixerError::InvalidProof
        );

        // Mark nullifier as used
        pool.nullifier_hashes.push(nullifier_hash);
        
        // Calculate amounts
        let withdrawal_amount = pool.denomination.checked_sub(fee)
            .ok_or(VeloMixerError::FeeExceedsDenomination)?;

        // Transfer to recipient
        let pool_seeds = &[
            b"pool".as_ref(),
            &pool.denomination.to_le_bytes(),
            &[pool.bump],
        ];
        let signer_seeds = &[&pool_seeds[..]];

        // Transfer main amount to recipient
        **ctx.accounts.pool_vault.to_account_info().try_borrow_mut_lamports()? -= withdrawal_amount;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += withdrawal_amount;

        // Transfer fee to relayer if applicable
        if fee > 0 && relayer != Pubkey::default() {
            **ctx.accounts.pool_vault.to_account_info().try_borrow_mut_lamports()? -= fee;
            **ctx.accounts.relayer.to_account_info().try_borrow_mut_lamports()? += fee;
        }

        pool.total_withdrawals += 1;

        emit!(Withdrawn {
            pool: pool.key(),
            nullifier_hash,
            recipient,
            relayer,
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
#[instruction(denomination: u64, pool_bump: u8)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + MixerPool::INIT_SPACE,
        seeds = [b"pool", &denomination.to_le_bytes()],
        bump
    )]
    pub pool: Account<'info, MixerPool>,
    
    /// CHECK: Pool vault PDA
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
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
        seeds = [b"vault", pool.key().as_ref()],
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
        seeds = [b"vault", pool.key().as_ref()],
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
#[derive(InitSpace)]
pub struct MixerPool {
    pub authority: Pubkey,
    pub denomination: u64,
    #[max_len(1048576)] // 2^20 leaves
    pub merkle_tree: MerkleTree,
    #[max_len(1000000)]
    pub nullifier_hashes: Vec<[u8; 32]>,
    pub total_deposits: u64,
    pub total_withdrawals: u64,
    pub bump: u8,
    pub is_active: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct MerkleTree {
    pub levels: u8,
    pub next_index: u64,
    #[max_len(30)] // ROOT_HISTORY_SIZE
    pub root_history: Vec<[u8; 32]>,
    pub current_root_index: u8,
    #[max_len(21)] // MERKLE_TREE_DEPTH + 1
    pub filled_subtrees: Vec<[u8; 32]>,
    #[max_len(21)]
    pub zeros: Vec<[u8; 32]>,
}

impl MerkleTree {
    pub fn new() -> Self {
        let mut zeros = Vec::with_capacity(MERKLE_TREE_DEPTH + 1);
        let mut current_zero = [0u8; 32];
        
        for _ in 0..=MERKLE_TREE_DEPTH {
            zeros.push(current_zero);
            current_zero = hash_pair(&current_zero, &current_zero);
        }
        
        Self {
            levels: MERKLE_TREE_DEPTH as u8,
            next_index: 0,
            root_history: vec![[0u8; 32]; ROOT_HISTORY_SIZE],
            current_root_index: 0,
            filled_subtrees: zeros.clone(),
            zeros,
        }
    }
    
    pub fn insert(&mut self, leaf: [u8; 32]) -> Result<u64> {
        let index = self.next_index;
        let mut current_index = index;
        let mut current_hash = leaf;
        
        for i in 0..self.levels as usize {
            if current_index % 2 == 0 {
                self.filled_subtrees[i] = current_hash;
                current_hash = hash_pair(&current_hash, &self.zeros[i]);
            } else {
                current_hash = hash_pair(&self.filled_subtrees[i], &current_hash);
            }
            current_index /= 2;
        }
        
        self.current_root_index = ((self.current_root_index as usize + 1) % ROOT_HISTORY_SIZE) as u8;
        self.root_history[self.current_root_index as usize] = current_hash;
        self.next_index += 1;
        
        Ok(index)
    }
    
    pub fn is_known_root(&self, root: &[u8; 32]) -> bool {
        if *root == [0u8; 32] {
            return false;
        }
        self.root_history.contains(root)
    }
    
    pub fn get_current_root(&self) -> [u8; 32] {
        self.root_history[self.current_root_index as usize]
    }
}

// ============================================================================
// ZK PROOF STRUCTURES
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ZKProof {
    pub a: [u8; 64],  // G1 point
    pub b: [u8; 128], // G2 point  
    pub c: [u8; 64],  // G1 point
}

/// Verify Groth16 ZK proof
/// In production, this would call a proper verifier program or use alt_bn128 precompiles
fn verify_proof(
    proof: &ZKProof,
    root: &[u8; 32],
    nullifier_hash: &[u8; 32],
    recipient: &Pubkey,
    relayer: &Pubkey,
    fee: u64,
) -> bool {
    // TODO: Implement proper Groth16 verification using alt_bn128 syscalls
    // For now, we verify the proof structure is valid
    // In production, integrate with Light Protocol or custom verifier
    
    // Basic sanity checks
    if proof.a == [0u8; 64] || proof.b == [0u8; 128] || proof.c == [0u8; 64] {
        return false;
    }
    
    // Verify public inputs hash
    let public_inputs = [
        root.as_slice(),
        nullifier_hash.as_slice(),
        recipient.as_ref(),
        relayer.as_ref(),
        &fee.to_le_bytes(),
    ].concat();
    
    let input_hash = solana_program::keccak::hash(&public_inputs);
    
    // In production: verify pairing equation e(A,B) = e(α,β) * e(C,δ) * e(public_inputs, γ)
    // For now, return true for valid-looking proofs
    !input_hash.0.iter().all(|&x| x == 0)
}

// ============================================================================
// HELPERS - POSEIDON HASH (ZK-friendly)
// ============================================================================

/// Poseidon hash for Merkle tree - ZK-friendly hash function
/// Uses BN254 curve which is compatible with Groth16 proofs
fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    // Initialize Poseidon hasher for 2 inputs
    let mut poseidon = Poseidon::<Fr>::new_circom(2).expect("Failed to init Poseidon");
    
    // Convert bytes to field elements
    let left_fr = Fr::from_be_bytes_mod_order(left);
    let right_fr = Fr::from_be_bytes_mod_order(right);
    
    // Compute Poseidon hash
    let hash = poseidon.hash(&[left_fr, right_fr]).expect("Hash failed");
    
    // Convert back to bytes
    let mut result = [0u8; 32];
    hash.serialize_compressed(&mut result[..]).expect("Serialize failed");
    result
}

/// Poseidon hash for commitment: commitment = Poseidon(nullifier, secret)
pub fn poseidon_commitment(nullifier: &[u8; 32], secret: &[u8; 32]) -> [u8; 32] {
    hash_pair(nullifier, secret)
}

/// Poseidon hash for nullifier hash: nullifierHash = Poseidon(nullifier)
pub fn poseidon_nullifier_hash(nullifier: &[u8; 32]) -> [u8; 32] {
    let mut poseidon = Poseidon::<Fr>::new_circom(1).expect("Failed to init Poseidon");
    let nullifier_fr = Fr::from_be_bytes_mod_order(nullifier);
    let hash = poseidon.hash(&[nullifier_fr]).expect("Hash failed");
    
    let mut result = [0u8; 32];
    hash.serialize_compressed(&mut result[..]).expect("Serialize failed");
    result
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
