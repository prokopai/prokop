import { z } from 'zod';

/**
 * Every named schema in the protocol. Kept private (not `z.globalRegistry`) so
 * ids never collide with schemas other packages register, and so JSON Schema
 * generation sees exactly the protocol.
 */
export const protocolRegistry = z.registry<{ id: string; description?: string }>();

/** Registers a schema under a stable id; the id becomes its `$defs` key. */
export function named<T extends z.ZodType>(id: string, schema: T, description?: string): T {
  protocolRegistry.add(schema as z.ZodType, description ? { id, description } : { id });
  return schema;
}

/**
 * A host-persisted SDK entity (session, message, part, ...). The schema pins
 * only the keys the host reads to route, store and upsert; all other fields
 * pass through untouched (`additionalProperties: true`). The type parameter
 * restores the full SDK type for TypeScript callers; it is not checked
 * against the shape.
 */
export function entity<T>(id: string, shape: z.ZodRawShape, description: string): z.ZodType<T> {
  return named(id, z.looseObject(shape), description) as unknown as z.ZodType<T>;
}

export interface RequestSpec<P extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType> {
  description: string;
  params: P;
  result: R;
}

export interface NotificationSpec<P extends z.ZodType = z.ZodType> {
  description: string;
  params: P;
}

/**
 * Names each method's params and result `<method>.params` / `<method>.result`.
 * A schema that already has a name (shared ones such as `Ack`) keeps it;
 * registering it again would rename it for every other method.
 */
function nameOnce(id: string, schema: z.ZodType, description?: string): void {
  if (!protocolRegistry.has(schema)) named(id, schema, description);
}

export function requests<T extends Record<string, RequestSpec>>(specs: T): T {
  for (const [method, spec] of Object.entries(specs)) {
    nameOnce(`${method}.params`, spec.params, spec.description);
    nameOnce(`${method}.result`, spec.result);
  }
  return specs;
}

export function notifications<T extends Record<string, NotificationSpec>>(specs: T): T {
  for (const [method, spec] of Object.entries(specs)) {
    nameOnce(`${method}.params`, spec.params, spec.description);
  }
  return specs;
}

/** Shared result for operations whose only answer is "done". */
export const Ack = named('Ack', z.object({}).strict());
