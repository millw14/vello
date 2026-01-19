import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import dbConnect from '@/lib/db';
import User from '@/models/User';

export async function POST(request: NextRequest) {
  try {
    await dbConnect();

    const { email, username, password } = await request.json();

    // Validate input
    if (!email || !username || !password) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username }],
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email or username already exists' },
        { status: 400 }
      );
    }

    // Generate Solana wallet
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toBase58();
    const secretKey = bs58.encode(keypair.secretKey);

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = await User.create({
      email: email.toLowerCase(),
      username,
      password: hashedPassword,
      solanaPublicKey: publicKey,
      solanaSecretKey: secretKey, // In production, encrypt this!
      tier: 'basic',
    });

    return NextResponse.json(
      {
        message: 'Account created successfully',
        user: {
          id: user._id,
          email: user.email,
          username: user.username,
          solanaPublicKey: user.solanaPublicKey,
          tier: user.tier,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
