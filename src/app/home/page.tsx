'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import VeloDashboard from '@/components/ui/velo-dashboard';
import { Loader2, Zap } from 'lucide-react';

interface User {
  id: string;
  email: string;
  username: string;
  solanaPublicKey: string;
  solanaSecretKey: string;
  tier: string;
}

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/me');
        
        if (!res.ok) {
          router.push('/login');
          return;
        }

        const data = await res.json();
        setUser(data.user);
      } catch (error) {
        console.error('Auth check failed:', error);
        router.push('/login');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="terminal-container">
        <div className="relative z-10 min-h-screen flex items-center justify-center">
          <div className="text-center">
            <Zap className="w-16 h-16 mx-auto mb-4 terminal-glow" />
            <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin" />
            <p className="text-terminal-dim">Initializing secure session...</p>
            <p className="text-terminal-dim text-sm mt-2">Connecting to Solana network</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <VeloDashboard
      username={user.username}
      publicKey={user.solanaPublicKey}
      secretKey={user.solanaSecretKey}
      tier={user.tier}
      onLogout={handleLogout}
    />
  );
}
