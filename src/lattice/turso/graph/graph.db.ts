import type { GraphEdgeInsert, GraphNode, GraphNodeInsert } from "../../graph.model";
import type { TursoDatabase } from "../db";

export const createGraphTables = async (database: TursoDatabase) => {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      hub_score REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS edges (
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      weight REAL DEFAULT 1,
      PRIMARY KEY (from_id, to_id)
    );
  `);
};

export type GraphStatements = Awaited<ReturnType<typeof createGraphStatements>>;

export type SelectTopTokensArgs = { limit: number };

export const createGraphStatements = async (database: TursoDatabase) => {
  const upsertNode = await database.prepare(`
    INSERT INTO nodes (token)
    VALUES (?)
    ON CONFLICT(token) DO UPDATE SET token = token
    RETURNING id;
  `);

  const insertEdge = await database.prepare(`
    INSERT INTO edges (from_id, to_id, weight)
    VALUES (?, ?, ?)
    ON CONFLICT(from_id, to_id)
    DO UPDATE SET weight = weight + excluded.weight;
  `);

  const selectTransitions = await database.prepare(`
    SELECT n.token AS "to", e.weight
    FROM edges e
    JOIN nodes n ON n.id = e.to_id
    WHERE e.from_id = (SELECT id FROM nodes WHERE token = ?)
  `);

  const selectTopTokens = await database.prepare(`
    SELECT token AS pattern, hub_score AS confidence
    FROM nodes
    ORDER BY hub_score DESC
    LIMIT ?
  `);

  const listPatterns = await database.prepare(`
    SELECT token AS pattern FROM nodes ORDER BY token;
  `);

  const getTransitionWeight = await database.prepare(`
    SELECT e.weight
    FROM edges e
    JOIN nodes nf ON nf.id = e.from_id
    JOIN nodes nt ON nt.id = e.to_id
    WHERE nf.token = ? AND nt.token = ?;
  `);

  const getConfidence = await database.prepare(`
    SELECT hub_score AS confidence FROM nodes WHERE token = ?;
  `);

  return {
    upsertNode,
    insertEdge,
    selectTransitions,
    selectTopTokens,
    listPatterns,
    getTransitionWeight,
    getConfidence,
  };
};

export type { GraphEdgeInsert, GraphNodeInsert };

export function bindUpsertNode(row: GraphNodeInsert): [GraphNodeInsert["pattern"]] {
  return [row.pattern];
}

export function bindInsertEdge(
  row: GraphEdgeInsert,
): [GraphEdgeInsert["from_id"], GraphEdgeInsert["to_id"], number] {
  return [row.from_id, row.to_id, row.weight ?? 1];
}

export function bindSelectTransitions(from: string): [string] {
  return [from];
}

export function bindSelectTopTokens(args: SelectTopTokensArgs): [SelectTopTokensArgs["limit"]] {
  return [args.limit];
}

export function bindGetTransitionWeight(from: string, to: string): [string, string] {
  return [from, to];
}

export function bindGetConfidence(pattern: string): [string] {
  return [pattern];
}

export type UpsertNodeRow = Pick<GraphNode, "id">;
