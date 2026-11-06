'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

export function CutoffSearch({ query }: { query: string }) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const requested = useRef(new Set<string>());
  const latest = useRef(query);

  useEffect(() => {
    // Respons pencarian lama tidak boleh menimpa kata yang masih diketik.
    if (requested.current.delete(query)) {
      if (query === latest.current) requested.current.clear();
    } else {
      clearTimeout(timer.current);
      setValue(query);
    }
  }, [query]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function search(next: string) {
    clearTimeout(timer.current);
    const trimmed = next.trim();
    if (trimmed === query && requested.current.size === 0) return;
    requested.current.add(trimmed);
    latest.current = trimmed;
    const params = new URLSearchParams();
    if (trimmed) params.set('q', trimmed);
    startTransition(() => router.replace(`/settings/cutoff${trimmed ? `?${params}` : ''}`, { scroll: false }));
  }

  function change(next: string) {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(next), 250);
  }

  return <form onSubmit={(event) => { event.preventDefault(); search(value); }} className="flex w-full min-w-0 items-center gap-2 sm:w-auto" role="search">
    <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
      <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-ink-muted" strokeWidth={1.8} aria-hidden />
      <input ref={input} type="search" name="q" value={value} onChange={(event) => change(event.target.value)}
        placeholder="Cari nama atau kode supplier" aria-label="Cari supplier" autoComplete="off"
        className="h-11 w-full min-w-0 rounded-full border border-line bg-card pl-11 pr-4 text-[14px] outline-none transition-colors duration-200 placeholder:text-ink-muted focus:border-line-strong" />
    </div>
    {value ? <button type="button" onClick={() => { setValue(''); search(''); input.current?.focus(); }}
      className="px-2 text-sm font-semibold text-ink-muted hover:text-ink">Reset</button> : null}
    <span role="status" className="sr-only">{pending || value.trim() !== query ? 'Mencari…' : ''}</span>
  </form>;
}
