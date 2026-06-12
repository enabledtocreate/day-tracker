/**
 * Lucide icon names (kebab-case) for org categories/blocks.
 * Full list: `lib/orgLucideIconNames.gen.ts` (regenerate with `npm run gen:org-icons` after upgrading lucide-react).
 * Server whitelist: `api/org_icon_whitelist.json` (same regeneration).
 */
import { ORG_LUCIDE_ICON_NAMES } from '@/lib/orgLucideIconNames.gen';

export { ORG_LUCIDE_ICON_NAMES };

export const ORG_LUCIDE_ICON_SET = new Set<string>(ORG_LUCIDE_ICON_NAMES);

export type OrgLucideIconName = string;

/** Legacy React export names (PascalCase) stored before kebab migration — map to kebab for lookup. */
export function legacyPascalToKebab(pascal: string): string {
  let s = pascal.replace(/([a-zA-Z])(\d)/g, '$1-$2');
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1-$2');
  s = s.replace(/([A-Z])([A-Z][a-z])/g, '$1-$2');
  return s.toLowerCase();
}

/** Canonical kebab-case name for API / DynamicIcon, or null if unknown. */
export function normalizeStoredOrgIcon(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (ORG_LUCIDE_ICON_SET.has(lower)) return lower;
  if (!t.includes('-') && /[A-Z]/.test(t)) {
    const leg = legacyPascalToKebab(t);
    if (ORG_LUCIDE_ICON_SET.has(leg)) return leg;
  }
  return null;
}

export function isOrgLucideIconName(s: string): s is OrgLucideIconName {
  return normalizeStoredOrgIcon(s) !== null;
}
