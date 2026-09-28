import type { Metadata } from "next";
import { MarketingNav } from "../_components/marketing-nav";
import { MarketingFooter } from "../_components/marketing-footer";

export const metadata: Metadata = {
  title: "Termos de Serviço — Funilly",
  description:
    "Termos de uso do Funilly: cadastro, planos, pagamento, cancelamento e responsabilidades.",
};

const LAST_UPDATED = "28 de setembro de 2026";

export default function TermosPage() {
  return (
    <>
      <MarketingNav />

      <section className="px-5 pt-[120px] pb-16 sm:px-10 sm:pt-[140px] sm:pb-20 lg:px-20 lg:pt-[160px] lg:pb-[100px]">
        <div className="mx-auto max-w-[720px]">
          <div className="mb-3 text-xs tracking-[3px] text-[#1D9E75] uppercase">Legal</div>
          <h1 className="mb-4 text-[32px] font-medium tracking-[-1px] sm:text-[40px]">
            Termos de Serviço
          </h1>
          <p className="mb-14 text-sm text-white/40">Última atualização: {LAST_UPDATED}</p>

          <div className="flex flex-col gap-10 text-[15px] leading-[1.75] text-white/60">
            <p>
              Estes Termos de Serviço (&quot;Termos&quot;) regem o uso da plataforma Funilly
              (&quot;Funilly&quot;, &quot;nós&quot;, &quot;serviço&quot;). Ao criar uma conta ou
              utilizar o Funilly, você concorda integralmente com estes Termos. Se você estiver
              usando o Funilly em nome de uma empresa, você declara ter autoridade para vinculá-la
              a este acordo.
            </p>

            <Section title="1. Descrição do serviço">
              <p>
                O Funilly é um CRM de atendimento e vendas via WhatsApp, com recursos de caixa de
                entrada compartilhada, funis de venda (pipelines), automações, transmissões de
                mensagens, relatórios e integração com a API Oficial do WhatsApp Business (Meta
                Cloud API).
              </p>
            </Section>

            <Section title="2. Cadastro e conta">
              <List
                items={[
                  "Você deve fornecer informações verdadeiras, completas e atualizadas ao criar sua conta.",
                  "Você é responsável por manter a confidencialidade da sua senha e por todas as atividades realizadas sob sua conta.",
                  "Você deve nos notificar imediatamente sobre qualquer uso não autorizado da sua conta.",
                  "É proibido compartilhar credenciais de acesso entre pessoas fora da sua equipe autorizada.",
                ]}
              />
            </Section>

            <Section title="3. Uso aceitável">
              <p>Ao usar o Funilly, você concorda em não:</p>
              <List
                items={[
                  "Utilizar a plataforma para enviar spam, mensagens não solicitadas em massa ou conteúdo que viole as Políticas Comerciais e de Uso do WhatsApp Business/Meta.",
                  "Utilizar o serviço para fins ilegais, fraudulentos ou que violem direitos de terceiros.",
                  "Tentar acessar áreas do sistema, dados de outras contas ou infraestrutura sem autorização.",
                  "Fazer engenharia reversa, copiar ou revender a plataforma sem autorização expressa.",
                  "Sobrecarregar deliberadamente a infraestrutura do serviço (ex.: ataques de negação de serviço).",
                ]}
              />
              <p>
                O uso do número de WhatsApp conectado à sua conta está sujeito também aos Termos
                de Serviço do WhatsApp Business e às políticas da Meta. Violações dessas políticas
                pelo seu número são de sua responsabilidade e podem resultar em bloqueio pela
                própria Meta, independentemente de ação do Funilly.
              </p>
            </Section>

            <Section title="4. Planos, pagamento e cobrança">
              <List
                items={[
                  "O Funilly é oferecido em planos por assinatura, cobrados por atendente (seat), conforme descrito na página de Preços.",
                  "Novas contas têm direito a um período de teste gratuito de 7 dias, sem necessidade de cartão de crédito.",
                  "Após o período de teste, a continuidade do uso requer a contratação de um plano pago.",
                  "Os pagamentos são processados pela Stripe. Ao assinar, você autoriza cobranças recorrentes no método de pagamento cadastrado.",
                  "Os valores podem ser reajustados mediante aviso prévio, aplicando-se ao próximo ciclo de cobrança.",
                  "Impostos aplicáveis podem ser acrescidos ao valor cobrado, conforme a legislação vigente.",
                ]}
              />
            </Section>

            <Section title="5. Cancelamento">
              <p>
                Você pode cancelar sua assinatura a qualquer momento diretamente pelas
                configurações da conta ou pelo portal de cobrança da Stripe, sem multa ou taxa de
                cancelamento. O cancelamento interrompe a renovação automática; o acesso permanece
                ativo até o fim do período já pago. Não realizamos reembolso proporcional de
                períodos parciais já cobrados, salvo quando exigido por lei.
              </p>
              <p>
                Também podemos suspender ou encerrar contas que violem estes Termos, mediante
                notificação prévia sempre que razoavelmente possível.
              </p>
            </Section>

            <Section title="6. Propriedade intelectual">
              <p>
                O Funilly, sua marca, design, código-fonte e demais elementos da plataforma são de
                propriedade exclusiva do Funilly ou de seus licenciadores, protegidos por leis de
                propriedade intelectual. Estes Termos não concedem a você qualquer direito de
                propriedade sobre a plataforma, apenas uma licença limitada, não exclusiva e
                intransferível de uso, enquanto sua assinatura estiver ativa.
              </p>
              <p>
                Os dados que você insere no Funilly (contatos, conversas, funis, templates)
                continuam sendo de sua propriedade. Você pode exportá-los ou solicitar sua
                exclusão a qualquer momento, conforme a Seção 8 da Política de Privacidade.
              </p>
            </Section>

            <Section title="7. Disponibilidade do serviço">
              <p>
                Envidamos esforços comercialmente razoáveis para manter o Funilly disponível de
                forma contínua, mas não garantimos operação ininterrupta ou livre de erros.
                Manutenções programadas, falhas de terceiros (incluindo a API do WhatsApp/Meta,
                provedores de nuvem e processadores de pagamento) podem causar indisponibilidade
                temporária, sem que isso gere direito a indenização, salvo obrigação legal em
                contrário.
              </p>
            </Section>

            <Section title="8. Limitação de responsabilidade">
              <p>
                Na máxima extensão permitida pela lei, o Funilly não será responsável por danos
                indiretos, incidentais, lucros cessantes ou perda de dados decorrentes do uso ou
                da incapacidade de uso da plataforma, incluindo bloqueios ou restrições aplicados
                pela Meta/WhatsApp ao seu número. A responsabilidade total do Funilly, em qualquer
                hipótese, está limitada ao valor pago por você nos 12 meses anteriores ao evento
                que originou a reclamação.
              </p>
            </Section>

            <Section title="9. Alterações nestes Termos">
              <p>
                Podemos atualizar estes Termos periodicamente para refletir mudanças no serviço ou
                em requisitos legais. Alterações relevantes serão comunicadas por e-mail ou aviso
                na plataforma com antecedência razoável. O uso continuado do Funilly após a
                entrada em vigor das alterações constitui aceitação dos novos Termos.
              </p>
            </Section>

            <Section title="10. Lei aplicável e foro">
              <p>
                Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito
                o foro da comarca do domicílio do Funilly para dirimir quaisquer controvérsias
                decorrentes deste acordo, com renúncia a qualquer outro, por mais privilegiado que
                seja.
              </p>
            </Section>

            <Section title="11. Contato">
              <p>
                Dúvidas sobre estes Termos podem ser enviadas para{" "}
                <a href="mailto:suporte@funilly.tech" className="text-[#1D9E75] hover:underline">
                  suporte@funilly.tech
                </a>
                .
              </p>
            </Section>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-white">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2 pl-5">
      {items.map((item) => (
        <li key={item} className="list-disc marker:text-[#1D9E75]">
          {item}
        </li>
      ))}
    </ul>
  );
}
