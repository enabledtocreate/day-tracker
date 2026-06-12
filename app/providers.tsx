'use client';

import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="day-tracker-theme">
      <TooltipProvider delay={200}>
        {children}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
