'use client';

import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { ScheduleQueryProvider } from '@/lib/scheduleData';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="day-tracker-theme">
      <ScheduleQueryProvider>
        <TooltipProvider delay={200}>
          {children}
          <Toaster />
        </TooltipProvider>
      </ScheduleQueryProvider>
    </ThemeProvider>
  );
}
