import './globals.css';

export const metadata = {
  title: '中国麻将在线',
  description: '四人在线中国麻将游戏',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
