// CusteAi - Utilitário de e-mail
const nodemailer = require('nodemailer');

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendPasswordReset(email, resetToken, userName) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[EMAIL] SMTP não configurado — token de reset:', resetToken);
    return false;
  }

  const appUrl = process.env.APP_URL || 'https://www.custeai.com.br';
  const resetLink = `${appUrl}/app?reset=${resetToken}`;
  const from = `"${process.env.EMAIL_FROM_NAME || 'CusteAi'}" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`;

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07080a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:40px auto;padding:0 16px">
    <div style="text-align:center;margin-bottom:32px">
      <span style="font-size:26px;font-weight:800;color:#fff;letter-spacing:-1px">Custe<span style="color:#00d97e">Ai</span></span>
    </div>
    <div style="background:#111315;border:1px solid #1e2024;border-radius:12px;padding:32px">
      <h2 style="color:#fff;font-size:20px;font-weight:700;margin:0 0 8px">Redefinir senha</h2>
      <p style="color:#8b949e;font-size:14px;line-height:1.6;margin:0 0 24px">
        Olá${userName ? `, <strong style="color:#fff">${userName}</strong>` : ''}! Recebemos uma solicitação para redefinir a senha da sua conta.
      </p>
      <a href="${resetLink}" style="display:block;background:#00d97e;color:#000;text-align:center;padding:14px 24px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:24px">
        Redefinir minha senha →
      </a>
      <p style="color:#6e7681;font-size:12px;line-height:1.6;margin:0">
        Este link é válido por <strong>1 hora</strong>. Se você não solicitou a redefinição, ignore este e-mail — sua senha continua a mesma.
      </p>
    </div>
    <p style="text-align:center;color:#484f58;font-size:11px;margin-top:24px">
      CusteAi · suporte@custeai.com.br
    </p>
  </div>
</body>
</html>`;

  try {
    const transporter = createTransport();
    await transporter.sendMail({
      from,
      to: email,
      subject: 'Redefinir senha — CusteAi',
      html,
      text: `Redefinir senha CusteAi\n\nClique no link para redefinir sua senha:\n${resetLink}\n\nLink válido por 1 hora.`,
    });
    return true;
  } catch (err) {
    console.error('[EMAIL] Erro ao enviar:', err.message);
    return false;
  }
}

module.exports = { sendPasswordReset };
