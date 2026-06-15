import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';

const SITE_NAME = 'База отдыха НИКО';

let lastEmailError: string | null = null;

function readEnv(key: string): string | undefined {
  const v = process.env[key];
  if (v == null) return undefined;
  const trimmed = String(v).trim();
  return trimmed.length ? trimmed : undefined;
}

/** Пустые SMTP_PORT / SMTP_SECURE в Railway ломали отправку — читаем только непустые значения */
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
  const user = readEnv('SMTP_USER');
  const pass = readEnv('SMTP_PASS');
  if (!user || !pass) return null;

  const providerKey = (
    readEnv('SMTP_PROVIDER')?.toLowerCase() ||
    detectProviderFromEmail(user) ||
    'custom'
  );

  const preset = SMTP_PRESETS[providerKey];
  const host = readEnv('SMTP_HOST') || preset?.host;
  if (!host) return null;

  const port = Number(readEnv('SMTP_PORT') || preset?.port || 587);
  const secureEnv = readEnv('SMTP_SECURE');
  const secure =
    secureEnv !== undefined
      ? secureEnv === 'true'
      : (preset?.secure ?? port === 465);

  return {
    host,
    port,
    secure,
    auth: { user, pass },
    requireTLS: !secure && port === 587,
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    family: 4,
  };
}

export function isEmailConfigured(): boolean {
  return !!readEnv('RESEND_API_KEY') || resolveSmtpConfig() !== null;
}

export function getLastEmailError(): string | null {
  return lastEmailError;
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

function getFromAddress(): string {
  return readEnv('EMAIL_FROM') || readEnv('SMTP_FROM') || `"${SITE_NAME}" <${readEnv('SMTP_USER')}>`;
}

async function sendViaResend(
  recipients: string[],
  subject: string,
  text: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = readEnv('RESEND_API_KEY');
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY не задан' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getFromAddress(),
        to: recipients,
        subject: `${SITE_NAME}: ${subject}`,
        html: wrapHtml(html),
        text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

async function sendViaSmtp(
  recipients: string[],
  subject: string,
  text: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  const transport = getTransporter();
  if (!transport) return { ok: false, error: 'SMTP не настроен (SMTP_USER и SMTP_PASS)' };

  const replyTo = readEnv('SMTP_REPLY_TO') || readEnv('SMTP_USER');

  try {
    await transport.sendMail({
      from: getFromAddress(),
      replyTo,
      to: recipients.join(', '),
      subject: `${SITE_NAME}: ${subject}`,
      text,
      html: wrapHtml(html),
      encoding: 'utf-8',
      headers: {
        'Content-Language': 'ru',
        'X-Mailer': 'Niko-Base',
      },
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export async function sendEmail(
  to: string | string[],
  subject: string,
  text: string,
  html?: string
): Promise<boolean> {
  const recipients = (Array.isArray(to) ? to : [to])
    .map(normalizeEmail)
    .filter(isValidEmail);

  if (recipients.length === 0) {
    lastEmailError = 'Неверный адрес получателя';
    console.log(`[email] ${lastEmailError}: «${subject}»`);
    return false;
  }

  const bodyHtml = html || text.replace(/\n/g, '<br>');
  let result: { ok: boolean; error?: string };

  if (readEnv('RESEND_API_KEY')) {
    result = await sendViaResend(recipients, subject, text, bodyHtml);
    if (!result.ok) {
      console.warn('[email] Resend не сработал, пробуем SMTP:', result.error);
      result = await sendViaSmtp(recipients, subject, text, bodyHtml);
    }
  } else {
    result = await sendViaSmtp(recipients, subject, text, bodyHtml);
  }

  if (result.ok) {
    lastEmailError = null;
    console.log(`[email] Отправлено: «${subject}» → ${recipients.join(', ')}`);
    return true;
  }

  lastEmailError = result.error || 'Неизвестная ошибка';
  console.error(`[email] Ошибка: ${lastEmailError}`);
  return false;
}

export async function verifyEmailConnection(): Promise<{ ok: boolean; error?: string; mode: string }> {
  if (readEnv('RESEND_API_KEY')) {
    return { ok: true, mode: 'resend (API)' };
  }

  const transport = getTransporter();
  if (!transport) {
    return { ok: false, error: 'Задайте SMTP_USER и SMTP_PASS (или RESEND_API_KEY)', mode: 'none' };
  }

  try {
    await transport.verify();
    return { ok: true, mode: getSmtpProviderInfo() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, mode: getSmtpProviderInfo() };
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
  const appUrl = (readEnv('APP_URL') || 'http://localhost:3000').replace(/\/$/, '');

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

    for (const email of parseEmailList(readEnv('ADMIN_EMAIL'))) {
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
  if (readEnv('RESEND_API_KEY')) return 'resend (API)';
  const user = readEnv('SMTP_USER') || '';
  const provider = readEnv('SMTP_PROVIDER') || detectProviderFromEmail(user) || 'custom';
  const config = resolveSmtpConfig();
  if (!config || !('host' in config) || !config.host) return 'не настроен';
  return `${provider} (${config.host}:${config.port}, secure=${config.secure})`;
}
