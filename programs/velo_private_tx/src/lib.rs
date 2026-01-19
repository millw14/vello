use anchor_lang::prelude::*;

declare_id!("VeLoPTx1111111111111111111111111111111111111");

/// Maximum notes per user
pub const MAX_NOTES_PER_USER: usize = 100;
/// Protocol fee in basis points (0.5%)
pub const PROTOCOL_FEE_BPS: u64 = 50;

#[program]
pub mod velo_private_tx {
    use super::*;

    /// Initialize the private transaction protocol
    pub fn initialize(ctx: Context<Initialize>, protocol_bump: u8) -> Result<()> {
        let protocol = &mut ctx.accounts.protocol;
        protocol.authority = ctx.accounts.authority.key();
        protocol.treasury = ctx.accounts.treasury.key();
        protocol.total_private_transfers = 0;
        protocol.total_volume = 0;
        protocol.fee_bps = PROTOCOL_FEE_BPS;
        protocol.bump = protocol_bump;
        protocol.is_active = true;

        emit!(ProtocolInitialized {
            authority: ctx.accounts.authority.key(),
            treasury: ctx.accounts.treasury.key(),
        });

        Ok(())
    }

    /// Create a shielded note (encrypted UTXO)
    /// The note contains encrypted amount and recipient information
    pub fn create_note(
        ctx: Context<CreateNote>,
        commitment: [u8; 32],
        encrypted_data: Vec<u8>,
        amount: u64,
    ) -> Result<()> {
        let protocol = &ctx.accounts.protocol;
        require!(protocol.is_active, VeloPrivateTxError::ProtocolInactive);

        let note = &mut ctx.accounts.note;
        note.owner = ctx.accounts.owner.key();
        note.commitment = commitment;
        note.encrypted_data = encrypted_data;
        note.amount = amount;
        note.spent = false;
        note.created_at = Clock::get()?.unix_timestamp;

        // Transfer funds to note escrow
        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.note_escrow.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(transfer_ctx, amount)?;

        emit!(NoteCreated {
            note: note.key(),
            commitment,
            amount,
            timestamp: note.created_at,
        });

        Ok(())
    }

    /// Execute a private transfer using ZK proof
    /// Spends input notes and creates output notes
    pub fn private_transfer(
        ctx: Context<PrivateTransfer>,
        proof: TransferProof,
        input_nullifiers: Vec<[u8; 32]>,
        output_commitments: Vec<[u8; 32]>,
        encrypted_outputs: Vec<Vec<u8>>,
        public_amount: i64, // Positive = deposit, Negative = withdraw
    ) -> Result<()> {
        let protocol = &mut ctx.accounts.protocol;
        require!(protocol.is_active, VeloPrivateTxError::ProtocolInactive);

        // Verify nullifiers haven't been spent
        for nullifier in &input_nullifiers {
            require!(
                !ctx.accounts.nullifier_set.contains(nullifier),
                VeloPrivateTxError::NullifierSpent
            );
        }

        // Verify the ZK proof
        require!(
            verify_transfer_proof(
                &proof,
                &input_nullifiers,
                &output_commitments,
                public_amount
            ),
            VeloPrivateTxError::InvalidProof
        );

        // Mark nullifiers as spent
        for nullifier in &input_nullifiers {
            ctx.accounts.nullifier_set.add(*nullifier)?;
        }

        // Handle public amount (deposit/withdraw)
        if public_amount > 0 {
            // Deposit: transfer from user to protocol
            let amount = public_amount as u64;
            let transfer_ctx = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.protocol_vault.to_account_info(),
                },
            );
            anchor_lang::system_program::transfer(transfer_ctx, amount)?;
        } else if public_amount < 0 {
            // Withdraw: transfer from protocol to user
            let amount = (-public_amount) as u64;
            let fee = amount * protocol.fee_bps / 10000;
            let net_amount = amount - fee;

            // Transfer to user
            **ctx.accounts.protocol_vault.try_borrow_mut_lamports()? -= net_amount;
            **ctx.accounts.user.try_borrow_mut_lamports()? += net_amount;

            // Transfer fee to treasury
            if fee > 0 {
                **ctx.accounts.protocol_vault.try_borrow_mut_lamports()? -= fee;
                **ctx.accounts.treasury.try_borrow_mut_lamports()? += fee;
            }
        }

        // Update protocol stats
        protocol.total_private_transfers += 1;
        protocol.total_volume += (public_amount.abs() as u64);

        emit!(PrivateTransferExecuted {
            nullifiers: input_nullifiers,
            commitments: output_commitments,
            public_amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Spend a note (mark as used)
    pub fn spend_note(
        ctx: Context<SpendNote>,
        nullifier: [u8; 32],
        proof: SpendProof,
    ) -> Result<()> {
        let note = &mut ctx.accounts.note;
        
        require!(!note.spent, VeloPrivateTxError::NoteAlreadySpent);
        require!(
            verify_spend_proof(&proof, &note.commitment, &nullifier),
            VeloPrivateTxError::InvalidProof
        );

        note.spent = true;

        emit!(NoteSpent {
            note: note.key(),
            nullifier,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Update protocol fee (admin only)
    pub fn update_fee(ctx: Context<AdminAction>, new_fee_bps: u64) -> Result<()> {
        require!(new_fee_bps <= 1000, VeloPrivateTxError::FeeTooHigh); // Max 10%
        
        let protocol = &mut ctx.accounts.protocol;
        protocol.fee_bps = new_fee_bps;

        emit!(FeeUpdated {
            old_fee: protocol.fee_bps,
            new_fee: new_fee_bps,
        });

        Ok(())
    }
}

// ============================================================================
// ACCOUNTS
// ============================================================================

#[derive(Accounts)]
#[instruction(protocol_bump: u8)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + PrivateProtocol::INIT_SPACE,
        seeds = [b"protocol"],
        bump
    )]
    pub protocol: Account<'info, PrivateProtocol>,

    /// CHECK: Treasury account
    pub treasury: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateNote<'info> {
    #[account(
        seeds = [b"protocol"],
        bump = protocol.bump
    )]
    pub protocol: Account<'info, PrivateProtocol>,

    #[account(
        init,
        payer = owner,
        space = 8 + ShieldedNote::INIT_SPACE,
    )]
    pub note: Account<'info, ShieldedNote>,

    /// CHECK: Note escrow PDA
    #[account(
        mut,
        seeds = [b"escrow", note.key().as_ref()],
        bump
    )]
    pub note_escrow: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PrivateTransfer<'info> {
    #[account(
        mut,
        seeds = [b"protocol"],
        bump = protocol.bump
    )]
    pub protocol: Account<'info, PrivateProtocol>,

    #[account(mut)]
    pub nullifier_set: Account<'info, NullifierSet>,

    /// CHECK: Protocol vault PDA
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub protocol_vault: AccountInfo<'info>,

    /// CHECK: Treasury
    #[account(mut)]
    pub treasury: AccountInfo<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SpendNote<'info> {
    #[account(
        mut,
        has_one = owner
    )]
    pub note: Account<'info, ShieldedNote>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"protocol"],
        bump = protocol.bump
    )]
    pub protocol: Account<'info, PrivateProtocol>,

    pub authority: Signer<'info>,
}

// ============================================================================
// STATE
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct PrivateProtocol {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub total_private_transfers: u64,
    pub total_volume: u64,
    pub fee_bps: u64,
    pub bump: u8,
    pub is_active: bool,
}

#[account]
#[derive(InitSpace)]
pub struct ShieldedNote {
    pub owner: Pubkey,
    pub commitment: [u8; 32],
    #[max_len(256)]
    pub encrypted_data: Vec<u8>,
    pub amount: u64,
    pub spent: bool,
    pub created_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct NullifierSet {
    #[max_len(100000)]
    pub nullifiers: Vec<[u8; 32]>,
}

impl NullifierSet {
    pub fn contains(&self, nullifier: &[u8; 32]) -> bool {
        self.nullifiers.contains(nullifier)
    }

    pub fn add(&mut self, nullifier: [u8; 32]) -> Result<()> {
        self.nullifiers.push(nullifier);
        Ok(())
    }
}

// ============================================================================
// PROOF STRUCTURES
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TransferProof {
    pub proof_data: Vec<u8>,
    pub merkle_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SpendProof {
    pub proof_data: Vec<u8>,
}

/// Verify transfer proof using ZK-SNARKs
fn verify_transfer_proof(
    proof: &TransferProof,
    input_nullifiers: &[[u8; 32]],
    output_commitments: &[[u8; 32]],
    public_amount: i64,
) -> bool {
    // TODO: Implement proper verification using Light Protocol or custom circuits
    // This would verify:
    // 1. Input notes exist (Merkle proof)
    // 2. Sum of inputs = Sum of outputs + public_amount
    // 3. Nullifiers are correctly derived from notes
    // 4. Output commitments are valid

    if proof.proof_data.is_empty() {
        return false;
    }

    // Verify proof structure
    !proof.merkle_root.iter().all(|&x| x == 0)
}

/// Verify spend proof
fn verify_spend_proof(
    proof: &SpendProof,
    commitment: &[u8; 32],
    nullifier: &[u8; 32],
) -> bool {
    // TODO: Implement proper verification
    // Verifies the nullifier is correctly derived from the commitment
    !proof.proof_data.is_empty() && !nullifier.iter().all(|&x| x == 0)
}

// ============================================================================
// EVENTS
// ============================================================================

#[event]
pub struct ProtocolInitialized {
    pub authority: Pubkey,
    pub treasury: Pubkey,
}

#[event]
pub struct NoteCreated {
    pub note: Pubkey,
    pub commitment: [u8; 32],
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct PrivateTransferExecuted {
    pub nullifiers: Vec<[u8; 32]>,
    pub commitments: Vec<[u8; 32]>,
    pub public_amount: i64,
    pub timestamp: i64,
}

#[event]
pub struct NoteSpent {
    pub note: Pubkey,
    pub nullifier: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct FeeUpdated {
    pub old_fee: u64,
    pub new_fee: u64,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum VeloPrivateTxError {
    #[msg("Protocol is not active")]
    ProtocolInactive,
    #[msg("Nullifier has already been spent")]
    NullifierSpent,
    #[msg("Invalid ZK proof")]
    InvalidProof,
    #[msg("Note has already been spent")]
    NoteAlreadySpent,
    #[msg("Fee too high (max 10%)")]
    FeeTooHigh,
}
