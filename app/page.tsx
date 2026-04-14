'use client';

import { useEffect, useState } from 'react';
import { MainApp } from '@/components/MainApp';
import { DT } from '@/lib/uiIdentifiers';

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        className={DT.pageBootstrapping}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)' }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div className={DT.page}>
      <MainApp />
    </div>
  );
}
