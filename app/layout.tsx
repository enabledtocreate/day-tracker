import type { Metadata } from 'next';
import './globals.css';
import { Inter } from 'next/font/google';
import { Providers } from '@/app/providers';
import { DT } from '@/lib/uiIdentifiers';
import { cn } from '@/lib/utils';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Day Tracker',
  description: 'Day Tracker',
};

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn('font-sans', inter.variable)} suppressHydrationWarning>
      <head>
        <link rel="icon" href={`${basePath}/favicon.ico`} type="image/x-icon" />
      </head>
      <body>
        <Providers>
          <div id="app" className={DT.appMount} data-baseurl={basePath}>
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
