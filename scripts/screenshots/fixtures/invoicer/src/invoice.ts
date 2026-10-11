export interface Invoice {
  id: string;
  amountCents: number;
  currency: string;
  dueAt: number;
  paidAt: number | null;
}

export function formatAmount(invoice: Invoice): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: invoice.currency }).format(invoice.amountCents / 100);
}

export function isOverdue(invoice: Invoice): boolean {
  return invoice.paidAt === null && invoice.dueAt < Date.now();
}
