'use client';

import { useRouter } from 'next/navigation';

/** Baris tabel yang bisa dibuka dari area kosong maupun dengan keyboard. */
export function ClickableRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();

  return (
    <tr
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a,button,input,select')) return;
        router.push(href);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          router.push(href);
        }
      }}
      className="cursor-pointer transition-colors duration-150 last:[&>td]:border-b-0 hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
    >
      {children}
    </tr>
  );
}
