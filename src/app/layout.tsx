import './globals.css';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export const metadata = {
  title: '在线麻将',
  description: '四人在线麻将游戏',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </head>
      <body>
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
