import type { Metadata, Viewport } from "next";
import { Archivo, DM_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });
const dmMono = DM_Mono({ subsets: ["latin"], weight: "500", variable: "--font-dm-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://filmclub.watch"),
  title: "Filmclub",
  description: "Swipe together. Pick one film.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Filmclub", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU" className={`${archivo.variable} ${dmMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
