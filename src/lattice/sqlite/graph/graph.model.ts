import Type, { type Static } from "typebox";

const positiveInteger = Type.Integer({ exclusiveMinimum: 0 });
const positiveNumber = Type.Number({ exclusiveMinimum: 0 });

export const GraphNodeSchema = Type.Object({
  id: positiveInteger,
  pattern: Type.String(),
  confidence: Type.Number(),
});

export const GraphEdgeSchema = Type.Object({
  from_id: positiveInteger,
  to_id: positiveInteger,
  weight: positiveNumber,
});

export const GraphNodeInsertSchema = Type.Pick(GraphNodeSchema, ["pattern"]);

export const GraphEdgeInsertSchema = Type.Object({
  from_id: positiveInteger,
  to_id: positiveInteger,
  weight: Type.Optional(positiveNumber),
});

export type GraphNode = Static<typeof GraphNodeSchema>;
export type GraphEdge = Static<typeof GraphEdgeSchema>;
export type GraphNodeInsert = Static<typeof GraphNodeInsertSchema>;
export type GraphEdgeInsert = Static<typeof GraphEdgeInsertSchema>;
