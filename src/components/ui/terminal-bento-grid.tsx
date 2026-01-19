import React from 'react';
import { cn } from '@/lib/utils';

interface BentoItemProps {
  className?: string;
  children: React.ReactNode;
}

export const BentoItem = ({ className, children }: BentoItemProps) => {
  return (
    <div className={cn('bento-item', className)}>
      {children}
    </div>
  );
};

export const BentoGrid = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  return (
    <div className={cn('bento-grid', className)}>
      {children}
    </div>
  );
};

export default BentoItem;
