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

export type SelectNodeIdArgs = Pick<GraphNode, "pattern">;
export type SelectTopTokensArgs = { limit: number };

export const createGraphStatements = async (database: TursoDatabase) => {
  const insertNode = await database.prepare(`
    INSERT INTO nodes (token)
    VALUES (?)
    ON CONFLICT(token) DO NOTHING;
  `);

  const selectNodeId = await database.prepare(`SELECT id FROM nodes WHERE token = ?;`);

  const insertEdge = await database.prepare(`
    INSERT INTO edges (from_id, to_id, weight)
    VALUES (?, ?, 1)
    ON CONFLICT(from_id, to_id)
    DO UPDATE SET weight = weight + 1;
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

  return {
    insertNode,
    selectNodeId,
    insertEdge,
    selectTransitions,
    selectTopTokens,
  };
};

export type { GraphEdgeInsert, GraphNodeInsert };

export function bindInsertNode(row: GraphNodeInsert): [GraphNodeInsert["pattern"]] {
  return [row.pattern];
}

export function bindInsertEdge(
  row: GraphEdgeInsert,
): [GraphEdgeInsert["from_id"], GraphEdgeInsert["to_id"]] {
  return [row.from_id, row.to_id];
}

export function bindSelectNodeId(args: SelectNodeIdArgs): [SelectNodeIdArgs["pattern"]] {
  return [args.pattern];
}

export function bindSelectTransitions(from: string): [string] {
  return [from];
}

export function bindSelectTopTokens(args: SelectTopTokensArgs): [SelectTopTokensArgs["limit"]] {
  return [args.limit];
}
