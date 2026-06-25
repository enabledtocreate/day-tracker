/** §5.12: CSS hooks for short/narrow schedule blocks (font scale, hide tags, action drawer). */
export function scheduleBlockDensityClasses(heightPx: number, widthPctSlot: number): string {
  const parts: string[] = [];
  if (heightPx < 40) parts.push('time-block-density-micro');
  else if (heightPx < 72) parts.push('time-block-density-tight');
  if (widthPctSlot < 34) parts.push('time-block-density-actions-drawer');
  return parts.length ? ' ' + parts.join(' ') : '';
}
