import type { Metadata } from "next";
import { MarketingNav } from "../_components/marketing-nav";
import { MarketingFooter } from "../_components/marketing-footer";
import { PricingGrid } from "../_components/pricing-grid";

export const metadata: Metadata = {
  title: "Preços — Funilly",
  description:
    "Planos Starter, Pro e Business do Funilly. Preço por seat, 7 dias grátis, sem cartão de crédito.",
};

const FAQ = [
  {
    question: "Preciso de cartão de crédito para o trial?",
    answer:
      "Não. Todos os planos incluem 7 dias grátis sem precisar cadastrar cartão de crédito.",
  },
  {
    question: "O que significa preço \"por seat\"?",
    answer:
      "Cada seat é um atendente com login próprio na conta. O valor do plano é multiplicado pela quantidade de atendentes que sua equipe precisa.",
  },
  {
    question: "Posso cancelar quando quiser?",
    answer: "Sim. Não há fidelidade nem taxa de cancelamento em nenhum plano.",
  },
  {
    question: "O WhatsApp usado é a API oficial?",
    answer:
      "Sim, o Funilly se conecta pela API Oficial Meta / WhatsApp Business — não é uma automação não-oficial que arrisca o número.",
  },
];

export default function PrecosPage() {
  return (
    <>
      <MarketingNav />

      <section className="px-5 pt-[120px] pb-16 text-center sm:px-10 sm:pt-[140px] sm:pb-20 lg:px-20 lg:pt-[160px] lg:pb-[100px]">
        <div className="mb-3 text-xs tracking-[3px] text-[#1D9E75] uppercase">Planos</div>
        <h1 className="mb-4 text-[32px] font-medium tracking-[-1px] sm:text-[40px] lg:text-[48px] lg:tracking-[-1.5px]">
          Simples e transparente
        </h1>
        <p className="mx-auto max-w-[480px] text-base leading-[1.7] text-white/45">
          Sem taxas escondidas. Cancele quando quiser.
        </p>

        <PricingGrid />
      </section>

      <section className="bg-[#0D1117] px-5 py-16 sm:px-10 sm:py-20 lg:px-20 lg:py-[100px]">
        <div className="mb-3 text-xs tracking-[3px] text-[#1D9E75] uppercase">Dúvidas</div>
        <h2 className="mb-10 text-[28px] font-medium tracking-[-1px] sm:text-[34px]">
          Perguntas frequentes
        </h2>
        <div className="flex flex-col gap-5">
          {FAQ.map((item) => (
            <div
              key={item.question}
              className="rounded-2xl border border-white/[0.06] bg-[#060810] p-7"
            >
              <h3 className="mb-2 text-base font-medium">{item.question}</h3>
              <p className="text-sm leading-[1.6] text-white/45">{item.answer}</p>
            </div>
          ))}
        </div>
      </section>

      <MarketingFooter />
    </>
  );
}
