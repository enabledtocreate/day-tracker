import {
  type ContactLinkPrefs,
  DEFAULT_CONTACT_LINK_PREFS,
  contactLinkGlyph,
  contactLinkHref,
  contactLinkKind,
  isContactUrl,
  normalizeContactUrlInput,
  openContactUrl,
} from '@/lib/contactLinks';
import { isMapsUrl, linkGlyph as mapLinkGlyphOnly, openMapsUrl } from '@/lib/mapLinks';

export type { ContactLinkPrefs };
export { DEFAULT_CONTACT_LINK_PREFS };

export type TaskLinkOpenOptions = {
  /** On mobile, open mailto/tel/sms with the device handler instead of web compose. */
  nativeContactHandlers?: boolean;
};

function resolvedContactPrefs(
  rawUrl: string,
  contactPrefs: ContactLinkPrefs,
  options?: TaskLinkOpenOptions
): ContactLinkPrefs {
  const normalized = normalizeContactUrlInput(rawUrl.trim());
  if (options?.nativeContactHandlers !== true || contactLinkKind(normalized) !== 'email') {
    return contactPrefs;
  }
  return { ...contactPrefs, emailHandler: 'mailto' as const };
}

/** True when the URL is a contact or maps link (special open behavior). */
export function isSpecialTaskLink(rawUrl: string | null | undefined): boolean {
  if (!rawUrl?.trim()) return false;
  const normalized = normalizeContactUrlInput(rawUrl.trim());
  return isContactUrl(normalized) || isMapsUrl(normalized) || isMapsUrl(rawUrl.trim());
}

/** Glyph for any task link: contact → maps → default chain. */
export function taskLinkGlyph(rawUrl: string | null | undefined): string {
  if (isContactUrl(rawUrl)) return contactLinkGlyph(rawUrl);
  return mapLinkGlyphOnly(rawUrl);
}

/** Safe href for task link anchors (avoids relative paths like "Email" for contact links). */
export function taskLinkHref(
  rawUrl: string,
  contactPrefs: ContactLinkPrefs = DEFAULT_CONTACT_LINK_PREFS,
  options?: TaskLinkOpenOptions
): string {
  const prefs = resolvedContactPrefs(rawUrl, contactPrefs, options);
  const contactTarget = contactLinkHref(rawUrl, prefs);
  if (contactTarget) return contactTarget;
  if (isMapsUrl(rawUrl)) return rawUrl.trim();
  return rawUrl.trim();
}

/** Open a task link with contact prefs and maps handling applied. */
export function openTaskLink(
  rawUrl: string,
  contactPrefs: ContactLinkPrefs = DEFAULT_CONTACT_LINK_PREFS,
  options?: TaskLinkOpenOptions
): void {
  const normalized = normalizeContactUrlInput(rawUrl.trim());
  if (isContactUrl(normalized)) {
    openContactUrl(normalized, resolvedContactPrefs(rawUrl, contactPrefs, options));
    return;
  }
  if (isMapsUrl(normalized)) {
    openMapsUrl(normalized);
    return;
  }
  if (typeof window === 'undefined') return;
  window.open(rawUrl.trim(), '_blank', 'noopener,noreferrer');
}

export function taskLinkOpenLabel(
  rawUrl: string | null | undefined,
  contactPrefs?: ContactLinkPrefs
): string {
  if (isContactUrl(rawUrl)) {
    void contactPrefs;
    return 'Open contact';
  }
  if (isMapsUrl(rawUrl)) return 'Open in maps';
  return 'Open link';
}
