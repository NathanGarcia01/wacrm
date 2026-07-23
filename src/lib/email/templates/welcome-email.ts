const DASHBOARD_URL = "https://www.funilly.tech/dashboard";

const FEATURES = [
  "CRM integrado ao WhatsApp",
  "Disparos em massa com cadência anti-banimento",
  "Pipeline de vendas automático",
  "Relatórios e ROI em tempo real",
  "Automações com IA",
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface WelcomeEmailProps {
  name: string;
}

/**
 * Table-based layout with inline styles only — the constraints every
 * email client (Outlook desktop especially) needs, no external
 * stylesheet or images. The Funilly wordmark is rendered as text on a
 * green bar rather than a hosted logo image, so the header never
 * shows a broken-image icon in clients that block remote images by
 * default (which is most of them, until the recipient opts in).
 */
export function welcomeEmailHtml({ name }: WelcomeEmailProps): string {
  const safeName = escapeHtml(name.trim());
  const heading = safeName
    ? `Bem-vindo ao Funilly, ${safeName}! 🎉`
    : "Bem-vindo ao Funilly! 🎉";

  const featuresHtml = FEATURES.map(
    (feature) =>
      `<tr><td style="padding:5px 0;color:#3f4650;font-size:14px;line-height:1.5;">✅ ${escapeHtml(feature)}</td></tr>`,
  ).join("");

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background-color:#1D9E75;padding:28px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:36px;height:36px;background-color:rgba(255,255,255,0.18);border-radius:8px;text-align:center;vertical-align:middle;">
                      <span style="color:#ffffff;font-size:18px;font-weight:700;line-height:36px;">F</span>
                    </td>
                    <td style="padding-left:10px;">
                      <span style="color:#ffffff;font-size:18px;font-weight:700;">Funilly</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;color:#0D1117;font-size:22px;font-weight:700;line-height:1.3;">${heading}</h1>
                <p style="margin:0 0 20px;color:#3f4650;font-size:15px;line-height:1.6;">
                  Sua conta foi criada com sucesso. Você tem <strong>7 dias de trial gratuito</strong> para explorar tudo que o Funilly tem a oferecer.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                  ${featuresHtml}
                </table>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:8px;background-color:#1D9E75;">
                      <a href="${DASHBOARD_URL}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">Acessar minha conta</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background-color:#f9fafb;border-top:1px solid #eef0f2;">
                <p style="margin:0;color:#9aa1ab;font-size:12px;line-height:1.6;">
                  Funilly · <a href="mailto:suporte@funilly.tech" style="color:#9aa1ab;text-decoration:underline;">suporte@funilly.tech</a> · <a href="https://www.funilly.tech" style="color:#9aa1ab;text-decoration:underline;">www.funilly.tech</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
