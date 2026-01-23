/**
 * VELO RELAYER SERVICE
 * 
 * This is the KEY to privacy on Solana!
 * 
 * How it works:
 * 1. User deposits SOL to Velo pool (on-chain, visible as "deposit to Velo")
 * 2. User gets a "note" with secret commitment
 * 3. User sends note to this relayer via HTTPS (off-chain, private)
 * 4. Relayer verifies the note is valid
 * 5. Relayer submits withdrawal transaction - RELAYER is the signer!
 * 6. Recipient gets SOL "from Velo", not from original sender
 * 
 * On Solscan:
 * - Deposit: [User Wallet] → [Velo Program] (amount visible)
 * - Withdrawal: [Velo Program] → [Recipient] (SENDER COMPLETELY HIDDEN!)
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { logger } from './utils/logger';
import { 
  RelayerConfig, 
  RelayerWithdrawRequest, 
  PoolSize, 
  POOL_AMOUNTS,
  POOL_LAMPORTS,
} from './types';
import { MixerRelayer } from './services/mixer';
import { StealthRelayer } from './services/stealth';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Velo Program ID (update after deployment)
const VELO_PROGRAM_ID = process.env.VELO_PROGRAM_ID || 'AQgeVtAYEvigMbBW5gEiK4voELjFB94fDY9cFZqKHgZ8';

// Configuration
const config: RelayerConfig = {
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  relayerKeypairPath: process.env.RELAYER_KEYPAIR_PATH || './relayer-keypair.json',
  minFee: parseInt(process.env.MIN_FEE || '500000'),      // 0.0005 SOL minimum
  maxFee: parseInt(process.env.MAX_FEE || '10000000'),    // 0.01 SOL maximum  
  feePercent: parseFloat(process.env.FEE_PERCENT || '0.5'), // 0.5% default
  veloProgramId: VELO_PROGRAM_ID,
};

// Global instances
let connection: Connection;
let relayerKeypair: Keypair;
let mixerRelayer: MixerRelayer;
let stealthRelayer: StealthRelayer;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST'],
}));
app.use(express.json());

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  // Don't log sensitive data
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip?.replace(/.*:/, ''), // Anonymize IP
  });
  next();
});

// ============================================================================
// PUBLIC ENDPOINTS
// ============================================================================

/**
 * Health check
 */
app.get('/health', async (req: Request, res: Response) => {
  try {
    const balance = await connection.getBalance(relayerKeypair.publicKey);
    res.json({
      status: 'ok',
      relayerAddress: relayerKeypair.publicKey.toString(),
      balance: balance / 1e9,
      network: config.rpcUrl.includes('devnet') ? 'devnet' : 'mainnet',
      timestamp: Date.now(),
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

/**
 * Get relayer info and fee schedule
 */
app.get('/info', async (req: Request, res: Response) => {
  try {
    const balance = await connection.getBalance(relayerKeypair.publicKey);
    const isRegistered = await mixerRelayer.isRelayerRegistered();
    
    res.json({
      relayerAddress: relayerKeypair.publicKey.toString(),
      isRegistered,
      feePercent: config.feePercent,
      minFee: config.minFee,
      maxFee: config.maxFee,
      minFeeSOL: config.minFee / 1e9,
      maxFeeSOL: config.maxFee / 1e9,
      supportedPools: [
        { size: PoolSize.SMALL, amount: POOL_AMOUNTS[PoolSize.SMALL], lamports: POOL_LAMPORTS[PoolSize.SMALL] },
        { size: PoolSize.MEDIUM, amount: POOL_AMOUNTS[PoolSize.MEDIUM], lamports: POOL_LAMPORTS[PoolSize.MEDIUM] },
        { size: PoolSize.LARGE, amount: POOL_AMOUNTS[PoolSize.LARGE], lamports: POOL_LAMPORTS[PoolSize.LARGE] },
      ],
      programId: VELO_PROGRAM_ID,
      balance: balance / 1e9,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Estimate fee for a withdrawal
 */
app.post('/estimate-fee', (req: Request, res: Response) => {
  const { poolSize } = req.body;
  
  if (!poolSize || !POOL_LAMPORTS[poolSize as PoolSize]) {
    return res.status(400).json({ 
      error: 'Invalid poolSize. Use: SMALL, MEDIUM, or LARGE' 
    });
  }

  const denomination = POOL_LAMPORTS[poolSize as PoolSize];
  let fee = Math.floor(denomination * (config.feePercent / 100));
  fee = Math.max(fee, config.minFee);
  fee = Math.min(fee, config.maxFee);

  res.json({
    poolSize,
    denomination,
    denominationSOL: denomination / 1e9,
    fee,
    feeSOL: fee / 1e9,
    recipientAmount: denomination - fee,
    recipientAmountSOL: (denomination - fee) / 1e9,
  });
});

/**
 * Get pool liquidity info
 */
app.get('/pools', async (req: Request, res: Response) => {
  try {
    const pools = await Promise.all([
      mixerRelayer.getVaultBalance(PoolSize.SMALL),
      mixerRelayer.getVaultBalance(PoolSize.MEDIUM),
      mixerRelayer.getVaultBalance(PoolSize.LARGE),
    ]);

    res.json({
      pools: [
        { 
          size: PoolSize.SMALL, 
          denomination: POOL_AMOUNTS[PoolSize.SMALL],
          balance: pools[0] / 1e9,
          canWithdraw: pools[0] >= POOL_LAMPORTS[PoolSize.SMALL],
        },
        { 
          size: PoolSize.MEDIUM, 
          denomination: POOL_AMOUNTS[PoolSize.MEDIUM],
          balance: pools[1] / 1e9,
          canWithdraw: pools[1] >= POOL_LAMPORTS[PoolSize.MEDIUM],
        },
        { 
          size: PoolSize.LARGE, 
          denomination: POOL_AMOUNTS[PoolSize.LARGE],
          balance: pools[2] / 1e9,
          canWithdraw: pools[2] >= POOL_LAMPORTS[PoolSize.LARGE],
        },
      ],
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// PRIVACY ENDPOINTS - THE MAGIC
// ============================================================================

/**
 * RELAY A PRIVATE WITHDRAWAL
 * 
 * This is the core privacy function!
 * User sends their note, we submit the withdrawal.
 * User is NEVER visible on-chain!
 */
app.post('/relay/withdraw', async (req: Request, res: Response) => {
  try {
    const request: RelayerWithdrawRequest = req.body;

    // Validate request
    if (!request.noteCommitment || !request.nullifier || !request.secret) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing note data (commitment, nullifier, secret)' 
      });
    }
    if (!request.recipient) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing recipient address' 
      });
    }
    if (!request.poolSize || !POOL_LAMPORTS[request.poolSize]) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid poolSize. Use: SMALL, MEDIUM, or LARGE' 
      });
    }

    logger.info('Processing private withdrawal relay', {
      recipient: request.recipient.slice(0, 8) + '...',
      poolSize: request.poolSize,
    });

    // Process the withdrawal
    const result = await mixerRelayer.relayWithdrawal(request);

    if (result.success) {
      logger.info('Private withdrawal successful', { 
        signature: result.signature,
        fee: result.fee,
      });
      res.json({
        success: true,
        signature: result.signature,
        fee: result.fee,
        feeSOL: result.fee ? result.fee / 1e9 : 0,
        recipientAmount: result.recipientAmount,
        recipientAmountSOL: result.recipientAmount ? result.recipientAmount / 1e9 : 0,
        message: 'Private withdrawal successful. Sender identity: HIDDEN',
      });
    } else {
      logger.warn('Private withdrawal failed', { error: result.error });
      res.status(400).json(result);
    }

  } catch (error: any) {
    logger.error('Relay error', { error: error.message });
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

/**
 * RELAY A STEALTH TRANSFER
 * 
 * Even more private: recipient is also hidden!
 */
app.post('/relay/stealth', async (req: Request, res: Response) => {
  try {
    const { noteCommitment, nullifier, secret, recipientStealthMeta, poolSize } = req.body;

    if (!noteCommitment || !nullifier || !secret || !recipientStealthMeta || !poolSize) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    logger.info('Processing stealth transfer relay', { poolSize });

    const result = await stealthRelayer.relayStealthTransfer({
      noteCommitment,
      nullifier,
      secret,
      recipientStealthMeta,
      poolSize,
    });

    if (result.success) {
      res.json({
        success: true,
        signature: result.signature,
        stealthAddress: result.stealthAddress,
        message: 'Stealth transfer successful. Sender AND recipient: HIDDEN',
      });
    } else {
      res.status(400).json(result);
    }

  } catch (error: any) {
    logger.error('Stealth relay error', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initialize() {
  try {
    logger.info('═══════════════════════════════════════');
    logger.info('       VELO RELAYER SERVICE');
    logger.info('═══════════════════════════════════════');

    // Connect to Solana
    connection = new Connection(config.rpcUrl, 'confirmed');
    const version = await connection.getVersion();
    logger.info(`Connected to Solana: ${config.rpcUrl}`);
    logger.info(`Solana version: ${version['solana-core']}`);

    // Load or generate relayer keypair
    if (fs.existsSync(config.relayerKeypairPath)) {
      const keypairData = JSON.parse(fs.readFileSync(config.relayerKeypairPath, 'utf-8'));
      relayerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
      logger.info('Loaded relayer keypair from file');
    } else {
      // Generate new keypair for development
      relayerKeypair = Keypair.generate();
      fs.writeFileSync(
        config.relayerKeypairPath,
        JSON.stringify(Array.from(relayerKeypair.secretKey))
      );
      logger.warn('Generated NEW relayer keypair - FUND IT before use!');
    }

    logger.info(`Relayer address: ${relayerKeypair.publicKey.toString()}`);

    // Check relayer balance
    const balance = await connection.getBalance(relayerKeypair.publicKey);
    logger.info(`Relayer balance: ${balance / 1e9} SOL`);

    if (balance < 0.01 * 1e9) {
      logger.warn('⚠️  Relayer balance LOW! Fund the relayer wallet to process transactions.');
      logger.warn(`    Address: ${relayerKeypair.publicKey.toString()}`);
    }

    // Initialize services
    mixerRelayer = new MixerRelayer(connection, relayerKeypair, config);
    stealthRelayer = new StealthRelayer(connection, relayerKeypair, config);

    // Check if relayer is registered on-chain
    const isRegistered = await mixerRelayer.isRelayerRegistered();
    if (isRegistered) {
      logger.info('✓ Relayer is registered on-chain');
    } else {
      logger.warn('⚠️  Relayer NOT registered on-chain. Run the registration script.');
    }

    // Start server
    app.listen(PORT, () => {
      logger.info('═══════════════════════════════════════');
      logger.info(`✓ Velo Relayer running on port ${PORT}`);
      logger.info(`✓ Program ID: ${VELO_PROGRAM_ID}`);
      logger.info(`✓ Fee: ${config.feePercent}% (min ${config.minFee/1e9} SOL)`);
      logger.info('═══════════════════════════════════════');
    });

  } catch (error: any) {
    logger.error('Failed to initialize relayer', { error: error.message });
    process.exit(1);
  }
}

initialize();
