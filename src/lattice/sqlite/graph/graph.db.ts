import type { Database, Statement } from "bun:sqlite";
import type { GraphEdgeInsert, GraphNode, GraphNodeInsert } from "../../graph.model";
import type { BunBind } from "../bind";

// Statement types
export type InsertNodeStmt = Statement<void, [BunBind<GraphNodeInsert>]>;
export type SelectNodeIdStmt = Statement<
  Pick<GraphNode, "id">,
  [BunBind<Pick<GraphNode, "pattern">>]
>;
export type InsertEdgeStmt = Statement<void, [BunBind<GraphEdgeInsert>]>;
export type SelectTransitionsStmt = Statement<
  { to: string; weight: number },
  [BunBind<{ from: string }>]
>;
export type SelectNodeCountStmt = Statement<{ count: number }, []>;
export type SelectTopTokensStmt = Statement<
  { pattern: string; confidence: number },
  [BunBind<{ limit: number }>]
>;

export const createGraphTables = (database: Database) =>
  database.run(`
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

export const createGraphStatements = (database: Database) => {
  // Node and edge operations
  const insertNode: InsertNodeStmt = database.query(`
    INSERT INTO nodes (token)
    VALUES ($pattern)
    ON CONFLICT(token) DO NOTHING;
  `);

  const selectNodeId: SelectNodeIdStmt = database.query(
    `SELECT id FROM nodes WHERE token = $pattern;`,
  );

  const insertEdge: InsertEdgeStmt = database.query(`
    INSERT INTO edges (from_id, to_id, weight)
    VALUES ($from_id, $to_id, 1)
    ON CONFLICT(from_id, to_id)
    DO UPDATE SET weight = weight + 1;
  `);

  const selectTransitions: SelectTransitionsStmt = database.query(`
    SELECT n.token AS "to", e.weight
    FROM edges e
    JOIN nodes n ON n.id = e.to_id
    WHERE e.from_id = (SELECT id FROM nodes WHERE token = $from)
  `);

  const selectNodeCount: SelectNodeCountStmt = database.query(`
    SELECT COUNT(*) as count FROM nodes
  `);

  const selectTopTokens: SelectTopTokensStmt = database.query(`
    SELECT token AS pattern, hub_score AS confidence
    FROM nodes
    ORDER BY hub_score DESC
    LIMIT $limit
  `);

  return {
    insertNode,
    selectNodeId,
    insertEdge,
    selectTransitions,
    selectNodeCount,
    selectTopTokens,
  };
};
