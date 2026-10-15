'use client';

import { useActionState, useState } from 'react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { loginAction, type LoginState } from './actions';
import { durations, easeSoft } from '@/components/motion/transitions';
import { BrandWrite } from '@/components/shell/brand-write';
import { OtpCodeInput } from '@/components/ui/otp-code-input';

const initial: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initial);
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden p-5">
      {/* Layar pembuka: nama aplikasi ditulis goresan demi goresan, lalu memudar. */}
      <div
        className="login-intro pointer-events-none absolute inset-0 z-10 grid place-items-center bg-canvas"
        aria-hidden
      >
        <span className="flex flex-col items-center gap-3">
          <BrandWrite />
          <span className="login-intro-tagline text-[12px] uppercase tracking-[0.34em] text-ink-muted">
            e-Kanban Supplier
          </span>
        </span>
      </div>

      <div className="login-card-enter a-stagger w-full max-w-[420px] rounded-panel border border-line bg-shell p-9 shadow-shell">
        {state.stage === 'TOTP' ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: durations.base, ease: easeSoft }}
          >
            <div className="grid size-12 place-items-center rounded-full bg-accent/10 text-accent">
              <ShieldCheck className="size-6" strokeWidth={1.9} aria-hidden />
            </div>
            <h1 className="mt-5 text-[22px] font-extrabold tracking-tight">Verifikasi keamanan</h1>
            <p className="mt-2 text-[14px] leading-6 text-ink-muted">
              Buka Google Authenticator, lalu masukkan kode 6 digit. Sesi ini berlaku 5 menit.
            </p>
            <form action={formAction} className="mt-7 space-y-4">
              <div>
                <label htmlFor="totpCode" className="mb-3 block text-[14px] font-semibold">
                  Kode Google Authenticator
                </label>
                <OtpCodeInput value={totpCode} onChange={setTotpCode} autoFocus />
              </div>
              <ErrorMessage message={state.error} />
              <SubmitButton
                pending={pending}
                disabled={totpCode.length !== 6}
                label="Verifikasi dan masuk"
              />
            </form>
            <a
              href="/login"
              className="mt-5 flex items-center justify-center gap-2 text-[13px] font-semibold text-ink-muted hover:text-ink"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Kembali ke email dan password
            </a>
          </motion.div>
        ) : (
          <>
            <div>
              <div className="text-[24px] font-extrabold leading-none tracking-tight">ARES</div>
              <p className="mt-2 text-[14px] text-ink-muted">
                e-Kanban Supplier — NPK untuk karyawan, email untuk supplier
              </p>
            </div>

            <form action={formAction} className="mt-8 space-y-4">
              <div>
                <label htmlFor="npk" className="mb-2 block text-[14px] font-semibold">
                  NPK / email supplier
                </label>
                <input
                  id="npk"
                  name="npk"
                  autoComplete="username"
                  autoFocus
                  required
                  className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-[14px] font-semibold">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    className="h-12 w-full rounded-2xl border border-line bg-surface px-4 pr-12 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    aria-pressed={showPassword}
                    className="absolute right-1 top-1 grid size-10 place-items-center rounded-xl text-ink-muted transition-colors hover:bg-card hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
                  >
                    {showPassword ? (
                      <EyeOff className="size-[18px]" strokeWidth={2} aria-hidden />
                    ) : (
                      <Eye className="size-[18px]" strokeWidth={2} aria-hidden />
                    )}
                  </button>
                </div>
              </div>

              <ErrorMessage message={state.error} />
              <SubmitButton pending={pending} label="Masuk" />
            </form>
            <p className="mt-6 text-center text-[13px] text-ink-muted">
              Supplier belum punya akun?{' '}
              <Link href="/register" className="font-semibold text-ink hover:underline">
                Daftar di sini
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function ErrorMessage({ message }: { message?: string }) {
  return message ? (
    <motion.p
      role="alert"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: durations.base, ease: easeSoft }}
      className="flex items-center gap-2 text-[14px] text-ng"
    >
      <AlertCircle className="size-4 shrink-0" strokeWidth={2} aria-hidden />
      {message}
    </motion.p>
  ) : null;
}

function SubmitButton({
  pending,
  label,
  disabled = false,
}: {
  pending: boolean;
  label: string;
  disabled?: boolean;
}) {
  const unavailable = pending || disabled;
  return (
    <div className="pt-2">
      <motion.button
        type="submit"
        disabled={unavailable}
        whileHover={unavailable ? undefined : { scale: 1.01 }}
        whileTap={unavailable ? undefined : { scale: 0.98 }}
        transition={{ duration: durations.fast, ease: easeSoft }}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-[15px] font-semibold text-white outline-none transition-colors duration-200 hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <>
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
              className="size-4 rounded-full border-2 border-white/30 border-t-white"
            />
            Memproses
          </>
        ) : (
          <>
            {label}
            <ArrowRight className="size-4" strokeWidth={2.2} aria-hidden />
          </>
        )}
      </motion.button>
    </div>
  );
}
