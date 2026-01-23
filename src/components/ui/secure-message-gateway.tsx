"use client";

import React, { useState } from "react";
import { Send, Terminal, PlusIcon, Lock, Wallet, Shield, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function CreateCorners({ children }: { children: React.ReactNode }) {
  const positions = [
    "top-0 -left-3",
    "top-0 -right-3",
    "bottom-0 -left-3",
    "bottom-0 -right-3",
  ];

  return (
    <div className="absolute z-10 inset-0 pointer-events-none">
      {positions.map((pos, index) => (
        <section key={index} className={`absolute ${pos}`}>
          {children}
        </section>
      ))}
    </div>
  );
}

interface SecureMessageGatewayProps {
  title?: string;
  subtitle?: string;
  placeholder?: string;
  buttonText?: string;
  onSubmit?: (message: string) => Promise<void> | void;
  disabled?: boolean;
  statusReady?: string;
  statusPending?: string;
  secureId?: string;
  icon?: React.ReactNode;
  showPrivacyIndicator?: boolean;
  variant?: 'default' | 'compact' | 'minimal';
}

export const SecureMessageGateway = ({
  title = "Private Transfer",
  subtitle = "with Velo",
  placeholder = "ENTER RECIPIENT ADDRESS >>",
  buttonText = "SEND",
  onSubmit,
  disabled = false,
  statusReady = "Ready",
  statusPending = "Processing...",
  secureId = "VELO_SECURE",
  icon,
  showPrivacyIndicator = true,
  variant = 'default',
}: SecureMessageGatewayProps) => {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!message.trim() || pending || disabled) return;

    setPending(true);
    try {
      if (onSubmit) {
        await onSubmit(message);
      }
      setMessage("");
    } finally {
      setPending(false);
    }
  }

  if (variant === 'minimal') {
    return (
      <form onSubmit={handleSubmit} className="flex items-stretch gap-2">
        <div className="relative flex-1 group">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-[#00ff9d] transition-colors">
            <Terminal size={14} />
          </div>
          <input
            type="text"
            autoComplete="off"
            placeholder={placeholder}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={pending || disabled}
            className={cn(
              "w-full bg-black/50 border border-gray-800 rounded-none h-10",
              "font-mono text-xs p-3 pl-9 outline-none transition-all",
              "placeholder:text-gray-600 text-white",
              "focus:bg-[#00ff9d]/5 focus:border-[#00ff9d]/50 border-dashed",
              (pending || disabled) && "opacity-50 cursor-not-allowed"
            )}
          />
        </div>
        <button
          type="submit"
          disabled={pending || !message.trim() || disabled}
          className={cn(
            "px-6 border bg-[#00ff9d] text-black font-mono font-bold text-xs min-h-10 transition-all flex items-center gap-2",
            !pending && message.trim() && !disabled && "hover:bg-[#00ff9d]/80 active:scale-95",
            (pending || !message.trim() || disabled) && "opacity-40 cursor-not-allowed bg-gray-700 text-gray-400 border-gray-700"
          )}
        >
          <Send size={12} className={cn(pending && "animate-bounce")} />
          {pending ? "..." : buttonText}
        </button>
      </form>
    );
  }

  return (
    <div className={cn(
      "flex items-center justify-center w-full bg-transparent",
      variant === 'compact' ? 'p-2' : 'p-4'
    )}>
      <div className={cn(
        "relative w-full max-w-2xl bg-black/30 border border-[#00ff9d]/20 border-dashed shadow-lg transition-all rounded-none backdrop-blur-sm",
        variant === 'compact' ? 'p-4' : 'p-6 sm:p-8'
      )}>

        <CreateCorners>
          <PlusIcon className="w-4 h-4 text-[#00ff9d]/60"/>
        </CreateCorners>

        {/* Diagonal Fade Grid Background */}
        <div className="min-h-full z-0 w-full bg-transparent absolute top-0 left-0 pointer-events-none overflow-hidden">
          <div
            className="absolute inset-0 z-0"
            style={{
              backgroundImage: `
                linear-gradient(to right, rgba(0,255,157,0.05) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(0,255,157,0.05) 1px, transparent 1px)
              `,
              backgroundSize: "24px 24px",
              WebkitMaskImage:
                "radial-gradient(ellipse 100% 100% at 0% 0%, #000 30%, transparent 70%)",
              maskImage:
                "radial-gradient(ellipse 100% 100% at 0% 0%, #000 30%, transparent 70%)",
            }}
          />
        </div>

        <div className="relative z-10">
          {/* Header */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 bg-[#00ff9d] rounded-full animate-pulse" />
              <span className="text-[0.6rem] font-mono uppercase tracking-[0.2em] text-[#00ff9d]">
                {title}
              </span>
              {showPrivacyIndicator && (
                <span className="ml-auto flex items-center gap-1 text-[0.5rem] font-mono text-[#00ff9d]/60 bg-[#00ff9d]/10 px-2 py-0.5">
                  <Shield size={8} />
                  ENCRYPTED
                </span>
              )}
            </div>
            <h1 className="text-lg font-semibold text-white tracking-tight flex items-center gap-2">
              {icon || <Lock size={16} className="text-[#00ff9d]" />}
              <span className="text-[#00ff9d]">{title}</span>
              <span className="text-gray-500 text-sm font-normal">{subtitle}</span>
            </h1>
          </div>

          {/* INPUT & BUTTON */}
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-stretch gap-2">
            
            <div className="relative flex-1 group">
              {/* Corner accents */}
              <div className="absolute -top-[1px] -left-[1px] w-2 h-2 border-t-2 border-l-2 border-[#00ff9d] opacity-0 group-focus-within:opacity-100 transition-all duration-200" />
              <div className="absolute -bottom-[1px] -right-[1px] w-2 h-2 border-b-2 border-r-2 border-[#00ff9d] opacity-0 group-focus-within:opacity-100 transition-all duration-200" />

              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600 group-focus-within:text-[#00ff9d] transition-colors duration-200">
                <Terminal size={14} />
              </div>

              <input
                type="text"
                autoComplete="off"
                placeholder={placeholder}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={pending || disabled}
                className={cn(
                  "w-full bg-black/60 border border-gray-800 rounded-none h-11",
                  "font-mono text-xs p-3 pl-10 outline-none transition-all duration-200",
                  "placeholder:text-gray-600 text-white",
                  "focus:bg-[#00ff9d]/5 focus:ring-1 focus:ring-[#00ff9d]/30 focus:border-[#00ff9d]/60 border-dashed",
                  (pending || disabled) && "opacity-50 cursor-not-allowed"
                )}
              />
            </div>

            <button
              type="submit"
              disabled={pending || !message.trim() || disabled}
              className={cn(
                "px-6 sm:px-8 h-11 border font-mono font-bold uppercase text-[0.65rem] tracking-[0.15em] transition-all duration-200 flex items-center justify-center gap-2 rounded-none",
                !pending && message.trim() && !disabled 
                  ? "bg-[#00ff9d] text-black border-[#00ff9d] hover:bg-[#00ff9d]/80 active:scale-[0.98]" 
                  : "bg-gray-900 text-gray-500 border-gray-800 border-dashed opacity-60 cursor-not-allowed"
              )}
            >
              <Send size={12} className={cn(pending && "animate-bounce")} />
              <span>{pending ? "SENDING..." : buttonText}</span>
            </button>
          </form>

          {/* Status Line */}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-[0.55rem] font-mono uppercase tracking-widest text-gray-500 flex items-center gap-2">
              STATUS: 
              {pending ? (
                <span className="text-yellow-400 animate-pulse">{statusPending}</span>
              ) : (
                <span className="text-[#00ff9d] bg-[#00ff9d]/10 px-1.5 py-0.5 border border-[#00ff9d]/30">
                  {statusReady}
                </span>
              )}
            </span>
            <span className="text-[0.5rem] font-mono text-gray-700">
              {secureId}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Velo-specific variant for private transfers
interface VeloTransferInputProps {
  onSend: (recipient: string) => Promise<void>;
  disabled?: boolean;
  balance?: number;
  selectedAmount?: number;
  poolSize?: string;
}

export const VeloTransferInput = ({
  onSend,
  disabled = false,
  balance = 0,
  selectedAmount = 0,
  poolSize = 'SMALL',
}: VeloTransferInputProps) => {
  return (
    <SecureMessageGateway
      title="Send Private"
      subtitle={`${selectedAmount} SOL`}
      placeholder="PASTE RECIPIENT WALLET ADDRESS >>"
      buttonText="SEND"
      onSubmit={onSend}
      disabled={disabled || balance < selectedAmount}
      statusReady="Ready"
      statusPending="Encrypting..."
      secureId={`POOL: ${poolSize}`}
      icon={<Wallet size={16} className="text-[#00ff9d]" />}
      variant="default"
    />
  );
};

// Privacy badge component
export const PrivacyBadge = ({ level = 'high' }: { level?: 'high' | 'medium' | 'low' }) => {
  const colors = {
    high: 'text-[#00ff9d] bg-[#00ff9d]/10 border-[#00ff9d]/30',
    medium: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
    low: 'text-red-400 bg-red-400/10 border-red-400/30',
  };
  
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 text-[0.5rem] font-mono uppercase tracking-wider border",
      colors[level]
    )}>
      {level === 'high' ? <EyeOff size={8} /> : <Eye size={8} />}
      {level.toUpperCase()} PRIVACY
    </span>
  );
};

export default SecureMessageGateway;
