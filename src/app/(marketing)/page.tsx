import Link from "next/link";
import type { Metadata } from "next";
import { MarketingNav } from "./_components/marketing-nav";
import { MarketingFooter } from "./_components/marketing-footer";
import { PricingGrid } from "./_components/pricing-grid";

export const metadata: Metadata = {
  title: "Funilly — CRM WhatsApp",
  description:
    "Pipeline automático, disparos em massa com proteção anti-banimento e automações com IA. Tudo integrado ao WhatsApp oficial.",
};

const FEATURES = [
  {
    icon: "📱",
    title: "Caixa de Entrada Unificada",
    description:
      "Todos os seus números WhatsApp em uma única tela. Atribua conversas, filtre por etapa do funil e nunca perca um lead.",
  },
  {
    icon: "🔄",
    title: "Pipeline Automático",
    description:
      "Todo contato novo vira um card no pipeline automaticamente. Acompanhe cada lead do primeiro contato ao fechamento.",
  },
  {
    icon: "📊",
    title: "Disparos em Massa",
    description:
      "Envie mensagens para centenas de contatos com cadência inteligente e proteção anti-banimento da Meta.",
  },
  {
    icon: "🤖",
    title: "Automações com IA",
    description:
      "Descreva em português o que você quer automatizar e a IA monta o fluxo completo para você.",
  },
  {
    icon: "📈",
    title: "Relatórios e ROI",
    description:
      "Saiba exatamente quanto cada disparo gerou de comissão. Relatório diário automático no seu WhatsApp às 19h30.",
  },
  {
    icon: "⭐",
    title: "NPS Automático",
    description:
      "Pesquisa de satisfação enviada automaticamente após cada atendimento. Monitore a qualidade do seu time.",
  },
];

const ANTIBAN_ITEMS = [
  {
    title: "Cadência inteligente",
    description:
      "Disparos em lotes com intervalos aleatórios entre mensagens, simulando comportamento humano.",
  },
  {
    title: "Monitor de qualidade",
    description:
      "Veja o status da sua conta Meta em tempo real (Verde/Amarelo/Vermelho) antes de cada disparo.",
  },
  {
    title: "Anti-duplicata",
    description:
      "Exclua automaticamente contatos que já receberam mensagem nos últimos X dias.",
  },
  {
    title: "Horário comercial",
    description:
      "Configure para disparar apenas em horário comercial (08h-20h, horário de Brasília).",
  },
];

const CADENCIA_ROWS = [
  { label: "Tamanho do lote", value: "50 mensagens" },
  { label: "Intervalo entre lotes", value: "10 minutos" },
  { label: "Intervalo entre msgs", value: "3 a 8 segundos (aleatório)" },
  { label: "Horário comercial", value: "08h às 20h ✓" },
  { label: "Anti-duplicata", value: "Últimos 7 dias ✓" },
];

/** Subtle background grid — a fixed 50px cell of near-invisible
 *  lines, per the approved design's `.grid-bg`. */
function GridBackground() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
        backgroundSize: "50px 50px",
      }}
    />
  );
}

export default function MarketingHomePage() {
  return (
    <>
      <MarketingNav />

      {/* HERO */}
      <section className="relative overflow-hidden px-5 pt-[120px] pb-20 text-center sm:px-10 sm:pt-[140px] lg:px-20 lg:pt-[160px] lg:pb-[100px]">
        <GridBackground />
        <div
          className="pointer-events-none absolute -top-[200px] left-1/2 h-[600px] w-[600px] -translate-x-1/2"
          style={{
            background:
              "radial-gradient(circle, rgba(29,158,117,0.12) 0%, transparent 70%)",
          }}
        />

        <div className="relative">
          <div className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-[#1D9E75]/30 bg-[#1D9E75]/10 px-3.5 py-[5px] text-xs text-[#5DCAA5]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#1D9E75]" />
            API Oficial Meta · WhatsApp Business
          </div>

          <h1 className="mb-5 text-[34px] leading-[1.15] font-medium tracking-[-1px] sm:text-[46px] sm:tracking-[-1.5px] lg:text-[58px] lg:tracking-[-2px]">
            O CRM que
            <br />
            <span className="text-[#1D9E75]">fecha mais negócios</span>
            <br />
            pelo WhatsApp
          </h1>

          <p className="mx-auto mb-10 max-w-[520px] text-base leading-[1.7] text-white/45 sm:text-lg">
            Pipeline automático, disparos em massa com proteção anti-banimento
            e automações com IA. Tudo integrado ao WhatsApp oficial.
          </p>

          <div className="flex justify-center">
            <Link
              href="/signup"
              className="rounded-[10px] bg-[#1D9E75] px-7 py-[13px] text-[15px] font-medium text-white transition-colors hover:bg-[#1D9E75]/90"
            >
              Comece Grátis
            </Link>
          </div>

          <div className="mt-16 flex justify-center gap-8 sm:gap-12">
            <div className="text-center">
              <div className="text-2xl font-medium tracking-[-1px] sm:text-[28px]">98%</div>
              <div className="mt-1 text-xs text-white/35">Taxa de entrega</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-medium tracking-[-1px] sm:text-[28px]">3x</div>
              <div className="mt-1 text-xs text-white/35">Mais conversões</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-medium tracking-[-1px] sm:text-[28px]">7 dias</div>
              <div className="mt-1 text-xs text-white/35">Trial gratuito</div>
            </div>
          </div>
        </div>
      </section>

      {/* FUNCIONALIDADES */}
      <section id="funcionalidades" className="px-5 py-16 sm:px-10 sm:py-20 lg:px-20 lg:py-[100px]">
        <div className="mb-3 text-xs tracking-[3px] text-[#1D9E75] uppercase">
          Funcionalidades
        </div>
        <h2 className="mb-4 text-[28px] font-medium tracking-[-1px] sm:text-[34px] lg:text-[40px] lg:tracking-[-1.5px]">
          Tudo que você precisa
          <br />
          em um só lugar
        </h2>
        <p className="max-w-[480px] text-base leading-[1.7] text-white/45">
          Do primeiro contato ao fechamento do negócio, o Funilly centraliza
          toda sua operação de vendas.
        </p>

        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-white/[0.06] bg-[#0D1117] p-7"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[10px] bg-[#1D9E75]/10 text-xl">
                {feature.icon}
              </div>
              <h3 className="mb-2 text-base font-medium">{feature.title}</h3>
              <p className="text-sm leading-[1.6] text-white/45">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PARA QUEM É */}
      <section id="publicos" className="bg-[#0D1117] px-5 py-16 sm:px-10 sm:py-20 lg:px-20 lg:py-[100px]">
        <div className="mb-3 text-xs tracking-[3px] text-[#1D9E75] uppercase">Para quem é</div>
        <h2 className="mb-4 text-[28px] font-medium tracking-[-1px] sm:text-[34px] lg:text-[40px] lg:tracking-[-1.5px]">
          Feito para quem
          <br />
          vende de verdade
        </h2>

        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-[20px] border border-white/[0.06] bg-[#060810] p-9">
            <div className="mb-4 text-4xl">💼</div>
            <h3 className="mb-3 text-[22px] font-medium">Para quem atende clientes</h3>
            <p className="mb-5 text-sm leading-[1.7] text-white/45">
              Gerencie leads, acompanhe orçamentos e saiba exatamente quantos
              contatos viraram clientes pagantes.
            </p>
            <ul className="flex flex-col gap-2">
              {[
                "Funil de vendas por produto ou serviço",
                "Disparos de follow-up automáticos",
                "NPS pós-atendimento",
                "Relatório diário de conversões",
                "Múltiplos atendentes na mesma conta",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2 text-[13px] text-white/60">
                  <span className="font-semibold text-[#1D9E75]">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[20px] border border-white/[0.06] bg-[#060810] p-9">
            <div className="mb-4 text-4xl">🚀</div>
            <h3 className="mb-3 text-[22px] font-medium">Para quem prospecta em massa</h3>
            <p className="mb-5 text-sm leading-[1.7] text-white/45">
              Dispare para grandes bases, acompanhe quem clicou, quem
              respondeu e feche mais negócios com menos esforço.
            </p>
            <ul className="flex flex-col gap-2">
              {[
                "Disparos segmentados por perfil de cliente",
                "Rastreamento de cliques nos botões",
                "ROI por campanha de disparo",
                "Relatório de comissões automático",
                "Proteção anti-banimento da Meta",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2 text-[13px] text-white/60">
                  <span className="font-semibold text-[#1D9E75]">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ANTI-BANIMENTO */}
      <section className="bg-[#0D1117] px-5 py-16 sm:px-10 sm:py-20 lg:px-20 lg:py-[100px]">
        <div className="mb-3 text-xs tracking-[3px] text-[#1D9E75] uppercase">Proteção</div>
        <h2 className="mb-4 text-[28px] font-medium tracking-[-1px] sm:text-[34px] lg:text-[40px] lg:tracking-[-1.5px]">
          Nunca mais tome
          <br />
          ban da Meta
        </h2>

        <div className="mt-14 grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-[60px]">
          <div className="flex flex-col gap-5">
            {ANTIBAN_ITEMS.map((item) => (
              <div key={item.title} className="flex items-start gap-3.5">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#1D9E75]" />
                <div>
                  <h4 className="mb-1 text-[15px] font-medium">{item.title}</h4>
                  <p className="text-[13px] leading-[1.6] text-white/40">{item.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-[#060810] p-7">
            <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-[#1D9E75]/30 bg-[#1D9E75]/15 px-3 py-[5px] text-xs font-medium text-[#1D9E75]">
              🟢 Conta Verde — Seguro para disparar
            </div>
            {CADENCIA_ROWS.map((row, i) => (
              <div
                key={row.label}
                className={`flex items-center justify-between py-2.5 text-[13px] ${
                  i < CADENCIA_ROWS.length - 1 ? "border-b border-white/5" : ""
                }`}
              >
                <span className="text-white/50">{row.label}</span>
                <span className="font-medium text-white">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PREÇOS */}
      <section id="precos" className="px-5 py-16 sm:px-10 sm:py-20 lg:px-20 lg:py-[100px]">
        <div className="mb-3 text-xs tracking-[3px] text-[#1D9E75] uppercase">Planos</div>
        <h2 className="mb-4 text-[28px] font-medium tracking-[-1px] sm:text-[34px] lg:text-[40px] lg:tracking-[-1.5px]">
          Simples e transparente
        </h2>
        <p className="max-w-[480px] text-base leading-[1.7] text-white/45">
          Sem taxas escondidas. Cancele quando quiser.
        </p>

        <PricingGrid />
      </section>

      {/* CTA FINAL */}
      <section className="px-5 py-16 text-center sm:px-10 sm:py-20 lg:px-20 lg:py-[100px]">
        <h2 className="mb-4 text-[30px] font-medium tracking-[-1px] sm:text-[36px] lg:text-[44px] lg:tracking-[-1.5px]">
          Pronto para fechar
          <br />
          mais negócios?
        </h2>
        <p className="mb-9 text-base text-white/40">
          Comece seu trial gratuito de 7 dias. Sem cartão de crédito.
        </p>
        <Link
          href="/signup"
          className="inline-block rounded-[10px] bg-[#1D9E75] px-9 py-[15px] text-base font-medium text-white transition-colors hover:bg-[#1D9E75]/90"
        >
          Criar conta grátis →
        </Link>
      </section>

      <MarketingFooter />
    </>
  );
}
