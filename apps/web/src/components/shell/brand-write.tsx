/**
 * Wordmark ARES yang "ditulis" goresan demi goresan — dipakai layar pembuka
 * sebelum login.
 *
 * Hurufnya digambar sendiri sebagai garis tunggal (bukan outline huruf dari
 * font mana pun), jadi tiap goresan bisa dianimasikan seperti tangan yang
 * menulis: `stroke-dasharray` penuh lalu `stroke-dashoffset` ditarik ke nol.
 *
 * `pathLength="1"` membuat setiap goresan dianggap sepanjang 1 satuan berapa
 * pun panjang aslinya, sehingga CSS cukup memakai `stroke-dashoffset: 1 → 0`
 * tanpa perlu mengukur tiap path lewat JavaScript. Urutan dan jedanya diatur
 * di globals.css (`.tulis-nama`), bukan di sini.
 */
export function BrandWrite({ className }: { className?: string }) {
  return (
    <span className={className}>
      <svg
        viewBox="0 0 380 150"
        className="tulis-nama h-[88px] w-auto text-ink"
        fill="none"
        stroke="currentColor"
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
        role="img"
        aria-label="ARES"
      >
        {/* A: naik, turun, palang */}
        <path pathLength={1} d="M26 112 L62 34" />
        <path pathLength={1} d="M62 34 L98 112" />
        <path pathLength={1} d="M41 84 L83 84" />
        {/* R: tiang, perut, kaki */}
        <path pathLength={1} d="M122 112 L122 34" />
        <path pathLength={1} d="M122 34 L160 34 C180 34 180 74 160 74 L122 74" />
        <path pathLength={1} d="M132 74 L188 112" />
        {/* E: tiang, tiga palang */}
        <path pathLength={1} d="M212 34 L212 112" />
        <path pathLength={1} d="M212 34 L268 34" />
        <path pathLength={1} d="M212 73 L256 73" />
        <path pathLength={1} d="M212 112 L268 112" />
        {/* S: satu goresan menerus */}
        <path
          pathLength={1}
          d="M352 48 C344 30 300 26 294 50 C288 72 348 70 346 94 C344 118 300 118 292 98"
        />
      </svg>
    </span>
  );
}
