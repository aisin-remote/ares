'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from './cn';
import { durations, easeSoft } from '../motion/transitions';

type Tone = 'success' | 'error' | 'info';

interface FeedbackItem {
  id: number;
  tone: Tone;
  title: string;
  detail?: string;
}

interface FeedbackContextValue {
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  info: (title: string, detail?: string) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

/** Pesan singkat lintas halaman untuk hasil aksi yang sudah selesai. */
export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback(
    (tone: Tone, title: string, detail?: string) => {
      nextId.current += 1;
      const id = nextId.current;
      setItems((current) => [...current.slice(-2), { id, tone, title, detail }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4500);
    },
    [dismiss],
  );

  const value = useMemo<FeedbackContextValue>(
    () => ({
      success: (title, detail) => show('success', title, detail),
      error: (title, detail) => show('error', title, detail),
      info: (title, detail) => show('info', title, detail),
    }),
    [show],
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(390px,calc(100vw-2rem))] flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const Icon =
              item.tone === 'success' ? CheckCircle2 : item.tone === 'error' ? AlertCircle : Info;
            return (
              <motion.div
                key={item.id}
                role={item.tone === 'error' ? 'alert' : 'status'}
                initial={{ opacity: 0, y: -10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 18 }}
                transition={{ duration: durations.base, ease: easeSoft }}
                className={cn(
                  'pointer-events-auto flex items-start gap-3 rounded-2xl border bg-card px-4 py-3 shadow-lift',
                  item.tone === 'success' && 'border-ok/35',
                  item.tone === 'error' && 'border-ng/35',
                  item.tone === 'info' && 'border-line-strong',
                )}
              >
                <Icon
                  className={cn(
                    'mt-0.5 size-5 shrink-0',
                    item.tone === 'success' && 'text-ok',
                    item.tone === 'error' && 'text-ng',
                    item.tone === 'info' && 'text-accent',
                  )}
                  strokeWidth={2.2}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold text-ink">{item.title}</p>
                  {item.detail ? (
                    <p className="mt-0.5 text-[13px] leading-5 text-ink-muted">{item.detail}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  aria-label="Tutup pesan"
                  className="grid size-7 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
                >
                  <X className="size-3.5" strokeWidth={2} aria-hidden />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackContextValue {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback harus dipakai di dalam FeedbackProvider');
  return context;
}
