import Link from "next/link";

interface Plan {
  name: string;
  priceReais: number;
  featured?: boolean;
  features: string[];
}

const PLANS: Plan[] = [
  {
    name: "Starter",
    priceReais: 47,
    features: [
      "1 número WhatsApp",
      "Caixa de entrada unificada",
      "Pipeline de vendas",
      "Contatos ilimitados",
      "Transmissões (até 500/mês)",
      "Relatórios básicos",
      "Suporte por email",
    ],
  },
  {
    name: "Pro",
    priceReais: 87,
    featured: true,
    features: [
      "Até 3 números WhatsApp",
      "Tudo do Starter +",
      "Automações ilimitadas",
      "Fluxos de atendimento",
      "Relatórios avançados + ROI",
      "Integração Google Sheets",
      "NPS automático",
      "Suporte prioritário",
    ],
  },
  {
    name: "Business",
    priceReais: 147,
    features: [
      "Números WhatsApp ilimitados",
      "Tudo do Pro +",
      "IA para criar automações",
      "Relatório diário por WhatsApp",
      "Dashboard de comissões",
      "API de integração",
      "Webhook de saída",
      "Gerente de conta dedicado",
    ],
  },
];

/** Shared by the home page's #precos section and the standalone
 *  /precos page — same three plans, same copy, so pricing can't drift
 *  between the two surfaces. */
export function PricingGrid() {
  return (
    <>
      <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={`relative rounded-[20px] border p-8 ${
              plan.featured
                ? "border-[#1D9E75] bg-[linear-gradient(135deg,rgba(29,158,117,0.08),#0D1117)]"
                : "border-white/[0.06] bg-[#0D1117]"
            }`}
          >
            {plan.featured && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#1D9E75] px-3.5 py-1 text-[11px] font-semibold whitespace-nowrap text-white">
                Mais popular
              </span>
            )}
            <div className="mb-2 text-sm text-white/50">{plan.name}</div>
            <div className="mb-1 text-[40px] font-medium tracking-[-2px]">
              R${plan.priceReais}
              <span className="text-base font-light text-white/40">/mês</span>
            </div>
            <div className="mb-7 text-xs text-white/35">por seat</div>
            <ul className="mb-7 flex flex-col gap-2.5">
              {plan.features.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-2 text-[13px] leading-[1.4] text-white/60"
                >
                  <span className="mt-px shrink-0 font-semibold text-[#1D9E75]">✓</span>
                  {feature}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className={`block rounded-[10px] py-3 text-center text-sm font-medium ${
                plan.featured
                  ? "bg-[#1D9E75] text-white hover:bg-[#1D9E75]/90"
                  : "border border-white/15 text-white hover:bg-white/5"
              }`}
            >
              Começar grátis
            </Link>
          </div>
        ))}
      </div>
      <p className="mt-5 text-center text-[13px] text-white/30">
        ✓ 7 dias grátis em todos os planos · Não precisa de cartão de crédito
      </p>
    </>
  );
}
