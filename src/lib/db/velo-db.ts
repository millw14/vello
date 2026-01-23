/**
 * VELO Database
 * IndexedDB storage for notes, transfers, and settings
 * Uses Dexie.js for easy IndexedDB management
 */

import Dexie, { Table } from 'dexie';

// Types
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
  timestamp: number;
  claimed: boolean;
  claimedAt?: number;
  txSignature?: string;
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
  type: 'deposit' | 'send' | 'receive' | 'claim';
  amount: number;
  poolSize: string;
  timestamp: number;
  txSignature?: string;
  counterparty?: string;
}

// Database class
class VeloDB extends Dexie {
  notes!: Table<DBNote, string>;
  transfers!: Table<DBTransfer, string>;
  settings!: Table<DBSettings, string>;
  activities!: Table<DBActivity, string>;

  constructor() {
    super('VeloDB');
    
    this.version(1).stores({
      notes: 'id, walletAddress, poolSize, used, createdAt',
      transfers: 'id, sender, recipient, claimed, timestamp',
      settings: 'id, walletAddress',
      activities: 'id, walletAddress, type, timestamp',
    });
  }
}

// Singleton instance
export const db = new VeloDB();

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
