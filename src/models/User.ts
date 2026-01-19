import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUser extends Document {
  email: string;
  username: string;
  password: string;
  solanaPublicKey: string;
  solanaSecretKey: string; // Encrypted in production
  tier: 'basic' | 'standard' | 'premium' | 'maximum';
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema<IUser> = new Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
    },
    solanaPublicKey: {
      type: String,
      required: true,
    },
    solanaSecretKey: {
      type: String,
      required: true,
    },
    tier: {
      type: String,
      enum: ['basic', 'standard', 'premium', 'maximum'],
      default: 'basic',
    },
  },
  {
    timestamps: true,
  }
);

const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

export default User;
