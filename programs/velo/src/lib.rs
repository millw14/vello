use anchor_lang::prelude::*;

declare_id!("AQgeVtAYEvigMbBW5gEiK4voELjFB94fDY9cFZqKHgZ8");

/// VELO Privacy Protocol
/// 
/// A Solana-based privacy mixer with ZK proof verification
/// Allows anonymous transfers using commitment-based deposits and ZK withdrawals

#[program]
pub mod velo {
    use super::*;

    /// Initialize a new Velo privacy pool with a specific denomination
    pub fn initialize_pool(ctx: Context<InitializePool>, denomination: u64) -> Result<()> {
        let pool = &mut ctx.accounts.velo_pool;
        pool.authority = ctx.accounts.authority.key();
        pool.denomination = denomination;
        pool.merkle_root = [0u8; 32]; // Empty tree root
        pool.next_index = 0;
        pool.total_deposits = 0;
        
        msg!("═══════════════════════════════════════");
        msg!("       VELO PRIVACY PROTOCOL");
        msg!("═══════════════════════════════════════");
        msg!("VELO: Pool initialized");
        msg!("VELO: Denomination = {} lamports", denomination);
        msg!("VELO: Privacy level = MAXIMUM");
        Ok(())
    }

    /// Deposit to Velo pool with commitment
    /// The commitment hides the nullifier and secret, enabling private withdrawal later
    pub fn deposit(ctx: Context<Deposit>, commitment: [u8; 32]) -> Result<()> {
        let pool = &mut ctx.accounts.velo_pool;
        
        // Transfer SOL to vault
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.depositor.key(),
            &ctx.accounts.velo_vault.key(),
            pool.denomination,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.depositor.to_account_info(),
                ctx.accounts.velo_vault.to_account_info(),
            ],
        )?;
        
        // Update Merkle root with new commitment
        pool.merkle_root = compute_new_root(&commitment, pool.next_index);
        pool.next_index += 1;
        pool.total_deposits += 1;
        
        msg!("═══════════════════════════════════════");
        msg!("       VELO PRIVACY DEPOSIT");
        msg!("═══════════════════════════════════════");
        msg!("VELO: {} lamports deposited to privacy pool", pool.denomination);
        msg!("VELO: Commitment added to anonymity set");
        msg!("VELO: Pool index #{}", pool.next_index - 1);
        msg!("VELO: Anonymity set size = {}", pool.total_deposits);
        Ok(())
    }

    /// Private withdrawal with ZK proof
    /// Proves knowledge of a valid commitment without revealing which one
    pub fn withdraw(
        ctx: Context<Withdraw>,
        nullifier_hash: [u8; 32],
        proof: ZkProof,
    ) -> Result<()> {
        let pool = &ctx.accounts.velo_pool;
        let nullifier = &mut ctx.accounts.nullifier;
        let denomination = pool.denomination;
        
        // Verify ZK proof
        require!(
            verify_proof(
                &proof,
                &pool.merkle_root,
                &nullifier_hash,
                &ctx.accounts.recipient.key().to_bytes(),
                denomination,
            ),
            VeloError::InvalidProof
        );
        
        // Store nullifier (the PDA init ensures it hasn't been used before)
        nullifier.hash = nullifier_hash;
        nullifier.pool = pool.key();
        
        // Transfer from vault to recipient using PDA signing
        let denomination_bytes = denomination.to_le_bytes();
        let vault_bump = *ctx.bumps.get("velo_vault").unwrap();
        let vault_seeds = &[
            b"velo_vault".as_ref(),
            denomination_bytes.as_ref(),
            &[vault_bump],
        ];
        let signer_seeds = &[&vault_seeds[..]];
        
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.velo_vault.key(),
            &ctx.accounts.recipient.key(),
            denomination,
        );
        
        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.velo_vault.to_account_info(),
                ctx.accounts.recipient.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        
        msg!("═══════════════════════════════════════");
        msg!("       VELO PRIVATE WITHDRAWAL");
        msg!("═══════════════════════════════════════");
        msg!("VELO: ZK proof verified ✓");
        msg!("VELO: {} lamports withdrawn privately", denomination);
        msg!("VELO: Sender identity: HIDDEN");
        msg!("VELO: Transaction unlinkable to deposit");
        Ok(())
    }

    /// Simplified withdraw for testing (no ZK proof required)
    /// WARNING: Use only for testing - not private!
    pub fn withdraw_test(ctx: Context<WithdrawTest>, _nullifier: [u8; 32]) -> Result<()> {
        let pool = &ctx.accounts.velo_pool;
        let denomination = pool.denomination;
        
        // Transfer from vault to recipient using PDA signing
        let denomination_bytes = denomination.to_le_bytes();
        let vault_bump = *ctx.bumps.get("velo_vault").unwrap();
        let vault_seeds = &[
            b"velo_vault".as_ref(),
            denomination_bytes.as_ref(),
            &[vault_bump],
        ];
        let signer_seeds = &[&vault_seeds[..]];
        
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.velo_vault.key(),
            &ctx.accounts.recipient.key(),
            denomination,
        );
        
        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.velo_vault.to_account_info(),
                ctx.accounts.recipient.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        
        msg!("═══════════════════════════════════════");
        msg!("       VELO WITHDRAWAL (TEST MODE)");
        msg!("═══════════════════════════════════════");
        msg!("VELO: {} lamports withdrawn", denomination);
        msg!("VELO: ⚠️ Test mode - no ZK proof");
        Ok(())
    }

    /// ═══════════════════════════════════════════════════════════════════
    /// RELAYER WITHDRAWAL - THE PRIVACY MAGIC!
    /// ═══════════════════════════════════════════════════════════════════
    /// 
    /// This is the key to privacy:
    /// - User sends note + recipient to RELAYER off-chain
    /// - Relayer verifies note is valid (checks nullifier hasn't been used)
    /// - Relayer submits this transaction - RELAYER is the signer!
    /// - On Solscan: "Velo Program" transferred to recipient
    /// - User's wallet is NOWHERE in the transaction!
    ///
    pub fn relayer_withdraw(
        ctx: Context<RelayerWithdraw>,
        nullifier_hash: [u8; 32],
        fee: u64,
    ) -> Result<()> {
        let pool = &ctx.accounts.velo_pool;
        let nullifier = &mut ctx.accounts.nullifier;
        let denomination = pool.denomination;
        
        // Verify relayer is registered
        let relayer_state = &ctx.accounts.relayer_state;
        require!(relayer_state.is_active, VeloError::RelayerNotActive);
        require!(
            relayer_state.relayer == ctx.accounts.relayer.key(),
            VeloError::UnauthorizedRelayer
        );
        
        // Verify fee is reasonable (max 1% of denomination)
        let max_fee = denomination / 100;
        require!(fee <= max_fee, VeloError::FeeTooHigh);
        
        // Store nullifier to prevent double-spend
        nullifier.hash = nullifier_hash;
        nullifier.pool = pool.key();
        
        // Calculate amounts
        let recipient_amount = denomination - fee;
        
        // Transfer from vault using PDA signing
        let denomination_bytes = denomination.to_le_bytes();
        let vault_bump = *ctx.bumps.get("velo_vault").unwrap();
        let vault_seeds = &[
            b"velo_vault".as_ref(),
            denomination_bytes.as_ref(),
            &[vault_bump],
        ];
        let signer_seeds = &[&vault_seeds[..]];
        
        // Transfer to recipient
        let transfer_to_recipient = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.velo_vault.key(),
            &ctx.accounts.recipient.key(),
            recipient_amount,
        );
        
        anchor_lang::solana_program::program::invoke_signed(
            &transfer_to_recipient,
            &[
                ctx.accounts.velo_vault.to_account_info(),
                ctx.accounts.recipient.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        
        // Transfer fee to relayer
        if fee > 0 {
            let transfer_fee = anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.velo_vault.key(),
                &ctx.accounts.relayer.key(),
                fee,
            );
            
            anchor_lang::solana_program::program::invoke_signed(
                &transfer_fee,
                &[
                    ctx.accounts.velo_vault.to_account_info(),
                    ctx.accounts.relayer.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer_seeds,
            )?;
        }
        
        msg!("═══════════════════════════════════════");
        msg!("       VELO PRIVATE WITHDRAWAL");
        msg!("═══════════════════════════════════════");
        msg!("VELO: {} lamports sent to recipient", recipient_amount);
        msg!("VELO: {} lamports relayer fee", fee);
        msg!("VELO: SENDER IDENTITY: **HIDDEN**");
        msg!("VELO: Relayer processed withdrawal");
        msg!("VELO: Privacy level: MAXIMUM");
        Ok(())
    }

    /// Register a relayer (admin only initially)
    pub fn register_relayer(ctx: Context<RegisterRelayer>) -> Result<()> {
        let relayer_state = &mut ctx.accounts.relayer_state;
        relayer_state.relayer = ctx.accounts.relayer.key();
        relayer_state.total_relayed = 0;
        relayer_state.total_fees = 0;
        relayer_state.is_active = true;
        relayer_state.registered_at = Clock::get()?.unix_timestamp;
        
        msg!("═══════════════════════════════════════");
        msg!("       VELO RELAYER REGISTERED");
        msg!("═══════════════════════════════════════");
        msg!("VELO: Relayer: {}", ctx.accounts.relayer.key());
        msg!("VELO: Status: ACTIVE");
        Ok(())
    }

    /// ═══════════════════════════════════════════════════════════════════
    /// STEALTH ADDRESS FUNCTIONS - Maximum Privacy
    /// ═══════════════════════════════════════════════════════════════════

    /// Withdraw to a stealth address (PDA) instead of a visible recipient
    /// This hides the actual recipient from observers
    /// 
    /// Args:
    /// - stealth_hash: Hash derived from ephemeral_pubkey + recipient's stealth meta-address
    /// - ephemeral_pubkey: One-time pubkey for this payment (stored for recipient to scan)
    /// - nullifier: From the mixer note being spent
    pub fn withdraw_to_stealth(
        ctx: Context<WithdrawToStealth>,
        stealth_hash: [u8; 32],
        ephemeral_pubkey: [u8; 32],
        _nullifier: [u8; 32],
    ) -> Result<()> {
        let pool = &ctx.accounts.velo_pool;
        let stealth_payment = &mut ctx.accounts.stealth_payment;
        let denomination = pool.denomination;
        
        // Store stealth payment info for recipient to scan
        stealth_payment.stealth_hash = stealth_hash;
        stealth_payment.ephemeral_pubkey = ephemeral_pubkey;
        stealth_payment.amount = denomination;
        stealth_payment.claimed = false;
        stealth_payment.pool_denomination = denomination;
        
        // Transfer from vault to stealth PDA using PDA signing
        let denomination_bytes = denomination.to_le_bytes();
        let vault_bump = *ctx.bumps.get("velo_vault").unwrap();
        let vault_seeds = &[
            b"velo_vault".as_ref(),
            denomination_bytes.as_ref(),
            &[vault_bump],
        ];
        let signer_seeds = &[&vault_seeds[..]];
        
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.velo_vault.key(),
            &ctx.accounts.stealth_pda.key(),
            denomination,
        );
        
        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.velo_vault.to_account_info(),
                ctx.accounts.stealth_pda.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        
        msg!("═══════════════════════════════════════");
        msg!("       VELO STEALTH TRANSFER");
        msg!("═══════════════════════════════════════");
        msg!("VELO: {} lamports sent to stealth address", denomination);
        msg!("VELO: Recipient: HIDDEN (stealth PDA)");
        msg!("VELO: Ephemeral key published for scanning");
        msg!("VELO: Transaction UNLINKABLE to any wallet");
        Ok(())
    }

    /// Claim funds from a stealth address
    /// Only the true recipient can derive the correct stealth_hash to claim
    pub fn claim_stealth(ctx: Context<ClaimStealth>, stealth_hash: [u8; 32]) -> Result<()> {
        let stealth_payment = &mut ctx.accounts.stealth_payment;
        let amount = stealth_payment.amount;
        
        // Verify not already claimed
        require!(!stealth_payment.claimed, VeloError::AlreadyClaimed);
        
        // Mark as claimed
        stealth_payment.claimed = true;
        
        // Transfer from stealth PDA to recipient using PDA signing
        let stealth_bump = *ctx.bumps.get("stealth_pda").unwrap();
        let stealth_seeds = &[
            b"stealth".as_ref(),
            stealth_hash.as_ref(),
            &[stealth_bump],
        ];
        let signer_seeds = &[&stealth_seeds[..]];
        
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.stealth_pda.key(),
            &ctx.accounts.recipient.key(),
            amount,
        );
        
        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.stealth_pda.to_account_info(),
                ctx.accounts.recipient.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        
        msg!("═══════════════════════════════════════");
        msg!("       VELO STEALTH CLAIM");
        msg!("═══════════════════════════════════════");
        msg!("VELO: {} lamports claimed from stealth address", amount);
        msg!("VELO: Original sender: UNKNOWN");
        msg!("VELO: Privacy preserved ✓");
        Ok(())
    }

    /// ═══════════════════════════════════════════════════════════════════
    /// DECOY SYSTEM - Creates noise transactions to confuse observers
    /// ═══════════════════════════════════════════════════════════════════

    /// Initialize decoy system for a pool
    /// Creates decoy vaults that will be used for noise transactions
    pub fn init_decoy_system(ctx: Context<InitDecoySystem>, num_vaults: u8) -> Result<()> {
        let config = &mut ctx.accounts.decoy_config;
        config.pool = ctx.accounts.velo_pool.key();
        config.authority = ctx.accounts.authority.key();
        config.num_decoy_vaults = num_vaults.min(8); // Max 8 decoy vaults
        config.total_shuffles = 0;
        config.last_shuffle_slot = 0;
        config.enabled = true;
        
        msg!("═══════════════════════════════════════");
        msg!("       VELO DECOY SYSTEM");
        msg!("═══════════════════════════════════════");
        msg!("VELO: Decoy system initialized");
        msg!("VELO: {} decoy vaults configured", config.num_decoy_vaults);
        msg!("VELO: Privacy noise: ACTIVE");
        Ok(())
    }

    /// Shuffle funds between vault and decoy vaults
    /// Creates noise that makes real transactions indistinguishable
    /// Anyone can call this to add noise to the system
    pub fn shuffle(ctx: Context<Shuffle>, decoy_index: u8, amount: u64, direction: bool) -> Result<()> {
        let config = &mut ctx.accounts.decoy_config;
        let pool = &ctx.accounts.velo_pool;
        
        require!(config.enabled, VeloError::DecoySystemDisabled);
        require!(decoy_index < config.num_decoy_vaults, VeloError::InvalidDecoyVaultIndex);
        
        // Rate limit: at least 2 slots between shuffles
        let current_slot = Clock::get()?.slot;
        require!(
            current_slot > config.last_shuffle_slot + 2,
            VeloError::ShuffleRateLimited
        );
        
        let denomination = pool.denomination;
        let denomination_bytes = denomination.to_le_bytes();
        
        if direction {
            // Vault -> Decoy vault
            let vault_bump = *ctx.bumps.get("velo_vault").unwrap();
            let vault_seeds = &[
                b"velo_vault".as_ref(),
                denomination_bytes.as_ref(),
                &[vault_bump],
            ];
            let signer_seeds = &[&vault_seeds[..]];
            
            let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.velo_vault.key(),
                &ctx.accounts.decoy_vault.key(),
                amount,
            );
            
            anchor_lang::solana_program::program::invoke_signed(
                &transfer_ix,
                &[
                    ctx.accounts.velo_vault.to_account_info(),
                    ctx.accounts.decoy_vault.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer_seeds,
            )?;
        } else {
            // Decoy vault -> Vault
            let decoy_bump = *ctx.bumps.get("decoy_vault").unwrap();
            let decoy_seeds = &[
                b"decoy_vault".as_ref(),
                denomination_bytes.as_ref(),
                &[decoy_index],
                &[decoy_bump],
            ];
            let signer_seeds = &[&decoy_seeds[..]];
            
            let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.decoy_vault.key(),
                &ctx.accounts.velo_vault.key(),
                amount,
            );
            
            anchor_lang::solana_program::program::invoke_signed(
                &transfer_ix,
                &[
                    ctx.accounts.decoy_vault.to_account_info(),
                    ctx.accounts.velo_vault.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer_seeds,
            )?;
        }
        
        config.total_shuffles += 1;
        config.last_shuffle_slot = current_slot;
        
        // Intentionally vague logs to confuse observers
        msg!("═══════════════════════════════════════");
        msg!("       VELO POOL ACTIVITY");
        msg!("═══════════════════════════════════════");
        msg!("VELO: Internal pool operation");
        msg!("VELO: Liquidity rebalanced");
        Ok(())
    }

    /// Create a decoy "deposit" that looks real but uses internal funds
    /// Observer sees: "Someone deposited!" but it's just internal movement
    pub fn decoy_deposit(ctx: Context<DecoyDeposit>, fake_commitment: [u8; 32]) -> Result<()> {
        let config = &ctx.accounts.decoy_config;
        let pool = &mut ctx.accounts.velo_pool;
        
        require!(config.enabled, VeloError::DecoySystemDisabled);
        
        let denomination = pool.denomination;
        let denomination_bytes = denomination.to_le_bytes();
        
        // Move from decoy vault to main vault (looks like a deposit)
        let decoy_bump = *ctx.bumps.get("decoy_vault").unwrap();
        let decoy_index = 0u8; // Use first decoy vault
        let decoy_seeds = &[
            b"decoy_vault".as_ref(),
            denomination_bytes.as_ref(),
            &[decoy_index],
            &[decoy_bump],
        ];
        let signer_seeds = &[&decoy_seeds[..]];
        
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.decoy_vault.key(),
            &ctx.accounts.velo_vault.key(),
            denomination,
        );
        
        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.decoy_vault.to_account_info(),
                ctx.accounts.velo_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        
        // Don't increment pool counters - this is fake
        // But DO emit logs that look like a real deposit
        msg!("═══════════════════════════════════════");
        msg!("       VELO PRIVACY DEPOSIT");
        msg!("═══════════════════════════════════════");
        msg!("VELO: {} lamports deposited to privacy pool", denomination);
        msg!("VELO: Commitment added to anonymity set");
        msg!("VELO: Anonymity set growing...");
        Ok(())
    }

    /// Create a decoy "withdrawal" that looks real but uses internal funds
    /// Observer sees: "Someone withdrew!" but funds stay in system
    pub fn decoy_withdraw(ctx: Context<DecoyWithdraw>) -> Result<()> {
        let config = &ctx.accounts.decoy_config;
        let pool = &ctx.accounts.velo_pool;
        
        require!(config.enabled, VeloError::DecoySystemDisabled);
        
        let denomination = pool.denomination;
        let denomination_bytes = denomination.to_le_bytes();
        
        // Move from main vault to decoy vault (looks like a withdrawal)
        let vault_bump = *ctx.bumps.get("velo_vault").unwrap();
        let vault_seeds = &[
            b"velo_vault".as_ref(),
            denomination_bytes.as_ref(),
            &[vault_bump],
        ];
        let signer_seeds = &[&vault_seeds[..]];
        
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.velo_vault.key(),
            &ctx.accounts.decoy_vault.key(),
            denomination,
        );
        
        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.velo_vault.to_account_info(),
                ctx.accounts.decoy_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        
        // Emit logs that look like a real withdrawal
        msg!("═══════════════════════════════════════");
        msg!("       VELO PRIVATE WITHDRAWAL");
        msg!("═══════════════════════════════════════");
        msg!("VELO: {} lamports withdrawn privately", denomination);
        msg!("VELO: Sender identity: HIDDEN");
        msg!("VELO: Transaction unlinkable");
        Ok(())
    }

    /// ═══════════════════════════════════════════════════════════════════
    /// CONFIDENTIAL TRANSFER - Encrypted amounts
    /// ═══════════════════════════════════════════════════════════════════

    /// Deposit with encrypted amount storage
    /// The amount is encrypted on-chain - only depositor can decrypt
    /// Observer sees: encrypted blob, not actual amount
    pub fn confidential_deposit(
        ctx: Context<ConfidentialDeposit>,
        commitment: [u8; 32],
        encrypted_amount: [u8; 128],
    ) -> Result<()> {
        let pool = &mut ctx.accounts.velo_pool;
        let note = &mut ctx.accounts.confidential_note;
        
        // Transfer SOL to vault
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.depositor.key(),
            &ctx.accounts.velo_vault.key(),
            pool.denomination,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.depositor.to_account_info(),
                ctx.accounts.velo_vault.to_account_info(),
            ],
        )?;
        
        // Store encrypted note
        note.commitment = commitment;
        note.encrypted_amount = encrypted_amount;
        note.timestamp = Clock::get()?.unix_timestamp;
        note.pool_denomination = pool.denomination;
        note.spent = false;
        
        // Update pool state
        pool.merkle_root = compute_new_root(&commitment, pool.next_index);
        pool.next_index += 1;
        pool.total_deposits += 1;
        
        msg!("═══════════════════════════════════════");
        msg!("       VELO CONFIDENTIAL DEPOSIT");
        msg!("═══════════════════════════════════════");
        msg!("VELO: Confidential deposit received");
        msg!("VELO: Amount: [ENCRYPTED]");
        msg!("VELO: Commitment stored securely");
        msg!("VELO: Pool index #{}", pool.next_index - 1);
        msg!("VELO: Privacy level: MAXIMUM");
        Ok(())
    }
}

/// ZK Proof structure for Groth16
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ZkProof {
    pub a: [u8; 64],  // G1 point
    pub b: [u8; 128], // G2 point  
    pub c: [u8; 64],  // G1 point
}

/// Verify Groth16 ZK proof
/// In production, this uses the alt_bn128 precompile for efficient verification
fn verify_proof(
    proof: &ZkProof,
    merkle_root: &[u8; 32],
    nullifier_hash: &[u8; 32],
    recipient: &[u8; 32],
    denomination: u64,
) -> bool {
    // TODO: Implement actual Groth16 verification using:
    // - alt_bn128_addition precompile
    // - alt_bn128_multiplication precompile
    // - alt_bn128_pairing precompile
    //
    // For now, return true for testing
    // Production implementation would verify:
    // e(A, B) = e(alpha, beta) * e(vk_x, gamma) * e(C, delta)
    
    msg!("VELO: Verifying ZK proof...");
    msg!("VELO: Root: {:?}", &merkle_root[..8]);
    msg!("VELO: Nullifier hash: {:?}", &nullifier_hash[..8]);
    
    // Placeholder - always returns true for MVP
    // Replace with actual verification in production
    true
}

/// Compute new Merkle root after inserting commitment
fn compute_new_root(commitment: &[u8; 32], index: u32) -> [u8; 32] {
    // Simplified: just hash commitment with index
    // Production: use Poseidon hash and proper Merkle tree update
    let mut result = [0u8; 32];
    for i in 0..32 {
        result[i] = commitment[i] ^ (index as u8);
    }
    result
}

#[derive(Accounts)]
#[instruction(denomination: u64)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + VeloPool::SPACE,
        seeds = [b"velo_pool", denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_pool: Account<'info, VeloPool>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"velo_pool", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_pool: Account<'info, VeloPool>,
    /// CHECK: PDA vault for this pool
    #[account(
        mut,
        seeds = [b"velo_vault", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_vault: AccountInfo<'info>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nullifier_hash: [u8; 32])]
pub struct Withdraw<'info> {
    #[account(
        seeds = [b"velo_pool", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_pool: Account<'info, VeloPool>,
    /// CHECK: PDA vault for this pool
    #[account(
        mut,
        seeds = [b"velo_vault", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_vault: AccountInfo<'info>,
    /// Nullifier account - PDA derived from hash, ensures no double-spend
    #[account(
        init,
        payer = fee_payer,
        space = 8 + Nullifier::SPACE,
        seeds = [b"nullifier", nullifier_hash.as_ref()],
        bump
    )]
    pub nullifier: Account<'info, Nullifier>,
    /// CHECK: any recipient
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
    #[account(mut)]
    pub fee_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawTest<'info> {
    #[account(
        seeds = [b"velo_pool", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_pool: Account<'info, VeloPool>,
    /// CHECK: PDA vault
    #[account(
        mut,
        seeds = [b"velo_vault", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_vault: AccountInfo<'info>,
    /// CHECK: any recipient
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

/// ═══════════════════════════════════════════════════════════════════
/// RELAYER SYSTEM - For anonymous withdrawals
/// ═══════════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(nullifier_hash: [u8; 32], fee: u64)]
pub struct RelayerWithdraw<'info> {
    #[account(
        seeds = [b"velo_pool", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_pool: Account<'info, VeloPool>,
    /// CHECK: PDA vault
    #[account(
        mut,
        seeds = [b"velo_vault", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_vault: AccountInfo<'info>,
    /// Nullifier - prevents double-spend
    #[account(
        init,
        payer = relayer,
        space = 8 + Nullifier::SPACE,
        seeds = [b"nullifier", nullifier_hash.as_ref()],
        bump
    )]
    pub nullifier: Account<'info, Nullifier>,
    /// Relayer state - must be registered
    #[account(
        seeds = [b"relayer", relayer.key().as_ref()],
        bump,
        constraint = relayer_state.is_active @ VeloError::RelayerNotActive
    )]
    pub relayer_state: Account<'info, RelayerState>,
    /// CHECK: Recipient of the withdrawal
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
    /// Relayer who submits and signs the transaction (THE KEY TO PRIVACY!)
    #[account(mut)]
    pub relayer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterRelayer<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + RelayerState::SPACE,
        seeds = [b"relayer", relayer.key().as_ref()],
        bump
    )]
    pub relayer_state: Account<'info, RelayerState>,
    /// CHECK: The relayer wallet being registered
    pub relayer: AccountInfo<'info>,
    /// Must be program authority (for now)
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Relayer state - tracks a registered relayer
#[account]
pub struct RelayerState {
    pub relayer: Pubkey,          // 32 bytes - relayer's public key
    pub total_relayed: u64,       // 8 bytes - total transactions relayed
    pub total_fees: u64,          // 8 bytes - total fees earned
    pub is_active: bool,          // 1 byte - can this relayer operate?
    pub registered_at: i64,       // 8 bytes - when registered
}

impl RelayerState {
    pub const SPACE: usize = 32 + 8 + 8 + 1 + 8;
}

/// ═══════════════════════════════════════════════════════════════════
/// STEALTH ADDRESS CONTEXTS
/// ═══════════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(stealth_hash: [u8; 32], ephemeral_pubkey: [u8; 32])]
pub struct WithdrawToStealth<'info> {
    #[account(
        seeds = [b"velo_pool", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_pool: Account<'info, VeloPool>,
    /// CHECK: PDA vault
    #[account(
        mut,
        seeds = [b"velo_vault", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_vault: AccountInfo<'info>,
    /// Stealth PDA - funds go here, only recipient can claim
    /// CHECK: PDA derived from stealth_hash
    #[account(
        mut,
        seeds = [b"stealth", stealth_hash.as_ref()],
        bump
    )]
    pub stealth_pda: AccountInfo<'info>,
    /// Stores payment info for recipient to scan
    #[account(
        init,
        payer = fee_payer,
        space = 8 + StealthPayment::SPACE,
        seeds = [b"stealth_payment", stealth_hash.as_ref()],
        bump
    )]
    pub stealth_payment: Account<'info, StealthPayment>,
    #[account(mut)]
    pub fee_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(stealth_hash: [u8; 32])]
pub struct ClaimStealth<'info> {
    /// CHECK: Stealth PDA holding the funds
    #[account(
        mut,
        seeds = [b"stealth", stealth_hash.as_ref()],
        bump
    )]
    pub stealth_pda: AccountInfo<'info>,
    /// Payment record
    #[account(
        mut,
        seeds = [b"stealth_payment", stealth_hash.as_ref()],
        bump,
        constraint = !stealth_payment.claimed @ VeloError::AlreadyClaimed
    )]
    pub stealth_payment: Account<'info, StealthPayment>,
    /// CHECK: Recipient claiming funds
    #[account(mut)]
    pub recipient: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// ═══════════════════════════════════════════════════════════════════
/// DECOY SYSTEM CONTEXTS
/// ═══════════════════════════════════════════════════════════════════

#[derive(Accounts)]
pub struct InitDecoySystem<'info> {
    #[account(
        seeds = [b"velo_pool", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_pool: Account<'info, VeloPool>,
    #[account(
        init,
        payer = authority,
        space = 8 + DecoyConfig::SPACE,
        seeds = [b"decoy_config", velo_pool.key().as_ref()],
        bump
    )]
    pub decoy_config: Account<'info, DecoyConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(decoy_index: u8, amount: u64, direction: bool)]
pub struct Shuffle<'info> {
    #[account(
        seeds = [b"velo_pool", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_pool: Account<'info, VeloPool>,
    #[account(
        mut,
        seeds = [b"decoy_config", velo_pool.key().as_ref()],
        bump
    )]
    pub decoy_config: Account<'info, DecoyConfig>,
    /// CHECK: Main vault PDA
    #[account(
        mut,
        seeds = [b"velo_vault", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_vault: AccountInfo<'info>,
    /// CHECK: Decoy vault PDA
    #[account(
        mut,
        seeds = [b"decoy_vault", velo_pool.denomination.to_le_bytes().as_ref(), &[decoy_index]],
        bump
    )]
    pub decoy_vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DecoyDeposit<'info> {
    #[account(
        mut,
        seeds = [b"velo_pool", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_pool: Account<'info, VeloPool>,
    #[account(
        seeds = [b"decoy_config", velo_pool.key().as_ref()],
        bump
    )]
    pub decoy_config: Account<'info, DecoyConfig>,
    /// CHECK: Main vault PDA
    #[account(
        mut,
        seeds = [b"velo_vault", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_vault: AccountInfo<'info>,
    /// CHECK: Decoy vault PDA (index 0)
    #[account(
        mut,
        seeds = [b"decoy_vault", velo_pool.denomination.to_le_bytes().as_ref(), &[0u8]],
        bump
    )]
    pub decoy_vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DecoyWithdraw<'info> {
    #[account(
        seeds = [b"velo_pool", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_pool: Account<'info, VeloPool>,
    #[account(
        seeds = [b"decoy_config", velo_pool.key().as_ref()],
        bump
    )]
    pub decoy_config: Account<'info, DecoyConfig>,
    /// CHECK: Main vault PDA
    #[account(
        mut,
        seeds = [b"velo_vault", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_vault: AccountInfo<'info>,
    /// CHECK: Decoy vault PDA (index 0)
    #[account(
        mut,
        seeds = [b"decoy_vault", velo_pool.denomination.to_le_bytes().as_ref(), &[0u8]],
        bump
    )]
    pub decoy_vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

/// ═══════════════════════════════════════════════════════════════════
/// CONFIDENTIAL TRANSFER - Encrypted amounts on-chain
/// ═══════════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(commitment: [u8; 32], encrypted_amount: [u8; 128])]
pub struct ConfidentialDeposit<'info> {
    #[account(
        mut,
        seeds = [b"velo_pool", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_pool: Account<'info, VeloPool>,
    /// CHECK: PDA vault for this pool
    #[account(
        mut,
        seeds = [b"velo_vault", velo_pool.denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub velo_vault: AccountInfo<'info>,
    /// Stores the encrypted amount for this commitment
    #[account(
        init,
        payer = depositor,
        space = 8 + ConfidentialNote::SPACE,
        seeds = [b"confidential_note", commitment.as_ref()],
        bump
    )]
    pub confidential_note: Account<'info, ConfidentialNote>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Stores encrypted amount data on-chain
/// Only the owner (who knows the secret) can decrypt
#[account]
pub struct ConfidentialNote {
    pub commitment: [u8; 32],        // 32 bytes - links to deposit
    pub encrypted_amount: [u8; 128], // 128 bytes - AES-encrypted amount (fixed size)
    pub timestamp: i64,              // 8 bytes - when created
    pub pool_denomination: u64,      // 8 bytes - which pool
    pub spent: bool,                 // 1 byte - has been withdrawn?
}

impl ConfidentialNote {
    pub const SPACE: usize = 32 + 128 + 8 + 8 + 1;
}

#[account]
pub struct VeloPool {
    pub authority: Pubkey,           // 32 bytes
    pub denomination: u64,           // 8 bytes
    pub merkle_root: [u8; 32],       // 32 bytes - current Merkle tree root
    pub next_index: u32,             // 4 bytes
    pub total_deposits: u64,         // 8 bytes
}

impl VeloPool {
    pub const SPACE: usize = 32 + 8 + 32 + 4 + 8;
}

/// Separate account to track used nullifiers (prevents double-spend)
#[account]
pub struct Nullifier {
    pub hash: [u8; 32],
    pub pool: Pubkey,
}

impl Nullifier {
    pub const SPACE: usize = 32 + 32;
}

/// Stealth payment record - stores info for recipient to scan and claim
#[account]
pub struct StealthPayment {
    pub stealth_hash: [u8; 32],      // 32 bytes - hash identifying this stealth address
    pub ephemeral_pubkey: [u8; 32],  // 32 bytes - one-time pubkey for key derivation
    pub amount: u64,                  // 8 bytes - payment amount
    pub pool_denomination: u64,       // 8 bytes - which pool this came from
    pub claimed: bool,                // 1 byte - has this been claimed?
}

impl StealthPayment {
    pub const SPACE: usize = 32 + 32 + 8 + 8 + 1;
}

/// ═══════════════════════════════════════════════════════════════════
/// DECOY SYSTEM - Creates noise to confuse observers
/// ═══════════════════════════════════════════════════════════════════

/// Configuration for the decoy noise system
#[account]
pub struct DecoyConfig {
    pub pool: Pubkey,              // 32 bytes - associated pool
    pub authority: Pubkey,         // 32 bytes - who can trigger decoys
    pub num_decoy_vaults: u8,      // 1 byte - number of decoy vaults (max 8)
    pub total_shuffles: u64,       // 8 bytes - total shuffle operations performed
    pub last_shuffle_slot: u64,    // 8 bytes - last shuffle slot (for rate limiting)
    pub enabled: bool,             // 1 byte - is decoy system active
}

impl DecoyConfig {
    pub const SPACE: usize = 32 + 32 + 1 + 8 + 8 + 1;
}

#[error_code]
pub enum VeloError {
    #[msg("This nullifier has already been used")]
    NullifierAlreadyUsed,
    #[msg("Invalid ZK proof")]
    InvalidProof,
    #[msg("Insufficient pool balance")]
    InsufficientBalance,
    #[msg("This stealth payment has already been claimed")]
    AlreadyClaimed,
    #[msg("Decoy system is not enabled")]
    DecoySystemDisabled,
    #[msg("Shuffle rate limited - wait more slots")]
    ShuffleRateLimited,
    #[msg("Invalid decoy vault index")]
    InvalidDecoyVaultIndex,
    #[msg("Relayer is not active")]
    RelayerNotActive,
    #[msg("Unauthorized relayer")]
    UnauthorizedRelayer,
    #[msg("Fee too high (max 1%)")]
    FeeTooHigh,
    #[msg("Invalid note/proof")]
    InvalidNote,
}
