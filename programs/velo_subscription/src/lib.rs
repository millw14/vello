use anchor_lang::prelude::*;

declare_id!("VeLoSub1111111111111111111111111111111111111");

/// Subscription duration in seconds
pub const MONTH_SECONDS: i64 = 30 * 24 * 60 * 60;
pub const YEAR_SECONDS: i64 = 365 * 24 * 60 * 60;

/// Tier prices in lamports
pub const BASIC_PRICE: u64 = 0;                    // Free
pub const STANDARD_PRICE: u64 = 5_000_000_000;     // 5 SOL/month
pub const PREMIUM_PRICE: u64 = 15_000_000_000;     // 15 SOL/month
pub const MAXIMUM_PRICE: u64 = 50_000_000_000;     // 50 SOL/month

/// Revenue split: 90% treasury, 10% dev
pub const TREASURY_SHARE_BPS: u64 = 9000;
pub const DEV_SHARE_BPS: u64 = 1000;

#[program]
pub mod velo_subscription {
    use super::*;

    /// Initialize the subscription protocol
    pub fn initialize(
        ctx: Context<Initialize>,
        dev_wallet: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.treasury = ctx.accounts.treasury.key();
        config.dev_wallet = dev_wallet;
        config.total_subscribers = 0;
        config.total_revenue = 0;
        config.bump = ctx.bumps.config;
        config.is_active = true;

        // Set tier prices
        config.tier_prices = [
            BASIC_PRICE,
            STANDARD_PRICE,
            PREMIUM_PRICE,
            MAXIMUM_PRICE,
        ];

        emit!(SubscriptionProtocolInitialized {
            authority: config.authority,
            treasury: config.treasury,
            dev_wallet,
        });

        Ok(())
    }

    /// Subscribe to a tier
    pub fn subscribe(
        ctx: Context<Subscribe>,
        tier: SubscriptionTier,
        duration_months: u8,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(config.is_active, VeloSubscriptionError::ProtocolInactive);
        require!(duration_months > 0 && duration_months <= 12, VeloSubscriptionError::InvalidDuration);

        let subscription = &mut ctx.accounts.subscription;
        let clock = Clock::get()?;
        
        // Calculate price
        let tier_price = config.tier_prices[tier as usize];
        let total_price = tier_price
            .checked_mul(duration_months as u64)
            .ok_or(VeloSubscriptionError::Overflow)?;

        if total_price > 0 {
            // Split payment between treasury and dev
            let treasury_amount = total_price * TREASURY_SHARE_BPS / 10000;
            let dev_amount = total_price - treasury_amount;

            // Transfer to treasury
            let transfer_treasury = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.subscriber.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            );
            anchor_lang::system_program::transfer(transfer_treasury, treasury_amount)?;

            // Transfer to dev
            let transfer_dev = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.subscriber.to_account_info(),
                    to: ctx.accounts.dev_wallet.to_account_info(),
                },
            );
            anchor_lang::system_program::transfer(transfer_dev, dev_amount)?;
        }

        // Update subscription
        let duration_seconds = (duration_months as i64) * MONTH_SECONDS;
        let new_expiry = if subscription.expiry > clock.unix_timestamp {
            subscription.expiry + duration_seconds
        } else {
            clock.unix_timestamp + duration_seconds
        };

        subscription.subscriber = ctx.accounts.subscriber.key();
        subscription.tier = tier;
        subscription.expiry = new_expiry;
        subscription.total_paid = subscription.total_paid.saturating_add(total_price);
        subscription.subscribed_at = if subscription.subscribed_at == 0 {
            clock.unix_timestamp
        } else {
            subscription.subscribed_at
        };

        // Update config stats
        let config = &mut ctx.accounts.config;
        if subscription.subscribed_at == clock.unix_timestamp {
            config.total_subscribers += 1;
        }
        config.total_revenue = config.total_revenue.saturating_add(total_price);

        emit!(Subscribed {
            subscriber: subscription.subscriber,
            tier,
            duration_months,
            expiry: new_expiry,
            amount_paid: total_price,
        });

        Ok(())
    }

    /// Upgrade subscription tier
    pub fn upgrade_tier(
        ctx: Context<ManageSubscription>,
        new_tier: SubscriptionTier,
    ) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;
        let config = &ctx.accounts.config;
        let clock = Clock::get()?;

        require!(
            subscription.expiry > clock.unix_timestamp,
            VeloSubscriptionError::SubscriptionExpired
        );
        require!(
            new_tier as u8 > subscription.tier as u8,
            VeloSubscriptionError::CannotDowngrade
        );

        // Calculate prorated upgrade cost
        let remaining_time = subscription.expiry - clock.unix_timestamp;
        let remaining_months = (remaining_time as f64 / MONTH_SECONDS as f64).ceil() as u64;
        
        let old_price = config.tier_prices[subscription.tier as usize];
        let new_price = config.tier_prices[new_tier as usize];
        let price_diff = new_price.saturating_sub(old_price);
        let upgrade_cost = price_diff.saturating_mul(remaining_months);

        if upgrade_cost > 0 {
            // Split payment
            let treasury_amount = upgrade_cost * TREASURY_SHARE_BPS / 10000;
            let dev_amount = upgrade_cost - treasury_amount;

            // Transfers
            let transfer_treasury = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.subscriber.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            );
            anchor_lang::system_program::transfer(transfer_treasury, treasury_amount)?;

            let transfer_dev = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.subscriber.to_account_info(),
                    to: ctx.accounts.dev_wallet.to_account_info(),
                },
            );
            anchor_lang::system_program::transfer(transfer_dev, dev_amount)?;
        }

        let old_tier = subscription.tier;
        subscription.tier = new_tier;
        subscription.total_paid = subscription.total_paid.saturating_add(upgrade_cost);

        emit!(TierUpgraded {
            subscriber: subscription.subscriber,
            old_tier,
            new_tier,
            upgrade_cost,
        });

        Ok(())
    }

    /// Check if subscription is active and get tier features
    pub fn check_subscription(ctx: Context<CheckSubscription>) -> Result<TierFeatures> {
        let subscription = &ctx.accounts.subscription;
        let clock = Clock::get()?;

        let is_active = subscription.expiry > clock.unix_timestamp;
        let effective_tier = if is_active {
            subscription.tier
        } else {
            SubscriptionTier::Basic
        };

        Ok(get_tier_features(effective_tier))
    }

    /// Update tier prices (admin only)
    pub fn update_prices(
        ctx: Context<AdminAction>,
        new_prices: [u64; 4],
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.tier_prices = new_prices;

        emit!(PricesUpdated {
            new_prices,
        });

        Ok(())
    }

    /// Pause/unpause protocol (admin only)
    pub fn set_active(ctx: Context<AdminAction>, is_active: bool) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.is_active = is_active;
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
        space = 8 + SubscriptionConfig::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, SubscriptionConfig>,

    /// CHECK: Treasury account
    #[account(mut)]
    pub treasury: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Subscribe<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, SubscriptionConfig>,

    #[account(
        init_if_needed,
        payer = subscriber,
        space = 8 + UserSubscription::INIT_SPACE,
        seeds = [b"subscription", subscriber.key().as_ref()],
        bump
    )]
    pub subscription: Account<'info, UserSubscription>,

    /// CHECK: Treasury
    #[account(mut, address = config.treasury)]
    pub treasury: AccountInfo<'info>,

    /// CHECK: Dev wallet
    #[account(mut, address = config.dev_wallet)]
    pub dev_wallet: AccountInfo<'info>,

    #[account(mut)]
    pub subscriber: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ManageSubscription<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, SubscriptionConfig>,

    #[account(
        mut,
        seeds = [b"subscription", subscriber.key().as_ref()],
        bump,
        has_one = subscriber
    )]
    pub subscription: Account<'info, UserSubscription>,

    /// CHECK: Treasury
    #[account(mut, address = config.treasury)]
    pub treasury: AccountInfo<'info>,

    /// CHECK: Dev wallet
    #[account(mut, address = config.dev_wallet)]
    pub dev_wallet: AccountInfo<'info>,

    #[account(mut)]
    pub subscriber: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CheckSubscription<'info> {
    #[account(
        seeds = [b"subscription", user.key().as_ref()],
        bump
    )]
    pub subscription: Account<'info, UserSubscription>,

    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, SubscriptionConfig>,

    pub authority: Signer<'info>,
}

// ============================================================================
// STATE
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct SubscriptionConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub dev_wallet: Pubkey,
    pub tier_prices: [u64; 4], // Basic, Standard, Premium, Maximum
    pub total_subscribers: u64,
    pub total_revenue: u64,
    pub bump: u8,
    pub is_active: bool,
}

#[account]
#[derive(InitSpace)]
pub struct UserSubscription {
    pub subscriber: Pubkey,
    pub tier: SubscriptionTier,
    pub expiry: i64,
    pub total_paid: u64,
    pub subscribed_at: i64,
}

// ============================================================================
// TYPES
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum SubscriptionTier {
    Basic = 0,
    Standard = 1,
    Premium = 2,
    Maximum = 3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TierFeatures {
    pub tier: SubscriptionTier,
    pub mixing_rounds: u8,
    pub stealth_addresses: bool,
    pub zk_proofs: bool,
    pub full_obfuscation: bool,
    pub max_tx_per_day: u32,
    pub privacy_score: u8,
}

fn get_tier_features(tier: SubscriptionTier) -> TierFeatures {
    match tier {
        SubscriptionTier::Basic => TierFeatures {
            tier,
            mixing_rounds: 1,
            stealth_addresses: false,
            zk_proofs: false,
            full_obfuscation: false,
            max_tx_per_day: 5,
            privacy_score: 40,
        },
        SubscriptionTier::Standard => TierFeatures {
            tier,
            mixing_rounds: 3,
            stealth_addresses: true,
            zk_proofs: false,
            full_obfuscation: false,
            max_tx_per_day: 20,
            privacy_score: 60,
        },
        SubscriptionTier::Premium => TierFeatures {
            tier,
            mixing_rounds: 5,
            stealth_addresses: true,
            zk_proofs: true,
            full_obfuscation: false,
            max_tx_per_day: 100,
            privacy_score: 80,
        },
        SubscriptionTier::Maximum => TierFeatures {
            tier,
            mixing_rounds: 8,
            stealth_addresses: true,
            zk_proofs: true,
            full_obfuscation: true,
            max_tx_per_day: u32::MAX,
            privacy_score: 100,
        },
    }
}

// ============================================================================
// EVENTS
// ============================================================================

#[event]
pub struct SubscriptionProtocolInitialized {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub dev_wallet: Pubkey,
}

#[event]
pub struct Subscribed {
    pub subscriber: Pubkey,
    pub tier: SubscriptionTier,
    pub duration_months: u8,
    pub expiry: i64,
    pub amount_paid: u64,
}

#[event]
pub struct TierUpgraded {
    pub subscriber: Pubkey,
    pub old_tier: SubscriptionTier,
    pub new_tier: SubscriptionTier,
    pub upgrade_cost: u64,
}

#[event]
pub struct PricesUpdated {
    pub new_prices: [u64; 4],
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum VeloSubscriptionError {
    #[msg("Protocol is not active")]
    ProtocolInactive,
    #[msg("Invalid subscription duration")]
    InvalidDuration,
    #[msg("Subscription has expired")]
    SubscriptionExpired,
    #[msg("Cannot downgrade tier")]
    CannotDowngrade,
    #[msg("Arithmetic overflow")]
    Overflow,
}
