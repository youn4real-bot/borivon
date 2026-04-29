import { Resend } from "resend";

export const resend = new Resend(process.env.RESEND_API_KEY!);

export async function sendVerificationEmail(to: string, name: string, token: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const verifyUrl = `${baseUrl}/portal/verify?token=${token}`;

  await resend.emails.send({
    from: "Borivon <noreply@borivon.com>",
    to,
    subject: "Vérifiez votre adresse email — Borivon",
    html: buildVerificationEmail(name, verifyUrl),
  });
}

function buildVerificationEmail(name: string, verifyUrl: string): string {
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vérification de votre email</title>
</head>
<body style="margin:0;padding:0;background:#1a1a1a;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#212121;border-radius:12px;overflow:hidden;border:1px solid rgba(201,162,64,0.2);">
          <!-- Header -->
          <tr>
            <td style="background:#c9a240;padding:32px 40px;text-align:center;">
              <p style="margin:0;font-size:28px;font-weight:700;color:#1a1a1a;letter-spacing:3px;">BORIVON</p>
              <p style="margin:8px 0 0;font-size:12px;color:rgba(26,26,26,0.7);letter-spacing:1px;text-transform:uppercase;">Portail Candidat</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;font-size:16px;color:#eeecea;">Bonjour <strong>${name}</strong>,</p>
              <p style="margin:0 0 24px;font-size:15px;color:rgba(238,236,234,0.75);line-height:1.6;">
                Merci pour votre paiement. Pour accéder à votre espace personnel et déposer vos documents, veuillez confirmer votre adresse email en cliquant sur le bouton ci-dessous.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:32px 0;">
                <tr>
                  <td style="background:#c9a240;border-radius:8px;">
                    <a href="${verifyUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#1a1a1a;text-decoration:none;letter-spacing:0.5px;">
                      Vérifier mon email
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:rgba(238,236,234,0.4);">Ce lien expire dans 24 heures.</p>
              <p style="margin:0;font-size:12px;color:rgba(238,236,234,0.3);word-break:break-all;">
                Lien direct : <a href="${verifyUrl}" style="color:#c9a240;">${verifyUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid rgba(255,255,255,0.06);">
              <p style="margin:0;font-size:12px;color:rgba(238,236,234,0.3);text-align:center;">
                Borivon · Casablanca, Maroc · <a href="https://borivon.com" style="color:#c9a240;text-decoration:none;">borivon.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
