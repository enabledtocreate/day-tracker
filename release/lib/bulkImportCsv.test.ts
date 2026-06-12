import { describe, expect, it } from 'vitest';
import { escapeBulkImportCell, parseBulkImportFile } from '@/lib/bulkImportCsv';

describe('bulkImportCsv', () => {
  it('escapeBulkImportCell doubles quotes and wraps when needed', () => {
    expect(escapeBulkImportCell('plain', 'tab')).toBe('plain');
    expect(escapeBulkImportCell('has,comma', 'comma')).toBe('"has,comma"');
    expect(escapeBulkImportCell('say "hi"', 'tab')).toBe('"say ""hi"""');
    expect(escapeBulkImportCell('a\tb', 'tab')).toBe('"a\tb"');
  });

  it('parseBulkImportFile reads tab-delimited task rows', () => {
    const tsv = 'Task\tCategory\nBuy milk\tHome\n';
    const { rows, parseError } = parseBulkImportFile(tsv, 'tab');
    expect(parseError).toBeUndefined();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.task).toBe('Buy milk');
    expect(rows[0]?.category).toBe('Home');
  });
});
