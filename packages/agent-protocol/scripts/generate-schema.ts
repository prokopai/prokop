// Regenerates schema/agent-protocol.schema.json. Run: bun run schema
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { protocolJsonSchemaText } from '../src/json-schema';

export const schemaPath = join(import.meta.dir, '..', 'schema', 'agent-protocol.schema.json');

if (import.meta.main) {
  mkdirSync(dirname(schemaPath), { recursive: true });
  writeFileSync(schemaPath, protocolJsonSchemaText());
  console.log(`Wrote ${schemaPath}`);
}
