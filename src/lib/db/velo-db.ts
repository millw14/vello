/**
 * VELO Database
 * IndexedDB storage for notes, transfers, balances, and settings
 * Uses Dexie.js for easy IndexedDB management
 */

import Dexie, { Table } from 'dexie';

// ═══════════════════════════════════════════════════════════════════
// DATABASE TYPES
// ═══════════════════════════════════════════════════════════════════

export interface DBNote {
  id: string;
  walletAddress: string;
  poolSize: 'SMALL' | 'MEDIUM' | 'LARGE';
  amount: number;
  commitment: string;
  nullifier: string;
  secret: string;
  createdAt: number;
  used: boolean;
  usedAt?: number;
  txSignature?: string;
}

export interface DBTransfer {
  id: string;
  sender: string;
  recipient: string;
  encryptedAmount: string;
  amountHint: string;
  amountSOL?: number;
  timestamp: number;
  claimed: boolean;
  claimedAt?: number;
  txSignature?: string;
  isInternal?: boolean;
}

export interface DBPrivateBalance {
  walletAddress: string;
  availableSOL: number;
  pendingSOL: number;
  lockedSOL: number;
  lastUpdated: number;
}

export interface DBInternalTransfer {
  id: string;
  sender: string;
  recipient: string;
  amountSOL: number;
  message?: string;
  timestamp: number;
  status: 'pending' | 'completed' | 'failed';
}

export interface DBExternalSend {
  id: string;
  sender: string;
  recipient: string;
  totalAmountSOL: number;
  sentAmountSOL: number;
  feeSOL: number;
  partsJson: string;  // JSON stringified parts
  status: 'pending' | 'in_progress' | 'completed' | 'partial' | 'failed';
  startedAt: number;
  completedAt?: number;
}

export interface DBVeloUser {
  walletAddress: string;
  username?: string;
  registeredAt: number;
  isActive: boolean;
}

export interface DBSettings {
  id: string;
  walletAddress: string;
  lastSync: number;
  theme: 'dark' | 'light';
  notifications: boolean;
}

export interface DBActivity {
  id: string;
  walletAddress: string;
  type: 'deposit' | 'withdraw' | 'send' | 'receive' | 'internal_send' | 'internal_receive';
  amount: number;
  poolSize?: string;
  timestamp: number;
  txSignature?: string;
  counterparty?: string;
  isInternal?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// DATABASE CLASS
// ═══════════════════════════════════════════════════════════════════

class VeloDB extends Dexie {
  notes!: Table<DBNote, string>;
  transfers!: Table<DBTransfer, string>;
  privateBalances!: Table<DBPrivateBalance, string>;
  internalTransfers!: Table<DBInternalTransfer, string>;
  externalSends!: Table<DBExternalSend, string>;
  veloUsers!: Table<DBVeloUser, string>;
  settings!: Table<DBSettings, string>;
  activities!: Table<DBActivity, string>;

  constructor() {
    super('VeloDB');
    
    this.version(2).stores({
      notes: 'id, walletAddress, poolSize, used, createdAt',
      transfers: 'id, sender, recipient, claimed, timestamp, isInternal',
      privateBalances: 'walletAddress',
      internalTransfers: 'id, sender, recipient, status, timestamp',
      externalSends: 'id, sender, recipient, status, startedAt',
      veloUsers: 'walletAddress, username, isActive',
      settings: 'id, walletAddress',
      activities: 'id, walletAddress, type, timestamp',
    });
  }
}

// Singleton instance
export const db = new VeloDB();

// ═══════════════════════════════════════════════════════════════════
// PRIVATE BALANCE OPERATIONS
// ═══════════════════════════════════════════════════════════════════

export async function getPrivateBalance(walletAddress: string): Promise<DBPrivateBalance> {
  const balance = await db.privateBalances.get(walletAddress);
  if (balance) return balance;
  
  // Create default balance
  const defaultBalance: DBPrivateBalance = {
    walletAddress,
    availableSOL: 0,
    pendingSOL: 0,
    lockedSOL: 0,
    lastUpdated: Date.now(),
  };
  await db.privateBalances.put(defaultBalance);
  return defaultBalance;
}

export async function updatePrivateBalance(
  walletAddress: string,
  update: Partial<Omit<DBPrivateBalance, 'walletAddress'>>
): Promise<DBPrivateBalance> {
  const current = await getPrivateBalance(walletAddress);
  const updated = {
    ...current,
    ...update,
    lastUpdated: Date.now(),
  };
  await db.privateBalances.put(updated);
  return updated;
}

export async function addToPrivateBalance(
  walletAddress: string,
  amountSOL: number
): Promise<DBPrivateBalance> {
  const current = await getPrivateBalance(walletAddress);
  return updatePrivateBalance(walletAddress, {
    availableSOL: current.availableSOL + amountSOL,
  });
}

export async function deductFromPrivateBalance(
  walletAddress: string,
  amountSOL: number
): Promise<{ success: boolean; balance?: DBPrivateBalance; error?: string }> {
  const current = await getPrivateBalance(walletAddress);
  if (current.availableSOL < amountSOL) {
    return { success: false, error: 'Insufficient private balance' };
  }
  const updated = await updatePrivateBalance(walletAddress, {
    availableSOL: current.availableSOL - amountSOL,
  });
  return { success: true, balance: updated };
}

// ═══════════════════════════════════════════════════════════════════
// VELO USER OPERATIONS
// ═══════════════════════════════════════════════════════════════════

export async function registerVeloUser(
  walletAddress: string,
  username?: string
): Promise<DBVeloUser> {
  const user: DBVeloUser = {
    walletAddress,
    username,
    registeredAt: Date.now(),
    isActive: true,
  };
  await db.veloUsers.put(user);
  return user;
}

export async function isVeloUser(walletAddress: string): Promise<boolean> {
  const user = await db.veloUsers.get(walletAddress);
  return user?.isActive ?? false;
}

export async function getVeloUser(walletAddress: string): Promise<DBVeloUser | undefined> {
  return db.veloUsers.get(walletAddress);
}

// ═══════════════════════════════════════════════════════════════════
// INTERNAL TRANSFER OPERATIONS
// ═══════════════════════════════════════════════════════════════════

export async function createInternalTransfer(
  transfer: Omit<DBInternalTransfer, 'id' | 'timestamp' | 'status'>
): Promise<DBInternalTransfer> {
  const id = `int_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const newTransfer: DBInternalTransfer = {
    ...transfer,
    id,
    timestamp: Date.now(),
    status: 'pending',
  };
  await db.internalTransfers.put(newTransfer);
  return newTransfer;
}

export async function completeInternalTransfer(
  transferId: string
): Promise<void> {
  await db.internalTransfers.update(transferId, { status: 'completed' });
}

export async function getInternalTransfers(
  walletAddress: string,
  type: 'sent' | 'received' | 'all' = 'all'
): Promise<DBInternalTransfer[]> {
  if (type === 'sent') {
    return db.internalTransfers.where('sender').equals(walletAddress).toArray();
  }
  if (type === 'received') {
    return db.internalTransfers.where('recipient').equals(walletAddress).toArray();
  }
  // All transfers involving this wallet
  const sent = await db.internalTransfers.where('sender').equals(walletAddress).toArray();
  const received = await db.internalTransfers.where('recipient').equals(walletAddress).toArray();
  return [...sent, ...received].sort((a, b) => b.timestamp - a.timestamp);
}

// ═══════════════════════════════════════════════════════════════════
// EXTERNAL SEND OPERATIONS
// ═══════════════════════════════════════════════════════════════════

export async function createExternalSend(
  send: Omit<DBExternalSend, 'id' | 'startedAt' | 'status' | 'sentAmountSOL' | 'feeSOL'>
): Promise<DBExternalSend> {
  const id = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const newSend: DBExternalSend = {
    ...send,
    id,
    startedAt: Date.now(),
    status: 'pending',
    sentAmountSOL: 0,
    feeSOL: 0,
  };
  await db.externalSends.put(newSend);
  return newSend;
}

export async function updateExternalSend(
  sendId: string,
  update: Partial<DBExternalSend>
): Promise<void> {
  await db.externalSends.update(sendId, update);
}

export async function getExternalSends(
  walletAddress: string,
  status?: DBExternalSend['status']
): Promise<DBExternalSend[]> {
  let query = db.externalSends.where('sender').equals(walletAddress);
  if (status) {
    query = query.and(s => s.status === status);
  }
  return query.reverse().toArray();
}

// ═══════════════════════════════════════════════════════════════════
// NOTES OPERATIONS
// ═══════════════════════════════════════════════════════════════════

export async function saveNote(note: DBNote): Promise<void> {
  await db.notes.put(note);
}

export async function getNotes(walletAddress: string): Promise<DBNote[]> {
  return db.notes.where('walletAddress').equals(walletAddress).toArray();
}

export async function getAvailableNotes(walletAddress: string): Promise<DBNote[]> {
  return db.notes
    .where('walletAddress')
    .equals(walletAddress)
    .and(note => !note.used)
    .toArray();
}

export async function getNotesByPool(
  walletAddress: string,
  poolSize: 'SMALL' | 'MEDIUM' | 'LARGE'
): Promise<DBNote[]> {
  return db.notes
    .where('walletAddress')
    .equals(walletAddress)
    .and(note => note.poolSize === poolSize && !note.used)
    .toArray();
}

export async function markNoteUsed(noteId: string, txSignature?: string): Promise<void> {
  await db.notes.update(noteId, {
    used: true,
    usedAt: Date.now(),
    txSignature,
  });
}

export async function deleteNote(noteId: string): Promise<void> {
  await db.notes.delete(noteId);
}

// ═══════════════════════════════════════════════════════════════════
// TRANSFERS OPERATIONS
// ═══════════════════════════════════════════════════════════════════

export async function saveTransfer(transfer: DBTransfer): Promise<void> {
  await db.transfers.put(transfer);
}

export async function getPendingIncoming(walletAddress: string): Promise<DBTransfer[]> {
  return db.transfers
    .where('recipient')
    .equals(walletAddress)
    .and(t => !t.claimed)
    .toArray();
}

export async function getPendingOutgoing(walletAddress: string): Promise<DBTransfer[]> {
  return db.transfers
    .where('sender')
    .equals(walletAddress)
    .and(t => !t.claimed)
    .toArray();
}

export async function markTransferClaimed(
  transferId: string,
  txSignature?: string
): Promise<void> {
  await db.transfers.update(transferId, {
    claimed: true,
    claimedAt: Date.now(),
    txSignature,
  });
}

export async function getTransferById(transferId: string): Promise<DBTransfer | undefined> {
  return db.transfers.get(transferId);
}

// ═══════════════════════════════════════════════════════════════════
// ACTIVITY LOG
// ═══════════════════════════════════════════════════════════════════

export async function logActivity(activity: Omit<DBActivity, 'id'>): Promise<void> {
  const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.activities.put({ ...activity, id });
}

export async function getActivities(
  walletAddress: string,
  limit = 50
): Promise<DBActivity[]> {
  return db.activities
    .where('walletAddress')
    .equals(walletAddress)
    .reverse()
    .limit(limit)
    .toArray();
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════

export async function getSettings(walletAddress: string): Promise<DBSettings | undefined> {
  return db.settings.where('walletAddress').equals(walletAddress).first();
}

export async function saveSettings(settings: DBSettings): Promise<void> {
  await db.settings.put(settings);
}

// ═══════════════════════════════════════════════════════════════════
// BALANCE CALCULATIONS
// ═══════════════════════════════════════════════════════════════════

export interface VeloBalanceInfo {
  // Private balance (off-chain, arbitrary amounts)
  privateBalance: number;
  pendingBalance: number;
  
  // Pool notes (on-chain, fixed denominations)
  poolBalance: number;
  byPool: Record<'SMALL' | 'MEDIUM' | 'LARGE', number>;
  noteCount: number;
  
  // Total
  totalPrivate: number;
}

export async function getVeloBalance(walletAddress: string): Promise<{
  total: number;
  byPool: Record<'SMALL' | 'MEDIUM' | 'LARGE', number>;
  noteCount: number;
}> {
  const notes = await getAvailableNotes(walletAddress);
  
  const byPool = {
    SMALL: 0,
    MEDIUM: 0,
    LARGE: 0,
  };
  
  let total = 0;
  for (const note of notes) {
    byPool[note.poolSize] += note.amount;
    total += note.amount;
  }
  
  return { total, byPool, noteCount: notes.length };
}

export async function getFullVeloBalance(walletAddress: string): Promise<VeloBalanceInfo> {
  // Get private balance
  const privateBalanceData = await getPrivateBalance(walletAddress);
  
  // Get pool notes balance
  const notes = await getAvailableNotes(walletAddress);
  const byPool = { SMALL: 0, MEDIUM: 0, LARGE: 0 };
  let poolBalance = 0;
  
  for (const note of notes) {
    byPool[note.poolSize] += note.amount;
    poolBalance += note.amount;
  }
  
  return {
    privateBalance: privateBalanceData.availableSOL,
    pendingBalance: privateBalanceData.pendingSOL,
    poolBalance,
    byPool,
    noteCount: notes.length,
    totalPrivate: privateBalanceData.availableSOL + poolBalance,
  };
}

// ═══════════════════════════════════════════════════════════════════
// MIGRATION / IMPORT FROM LOCALSTORAGE
// ═══════════════════════════════════════════════════════════════════

export async function migrateFromLocalStorage(walletAddress: string): Promise<void> {
  // Check if already migrated
  const existing = await getNotes(walletAddress);
  if (existing.length > 0) return;

  // Migrate old notes
  const oldNotesKey = `velo_v2_notes_${walletAddress}`;
  const oldNotes = localStorage.getItem(oldNotesKey);
  
  if (oldNotes) {
    try {
      const notes = JSON.parse(oldNotes);
      for (const note of notes) {
        await saveNote({
          id: note.id || `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          walletAddress,
          poolSize: note.poolSize,
          amount: note.amount,
          commitment: note.commitment,
          nullifier: note.nullifier,
          secret: note.secret,
          createdAt: note.createdAt || Date.now(),
          used: note.used || false,
        });
      }
      console.log(`Migrated ${notes.length} notes from localStorage`);
    } catch (e) {
      console.error('Failed to migrate notes:', e);
    }
  }

  // Migrate old pending transfers
  const oldPendingKey = `velo_v2_pending`;
  const oldPending = localStorage.getItem(oldPendingKey);
  
  if (oldPending) {
    try {
      const transfers = JSON.parse(oldPending);
      for (const t of transfers) {
        if (t.sender === walletAddress || t.recipient === walletAddress) {
          await saveTransfer({
            id: t.id,
            sender: t.sender,
            recipient: t.recipient,
            encryptedAmount: t.encryptedAmount,
            amountHint: t.amountHint || 'SMALL',
            timestamp: t.timestamp,
            claimed: t.claimed || false,
            claimedAt: t.claimedAt,
          });
        }
      }
      console.log(`Migrated transfers from localStorage`);
    } catch (e) {
      console.error('Failed to migrate transfers:', e);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// CLEAR DATA (for testing)
// ═══════════════════════════════════════════════════════════════════

export async function clearAllData(): Promise<void> {
  await db.notes.clear();
  await db.transfers.clear();
  await db.activities.clear();
  await db.settings.clear();
}

export async function clearWalletData(walletAddress: string): Promise<void> {
  await db.notes.where('walletAddress').equals(walletAddress).delete();
  await db.activities.where('walletAddress').equals(walletAddress).delete();
}

export async function clearOldTransfers(walletAddress: string): Promise<void> {
  // Clear all unclaimed transfers for this wallet (old invalid ones)
  await db.transfers
    .where('recipient')
    .equals(walletAddress)
    .and(t => !t.claimed)
    .delete();
  await db.transfers
    .where('sender')
    .equals(walletAddress)
    .and(t => !t.claimed)
    .delete();
}
