import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AgentGroupMember } from '@prokopai/sdk';
import { GroupMemberChips, orderMembersByAttention, visibleChipCount, type GroupMemberChipEntry } from '@/components/groups/GroupMemberChips';
import type { GroupMemberStatus } from '@/hooks/useGroupMemberStatuses';

afterEach(cleanup);

const NAMES = ['Implementer', 'Reviewer', 'Idea Architect', 'Researcher', 'Tester', 'Writer', 'Designer', 'Ops', 'Security', 'Planner'];
const members: AgentGroupMember[] = NAMES.map((name, index) => ({ agentId: `a${index}`, name, sessionId: `s${index}`, cursorSeq: 0, joinedAt: 't' }));

function entries(statuses: GroupMemberStatus[], onStop = vi.fn()): GroupMemberChipEntry[] {
  return members.slice(0, statuses.length).map((member, index) => ({ member, status: statuses[index]!, isDefault: index === 0, onStop, onOpenSession: vi.fn() }));
}

// happy-dom lays nothing out: every chip measures 80px and the row 300px, the overflow chip 50px.
const widths = { chip: 80, overflow: 50, row: 300 };
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.measure === 'chip') return widths.chip;
    if (this.dataset.measure === 'overflow') return widths.overflow;
    return 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => widths.row);
});
afterEach(() => vi.restoreAllMocks());

test('the count that fits leaves room for the overflow chip; unmeasured rows show everything', () => {
  expect(visibleChipCount([80, 80, 80, 80], 50, 300)).toBe(2);
  expect(visibleChipCount([80, 80, 80], 50, 300)).toBe(3);
  expect(visibleChipCount([200, 200], 50, 300)).toBe(1);
  expect(visibleChipCount([400, 80], 50, 300)).toBe(0);
  expect(visibleChipCount([0, 0, 0], 0, 0)).toBe(3);
  expect(orderMembersByAttention([{ status: 'idle', n: 1 }, { status: 'needs-you', n: 2 }, { status: 'working', n: 3 }, { status: 'idle', n: 4 }]).map((e) => e.n)).toEqual([2, 3, 1, 4]);
});

test('ten members in a narrow row: the ones that need you and work come first, the rest fold behind +N with their actions', async () => {
  const onStop = vi.fn();
  render(<GroupMemberChips entries={entries(['idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'needs-you', 'working', 'idle'], onStop)} />);
  const chips = screen.getAllByRole('button');
  expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual(['Ops: needs you', 'Security: working', '8 more members']);

  await act(async () => {
    fireEvent.pointerDown(screen.getByRole('button', { name: '8 more members' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
  const folded = await screen.findAllByRole('menuitem');
  expect(folded.map((item) => item.getAttribute('aria-label'))[0]).toBe('Implementer: idle');
  expect(folded).toHaveLength(8);
});

test('a wider row shows every member and no overflow chip', () => {
  widths.row = 2000;
  render(<GroupMemberChips entries={entries(['idle', 'working', 'idle'])} />);
  expect(screen.getAllByRole('button').map((chip) => chip.getAttribute('aria-label'))).toEqual(['Reviewer: working', 'Implementer: idle, default member', 'Idea Architect: idle']);
  expect(screen.queryByRole('button', { name: /more members/ })).toBeNull();
  widths.row = 300;
});
