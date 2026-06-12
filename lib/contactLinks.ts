/**
 * Contact-link detection and opening (email / phone / SMS).
 *
 * Stored like any task link URL (`mailto:`, `tel:`, `sms:`). User settings
 * choose which app or web compose UI opens when a contact link is clicked.
 */

export type ContactEmailHandler = 'mailto' | 'gmail' | 'outlook_web' | 'yahoo_web';
export type ContactPhoneHandler = 'tel' | 'sms';

export type ContactLinkKind = 'email' | 'phone' | 'sms';

export type ContactLinkPrefs = {
  emailHandler: ContactEmailHandler;
  phoneHandler: ContactPhoneHandler;
  /** 0-based Gmail multi-account index (`/u/0/`, `/u/1/`, …). Used when emailHandler is gmail. */
  gmailAccountIndex: number;
};

export const DEFAULT_CONTACT_LINK_PREFS: ContactLinkPrefs = {
  emailHandler: 'mailto',
  phoneHandler: 'tel',
  gmailAccountIndex: 0,
};

const EMAIL_HANDLERS: ContactEmailHandler[] = ['mailto', 'gmail', 'outlook_web', 'yahoo_web'];
const PHONE_HANDLERS: ContactPhoneHandler[] = ['tel', 'sms'];

/** Gmail supports up to six signed-in accounts in the browser (indices 0–5). */
export const GMAIL_ACCOUNT_INDEX_MAX = 5;

export function clampGmailAccountIndex(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseInt(value, 10) : 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > GMAIL_ACCOUNT_INDEX_MAX) return GMAIL_ACCOUNT_INDEX_MAX;
  return Math.floor(n);
}

export function gmailAccountOptionLabel(index: number): string {
  const ordinals = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
  const ord = ordinals[index] ?? `${index + 1}th`;
  return index === 0 ? `${ord} Google account (default)` : `${ord} Google account`;
}

/** Emoji shown for contact links (email / phone / SMS). */
export const CONTACT_EMAIL_GLYPH = '✉️';
export const CONTACT_PHONE_GLYPH = '📞';
export const CONTACT_SMS_GLYPH = '💬';

export function parseContactLinkPrefsJson(raw: string | null | undefined): ContactLinkPrefs {
  if (raw == null || raw.trim() === '') return { ...DEFAULT_CONTACT_LINK_PREFS };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const email = typeof o.email === 'string' ? o.email : DEFAULT_CONTACT_LINK_PREFS.emailHandler;
    const phone = typeof o.phone === 'string' ? o.phone : DEFAULT_CONTACT_LINK_PREFS.phoneHandler;
    return {
      emailHandler: EMAIL_HANDLERS.includes(email as ContactEmailHandler)
        ? (email as ContactEmailHandler)
        : DEFAULT_CONTACT_LINK_PREFS.emailHandler,
      phoneHandler: PHONE_HANDLERS.includes(phone as ContactPhoneHandler)
        ? (phone as ContactPhoneHandler)
        : DEFAULT_CONTACT_LINK_PREFS.phoneHandler,
      gmailAccountIndex: clampGmailAccountIndex(o.gmail_account),
    };
  } catch {
    return { ...DEFAULT_CONTACT_LINK_PREFS };
  }
}

export function contactLinkPrefsToJson(prefs: ContactLinkPrefs): string {
  return JSON.stringify({
    email: prefs.emailHandler,
    phone: prefs.phoneHandler,
    gmail_account: clampGmailAccountIndex(prefs.gmailAccountIndex),
  });
}

export function contactLinkPrefsFromSettings(
  settings: { contact_link_json?: string | null } | null | undefined
): ContactLinkPrefs {
  return parseContactLinkPrefsJson(settings?.contact_link_json ?? null);
}

/** Classify a stored contact URL. Returns null when not a contact link. */
export function contactLinkKind(rawUrl: string | null | undefined): ContactLinkKind | null {
  if (!rawUrl) return null;
  const url = normalizeContactUrlInput(rawUrl.trim());
  if (/^mailto:/i.test(url)) return 'email';
  if (/^tel:/i.test(url)) return 'phone';
  if (/^sms:/i.test(url)) return 'sms';
  return null;
}

export function isContactUrl(rawUrl: string | null | undefined): boolean {
  return contactLinkKind(rawUrl) != null;
}

/** Normalize user input into a contact URL when it looks like email or phone. */
export function normalizeContactUrlInput(raw: string): string {
  const u = raw.trim();
  if (u === '') return u;
  if (/^(mailto|tel|sms):/i.test(u)) return u;
  if (/^email:/i.test(u)) {
    const addr = u.replace(/^email:/i, '').trim();
    return addr ? `mailto:${addr}` : u;
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return `mailto:${u}`;
  const digits = u.replace(/[^\d+]/g, '');
  if (digits.length >= 7 && /^[\d\s().+-]+$/.test(u)) return `tel:${digits}`;
  return u;
}

export function extractMailtoAddress(url: string): string {
  const rest = url.replace(/^mailto:/i, '');
  const addr = rest.split('?')[0]?.trim() ?? '';
  return decodeURIComponent(addr);
}

function extractTelNumber(url: string): string {
  return url.replace(/^(tel|sms):/i, '').trim();
}

export function buildEmailOpenUrl(address: string, prefs: ContactLinkPrefs): string {
  const to = encodeURIComponent(address);
  switch (prefs.emailHandler) {
    case 'gmail': {
      const idx = clampGmailAccountIndex(prefs.gmailAccountIndex);
      return `https://mail.google.com/mail/u/${idx}/?view=cm&fs=1&to=${to}`;
    }
    case 'outlook_web':
      return `https://outlook.office.com/mail/deeplink/compose?to=${to}`;
    case 'yahoo_web':
      return `https://compose.mail.yahoo.com/?to=${to}`;
    case 'mailto':
    default:
      return `mailto:${address}`;
  }
}

/** Resolved href for a contact link (mailto, tel, sms, or web compose). */
export function contactLinkHref(
  rawUrl: string,
  prefs: ContactLinkPrefs = DEFAULT_CONTACT_LINK_PREFS
): string | null {
  const url = normalizeContactUrlInput(rawUrl.trim());
  if (url === '') return null;
  const kind = contactLinkKind(url);
  if (kind === 'email') {
    const addr = extractMailtoAddress(url);
    if (!addr) return null;
    return buildEmailOpenUrl(addr, prefs);
  }
  if (kind === 'phone' || kind === 'sms') return url;
  return null;
}

/** Open a contact link using user preferences. */
export function openContactUrl(rawUrl: string, prefs: ContactLinkPrefs = DEFAULT_CONTACT_LINK_PREFS): void {
  if (typeof window === 'undefined') return;
  const url = normalizeContactUrlInput(rawUrl.trim());
  if (url === '') return;

  const kind = contactLinkKind(url);
  if (kind === 'email') {
    const addr = extractMailtoAddress(url);
    if (!addr) return;
    const target = buildEmailOpenUrl(addr, prefs);
    if (prefs.emailHandler === 'mailto') {
      window.location.href = target;
    } else {
      window.open(target, '_blank', 'noopener,noreferrer');
    }
    return;
  }

  if (kind === 'phone') {
    const num = extractTelNumber(url);
    if (prefs.phoneHandler === 'sms') {
      window.location.href = `sms:${num}`;
    } else {
      window.location.href = `tel:${num}`;
    }
    return;
  }

  if (kind === 'sms') {
    window.location.href = `sms:${extractTelNumber(url)}`;
  }
}

export function contactLinkGlyph(rawUrl: string | null | undefined): string {
  const kind = contactLinkKind(rawUrl);
  if (kind === 'email') return CONTACT_EMAIL_GLYPH;
  if (kind === 'phone') return CONTACT_PHONE_GLYPH;
  if (kind === 'sms') return CONTACT_SMS_GLYPH;
  return CONTACT_EMAIL_GLYPH;
}

export function contactLinkOpenLabel(rawUrl: string | null | undefined): string {
  const kind = contactLinkKind(rawUrl);
  if (kind === 'email') return 'Open contact (email)';
  if (kind === 'phone') return 'Open contact (phone)';
  if (kind === 'sms') return 'Open contact (SMS)';
  return 'Open contact';
}
