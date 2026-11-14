import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BRAND } from '@aiv/core';
import './globals.css';

export const metadata: Metadata = {
  title: BRAND.productName,
  description: BRAND.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
