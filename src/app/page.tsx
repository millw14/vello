'use client';

import Spline from '@splinetool/react-spline';
import Link from 'next/link';
import { Zap } from 'lucide-react';

export default function Home() {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0a0a0a]">
      {/* Spline 3D Background */}
      <div className="absolute inset-0 z-0">
        <Spline
          scene="https://prod.spline.design/M7kBEFoks4GMluBb/scene.splinecode"
          className="w-full h-full"
        />
      </div>

      {/* Scanline effect overlay */}
      <div className="absolute inset-0 z-[1] pointer-events-none">
        <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(0,255,157,0.03)_0px,rgba(0,255,157,0.03)_1px,transparent_1px,transparent_2px)]" />
      </div>

      {/* Navigation */}
      <nav className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-2 text-[#00ff9d]">
          <Zap className="w-8 h-8" />
          <span className="text-2xl font-bold">VELO</span>
        </div>

        <div className="flex items-center gap-4">
          <Link 
            href="/login"
            className="px-5 py-2.5 text-[#00ff9d] text-sm font-mono hover:underline transition-all"
          >
            LOGIN
          </Link>
          <Link 
            href="/signup"
            className="px-6 py-2.5 bg-[#00ff9d] text-[#0a0a0a] text-sm font-bold font-mono hover:shadow-[0_0_20px_rgba(0,255,157,0.5)] transition-all"
          >
            {'>'} GET_STARTED
          </Link>
        </div>
      </nav>
    </main>
  );
}
