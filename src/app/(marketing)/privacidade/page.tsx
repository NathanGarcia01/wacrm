import type { Metadata } from "next";
import { MarketingNav } from "../_components/marketing-nav";
import { MarketingFooter } from "../_components/marketing-footer";

export const metadata: Metadata = {
  title: "Política de Privacidade — Funilly",
  description:
    "Como o Funilly coleta, usa e protege seus dados pessoais, em conformidade com a LGPD.",
};

const LAST_UPDATED = "28 de setembro de 2026";

export default function PrivacidadePage() {
  return (
    <>
      <MarketingNav />

      <section className="px-5 pt-[120px] pb-16 sm:px-10 sm:pt-[140px] sm:pb-20 lg:px-20 lg:pt-[160px] lg:pb-[100px]">
        <div className="mx-auto max-w-[720px]">
          <div className="mb-3 text-xs tracking-[3px] text-[#1D9E75] uppercase">Legal</div>
          <h1 className="mb-4 text-[32px] font-medium tracking-[-1px] sm:text-[40px]">
            Política de Privacidade
          </h1>
          <p className="mb-14 text-sm text-white/40">Última atualização: {LAST_UPDATED}</p>

          <div className="flex flex-col gap-10 text-[15px] leading-[1.75] text-white/60">
            <p>
              O Funilly (&quot;nós&quot;, &quot;nosso&quot;) leva a sua privacidade a sério. Esta
              Política de Privacidade explica quais dados pessoais coletamos, como usamos,
              armazenamos e protegemos essas informações, e quais direitos você tem sobre elas,
              em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).
            </p>
            <p>
              Ao usar o Funilly, você concorda com as práticas descritas nesta política. Se você
              não concordar, pedimos que não utilize a plataforma.
            </p>

            <Section title="1. Quem somos">
              <p>
                O Funilly é uma plataforma de CRM para atendimento e vendas via WhatsApp,
                operada como um serviço SaaS (Software as a Service). Para os fins da LGPD, o
                Funilly atua como <strong className="text-white/80">controlador</strong> dos
                dados de cadastro e de uso da plataforma (conta, cobrança, acessos), e como{" "}
                <strong className="text-white/80">operador</strong> dos dados de contatos e
                conversas que nossos clientes gerenciam dentro da ferramenta — ou seja, os dados
                dos clientes finais de cada empresa que usa o Funilly pertencem e são de
                responsabilidade dessa empresa, e nós os tratamos apenas para prestar o serviço
                contratado.
              </p>
            </Section>

            <Section title="2. Quais dados coletamos">
              <SubTitle>2.1 Dados de cadastro</SubTitle>
              <p>
                Nome, e-mail, telefone, nome da empresa e senha (armazenada de forma
                criptografada) quando você cria uma conta.
              </p>
              <SubTitle>2.2 Dados de pagamento</SubTitle>
              <p>
                O processamento de pagamentos é feito pela Stripe. O Funilly não armazena
                números completos de cartão de crédito — apenas identificadores de assinatura e
                histórico de cobrança fornecidos pela Stripe.
              </p>
              <SubTitle>2.3 Dados de uso da plataforma</SubTitle>
              <p>
                Registros de acesso (endereço IP, data e hora, navegador, dispositivo) e dados
                de uso das funcionalidades, coletados para segurança, suporte e melhoria do
                produto.
              </p>
              <SubTitle>2.4 Dados de conversas e contatos do WhatsApp</SubTitle>
              <p>
                Ao conectar um número do WhatsApp Business, o Funilly processa e armazena as
                mensagens, contatos, tags e demais informações que você (ou sua equipe)
                gerencia dentro da plataforma, para viabilizar o atendimento, os funis de venda,
                as automações e os relatórios. Esses dados são tratados como confidenciais e não
                são compartilhados com terceiros além dos descritos na Seção 4.
              </p>
              <SubTitle>2.5 Cookies</SubTitle>
              <p>Ver Seção 6.</p>
            </Section>

            <Section title="3. Como usamos os dados">
              <List
                items={[
                  "Fornecer, operar e manter as funcionalidades do Funilly (inbox, funis, automações, transmissões e relatórios).",
                  "Processar pagamentos e gerenciar assinaturas.",
                  "Autenticar acessos e proteger sua conta contra uso não autorizado.",
                  "Enviar comunicações essenciais sobre o serviço (avisos de cobrança, mudanças de funcionalidade, segurança).",
                  "Oferecer suporte técnico.",
                  "Cumprir obrigações legais e regulatórias.",
                  "Melhorar a plataforma a partir de métricas agregadas de uso.",
                ]}
              />
            </Section>

            <Section title="4. Com quem compartilhamos dados">
              <p>Compartilhamos dados apenas com prestadores de serviço necessários à operação do Funilly:</p>
              <List
                items={[
                  "Meta / WhatsApp Business Platform — para envio e recebimento de mensagens via API oficial.",
                  "Stripe — para processamento de pagamentos e gestão de assinaturas.",
                  "Supabase — infraestrutura de banco de dados e autenticação.",
                  "Render — infraestrutura de hospedagem da aplicação.",
                ]}
              />
              <p>
                Não vendemos, alugamos ou comercializamos seus dados pessoais ou os dados dos
                seus contatos a terceiros para fins de marketing.
              </p>
            </Section>

            <Section title="5. Armazenamento e segurança">
              <p>
                Os dados são armazenados em servidores com criptografia em trânsito (TLS) e em
                repouso para informações sensíveis, como tokens de acesso à API do WhatsApp.
                Adotamos controles de acesso, autenticação e segregação por conta para reduzir o
                risco de acesso não autorizado. Nenhum sistema é 100% imune a falhas, e nos
                comprometemos a notificar você em caso de incidente de segurança que possa
                afetar seus dados, conforme exigido pela LGPD.
              </p>
            </Section>

            <Section title="6. Cookies">
              <p>
                Utilizamos cookies essenciais para manter sua sessão autenticada e cookies de
                preferência (como tema claro/escuro). Não utilizamos cookies de rastreamento
                publicitário de terceiros. Você pode desabilitar cookies nas configurações do
                seu navegador, mas isso pode impedir o funcionamento correto da plataforma.
              </p>
            </Section>

            <Section title="7. Seus direitos (LGPD)">
              <p>Como titular de dados, você tem direito a:</p>
              <List
                items={[
                  "Confirmação da existência de tratamento dos seus dados.",
                  "Acesso aos dados que temos sobre você.",
                  "Correção de dados incompletos, inexatos ou desatualizados.",
                  "Anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade com a lei.",
                  "Portabilidade dos dados a outro fornecedor de serviço.",
                  "Eliminação dos dados pessoais tratados com o seu consentimento.",
                  "Informação sobre as entidades com quem compartilhamos seus dados.",
                  "Revogação do consentimento, quando aplicável.",
                ]}
              />
              <p>
                Para exercer qualquer um desses direitos, entre em contato pelo e-mail{" "}
                <a href="mailto:suporte@funilly.tech" className="text-[#1D9E75] hover:underline">
                  suporte@funilly.tech
                </a>
                . Responderemos sua solicitação dentro dos prazos estabelecidos pela LGPD.
              </p>
            </Section>

            <Section title="8. Retenção e exclusão de dados">
              <p>
                Mantemos seus dados enquanto sua conta estiver ativa ou conforme necessário para
                cumprir obrigações legais, resolver disputas e fazer cumprir nossos acordos.
                Após o cancelamento da conta, os dados são retidos por um período razoável para
                fins de backup e obrigações fiscais/contábeis, e depois excluídos ou
                anonimizados, salvo quando a lei exigir retenção por prazo maior.
              </p>
            </Section>

            <Section title="9. Alterações nesta política">
              <p>
                Podemos atualizar esta política periodicamente. Alterações relevantes serão
                comunicadas por e-mail ou por aviso na plataforma, com antecedência razoável
                antes de entrarem em vigor.
              </p>
            </Section>

            <Section title="10. Contato">
              <p>
                Dúvidas sobre esta Política de Privacidade ou sobre o tratamento dos seus dados
                podem ser enviadas para{" "}
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

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-2 text-sm font-medium text-white/80">{children}</h3>;
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
