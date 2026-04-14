import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Minimal structural check (no AJV): envelope matches contracts/ai/assistant-response.schema.json intent. */
function assertAssistantShape(obj: unknown): void {
  expect(obj).toBeTypeOf('object');
  const o = obj as Record<string, unknown>;
  expect(o.schemaVersion).toBe(1);
  expect(['plan', 'need_context', 'mixed']).toContain(o.kind);
  expect(o.advice).toBeTypeOf('object');
  expect((o.advice as { summary?: string }).summary).toBeTypeOf('string');
  expect(Array.isArray(o.dataRequests)).toBe(true);
  expect(Array.isArray(o.proposals)).toBe(true);
}

describe('assistant response contract smoke', () => {
  it('schema file is valid JSON', () => {
    const raw = readFileSync(join(__dirname, '../contracts/ai/assistant-response.schema.json'), 'utf8');
    const schema = JSON.parse(raw);
    expect(schema.title).toBeDefined();
    expect(schema.properties?.schemaVersion).toBeDefined();
  });

  it('fixture-shaped object passes structural check', () => {
    assertAssistantShape({
      schemaVersion: 1,
      kind: 'plan',
      advice: { summary: 'x', bullets: [] },
      dataRequests: [],
      proposals: [],
      proposedOrgCreates: [],
      clientHints: { includeIcalEvents: false, icalRangeDays: 7 },
    });
  });
});
