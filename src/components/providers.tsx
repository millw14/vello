'use client';

import { FC, ReactNode } from 'react';
import { SolanaWalletProvider } from './wallet-provider';

interface Props {
  children: ReactNode;
}

export const Providers: FC<Props> = ({ children }) => {
  return (
    <SolanaWalletProvider>
      {children}
    </SolanaWalletProvider>
  );
};
