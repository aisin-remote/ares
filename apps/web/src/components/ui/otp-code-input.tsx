'use client';

import { useRef, useState } from 'react';

export function OtpCodeInput({
  value,
  onChange,
  id = 'otpCode',
  name = 'otpCode',
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const activeIndex = Math.min(value.length, 5);

  return (
    <div className="relative" onClick={() => inputRef.current?.focus()}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        enterKeyHint="done"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        onFocus={(event) => {
          setFocused(true);
          event.currentTarget.setSelectionRange(value.length, value.length);
        }}
        onClick={(event) => event.currentTarget.setSelectionRange(value.length, value.length)}
        onBlur={() => setFocused(false)}
        aria-label="Kode OTP email"
        autoFocus={autoFocus}
        required
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
      />
      <div className="flex gap-4" aria-hidden>
        {[0, 3].map((start) => (
          <div key={start} className="flex min-w-0 flex-1 gap-2">
            {[start, start + 1, start + 2].map((index) => {
              const active = focused && index === activeIndex;
              return (
                <span
                  key={index}
                  className={`grid h-14 min-w-0 flex-1 place-items-center rounded-xl border bg-surface font-mono text-[22px] font-bold tabular-nums transition-colors duration-150 ${
                    active
                      ? 'border-accent bg-card ring-2 ring-accent/15'
                      : value[index]
                        ? 'border-line-strong text-ink'
                        : 'border-line text-ink-muted'
                  }`}
                >
                  {value[index] ?? ''}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
