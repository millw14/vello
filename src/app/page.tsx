'use client';

import Spline from '@splinetool/react-spline';
import Link from 'next/link';

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

    </main>
  );
}
