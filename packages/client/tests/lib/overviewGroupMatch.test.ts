import { expect, test } from 'vitest';
import type { Agent, Workspace } from '@prokopai/sdk';
import { findOverviewGroup, overviewGroupName, sameWorkspaceSet, uniqueOverviewGroupName } from '@/lib/overviewGroupMatch';

const groups = [
  { id: 'g1', serverId: 's', name: 'jean2 + db-web', workspaceIds: ['jean2', 'db-web'] },
  { id: 'g2', serverId: 's', name: 'all', workspaceIds: ['jean2', 'db-web', 'site'] },
  { id: 'g3', serverId: 'other', name: 'jean2 + db-web', workspaceIds: ['db-web', 'jean2'] },
];

test('a group matches on the same workspaces in any order, on the same server only', () => {
  expect(sameWorkspaceSet(['a', 'b'], ['b', 'a'])).toBe(true);
  expect(sameWorkspaceSet(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
  expect(findOverviewGroup(groups, 's', ['db-web', 'jean2'])?.id).toBe('g1');
  expect(findOverviewGroup(groups, 's', ['site', 'jean2', 'db-web'])?.id).toBe('g2');
  expect(findOverviewGroup(groups, 's', ['jean2'])).toBeNull();
  expect(findOverviewGroup(groups, 'third', ['jean2', 'db-web'])).toBeNull();
});

test('the name joins the display names in order, stays within the limit, and steps past taken names', () => {
  const workspaces = [{ id: 'jean2', name: 'jean2', path: '/j' }, { id: 'db-web', name: 'db-web', path: '/d' }] as Workspace[];
  expect(overviewGroupName(['jean2', 'db-web'], workspaces, [] as Agent[])).toBe('jean2 + db-web');
  expect(overviewGroupName(['db-web', 'ghost'], workspaces, [] as Agent[])).toBe('db-web + ghost');
  const long = [{ id: 'a', name: 'a'.repeat(40), path: '/a' }, { id: 'b', name: 'b'.repeat(40), path: '/b' }] as Workspace[];
  expect(overviewGroupName(['a', 'b'], long, [] as Agent[])).toHaveLength(47);
  expect(uniqueOverviewGroupName('jean2 + db-web', ['other'])).toBe('jean2 + db-web');
  expect(uniqueOverviewGroupName('jean2 + db-web', ['JEAN2 + DB-WEB', 'jean2 + db-web 2'])).toBe('jean2 + db-web 3');
});
