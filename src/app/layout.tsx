/**
 * 根布局 - App Router 默认 RSC
 * QueryProvider 包裹客户端，供 React Query 使用
 */
import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/components/providers/QueryProvider';

export const metadata: Metadata = {
  title: 'IM Demo - Help & Support',
  description: 'IM Demo Customer Support System - Smart Assistant & Live Agent Chat',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
