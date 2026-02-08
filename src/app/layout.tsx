import type { Metadata } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://velo.up.railway.app"),
  title: "Velo | Private Solana Transfers",
  description: "Private transfers on Solana with hidden amounts. Connect your wallet, deposit, and send privately.",
  keywords: ["Solana", "Privacy", "Mixer", "Private Transfers", "Crypto"],
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
  openGraph: {
    title: "Velo | Private Solana Transfers",
    description: "Send SOL with hidden amounts. Your balance, your privacy, your control.",
    type: "website",
    siteName: "Velo",
  },
  twitter: {
    card: "summary_large_image",
    title: "Velo | Private Solana Transfers",
    description: "Send SOL with hidden amounts. Your balance, your privacy, your control.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${outfit.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
