import { expect, test } from 'bun:test';
import type { SessionHarness } from '@prokopai/sdk';
import { createHarnessRegistration, createHarnessRegistrations } from '@prokopai/agent';
import { harnessCapabilities } from '@prokopai/agent/host';
import { agentProcessRegistrations } from '@/bootstrap/agent-ports';
import { createWiredAgentsApplication } from '@/bootstrap/application';

const optional = ['editMessage', 'regenerateTitle', 'compact', 'revert', 'fork', 'drainQueue', 'steerQueue'] as const;

/** The operations a registration offers beyond send, interrupt and activity. */
function shape(registrations: Record<string, { execution: object; headless?: unknown }>) {
  return Object.fromEntries(Object.entries(registrations).map(([harness, registration]) => [harness, {
    operations: optional.filter(operation => typeof (registration.execution as Record<string, unknown>)[operation] === 'function'),
    headless: registration.headless !== undefined,
  }]));
}

const hostOperations = (registrations: Record<string, { hostOperations?: readonly string[] }>) =>
  Object.fromEntries(Object.entries(registrations).map(([harness, registration]) => [harness, registration.hostOperations ?? []]));

test('the host capability table matches the real harness registrations', () => {
  const noTitle = async () => {};
  const deps = { agents: createWiredAgentsApplication(), titles: { 'codex-cli': noTitle, 'claude-cli': noTitle } };
  const real = Object.fromEntries((Object.keys(harnessCapabilities) as SessionHarness[])
    .map(harness => [harness, createHarnessRegistration(harness, deps)]));
  const table = Object.fromEntries(Object.entries(harnessCapabilities).map(([harness, capabilities]) => [harness, {
    operations: optional.filter(operation => (capabilities.operations as readonly string[]).includes(operation)),
    headless: capabilities.headless as boolean,
  }]));
  expect(table).toEqual(shape(real));
  // The agent's lazy registrations and the host's routing registrations have the same shape.
  const lazy = createHarnessRegistrations(deps);
  expect(shape(lazy)).toEqual(shape(real));
  expect(hostOperations(lazy)).toEqual(hostOperations(real));
  expect(shape(agentProcessRegistrations())).toEqual(shape(real));
});
