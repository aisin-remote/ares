'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { OtpCodeInput } from '@/components/ui/otp-code-input';
import { registrationAction, type RegistrationState } from './actions';

const initialState: RegistrationState = {};

export default function SupplierRegistrationPage() {
  const [state, formAction, pending] = useActionState(registrationAction, initialState);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [furthestStep, setFurthestStep] = useState(1);
  const [vendorCode, setVendorCode] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string>();

  useEffect(() => {
    if (state.stage === 'AUTHENTICATOR') {
      setStep(3);
      setFurthestStep(3);
    }
  }, [state.qrDataUrl, state.setupKey, state.stage]);

  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-5">
      <section className="w-full max-w-[520px] rounded-panel border border-line bg-shell p-8 shadow-shell sm:p-9">
        <Link
          href="/login"
          className="mb-7 inline-flex items-center gap-2 text-[13px] font-semibold text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke login
        </Link>

        <div className="text-[24px] font-extrabold leading-none tracking-tight">
          Daftar akun supplier
        </div>
        <p className="mt-2 text-[14px] leading-6 text-ink-muted">
          Selesaikan tiga langkah berikut untuk mengajukan akun supplier.
        </p>

        <RegistrationStepper
          current={state.stage === 'DONE' ? 3 : step}
          furthest={furthestStep}
          done={state.stage === 'DONE'}
          disabled={pending}
          onChange={(nextStep) => {
            setLocalError(undefined);
            setStep(nextStep);
          }}
        />

        {state.stage === 'DONE' ? (
          <div className="mt-8">
            <div className="grid size-12 place-items-center rounded-full bg-ok/10 text-ok">
              <CheckCircle2 className="size-6" aria-hidden />
            </div>
            <h2 className="mt-5 text-[18px] font-bold">Pendaftaran diterima</h2>
            <p className="mt-2 text-[14px] leading-6 text-ink-muted">{state.message}</p>
            <Link
              href="/login"
              className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-[15px] font-semibold text-white hover:bg-accent-soft"
            >
              Kembali ke login
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        ) : step === 3 && state.stage === 'AUTHENTICATOR' ? (
          <form action={formAction} className="mt-7 space-y-5">
            <input type="hidden" name="intent" value="verify" />
            <input type="hidden" name="password" value={password} />
            <input type="hidden" name="passwordConfirmation" value={passwordConfirmation} />

            <StepHeading
              title="Hubungkan Google Authenticator"
              description="Pindai QR, lalu masukkan kode 6 digit dari aplikasi."
            />
            <div className="rounded-2xl border border-line bg-surface p-5 text-center text-[13px] leading-5 text-ink-muted">
              <Smartphone className="mx-auto mb-3 size-5 text-ink" aria-hidden />
              {state.qrDataUrl ? (
                <img
                  src={state.qrDataUrl}
                  alt="QR setup Google Authenticator"
                  className="mx-auto mb-4 size-44 rounded-xl bg-white p-2"
                />
              ) : null}
              <p className="text-[12px]">Tidak bisa scan? Masukkan setup key:</p>
              <code className="mt-1 block break-all rounded-lg border border-line bg-card px-3 py-2 font-mono text-[12px] font-semibold tracking-[0.08em] text-ink">
                {state.setupKey}
              </code>
            </div>
            <div>
              <label htmlFor="registrationCode" className="mb-3 block text-[14px] font-semibold">
                Kode Google Authenticator
              </label>
              <OtpCodeInput
                id="registrationCode"
                name="code"
                value={totpCode}
                onChange={setTotpCode}
              />
            </div>
            <ErrorMessage message={state.error} />
            <SubmitButton
              pending={pending}
              disabled={totpCode.length !== 6}
              label="Verifikasi dan daftar"
            />
            <Link
              href="/register"
              className="block text-center text-[13px] font-semibold text-ink-muted hover:text-ink"
            >
              Mulai ulang pendaftaran
            </Link>
          </form>
        ) : step === 2 ? (
          <form
            action={formAction}
            className="mt-7 space-y-4"
            onSubmit={(event) => {
              if (password === passwordConfirmation) {
                setLocalError(undefined);
                return;
              }
              event.preventDefault();
              setLocalError('Konfirmasi password tidak sama');
            }}
          >
            <input type="hidden" name="intent" value="request" />
            <input type="hidden" name="vendorCode" value={vendorCode} />
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="email" value={email} />

            <StepHeading
              title="Buat password"
              description="Gunakan minimal 15 karakter agar akun lebih aman."
            />
            <PasswordField
              label="Password baru"
              name="password"
              value={password}
              onChange={setPassword}
              visible={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
              autoFocus
            />
            <Field
              label="Ulangi password"
              name="passwordConfirmation"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={15}
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
            />
            <ErrorMessage message={localError ?? state.error} />
            <SubmitButton pending={pending} label="Lanjutkan ke Authenticator" />
            <button
              type="button"
              onClick={() => {
                setLocalError(undefined);
                setStep(1);
              }}
              className="flex w-full items-center justify-center gap-2 text-[13px] font-semibold text-ink-muted hover:text-ink"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Kembali ke data supplier
            </button>
          </form>
        ) : (
          <form
            className="mt-7 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setLocalError(undefined);
              setStep(2);
              setFurthestStep((current) => Math.max(current, 2));
            }}
          >
            <StepHeading
              title="Masukkan data supplier"
              description="Gunakan kode supplier dan email perusahaan yang terdaftar di ARES."
            />
            <Field
              label="Kode supplier"
              name="vendorCode"
              autoComplete="organization"
              placeholder="Contoh: J901"
              value={vendorCode}
              onChange={(event) => setVendorCode(event.target.value)}
              autoFocus
            />
            <Field
              label="Nama lengkap"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Field
              label="Email perusahaan"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="nama@perusahaan.co.id"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <SubmitButton pending={false} label="Lanjutkan ke password" />
          </form>
        )}
      </section>
    </main>
  );
}

function RegistrationStepper({
  current,
  furthest,
  done,
  disabled,
  onChange,
}: {
  current: 1 | 2 | 3;
  furthest: number;
  done: boolean;
  disabled: boolean;
  onChange: (step: 1 | 2 | 3) => void;
}) {
  const steps = ['Data supplier', 'Password', 'Authenticator'];
  return (
    <nav
      className="mt-7"
      aria-label={`Langkah pendaftaran. Saat ini langkah ${current} dari 3: ${steps[current - 1]}`}
    >
      <div className="grid grid-cols-3 gap-2">
        {steps.map((label, index) => {
          const targetStep = (index + 1) as 1 | 2 | 3;
          const available = targetStep <= furthest && !done;
          return (
            <button
              key={label}
              type="button"
              title={`Buka langkah ${targetStep}: ${label}`}
              aria-label={`Langkah ${targetStep}: ${label}`}
              aria-current={targetStep === current ? 'step' : undefined}
              disabled={!available || disabled}
              onClick={() => onChange(targetStep)}
              className="group flex h-5 items-center disabled:cursor-not-allowed"
            >
              <span
                className={`h-1.5 w-full rounded-full transition-colors ${
                  done || index < current
                    ? 'bg-accent'
                    : index === current - 1
                      ? 'bg-accent'
                      : 'bg-line-strong'
                } ${available && !disabled ? 'group-hover:bg-accent-soft' : ''}`}
                aria-hidden
              />
            </button>
          );
        })}
      </div>
      <div className="mt-2.5 flex items-center justify-between text-[12px] font-semibold">
        <span className="text-ink-muted">Langkah {current} dari 3</span>
        <span className="text-ink">{steps[current - 1]}</span>
      </div>
    </nav>
  );
}

function StepHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="pb-1">
      <h2 className="text-[17px] font-bold">{title}</h2>
      <p className="mt-1 text-[13px] leading-5 text-ink-muted">{description}</p>
    </div>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
}

function Field({ label, name, ...props }: FieldProps) {
  return (
    <div>
      <label htmlFor={name} className="mb-2 block text-[14px] font-semibold">
        {label}
      </label>
      <input
        id={name}
        name={name}
        required
        className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors focus:border-line-strong focus:bg-card"
        {...props}
      />
    </div>
  );
}

function PasswordField({
  label,
  name,
  value,
  onChange,
  visible,
  onToggle,
  autoFocus,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoFocus?: boolean;
}) {
  const strength = getPasswordStrength(value);
  const isStrong = strength.level === 4;

  return (
    <div>
      <label htmlFor={name} className="mb-2 block text-[14px] font-semibold">
        {label}
      </label>
      <div
        className={`relative overflow-hidden rounded-2xl ${isStrong ? 'password-vault-open' : ''}`}
      >
        <input
          id={name}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          minLength={15}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoFocus={autoFocus}
          required
          className={`h-12 w-full rounded-2xl border bg-surface px-4 pr-12 text-[15px] outline-none transition-colors focus:bg-card ${
            isStrong ? 'border-ok/70 focus:border-ok' : 'border-line focus:border-line-strong'
          }`}
        />
        {isStrong ? <span className="password-vault-scan" aria-hidden /> : null}
        <button
          type="button"
          onClick={onToggle}
          aria-label={visible ? 'Sembunyikan password' : 'Tampilkan password'}
          className="absolute right-1 top-1 z-20 grid size-10 place-items-center rounded-xl text-ink-muted hover:bg-card hover:text-ink"
        >
          {visible ? (
            <EyeOff className="size-[18px]" aria-hidden />
          ) : (
            <Eye className="size-[18px]" aria-hidden />
          )}
        </button>
      </div>
      {value ? (
        <div
          className="mt-2 flex min-h-5 items-center justify-between gap-3 text-[12px] font-semibold"
          role="status"
          aria-live="polite"
        >
          {isStrong ? (
            <span className="password-strong-message inline-flex items-center gap-1.5 text-ok">
              <ShieldCheck className="password-strong-shield size-4" aria-hidden />
              Password kuat · siap dipakai
            </span>
          ) : (
            <span className="text-ink-muted">{strength.message}</span>
          )}
          <span className="shrink-0 tabular text-ink-muted">{value.length}/15+</span>
        </div>
      ) : null}
    </div>
  );
}

function getPasswordStrength(value: string): { level: number; message: string } {
  if (!value) return { level: 0, message: '' };

  const characterGroups = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ].filter(Boolean).length;

  if (value.length < 8) return { level: 1, message: 'Masih terlalu pendek' };
  if (value.length < 15) return { level: 2, message: `${15 - value.length} karakter lagi` };
  if (characterGroups < 3) {
    return { level: 3, message: 'Sudah valid · tambah angka atau simbol agar lebih kuat' };
  }
  return { level: 4, message: 'Password kuat' };
}

function ErrorMessage({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="flex items-center gap-2 text-[14px] text-ng">
      <AlertCircle className="size-4 shrink-0" aria-hidden />
      {message}
    </p>
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
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-[15px] font-semibold text-white hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Memproses…' : label}
      {!pending ? <ArrowRight className="size-4" aria-hidden /> : null}
    </button>
  );
}
