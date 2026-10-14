/**
 * Agent process entry (host/agent split, Phase 2). The host spawns
 * `bun packages/agent/src/main.ts --stdio` and speaks the agent protocol
 * (packages/agent-protocol) over its stdin and stdout. The process exits
 * when the host closes its stdin.
 */
import { runAgentProcessOverStdio } from '../../server/src/agent';
import serverPackage from '../../server/package.json' with { type: 'json' };

if (!process.argv.includes('--stdio')) {
  console.error('usage: bun packages/agent/src/main.ts --stdio');
  process.exit(2);
}

runAgentProcessOverStdio({ version: serverPackage.version });
