import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';

const SITE_NAME = 'База отдыха НИКО';

/** Пресеты SMTP — Gmail, Yandex, Mail.ru, Outlook и др. */
const SMTP_PRESETS: Record<string, { host: string; port: number; secure: boolean }> = {
  yandex: { host: 'smtp.yandex.ru', port: 465, secure: true },
  gmail: { host: 'smtp.gmail.com', port: 587, secure: false },
  google: { host: 'smtp.gmail.com', port: 587, secure: false },
  mailru: { host: 'smtp.mail.ru', port: 465, secure: true },
  mail: { host: 'smtp.mail.ru', port: 465, secure: true },
  outlook: { host: 'smtp.office365.com', port: 587, secure: false },
  hotmail: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  live: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  rambler: { host: 'smtp.rambler.ru', port: 465, secure: true },
  icloud: { host: 'smtp.mail.me.com', port: 587, secure: false },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
  proton: { host: 'smtp.protonmail.ch', port: 587, secure: false },
};

const DOMAIN_TO_PROVIDER: Record<string, string> = {
  'yandex.ru': 'yandex',
  'ya.ru': 'yandex',
  'yandex.com': 'yandex',
  'gmail.com': 'gmail',
  'googlemail.com': 'gmail',
  'mail.ru': 'mailru',
  'inbox.ru': 'mailru',
  'list.ru': 'mailru',
  'bk.ru': 'mailru',
  'internet.ru': 'mailru',
  'outlook.com': 'outlook',
  'hotmail.com': 'hotmail',
  'live.com': 'live',
  'live.ru': 'outlook',
  'rambler.ru': 'rambler',
  'lenta.ru': 'rambler',
  'icloud.com': 'icloud',
  'me.com': 'icloud',
  'mac.com': 'icloud',
  'yahoo.com': 'yahoo',
};

function detectProviderFromEmail(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  return DOMAIN_TO_PROVIDER[domain] || null;
}

function resolveSmtpConfig(): SMTPTransport.Options | null {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;

  const providerKey = (
    process.env.SMTP_PROVIDER?.toLowerCase() ||
    detectProviderFromEmail(user) ||
    'custom'
  );

  const preset = SMTP_PRESETS[providerKey];
  const host = process.env.SMTP_HOST?.trim() || preset?.host;
  if (!host) return null;

  const port = Number(process.env.SMTP_PORT || preset?.port || 587);
  const secure =
    process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE === 'true'
      : (preset?.secure ?? port === 465);

  return {
    host,
    port,
    secure,
    auth: { user, pass },
    requireTLS: !secure && port === 587,
    tls: { minVersion: 'TLSv1.2' },
  };
}

export function isEmailConfigured(): boolean {
  return resolveSmtpConfig() !== null;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const config = resolveSmtpConfig();
  if (!config) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport(config);
  }
  return transporter;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseEmailList(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(
    raw.split(/[,;]/).map(normalizeEmail).filter((e) => e && isValidEmail(e))
  )];
}

function wrapHtml(bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"></head><body>${bodyHtml}</body></html>`;
}

export async function sendEmail(
  to: string | string[],
  subject: string,
  text: string,
  html?: string
): Promise<boolean> {
  const transport = getTransporter();
  const recipients = (Array.isArray(to) ? to : [to])
    .map(normalizeEmail)
    .filter(isValidEmail);

  if (!transport || recipients.length === 0) {
    console.log(`[email] SMTP не настроен или неверный адрес — пропуск: «${subject}»`);
    return false;
  }

  const from = process.env.SMTP_FROM?.trim() || `"${SITE_NAME}" <${process.env.SMTP_USER}>`;
  const replyTo = process.env.SMTP_REPLY_TO?.trim() || process.env.SMTP_USER;

  try {
    await transport.sendMail({
      from,
      replyTo,
      to: recipients.join(', '),
      subject: `${SITE_NAME}: ${subject}`,
      text,
      html: wrapHtml(html || text.replace(/\n/g, '<br>')),
      encoding: 'utf-8',
      headers: {
        'Content-Language': 'ru',
        'X-Mailer': 'Niko-Base',
      },
    });
    console.log(`[email] Отправлено: «${subject}» → ${recipients.join(', ')}`);
    return true;
  } catch (err) {
    console.error('[email] Ошибка отправки:', err);
    return false;
  }
}

export function emailLayout(title: string, bodyHtml: string): string {
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#18181b;line-height:1.6">
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
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) return;
    void sendEmail(normalized, subject, text, html).catch((e) => console.error('[email]', e));
  };

  const notifyUser = (userId: number, subject: string, text: string, html?: string) => {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined;
    if (user?.email) notifyAddress(user.email, subject, text, html);
  };

  const notifyAdmins = (subject: string, text: string, html?: string) => {
    const targets = new Set<string>();

    for (const email of parseEmailList(process.env.ADMIN_EMAIL)) {
      targets.add(email);
    }

    const admins = db.prepare("SELECT email FROM users WHERE role = 'admin'").all() as { email: string }[];
    for (const admin of admins) {
      if (admin.email && isValidEmail(admin.email)) {
        targets.add(normalizeEmail(admin.email));
      }
    }

    if (targets.size === 0) {
      console.log('[email] Нет адресов администратора (ADMIN_EMAIL или admin в БД)');
      return;
    }

    void sendEmail([...targets], subject, text, html).catch((e) => console.error('[email]', e));
  };

  return { appUrl, notifyUser, notifyAdmins, notifyAddress };
}

export function getSmtpProviderInfo(): string {
  const user = process.env.SMTP_USER || '';
  const provider = process.env.SMTP_PROVIDER || detectProviderFromEmail(user) || 'custom';
  const config = resolveSmtpConfig();
  if (!config || !('host' in config) || !config.host) return 'не настроен';
  return `${provider} (${config.host}:${config.port})`;
}
