/**
 * Agent process entry (host/agent split, Phase 2). The host spawns
 * `bun packages/agent/src/main.ts --stdio` and speaks the agent protocol
 * (packages/agent-protocol) over its stdin and stdout. The process exits
 * when the host closes its stdin.
 */
import { runAgentProcessOverStdio } from '#agent/composition/agent-process';
import agentPackage from '../package.json' with { type: 'json' };

if (!process.argv.includes('--stdio')) {
  console.error('usage: bun packages/agent/src/main.ts --stdio');
  process.exit(2);
}

runAgentProcessOverStdio({ version: agentPackage.version });
