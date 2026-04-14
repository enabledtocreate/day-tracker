import type { Metadata } from 'next';
import './globals.css';
import { DT } from '@/lib/uiIdentifiers';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

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
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <head>
        <link rel="icon" href={`${basePath}/favicon.ico`} type="image/x-icon" />
      </head>
      <body>
        <div id="app" className={DT.appMount} data-baseurl={basePath}>
          {children}
        </div>
      </body>
    </html>
  );
}
