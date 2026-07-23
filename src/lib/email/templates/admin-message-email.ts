import { escapeHtml } from "./welcome-email";

export interface AdminMessageEmailProps {
  subject: string;
  message: string;
}

/**
 * Free-text message sent by an admin from the account detail page
 * (e.g. a billing follow-up). Mirrors welcome-email.ts's table-based,
 * inline-style layout so every transactional email out of Funilly
 * looks consistent — same header bar, same footer.
 */
export function adminMessageEmailHtml({ subject, message }: AdminMessageEmailProps): string {
  const safeSubject = escapeHtml(subject.trim());
  // Preserve line breaks the admin typed — escape first, then turn
  // newlines into <br>, so no user input can inject markup via a
  // crafted line.
  const safeMessageHtml = escapeHtml(message.trim()).replace(/\n/g, "<br />");

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
                <h1 style="margin:0 0 16px;color:#0D1117;font-size:20px;font-weight:700;line-height:1.3;">${safeSubject}</h1>
                <p style="margin:0;color:#3f4650;font-size:15px;line-height:1.6;">${safeMessageHtml}</p>
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
