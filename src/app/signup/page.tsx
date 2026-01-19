'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap, Eye, EyeOff, Loader2, Check } from 'lucide-react';

export default function SignupPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ publicKey: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          username: formData.username,
          password: formData.password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Signup failed');
      }

      setSuccess({ publicKey: data.user.solanaPublicKey });
      
      setTimeout(() => {
        router.push('/login');
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="terminal-container">
        <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
          <div className="w-full max-w-md text-center">
            <div className="border border-[var(--terminal-green)] p-8">
              <Check className="w-16 h-16 mx-auto mb-4" />
              <h2 className="text-2xl mb-4">[SUCCESS] ACCOUNT_CREATED</h2>
              <p className="text-terminal-dim mb-6">Your Solana wallet has been generated:</p>
              <div className="p-4 bg-[rgba(0,255,157,0.05)] border border-terminal mb-6">
                <code className="text-terminal-cyan text-sm break-all">{success.publicKey}</code>
              </div>
              <p className="text-terminal-dim text-sm">Redirecting to login...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-container">
      <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-10">
            <Link href="/" className="inline-block">
              <div className="text-4xl font-bold terminal-glow mb-2">
                <Zap className="inline w-10 h-10 mr-2" />
                VELO
              </div>
            </Link>
            <p className="text-terminal-dim">Private Solana Transfers</p>
          </div>

          {/* Signup Box */}
          <div className="border border-terminal p-8">
            <h1 className="text-2xl mb-6 blinking-cursor">{'>'} CREATE_ACCOUNT</h1>

            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="p-3 border border-[#ff4444] text-[#ff4444] text-sm">
                  [ERROR] {error}
                </div>
              )}

              <div>
                <label className="text-terminal-dim text-sm block mb-2">EMAIL:</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="user@example.com"
                  className="terminal-input"
                  required
                />
              </div>

              <div>
                <label className="text-terminal-dim text-sm block mb-2">USERNAME:</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder="satoshi"
                  className="terminal-input"
                  minLength={3}
                  maxLength={20}
                  required
                />
              </div>

              <div>
                <label className="text-terminal-dim text-sm block mb-2">PASSWORD:</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="••••••••"
                    className="terminal-input pr-12"
                    minLength={6}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-terminal-dim hover:text-[var(--terminal-green)]"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-terminal-dim text-sm block mb-2">CONFIRM_PASSWORD:</label>
                <input
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  placeholder="••••••••"
                  className="terminal-input"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="terminal-btn-filled w-full py-4 text-lg font-bold flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    GENERATING_WALLET...
                  </>
                ) : (
                  <>{'>'} CREATE_ACCOUNT</>
                )}
              </button>
            </form>

            <div className="mt-6 text-center text-terminal-dim">
              <span>Have an account? </span>
              <Link href="/login" className="text-[var(--terminal-green)] hover:underline">
                LOGIN
              </Link>
            </div>
          </div>

          <p className="text-center text-terminal-dim text-sm mt-6">
            Wallet keys generated client-side • Encrypted storage
          </p>
        </div>
      </div>
    </div>
  );
}
