import { describe, expect, test } from 'bun:test';
import { formatAmount, type Invoice } from '../src/invoice';

const invoice: Invoice = { id: 'inv-1042', amountCents: 129_900, currency: 'EUR', dueAt: 0, paidAt: null };

describe('formatAmount', () => {
  test('formats cents in the invoice currency', () => {
    expect(formatAmount(invoice)).toBe('€1,299.00');
  });
});
