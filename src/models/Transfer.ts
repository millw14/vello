import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ITransfer extends Document {
  transferId: string;
  sender: string;
  recipient: string;
  amount: number;
  poolSize: 'SMALL' | 'MEDIUM' | 'LARGE';
  status: 'pending' | 'claimed' | 'expired';
  escrowSecret: string; // Encrypted escrow keypair for actual SOL transfer
  createdAt: Date;
  claimedAt?: Date;
  txSignature?: string;
}

const TransferSchema: Schema<ITransfer> = new Schema(
  {
    transferId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    sender: {
      type: String,
      required: true,
      index: true,
    },
    recipient: {
      type: String,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    poolSize: {
      type: String,
      enum: ['SMALL', 'MEDIUM', 'LARGE'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'claimed', 'expired'],
      default: 'pending',
    },
    escrowSecret: {
      type: String,
      required: true,
    },
    claimedAt: {
      type: Date,
    },
    txSignature: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Index for finding pending transfers for a recipient
TransferSchema.index({ recipient: 1, status: 1 });

const Transfer: Model<ITransfer> = mongoose.models.Transfer || mongoose.model<ITransfer>('Transfer', TransferSchema);

export default Transfer;
