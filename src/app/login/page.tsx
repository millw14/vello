'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap, Eye, EyeOff, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      router.push('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

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

          {/* Login Box */}
          <div className="border border-terminal p-8">
            <h1 className="text-2xl mb-6 blinking-cursor">{'>'} SYSTEM_LOGIN</h1>

            <form onSubmit={handleSubmit} className="space-y-6">
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
                <label className="text-terminal-dim text-sm block mb-2">PASSWORD:</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="••••••••"
                    className="terminal-input pr-12"
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

              <button
                type="submit"
                disabled={isLoading}
                className="terminal-btn-filled w-full py-4 text-lg font-bold flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    AUTHENTICATING...
                  </>
                ) : (
                  <>{'>'} LOGIN</>
                )}
              </button>
            </form>

            <div className="mt-6 text-center text-terminal-dim">
              <span>No account? </span>
              <Link href="/signup" className="text-[var(--terminal-green)] hover:underline">
                CREATE_ACCOUNT
              </Link>
            </div>
          </div>

          <p className="text-center text-terminal-dim text-sm mt-6">
            Encrypted session • ZK protected
          </p>
        </div>
      </div>
    </div>
  );
}
