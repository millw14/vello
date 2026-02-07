/**
 * cSOL MINT CONSTANTS
 * Auto-generated on 2026-01-26T22:00:22.122Z
 * Network: devnet
 */

import { PublicKey } from '@solana/web3.js';

// cSOL Token-2022 Mint
export const CSOL_MINT = new PublicKey('5YYiu4CRi2qiW1reQgq3j5mFbc3WpXz6dJZrGaxFwQZN');
export const CSOL_DECIMALS = 9;

// Velo Authority (can mint/burn cSOL)
export const VELO_AUTHORITY = new PublicKey('2fuscGagY6Py69DNGyuC6C16b9oZGGxLDx6F9vsWhtiX');

// Fee configuration
export const CSOL_FEE_BASIS_POINTS = 50; // 0.5%
export const CSOL_MAX_FEE = BigInt('1000000000');
