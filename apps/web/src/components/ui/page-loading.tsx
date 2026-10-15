import { Loader2 } from 'lucide-react';

export function PageLoading({ label = 'Sedang memuat data…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-6">
      <div className="flex items-center gap-3 text-[14px] font-medium text-ink-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        <span>{label}</span>
      </div>

      <div className="animate-pulse space-y-6" aria-hidden>
        <div className="space-y-3">
          <div className="h-4 w-28 rounded-full bg-surface" />
          <div className="h-8 w-64 max-w-3/4 rounded-xl bg-surface" />
          <div className="h-4 w-96 max-w-full rounded-full bg-surface" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-28 rounded-3xl border border-line bg-card" />
          ))}
        </div>

        <div className="rounded-3xl border border-line bg-card p-5">
          <div className="mb-5 h-5 w-44 rounded-full bg-surface" />
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="h-11 rounded-2xl bg-surface" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
