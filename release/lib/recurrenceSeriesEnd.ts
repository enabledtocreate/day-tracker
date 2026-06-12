/** Last calendar day the series should still generate occurrences (inclusive). */
export function lastRecurringSeriesDayBefore(fromDate: string): string {
  const d = new Date(fromDate + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function mergeRecurrenceRuleEndDate(
  recurrenceRule: string | null | undefined,
  endDateInclusive: string
): string {
  let rule: Record<string, unknown> = {};
  if (recurrenceRule) {
    try {
      const parsed = JSON.parse(recurrenceRule);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rule = parsed as Record<string, unknown>;
      }
    } catch {
      rule = {};
    }
  }
  rule.endDate = endDateInclusive;
  return JSON.stringify(rule);
}
