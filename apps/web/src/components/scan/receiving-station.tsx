'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ScanLine,
  CheckCircle2,
  XCircle,
  CopyX,
  Volume2,
  VolumeX,
  Keyboard,
  KeyboardOff,
} from 'lucide-react';
import { scanReceiptAction, type ScanOutcome } from '@/app/(app)/receiving/actions';
import type { ReceiptDetail } from '@/lib/queries';
import { jam } from '@/components/picklist/status';
import { StationBar } from './station-bar';
import { CloseSession } from './close-session';
import { useScanSound } from './use-scan-sound';
import { usePreferences } from '../shell/preferences-provider';
import { springSoft } from '../motion/transitions';
import { IconButton } from '../ui/icon-button';
import { cn } from '../ui/cn';

type Line = ReceiptDetail['lines'][number];

/**
 * Layar stasiun receiving (PRD §10.4, F-35–F-38), disusun untuk scanner
 * handheld dulu.
 *
 * Di layar 6 inci portrait urutannya: hasil scan besar, lalu kotak input, lalu
 * daftar line yang menggulir sendiri — hasil dan input selalu terlihat tanpa
 * menggulir. Mulai `xl` tata letaknya kembali ke tiga kolom ScanStation
 * Avicenna (input kiri, hasil tengah, line kanan) untuk monitor gudang.
 *
 * Tiga hal yang menentukan layar ini berguna atau tidak:
 *  1. Fokus HARUS selalu kembali ke input. Scanner mengetik lalu menekan
 *     Enter; kalau fokus lepas, scan berikutnya hilang tanpa jejak.
 *  2. Keyboard virtual tidak boleh menutupi layar: `inputMode="none"` menahan
 *     keyboard Android saat scanner hardware menembak ke input yang fokus;
 *     tombol "ketik manual" membukanya bila kartu tidak terbaca.
 *  3. Hasilnya harus terdengar, karena operator sering tidak menatap layar.
 */
export function ReceivingStation({
  session,
  userName,
  npk,
}: {
  session: ReceiptDetail;
  userName: string;
  npk: string;
}) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ScanOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>(session.lines);
  const [rejected, setRejected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [manual, setManual] = useState(false);
  const router = useRouter();

  // Diawali dari preferensi tersimpan, lalu masih bisa dimatikan sesaat dari
  // layar ini tanpa mengubah pengaturan perangkat.
  const { prefs } = usePreferences();
  const [soundOn, setSoundOn] = useState(prefs.scanSound);

  /*
   * Preferensi tersimpan baru terbaca setelah komponen terpasang — membaca
   * localStorage saat render akan membuat hasil render server dan klien
   * berbeda. Nilai awal useState karena itu selalu bawaan, dan efek inilah
   * yang menyusulkan pilihan yang sebenarnya.
   */
  useEffect(() => {
    setSoundOn(prefs.scanSound);
  }, [prefs.scanSound]);

  const inputRef = useRef<HTMLInputElement>(null);
  const sound = useScanSound(soundOn);
  const seq = useRef(0);

  /** Mengembalikan fokus ke input — dipanggil setelah setiap kejadian apa pun. */
  const focusInput = useCallback(() => {
    if (closing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [closing]);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  /*
   * Kembalikan fokus setiap kali proses pengiriman selesai — SETELAH render,
   * ketika input sudah siap. Input juga sengaja tidak pernah di-disable:
   * elemen yang dinonaktifkan kehilangan fokus, dan scan berikutnya hilang.
   */
  useEffect(() => {
    if (!busy) focusInput();
  }, [busy, focusInput]);

  // Sentuhan di mana pun pada layar mengembalikan fokus. Operator sering tidak
  // sengaja menyentuh area lain, dan tanpa ini scan berikutnya hilang diam-diam.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('input') || target.closest('textarea')) return;
      if (target.closest('[role="dialog"]')) return;
      // Ditunda satu tick agar tidak berebut dengan fokus bawaan browser.
      setTimeout(focusInput, 0);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [focusInput]);

  async function submit(raw: string) {
    const value = raw.trim();
    if (!value || busy || closing) return;

    setBusy(true);
    setError(null);
    seq.current += 1;

    const res = await scanReceiptAction({
      receiptId: session.publicId,
      code: value,
      // Kunci per scan untuk mencocokkan balasan; dedupe sesungguhnya ada di
      // API (receiptId:kode, F-38) sehingga kiriman ulang tidak menggandakan.
      clientRef: `${session.id}-${Date.now()}-${seq.current}`,
    });

    setCode('');
    setBusy(false);

    if ('error' in res) {
      setError(res.error);
      setResult(null);
      sound.reject();
      return;
    }

    setResult(res);
    if (res.line) {
      const l = res.line;
      setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, boxScanned: l.boxScanned } : x)));
    }
    if (res.result === 'OK') sound.ok();
    else sound.reject();
    if (res.result === 'REJECTED') setRejected((n) => n + 1);
  }

  const lineOf = (id: number | undefined) => lines.find((l) => l.id === id);
  const totalOrdered = lines.reduce((n, l) => n + l.boxOrdered, 0);
  const totalScanned = lines.reduce((n, l) => n + l.boxScanned, 0);
  const selesai = totalOrdered > 0 && totalScanned >= totalOrdered;

  const tone = error
    ? 'bad'
    : !result
      ? 'idle'
      : result.result === 'OK'
        ? 'ok'
        : result.result === 'DUPLICATE'
          ? 'dup'
          : 'bad';

  return (
    <div className="flex h-dvh flex-col xl:h-auto xl:min-h-screen">
      <StationBar
        picklistNo={session.picklistNo}
        revision={session.revision}
        vendorName={session.vendorName}
        arrivalTime={jam(session.arrivalTime)}
        receiptNo={session.receiptNo}
        userName={userName}
        npk={npk}
        onClose={() => setClosing(true)}
        closeDisabled={busy}
      />

      {/*
       * Handheld: kolom tunggal dengan tinggi layar; hasil dan input tetap
       * terlihat, hanya daftar line yang menggulir. Mulai xl: tiga kolom.
       */}
      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3 xl:grid xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,460px)] xl:gap-5 xl:p-6">
        {/* ── Input ─────────────────────────────────────────────────────── */}
        <section className="order-2 shrink-0 rounded-card border border-line bg-card p-3 xl:order-1 xl:p-5">
          <h2 className="hidden text-[12px] font-semibold uppercase tracking-wide text-ink-muted xl:block">
            Scan kanban
          </h2>
          <p className="mt-2 hidden text-[13px] leading-snug text-ink-muted xl:block">
            Arahkan QR di kartu kanban ke scanner. Hasilnya muncul besar di sebelah kanan.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(code);
            }}
            className="flex items-center gap-2 xl:mt-4 xl:block"
          >
            <input
              ref={inputRef}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              // Sebagian scanner mengakhiri tembakan dengan Tab, bukan Enter.
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  void submit(code);
                }
              }}
              // Scanner hardware menembak ke input yang fokus; keyboard virtual
              // hanya perlu muncul saat operator memilih mengetik sendiri.
              inputMode={manual ? 'text' : 'none'}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="QR kanban"
              placeholder={manual ? 'Ketik kode kanban' : 'Siap — tembak QR kanban'}
              className="tabular h-12 min-w-0 flex-1 rounded-2xl border-2 border-line bg-surface px-4 text-[17px] font-semibold outline-none transition-colors duration-200 placeholder:text-[14px] placeholder:font-normal placeholder:text-ink-muted focus:border-ink focus:bg-card xl:h-14 xl:w-full xl:text-[18px] xl:placeholder:text-[15px]"
            />
            <div className="flex shrink-0 items-center gap-2 xl:mt-4">
              <IconButton
                icon={manual ? KeyboardOff : Keyboard}
                label={manual ? 'Kembali ke mode scanner' : 'Ketik manual'}
                variant={manual ? 'solid' : 'outline'}
                onClick={() => {
                  setManual((v) => !v);
                  focusInput();
                }}
              />
              <IconButton
                icon={soundOn ? Volume2 : VolumeX}
                label={soundOn ? 'Matikan suara' : 'Nyalakan suara'}
                variant={soundOn ? 'outline' : 'ghost'}
                onClick={() => {
                  setSoundOn((v) => !v);
                  focusInput();
                }}
              />
            </div>
          </form>
        </section>

        {/* ── Status besar ──────────────────────────────────────────────── */}
        <section
          id="scan-status"
          aria-live="assertive"
          className={cn(
            'order-1 flex shrink-0 flex-col rounded-card border-2 transition-colors duration-300 xl:order-2 xl:min-h-[260px]',
            tone === 'idle' && 'border-line bg-card',
            tone === 'ok' && 'border-ok/30 bg-ok/8',
            tone === 'dup' && 'border-warn/30 bg-warn/8',
            tone === 'bad' && 'border-ng/30 bg-ng/8',
          )}
        >
          <div className="flex min-h-[176px] flex-1 items-center justify-center p-4 text-center sm:min-h-[220px] xl:p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${result?.result ?? 'idle'}-${seq.current}`}
                initial={{ opacity: 0, scale: 0.94, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={springSoft}
                className="flex flex-col items-center gap-2 xl:gap-3"
              >
                {error ? (
                  <>
                    <XCircle className="size-10 text-ng xl:size-12" strokeWidth={1.6} aria-hidden />
                    <div className="text-[24px] font-extrabold leading-tight text-ng xl:text-[26px]">
                      GAGAL KIRIM
                    </div>
                    <p className="max-w-md text-[15px] text-ink-soft">{error}</p>
                  </>
                ) : !result ? (
                  <>
                    <ScanLine
                      className="size-10 text-ink-muted xl:size-12"
                      strokeWidth={1.4}
                      aria-hidden
                    />
                    <div className="text-[22px] font-extrabold leading-tight text-ink-muted xl:text-[26px]">
                      MENUNGGU SCAN
                    </div>
                  </>
                ) : result.result === 'OK' ? (
                  <>
                    <CheckCircle2
                      className="size-10 text-ok xl:size-12"
                      strokeWidth={1.6}
                      aria-hidden
                    />
                    <div className="text-[36px] font-extrabold leading-none tracking-tight text-ok xl:text-[38px]">
                      OK
                    </div>
                    <div className="tabular text-[18px] font-bold xl:text-[20px]">
                      Kanban {result.kanbanSerial ?? '?'} / {totalOrdered}
                    </div>
                    <div className="text-[15px] text-ink-soft">
                      <span className="font-extrabold text-ink">
                        {lineOf(result.line?.id)?.backNo}
                      </span>{' '}
                      · {lineOf(result.line?.id)?.partNo}
                    </div>
                    {result.autoShipped ? (
                      <div className="text-[13px] text-warn">
                        Diterima tanpa konfirmasi kirim supplier
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    {result.result === 'DUPLICATE' ? (
                      <CopyX
                        className="size-10 text-warn xl:size-12"
                        strokeWidth={1.6}
                        aria-hidden
                      />
                    ) : (
                      <XCircle
                        className="size-10 text-ng xl:size-12"
                        strokeWidth={1.6}
                        aria-hidden
                      />
                    )}
                    <div
                      className={cn(
                        'text-[28px] font-extrabold leading-none tracking-tight xl:text-[32px]',
                        result.result === 'DUPLICATE' ? 'text-warn' : 'text-ng',
                      )}
                    >
                      {result.result === 'DUPLICATE' ? 'SUDAH DISCAN' : 'DITOLAK'}
                    </div>
                    {result.kanbanSerial ? (
                      <div className="tabular text-[18px] font-bold">
                        Kanban {result.kanbanSerial}
                      </div>
                    ) : null}
                    <p className="max-w-md text-[15px] text-ink-soft">{result.message}</p>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Progres sesi menempel pada hasil: satu pandangan, dua jawaban. */}
          <div className="flex items-baseline justify-between border-t border-line/60 px-4 py-2.5 xl:px-6">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
              Progres sesi
            </span>
            <span className="tabular text-[15px] text-ink-muted">
              <span className={cn('text-[22px] font-extrabold', selesai ? 'text-ok' : 'text-ink')}>
                {totalScanned}
              </span>{' '}
              / {totalOrdered} box
              {rejected > 0 ? <span className="text-ng"> · {rejected} ditolak</span> : null}
            </span>
          </div>
        </section>

        {/* ── Line picklist ─────────────────────────────────────────────── */}
        <section className="order-3 flex min-h-0 flex-1 flex-col rounded-card border border-line bg-card xl:order-3">
          <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 xl:px-5 xl:py-4">
            <h2 className="text-[15px] font-bold">Line Order Sheet</h2>
            <span className="text-[13px] text-ink-muted">{lines.length} part</span>
          </header>
          <ul className="scroll-slim min-h-0 flex-1 divide-y divide-line overflow-y-auto">
            {lines.map((l) => {
              const done = l.boxScanned >= l.boxOrdered;
              const pct = l.boxOrdered > 0 ? Math.min(100, (l.boxScanned / l.boxOrdered) * 100) : 0;
              const aktif = result?.result !== 'REJECTED' && result?.line?.id === l.id;
              return (
                <li
                  key={l.id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 transition-colors duration-500 xl:px-5',
                    aktif && 'bg-ok/8',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[20px] font-extrabold leading-none tracking-tight">
                        {l.backNo}
                      </span>
                      <span className="tabular truncate text-[13px] font-semibold text-ink-soft">
                        {l.partNo}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-ink-muted">{l.partName}</div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface">
                      <div
                        className={cn(
                          'h-full rounded-full transition-[width] duration-500',
                          done ? 'bg-ok' : 'bg-accent',
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="tabular shrink-0 text-right">
                    <span
                      className={cn(
                        'text-[26px] font-extrabold leading-none',
                        done ? 'text-ok' : 'text-ink',
                      )}
                    >
                      {l.boxScanned}
                    </span>
                    <span className="text-[15px] text-ink-muted"> / {l.boxOrdered}</span>
                    {l.boxShipped != null ? (
                      <div className="mt-1 text-[12px] text-ink-muted">dikirim {l.boxShipped}</div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </main>

      {closing ? (
        <CloseSession
          receiptId={session.publicId}
          lines={lines}
          rejected={rejected}
          onCancel={() => setClosing(false)}
          onClosed={() => router.push(`/receiving/${session.publicId}/ringkasan`)}
        />
      ) : null}
    </div>
  );
}
