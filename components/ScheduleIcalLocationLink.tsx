'use client';

import { icalLocationToMapsUrl, MAP_LINK_GLYPH, openMapsUrl } from '@/lib/mapLinks';

type Props = {
  location?: string | null;
};

/** Map pin inline link for iCal events — same glyph/behavior as task map links on schedule blocks. */
export function ScheduleIcalLocationLink({ location }: Props) {
  const label = location?.trim();
  if (!label) return null;
  const href = icalLocationToMapsUrl(label);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="time-block-link-inline"
      title={label}
      aria-label={`Open location: ${label}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openMapsUrl(href);
      }}
    >
      {MAP_LINK_GLYPH}
    </a>
  );
}
