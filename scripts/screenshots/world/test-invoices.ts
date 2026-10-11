/**
 * The same agent in another project: it looks up how this user wants time
 * handled in tests, finds the linkshelf conversation, and applies it.
 */
import type { Story } from './types';

/** Visible once the final reply rendered. */
export const TEST_INVOICES_READY = 'never once paid';

const IS_OVERDUE = 'export function isOverdue(invoice: Invoice): boolean {\n  return invoice.paidAt === null && invoice.dueAt < Date.now();';

const OVERDUE_TESTS = `

describe('isOverdue', () => {
  const now = Date.UTC(2026, 9, 15);
  const day = 24 * 60 * 60 * 1000;

  test('is overdue once the due date passes unpaid', () => {
    expect(isOverdue({ ...invoice, dueAt: now - day }, now)).toBe(true);
  });

  test('is not overdue before the due date', () => {
    expect(isOverdue({ ...invoice, dueAt: now + day }, now)).toBe(false);
  });

  test('is never overdue once paid', () => {
    expect(isOverdue({ ...invoice, dueAt: now - day, paidAt: now - 2 * day }, now)).toBe(false);
  });
});`;

export const testInvoices: Story = {
  title: 'Test overdue invoices',
  prompt: 'Add tests for overdue invoices.',
  project: 'invoicer',
  steps: [
    {
      type: 'tool-call',
      reasoning: 'isOverdue depends on the current time. My notes say this user does not want Date mocked in tests; check where that came from before picking an approach.',
      text: 'Checking how you like time handled in tests.',
      toolName: 'session_search',
      args: { action: 'search', query: 'mock Date', scope: 'agent' },
      usage: { inputTokens: 11_940, outputTokens: 81 },
    },
    {
      type: 'tool-call',
      text: 'In linkshelf you asked me to pass `now` in instead of mocking `Date`, and it is in my notes. Doing the same here.',
      toolName: 'read-file',
      args: { path: 'src/invoice.ts' },
      usage: { inputTokens: 12_480, outputTokens: 47 },
    },
    {
      type: 'tool-call',
      text: '`isOverdue` reads `Date.now()` directly. Giving it a `now` parameter.',
      toolName: 'edit',
      args: {
        path: 'src/invoice.ts',
        revision: null,
        edits: [{
          oldString: IS_OVERDUE,
          newString: 'export function isOverdue(invoice: Invoice, now = Date.now()): boolean {\n  return invoice.paidAt === null && invoice.dueAt < now;',
        }],
      },
      usage: { inputTokens: 13_020, outputTokens: 118 },
    },
    {
      type: 'tool-call',
      text: 'Adding tests with fixed times.',
      toolName: 'edit',
      args: {
        path: 'test/invoice.test.ts',
        revision: null,
        edits: [
          { oldString: 'import { formatAmount, type Invoice }', newString: 'import { formatAmount, isOverdue, type Invoice }' },
          { oldString: "    expect(formatAmount(invoice)).toBe('€1,299.00');\n  });\n});", newString: `    expect(formatAmount(invoice)).toBe('€1,299.00');\n  });\n});${OVERDUE_TESTS}` },
        ],
      },
      usage: { inputTokens: 13_640, outputTokens: 296 },
    },
    {
      type: 'tool-call',
      text: 'Running the suite.',
      toolName: 'shell',
      // Bun reports results on stderr, which the transcript styles as an error.
      args: { command: 'bun test 2>&1' },
      usage: { inputTokens: 14_180, outputTokens: 33 },
    },
    {
      type: 'text',
      content: [
        `\`isOverdue\` now takes an optional \`now\`, like in linkshelf, so the new tests pass fixed times instead of mocking \`Date\`: overdue after the due date, not before it, and ${TEST_INVOICES_READY}.`,
        '',
        '`bun test`: 4 pass, 0 fail.',
      ].join('\n'),
      usage: { inputTokens: 14_560, outputTokens: 71 },
    },
  ],
};
