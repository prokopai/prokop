import { z } from 'zod';
import { PROTOCOL_VERSION, protocol } from './index';
import { protocolRegistry, type NotificationSpec, type RequestSpec } from './registry';

const ref = (schema: z.ZodType): { $ref: string } => {
  const id = protocolRegistry.get(schema)?.id;
  if (!id) throw new Error('Protocol schema is not registered');
  return { $ref: `#/$defs/${id}` };
};

function requestTable(specs: Record<string, RequestSpec>) {
  return Object.fromEntries(Object.entries(specs).map(([method, spec]) => [method, {
    description: spec.description, params: ref(spec.params), result: ref(spec.result),
  }]));
}

function notificationTable(specs: Record<string, NotificationSpec>) {
  return Object.fromEntries(Object.entries(specs).map(([method, spec]) => [method, {
    description: spec.description, params: ref(spec.params),
  }]));
}

/**
 * One JSON Schema document for the whole protocol: a method table plus every
 * named schema under `$defs`. Params use the sender's view (`io: 'input'`), so
 * fields with defaults are optional. The Go host generates structs from it.
 */
export function buildProtocolJsonSchema(): Record<string, unknown> {
  const { schemas } = z.toJSONSchema(protocolRegistry, {
    target: 'draft-2020-12',
    io: 'input',
    uri: id => `#/$defs/${id}`,
  });
  const defs = Object.fromEntries(Object.keys(schemas).sort().map((id) => {
    const { $schema: _schema, $id: _id, ...schema } = schemas[id] as Record<string, unknown>;
    return [id, schema];
  }));
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Prokop agent protocol',
    protocolVersion: PROTOCOL_VERSION,
    methods: {
      hostToAgent: {
        requests: requestTable(protocol.hostToAgent.requests),
        notifications: notificationTable(protocol.hostToAgent.notifications),
      },
      agentToHost: {
        requests: requestTable(protocol.agentToHost.requests),
        notifications: notificationTable(protocol.agentToHost.notifications),
      },
    },
    $defs: defs,
  };
}

export const protocolJsonSchemaText = (): string => `${JSON.stringify(buildProtocolJsonSchema(), null, 2)}\n`;
