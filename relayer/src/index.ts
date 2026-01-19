/**
 * Velo Relayer Service
 * 
 * Submits private transactions on behalf of users to hide their IP/wallet.
 * Collects fees for the service.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as dotenv from 'dotenv';
import { logger } from './utils/logger';
import { validateWithdrawRequest, validateTransferRequest } from './validators';
import { RelayerConfig, WithdrawRequest, TransferRequest, RelayResult } from './types';
import { MixerRelayer } from './services/mixer';
import { PrivateTxRelayer } from './services/privateTx';
import { StealthRelayer } from './services/stealth';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration
const config: RelayerConfig = {
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  relayerKeypairPath: process.env.RELAYER_KEYPAIR_PATH || './relayer-keypair.json',
  minFee: parseInt(process.env.MIN_FEE || '10000'), // 0.00001 SOL minimum
  maxFee: parseInt(process.env.MAX_FEE || '100000000'), // 0.1 SOL maximum
  feePercent: parseFloat(process.env.FEE_PERCENT || '0.5'), // 0.5% default fee
  mixerProgramId: process.env.MIXER_PROGRAM_ID || 'VeLoMix1111111111111111111111111111111111111',
  privateTxProgramId: process.env.PRIVATE_TX_PROGRAM_ID || 'VeLoPTx1111111111111111111111111111111111111',
  stealthProgramId: process.env.STEALTH_PROGRAM_ID || 'VeLoStH1111111111111111111111111111111111111',
};

// Initialize connection and relayer wallet
let connection: Connection;
let relayerKeypair: Keypair;

// Service instances
let mixerRelayer: MixerRelayer;
let privateTxRelayer: PrivateTxRelayer;
let stealthRelayer: StealthRelayer;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  next();
});

// ============================================================================
// ENDPOINTS
// ============================================================================

/**
 * Health check
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    relayer: relayerKeypair?.publicKey?.toString(),
    network: config.rpcUrl.includes('devnet') ? 'devnet' : 'mainnet',
    timestamp: Date.now(),
  });
});

/**
 * Get relayer info and fee schedule
 */
app.get('/info', (req: Request, res: Response) => {
  res.json({
    relayerAddress: relayerKeypair.publicKey.toString(),
    feePercent: config.feePercent,
    minFee: config.minFee,
    maxFee: config.maxFee,
    supportedPools: ['0.1 SOL', '1 SOL', '10 SOL'],
    programs: {
      mixer: config.mixerProgramId,
      privateTx: config.privateTxProgramId,
      stealth: config.stealthProgramId,
    },
  });
});

/**
 * Estimate fee for a transaction
 */
app.post('/estimate-fee', (req: Request, res: Response) => {
  const { amount, type } = req.body;
  
  if (!amount || !type) {
    return res.status(400).json({ error: 'Missing amount or type' });
  }

  const amountLamports = parseFloat(amount) * 1e9;
  let fee = Math.floor(amountLamports * (config.feePercent / 100));
  
  // Apply min/max
  fee = Math.max(fee, config.minFee);
  fee = Math.min(fee, config.maxFee);

  res.json({
    estimatedFee: fee,
    feeSOL: fee / 1e9,
    netAmount: amountLamports - fee,
    netAmountSOL: (amountLamports - fee) / 1e9,
  });
});

/**
 * Relay a mixer withdrawal
 */
app.post('/relay/mixer/withdraw', async (req: Request, res: Response) => {
  try {
    const validation = validateWithdrawRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const request: WithdrawRequest = req.body;
    
    logger.info('Processing mixer withdrawal relay', {
      recipient: request.recipient,
      pool: request.poolDenomination,
    });

    const result = await mixerRelayer.relayWithdrawal(request);
    
    if (result.success) {
      logger.info('Withdrawal relay successful', { signature: result.signature });
      res.json(result);
    } else {
      logger.error('Withdrawal relay failed', { error: result.error });
      res.status(500).json(result);
    }
  } catch (error: any) {
    logger.error('Withdrawal relay error', { error: error.message });
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

/**
 * Relay a private transfer
 */
app.post('/relay/private-transfer', async (req: Request, res: Response) => {
  try {
    const validation = validateTransferRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const request: TransferRequest = req.body;
    
    logger.info('Processing private transfer relay', {
      publicAmount: request.publicAmount,
    });

    const result = await privateTxRelayer.relayTransfer(request);
    
    if (result.success) {
      logger.info('Private transfer relay successful', { signature: result.signature });
      res.json(result);
    } else {
      logger.error('Private transfer relay failed', { error: result.error });
      res.status(500).json(result);
    }
  } catch (error: any) {
    logger.error('Private transfer relay error', { error: error.message });
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

/**
 * Relay a stealth payment
 */
app.post('/relay/stealth/send', async (req: Request, res: Response) => {
  try {
    const { recipientMeta, amount, senderSignedTx } = req.body;
    
    if (!recipientMeta || !amount || !senderSignedTx) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    logger.info('Processing stealth payment relay', {
      recipientMeta,
      amount,
    });

    const result = await stealthRelayer.relayStealthPayment(
      recipientMeta,
      amount,
      senderSignedTx
    );
    
    if (result.success) {
      logger.info('Stealth payment relay successful', { signature: result.signature });
      res.json(result);
    } else {
      logger.error('Stealth payment relay failed', { error: result.error });
      res.status(500).json(result);
    }
  } catch (error: any) {
    logger.error('Stealth payment relay error', { error: error.message });
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

/**
 * Get pending transactions (for monitoring)
 */
app.get('/pending', async (req: Request, res: Response) => {
  // In production, this would query a Redis queue
  res.json({
    pending: 0,
    avgProcessingTime: '2.5s',
  });
});

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initialize() {
  try {
    // Connect to Solana
    connection = new Connection(config.rpcUrl, 'confirmed');
    logger.info(`Connected to Solana: ${config.rpcUrl}`);

    // Load or generate relayer keypair
    try {
      const fs = await import('fs');
      if (fs.existsSync(config.relayerKeypairPath)) {
        const keypairData = JSON.parse(fs.readFileSync(config.relayerKeypairPath, 'utf-8'));
        relayerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
      } else {
        // Generate new keypair for development
        relayerKeypair = Keypair.generate();
        fs.writeFileSync(
          config.relayerKeypairPath,
          JSON.stringify(Array.from(relayerKeypair.secretKey))
        );
        logger.warn('Generated new relayer keypair - fund it before use!');
      }
    } catch (e) {
      relayerKeypair = Keypair.generate();
      logger.warn('Using ephemeral relayer keypair');
    }

    logger.info(`Relayer public key: ${relayerKeypair.publicKey.toString()}`);

    // Check relayer balance
    const balance = await connection.getBalance(relayerKeypair.publicKey);
    logger.info(`Relayer balance: ${balance / 1e9} SOL`);

    if (balance < 0.1 * 1e9) {
      logger.warn('Relayer balance low! Please fund the relayer wallet.');
    }

    // Initialize service instances
    mixerRelayer = new MixerRelayer(connection, relayerKeypair, config);
    privateTxRelayer = new PrivateTxRelayer(connection, relayerKeypair, config);
    stealthRelayer = new StealthRelayer(connection, relayerKeypair, config);

    // Start server
    app.listen(PORT, () => {
      logger.info(`Velo Relayer running on port ${PORT}`);
    });

  } catch (error: any) {
    logger.error('Failed to initialize relayer', { error: error.message });
    process.exit(1);
  }
}

initialize();
