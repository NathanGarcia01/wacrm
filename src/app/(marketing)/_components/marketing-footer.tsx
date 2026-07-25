export function MarketingFooter() {
  return (
    <footer className="flex flex-col items-center gap-4 border-t border-white/5 px-5 py-10 sm:flex-row sm:justify-between sm:px-10 lg:px-20">
      <img src="/logo-dark.svg" alt="Funilly" className="h-6 w-auto" />
      <p className="text-[13px] text-white/25">
        © {new Date().getFullYear()} Funilly · Todos os direitos reservados
      </p>
      <p className="text-[13px] text-white/25">contato@funilly.tech</p>
    </footer>
  );
}
