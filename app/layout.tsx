import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="en">
      <head>
        <link rel="icon" href={`${basePath}/favicon.ico`} type="image/x-icon" />
      </head>
      <body>
        <div id="app" data-baseurl={basePath}>
          {children}
        </div>
      </body>
    </html>
  );
}
