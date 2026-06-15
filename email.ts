import nodemailer from 'nodemailer';

const SITE_NAME = 'База отдыха НИКО';

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!isEmailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

export async function sendEmail(
  to: string | string[],
  subject: string,
  text: string,
  html?: string
): Promise<boolean> {
  const transport = getTransporter();
  if (!transport) {
    console.log(`[email] SMTP не настроен — пропуск: «${subject}» → ${to}`);
    return false;
  }
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || `"${SITE_NAME}" <${process.env.SMTP_USER}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: `【${SITE_NAME}】 ${subject}`,
      text,
      html: html || text.replace(/\n/g, '<br>'),
    });
    console.log(`[email] Отправлено: «${subject}» → ${to}`);
    return true;
  } catch (err) {
    console.error('[email] Ошибка отправки:', err);
    return false;
  }
}

export function emailLayout(title: string, bodyHtml: string): string {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#18181b;line-height:1.6">
      <p style="color:#059669;font-weight:700;font-size:18px;margin:0 0 8px">${SITE_NAME}</p>
      <h2 style="margin:0 0 16px;font-size:22px">${title}</h2>
      ${bodyHtml}
      <p style="color:#a1a1aa;font-size:12px;margin-top:32px;border-top:1px solid #e4e4e7;padding-top:16px">
        Автоматическое письмо с сайта. Если вы не ожидали это сообщение — просто проигнорируйте его.
      </p>
    </div>`;
}

export function formatDateRu(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
}

type DbLike = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
};

export type EmailNotifier = {
  appUrl: string;
  notifyUser: (userId: number, subject: string, text: string, html?: string) => void;
  notifyAdmins: (subject: string, text: string, html?: string) => void;
  notifyAddress: (email: string, subject: string, text: string, html?: string) => void;
};

export function createEmailNotifier(db: DbLike): EmailNotifier {
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

  const notifyAddress = (email: string, subject: string, text: string, html?: string) => {
    if (!email) return;
    void sendEmail(email, subject, text, html).catch((e) => console.error('[email]', e));
  };

  const notifyUser = (userId: number, subject: string, text: string, html?: string) => {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined;
    if (user?.email) notifyAddress(user.email, subject, text, html);
  };

  const notifyAdmins = (subject: string, text: string, html?: string) => {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      notifyAddress(adminEmail, subject, text, html);
      return;
    }
    const admins = db.prepare("SELECT email FROM users WHERE role = 'admin'").all() as { email: string }[];
    for (const admin of admins) {
      if (admin.email) notifyAddress(admin.email, subject, text, html);
    }
  };

  return { appUrl, notifyUser, notifyAdmins, notifyAddress };
}
