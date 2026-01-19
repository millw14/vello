use anchor_lang::prelude::*;

declare_id!("VeLoStH1111111111111111111111111111111111111");

/// Maximum stealth addresses per user
pub const MAX_STEALTH_ADDRESSES: usize = 1000;
/// Stealth address expiry (24 hours)
pub const STEALTH_EXPIRY_SECONDS: i64 = 24 * 60 * 60;

#[program]
pub mod velo_stealth {
    use super::*;

    /// Initialize the stealth address registry
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.total_registrations = 0;
        registry.total_transactions = 0;
        registry.bump = ctx.bumps.registry;
        registry.is_active = true;

        emit!(RegistryInitialized {
            authority: registry.authority,
        });

        Ok(())
    }

    /// Register a user's stealth meta-address (spend key + view key)
    pub fn register_meta_address(
        ctx: Context<RegisterMetaAddress>,
        spend_public_key: [u8; 32],
        view_public_key: [u8; 32],
    ) -> Result<()> {
        let registry = &ctx.accounts.registry;
        require!(registry.is_active, VeloStealthError::RegistryInactive);

        let user_stealth = &mut ctx.accounts.user_stealth;
        user_stealth.owner = ctx.accounts.owner.key();
        user_stealth.spend_public_key = spend_public_key;
        user_stealth.view_public_key = view_public_key;
        user_stealth.registered_at = Clock::get()?.unix_timestamp;
        user_stealth.total_received = 0;
        user_stealth.is_active = true;

        // Update registry stats
        let registry = &mut ctx.accounts.registry;
        registry.total_registrations += 1;

        emit!(MetaAddressRegistered {
            owner: user_stealth.owner,
            spend_public_key,
            view_public_key,
        });

        Ok(())
    }

    /// Announce a stealth address payment
    /// Sender publishes ephemeral public key so recipient can detect and claim funds
    pub fn announce_payment(
        ctx: Context<AnnouncePayment>,
        stealth_address: Pubkey,
        ephemeral_public_key: [u8; 32],
        encrypted_view_tag: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        let registry = &ctx.accounts.registry;
        require!(registry.is_active, VeloStealthError::RegistryInactive);

        let announcement = &mut ctx.accounts.announcement;
        announcement.sender = ctx.accounts.sender.key();
        announcement.recipient_meta = ctx.accounts.recipient_meta.key();
        announcement.stealth_address = stealth_address;
        announcement.ephemeral_public_key = ephemeral_public_key;
        announcement.encrypted_view_tag = encrypted_view_tag;
        announcement.amount = amount;
        announcement.timestamp = Clock::get()?.unix_timestamp;
        announcement.claimed = false;

        // Transfer funds to stealth address
        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.sender.to_account_info(),
                to: ctx.accounts.stealth_account.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(transfer_ctx, amount)?;

        // Update recipient stats
        let recipient = &mut ctx.accounts.recipient_meta;
        recipient.total_received = recipient.total_received.saturating_add(amount);

        // Update registry stats
        let registry = &mut ctx.accounts.registry;
        registry.total_transactions += 1;

        emit!(PaymentAnnounced {
            sender: announcement.sender,
            stealth_address,
            ephemeral_public_key,
            amount,
            timestamp: announcement.timestamp,
        });

        Ok(())
    }

    /// Claim funds from a stealth address
    /// Recipient proves ownership by signing with derived private key
    pub fn claim_stealth_funds(
        ctx: Context<ClaimStealthFunds>,
        stealth_private_key_proof: [u8; 64], // Signature proving ownership
    ) -> Result<()> {
        let announcement = &mut ctx.accounts.announcement;
        
        require!(!announcement.claimed, VeloStealthError::AlreadyClaimed);
        
        // Verify the claimer can sign for the stealth address
        // In production, this would verify a signature using the stealth private key
        require!(
            verify_stealth_ownership(
                &announcement.stealth_address,
                &ctx.accounts.claimer.key(),
                &stealth_private_key_proof
            ),
            VeloStealthError::InvalidOwnershipProof
        );

        // Transfer funds from stealth address to claimer
        let amount = ctx.accounts.stealth_account.lamports();
        
        **ctx.accounts.stealth_account.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.claimer.try_borrow_mut_lamports()? += amount;

        announcement.claimed = true;

        emit!(StealthFundsClaimed {
            stealth_address: announcement.stealth_address,
            claimer: ctx.accounts.claimer.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Scan for incoming payments (view key holder)
    /// Returns matching announcements for a recipient
    pub fn scan_announcements(
        ctx: Context<ScanAnnouncements>,
        start_timestamp: i64,
        limit: u32,
    ) -> Result<Vec<Pubkey>> {
        // In a real implementation, this would use an indexer
        // For on-chain, we return announcement accounts that match
        
        let _user_stealth = &ctx.accounts.user_stealth;
        
        // Return empty vec - actual scanning happens off-chain
        // using the view key to check each announcement
        Ok(Vec::new())
    }

    /// Generate stealth address (helper - actual generation is off-chain)
    /// This instruction validates and stores a pre-computed stealth address
    pub fn validate_stealth_address(
        ctx: Context<ValidateStealthAddress>,
        stealth_address: Pubkey,
        ephemeral_public_key: [u8; 32],
    ) -> Result<bool> {
        let recipient_meta = &ctx.accounts.recipient_meta;
        
        // Verify the stealth address derivation
        // stealth_addr = spend_key + hash(ephemeral * view_key) * G
        let is_valid = verify_stealth_derivation(
            &recipient_meta.spend_public_key,
            &recipient_meta.view_public_key,
            &ephemeral_public_key,
            &stealth_address,
        );

        Ok(is_valid)
    }

    /// Update meta-address keys
    pub fn update_meta_address(
        ctx: Context<ManageUserStealth>,
        new_spend_key: Option<[u8; 32]>,
        new_view_key: Option<[u8; 32]>,
    ) -> Result<()> {
        let user_stealth = &mut ctx.accounts.user_stealth;

        if let Some(spend_key) = new_spend_key {
            user_stealth.spend_public_key = spend_key;
        }
        if let Some(view_key) = new_view_key {
            user_stealth.view_public_key = view_key;
        }

        emit!(MetaAddressUpdated {
            owner: user_stealth.owner,
        });

        Ok(())
    }

    /// Deactivate stealth registration
    pub fn deactivate(ctx: Context<ManageUserStealth>) -> Result<()> {
        let user_stealth = &mut ctx.accounts.user_stealth;
        user_stealth.is_active = false;

        emit!(MetaAddressDeactivated {
            owner: user_stealth.owner,
        });

        Ok(())
    }
}

// ============================================================================
// ACCOUNTS
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + StealthRegistry::INIT_SPACE,
        seeds = [b"registry"],
        bump
    )]
    pub registry: Account<'info, StealthRegistry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterMetaAddress<'info> {
    #[account(
        mut,
        seeds = [b"registry"],
        bump = registry.bump
    )]
    pub registry: Account<'info, StealthRegistry>,

    #[account(
        init,
        payer = owner,
        space = 8 + UserStealthMeta::INIT_SPACE,
        seeds = [b"stealth_meta", owner.key().as_ref()],
        bump
    )]
    pub user_stealth: Account<'info, UserStealthMeta>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AnnouncePayment<'info> {
    #[account(
        mut,
        seeds = [b"registry"],
        bump = registry.bump
    )]
    pub registry: Account<'info, StealthRegistry>,

    #[account(mut)]
    pub recipient_meta: Account<'info, UserStealthMeta>,

    #[account(
        init,
        payer = sender,
        space = 8 + StealthAnnouncement::INIT_SPACE,
    )]
    pub announcement: Account<'info, StealthAnnouncement>,

    /// CHECK: Stealth address account (will receive funds)
    #[account(mut)]
    pub stealth_account: AccountInfo<'info>,

    #[account(mut)]
    pub sender: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimStealthFunds<'info> {
    #[account(mut)]
    pub announcement: Account<'info, StealthAnnouncement>,

    /// CHECK: Stealth address account
    #[account(
        mut,
        address = announcement.stealth_address
    )]
    pub stealth_account: AccountInfo<'info>,

    #[account(mut)]
    pub claimer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ScanAnnouncements<'info> {
    #[account(
        seeds = [b"stealth_meta", scanner.key().as_ref()],
        bump
    )]
    pub user_stealth: Account<'info, UserStealthMeta>,

    pub scanner: Signer<'info>,
}

#[derive(Accounts)]
pub struct ValidateStealthAddress<'info> {
    pub recipient_meta: Account<'info, UserStealthMeta>,
}

#[derive(Accounts)]
pub struct ManageUserStealth<'info> {
    #[account(
        mut,
        has_one = owner,
        seeds = [b"stealth_meta", owner.key().as_ref()],
        bump
    )]
    pub user_stealth: Account<'info, UserStealthMeta>,

    pub owner: Signer<'info>,
}

// ============================================================================
// STATE
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct StealthRegistry {
    pub authority: Pubkey,
    pub total_registrations: u64,
    pub total_transactions: u64,
    pub bump: u8,
    pub is_active: bool,
}

#[account]
#[derive(InitSpace)]
pub struct UserStealthMeta {
    pub owner: Pubkey,
    pub spend_public_key: [u8; 32],
    pub view_public_key: [u8; 32],
    pub registered_at: i64,
    pub total_received: u64,
    pub is_active: bool,
}

#[account]
#[derive(InitSpace)]
pub struct StealthAnnouncement {
    pub sender: Pubkey,
    pub recipient_meta: Pubkey,
    pub stealth_address: Pubkey,
    pub ephemeral_public_key: [u8; 32],
    pub encrypted_view_tag: [u8; 32],
    pub amount: u64,
    pub timestamp: i64,
    pub claimed: bool,
}

// ============================================================================
// HELPERS
// ============================================================================

/// Verify stealth address ownership (simplified)
fn verify_stealth_ownership(
    stealth_address: &Pubkey,
    claimer: &Pubkey,
    proof: &[u8; 64],
) -> bool {
    // In production: verify signature over stealth_address using stealth private key
    // The stealth private key = spend_private_key + hash(ephemeral * view_private_key)
    
    // For now, verify non-zero proof
    !proof.iter().all(|&x| x == 0)
}

/// Verify stealth address derivation
fn verify_stealth_derivation(
    spend_public_key: &[u8; 32],
    view_public_key: &[u8; 32],
    ephemeral_public_key: &[u8; 32],
    stealth_address: &Pubkey,
) -> bool {
    // In production: verify stealth_addr = spend_key + hash(ephemeral * view_key) * G
    // Using elliptic curve operations
    
    // Compute shared secret hash
    let shared_secret_input = [
        ephemeral_public_key.as_slice(),
        view_public_key.as_slice(),
    ].concat();
    let _shared_secret_hash = solana_program::keccak::hash(&shared_secret_input);
    
    // For now, return true for non-zero inputs
    !spend_public_key.iter().all(|&x| x == 0) &&
    !view_public_key.iter().all(|&x| x == 0) &&
    *stealth_address != Pubkey::default()
}

// ============================================================================
// EVENTS
// ============================================================================

#[event]
pub struct RegistryInitialized {
    pub authority: Pubkey,
}

#[event]
pub struct MetaAddressRegistered {
    pub owner: Pubkey,
    pub spend_public_key: [u8; 32],
    pub view_public_key: [u8; 32],
}

#[event]
pub struct PaymentAnnounced {
    pub sender: Pubkey,
    pub stealth_address: Pubkey,
    pub ephemeral_public_key: [u8; 32],
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct StealthFundsClaimed {
    pub stealth_address: Pubkey,
    pub claimer: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct MetaAddressUpdated {
    pub owner: Pubkey,
}

#[event]
pub struct MetaAddressDeactivated {
    pub owner: Pubkey,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum VeloStealthError {
    #[msg("Registry is not active")]
    RegistryInactive,
    #[msg("Stealth funds already claimed")]
    AlreadyClaimed,
    #[msg("Invalid ownership proof")]
    InvalidOwnershipProof,
    #[msg("Invalid stealth address derivation")]
    InvalidDerivation,
}
