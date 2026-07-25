import Link from "next/link";

/**
 * Fixed top nav for the public marketing site. Section links are
 * absolute-path hashes (`/#funcionalidades`, not `#funcionalidades`)
 * so they resolve correctly from both `/` (same-page scroll) and
 * `/precos` (navigate to `/` then scroll) — the approved design only
 * ever links from the home page itself, but this site also has
 * `/precos`, so the links need to work from there too.
 */
export function MarketingNav() {
  return (
    <nav className="fixed inset-x-0 top-0 z-[100] flex items-center justify-between border-b border-white/5 bg-[#060810]/90 px-5 py-4 backdrop-blur-[10px] sm:px-10 lg:px-20">
      <Link href="/" className="flex items-center">
        <img src="/logo-dark.svg" alt="Funilly" className="h-8 w-auto sm:h-9" />
      </Link>

      <ul className="hidden items-center gap-8 md:flex">
        <li>
          <Link
            href="/#funcionalidades"
            className="text-sm text-white/60 transition-colors hover:text-white"
          >
            Funcionalidades
          </Link>
        </li>
        <li>
          <Link
            href="/#publicos"
            className="text-sm text-white/60 transition-colors hover:text-white"
          >
            Para quem é
          </Link>
        </li>
        <li>
          <Link
            href="/#precos"
            className="text-sm text-white/60 transition-colors hover:text-white"
          >
            Preços
          </Link>
        </li>
      </ul>

      <Link
        href="/signup"
        className="rounded-lg bg-[#1D9E75] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1D9E75]/90"
      >
        Começar grátis
      </Link>
    </nav>
  );
}
