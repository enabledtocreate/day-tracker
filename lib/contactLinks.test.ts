import { describe, it, expect, vi } from 'vitest';
import {
  contactLinkKind,
  isContactUrl,
  normalizeContactUrlInput,
  openContactUrl,
  parseContactLinkPrefsJson,
  contactLinkPrefsToJson,
  contactLinkGlyph,
  contactLinkHref,
  CONTACT_EMAIL_GLYPH,
  CONTACT_PHONE_GLYPH,
} from './contactLinks';

describe('contactLinkKind', () => {
  it('detects mailto, tel, and sms', () => {
    expect(contactLinkKind('mailto:alice@example.com')).toBe('email');
    expect(contactLinkKind('tel:+15551234567')).toBe('phone');
    expect(contactLinkKind('sms:5551234567')).toBe('sms');
    expect(contactLinkKind('https://example.com')).toBe(null);
  });
});

describe('normalizeContactUrlInput', () => {
  it('wraps bare email and phone', () => {
    expect(normalizeContactUrlInput('bob@corp.com')).toBe('mailto:bob@corp.com');
    expect(normalizeContactUrlInput('(555) 123-4567')).toBe('tel:5551234567');
    expect(normalizeContactUrlInput('mailto:already@x.com')).toBe('mailto:already@x.com');
    expect(normalizeContactUrlInput('email:someone@example.com')).toBe('mailto:someone@example.com');
  });
});

describe('parseContactLinkPrefsJson', () => {
  it('defaults and validates handlers', () => {
    expect(parseContactLinkPrefsJson(null).emailHandler).toBe('mailto');
    expect(parseContactLinkPrefsJson(null).gmailAccountIndex).toBe(0);
    expect(parseContactLinkPrefsJson('{"email":"gmail","phone":"sms"}').emailHandler).toBe('gmail');
    expect(parseContactLinkPrefsJson('{"email":"gmail","phone":"sms","gmail_account":2}').gmailAccountIndex).toBe(2);
    expect(parseContactLinkPrefsJson('{"email":"bad","phone":"bad"}').phoneHandler).toBe('tel');
    expect(parseContactLinkPrefsJson('{"email":"gmail","gmail_account":99}').gmailAccountIndex).toBe(5);
  });

  it('round-trips through JSON helpers', () => {
    const prefs = { ...parseContactLinkPrefsJson(null), emailHandler: 'gmail' as const, gmailAccountIndex: 2 };
    const parsed = parseContactLinkPrefsJson(contactLinkPrefsToJson(prefs));
    expect(parsed.emailHandler).toBe('gmail');
    expect(parsed.gmailAccountIndex).toBe(2);
  });
});

describe('isContactUrl', () => {
  it('is true for contact schemes and normalized bare email', () => {
    expect(isContactUrl('mailto:a@b.co')).toBe(true);
    expect(isContactUrl('bob@corp.com')).toBe(true);
    expect(isContactUrl('https://example.com')).toBe(false);
  });
});

describe('contactLinkGlyph', () => {
  it('returns kind-specific glyphs', () => {
    expect(contactLinkGlyph('mailto:a@b.co')).toBe(CONTACT_EMAIL_GLYPH);
    expect(contactLinkGlyph('tel:123')).toBe(CONTACT_PHONE_GLYPH);
  });
});

describe('contactLinkHref', () => {
  it('returns Gmail compose URL for bare email on desktop prefs', () => {
    expect(
      contactLinkHref('alice@example.com', {
        ...parseContactLinkPrefsJson(null),
        emailHandler: 'gmail',
        gmailAccountIndex: 1,
      })
    ).toBe('https://mail.google.com/mail/u/1/?view=cm&fs=1&to=alice%40example.com');
  });

  it('returns mailto for mailto handler', () => {
    expect(contactLinkHref('mailto:bob@test.org', parseContactLinkPrefsJson(null))).toBe(
      'mailto:bob@test.org'
    );
  });
});

describe('openContactUrl', () => {
  it('opens Gmail compose for gmail handler (default account)', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    vi.stubGlobal('location', { href: '' });
    openContactUrl('mailto:test@example.com', {
      ...parseContactLinkPrefsJson(null),
      emailHandler: 'gmail',
      gmailAccountIndex: 0,
    });
    expect(open).toHaveBeenCalledWith(
      'https://mail.google.com/mail/u/0/?view=cm&fs=1&to=test%40example.com',
      '_blank',
      'noopener,noreferrer'
    );
    vi.unstubAllGlobals();
  });

  it('opens Gmail compose for selected account index', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    vi.stubGlobal('location', { href: '' });
    openContactUrl('mailto:test@example.com', {
      ...parseContactLinkPrefsJson(null),
      emailHandler: 'gmail',
      gmailAccountIndex: 2,
    });
    expect(open).toHaveBeenCalledWith(
      'https://mail.google.com/mail/u/2/?view=cm&fs=1&to=test%40example.com',
      '_blank',
      'noopener,noreferrer'
    );
    vi.unstubAllGlobals();
  });
});
