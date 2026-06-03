import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Token Optimizer Dashboard',
  description: 'Track AI token savings across Claude Code sessions',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        background: '#0d1117',
        color: '#e6edf3',
        minHeight: '100vh',
      }}>
        {children}
      </body>
    </html>
  );
}
