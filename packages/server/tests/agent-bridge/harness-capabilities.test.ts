import { expect, test } from 'bun:test';
import { createHarnessRegistrations } from '@prokopai/agent';
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

test('the host capability table matches the real harness registrations', () => {
  const noTitle = async () => {};
  const real = createHarnessRegistrations({
    agents: createWiredAgentsApplication(), titles: { 'codex-cli': noTitle, 'claude-cli': noTitle },
  });
  const table = Object.fromEntries(Object.entries(harnessCapabilities).map(([harness, capabilities]) => [harness, {
    operations: optional.filter(operation => (capabilities.operations as readonly string[]).includes(operation)),
    headless: capabilities.headless as boolean,
  }]));
  expect(table).toEqual(shape(real));
  // The registrations the host routes to an agent process have the same shape.
  expect(shape(agentProcessRegistrations())).toEqual(shape(real));
});
