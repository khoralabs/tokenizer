import Type, { type Static } from "typebox";

/** TypeBox schemas for persisted trie rows (SQLite / Turso). Not used by in-memory backends. */

const positiveInteger = Type.Integer({ exclusiveMinimum: 0 });
const nullablePositiveInteger = Type.Union([positiveInteger, Type.Null()]);
const nullableString = Type.Union([Type.String(), Type.Null()]);

export const TrieNodeSchema = Type.Object({
  id: positiveInteger,
  parent_id: nullablePositiveInteger,
  parent_key: Type.Integer(),
  char: Type.String({ minLength: 1, maxLength: 1 }),
  pattern: nullableString,
  terminal: Type.Integer({ minimum: 0, maximum: 1 }),
  markov_id: nullablePositiveInteger,
});

export const TrieNodeInsertSchema = Type.Object({
  parent_id: nullablePositiveInteger,
  parent_key: Type.Integer(),
  char: Type.String({ minLength: 1, maxLength: 1 }),
  terminal: Type.Integer({ minimum: 0, maximum: 1 }),
  pattern: Type.Optional(nullableString),
  markov_id: Type.Optional(nullablePositiveInteger),
});

export const TrieNodeUpdateSchema = Type.Intersect([
  Type.Pick(TrieNodeSchema, ["id", "pattern", "markov_id"]),
  Type.Object({ terminal: Type.Literal(1) }),
]);

export type TrieNode = Static<typeof TrieNodeSchema>;
export type TrieNodeInsert = Static<typeof TrieNodeInsertSchema>;
export type TrieNodeUpdate = Static<typeof TrieNodeUpdateSchema>;
