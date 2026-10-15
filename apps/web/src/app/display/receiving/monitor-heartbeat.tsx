'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const REFRESH_MS = 120_000;
const RENEW_MS = 12 * 60 * 60 * 1000;

export function MonitorHeartbeat() {
  const router = useRouter();
  const [clock, setClock] = useState('');

  useEffect(() => {
    const updateClock = () => setClock(new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(new Date()));
    const renew = async () => {
      try {
        const response = await fetch('/api/display/renew', { method: 'POST' });
        if (response.status === 401) window.location.assign('/display/setup');
      } catch {
        // Gangguan jaringan sementara tidak mengosongkan layar; siklus berikutnya mencoba lagi.
      }
    };
    const refresh = () => router.refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void renew();
        refresh();
      }
    };

    updateClock();
    void renew();
    const clockTimer = window.setInterval(updateClock, 1000);
    const refreshTimer = window.setInterval(refresh, REFRESH_MS);
    const renewTimer = window.setInterval(() => void renew(), RENEW_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(clockTimer);
      window.clearInterval(refreshTimer);
      window.clearInterval(renewTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  return <div className="flex items-center gap-3 text-[12px] text-ink-muted">
    <span className="inline-flex items-center gap-2 font-semibold text-ok">
      <span className="size-2 animate-pulse rounded-full bg-ok" /> LIVE
    </span>
    <span className="tabular">{clock}</span>
    <span className="hidden sm:inline">· data diperbarui tiap 2 menit</span>
  </div>;
}
