import type { Database, Statement } from "bun:sqlite";
import type { GraphEdgeInsert, GraphNode, GraphNodeInsert } from "../../graph.model";
import type { BunBind } from "../bind";

// Statement types
export type UpsertNodeStmt = Statement<Pick<GraphNode, "id">, [BunBind<GraphNodeInsert>]>;
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
export type SelectTopTokensReadonlyStmt = Statement<
  { pattern: string; confidence: number },
  [BunBind<{ limit: number }>]
>;
export type ListPatternsStmt = Statement<{ pattern: string }, []>;
export type GetTransitionWeightStmt = Statement<
  { weight: number },
  [BunBind<{ from: string; to: string }>]
>;
export type GetConfidenceStmt = Statement<
  { confidence: number },
  [BunBind<Pick<GraphNode, "pattern">>]
>;
export type RecordEmissionStmt = Statement<void, [BunBind<{ pattern: string; delta: number }>]>;
export type GetTokenCountStmt = Statement<
  { token_count: number },
  [BunBind<Pick<GraphNode, "pattern">>]
>;
export type GetTotalEmissionsStmt = Statement<{ total: number }, []>;
export type GetVocabSizeStmt = Statement<{ count: number }, []>;
export type GetOutgoingTotalStmt = Statement<{ total: number }, [BunBind<{ from: string }>]>;
export type SelectAllTokenCountsStmt = Statement<{ token: string; token_count: number }, []>;
export type SelectAllLmEdgesStmt = Statement<
  { from_token: string; to_token: string; weight: number },
  []
>;

export const createGraphTables = (database: Database, options?: { readonly?: boolean }) => {
  if (!options?.readonly) {
    database.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        hub_score REAL DEFAULT 0,
        token_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS edges (
        from_id INTEGER NOT NULL,
        to_id INTEGER NOT NULL,
        weight REAL DEFAULT 1,
        PRIMARY KEY (from_id, to_id)
      );
    `);

    const columns = database.query("PRAGMA table_info(nodes)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "token_count")) {
      database.run("ALTER TABLE nodes ADD COLUMN token_count INTEGER NOT NULL DEFAULT 0");
    }
    return;
  }

  database.run(`
    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      hub_score REAL DEFAULT 0,
      token_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS edges (
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      weight REAL DEFAULT 1,
      PRIMARY KEY (from_id, to_id)
    );
  `);
};

export function hasTokenCountColumn(database: Database): boolean {
  const columns = database.query("PRAGMA table_info(nodes)").all() as { name: string }[];
  return columns.some((column) => column.name === "token_count");
}

export const createGraphStatements = (database: Database, options?: { tokenCounts?: boolean }) => {
  const upsertNode: UpsertNodeStmt = database.query(`
    INSERT INTO nodes (token)
    VALUES ($pattern)
    ON CONFLICT(token) DO UPDATE SET token = token
    RETURNING id;
  `);

  const insertEdge: InsertEdgeStmt = database.query(`
    INSERT INTO edges (from_id, to_id, weight)
    VALUES ($from_id, $to_id, $weight)
    ON CONFLICT(from_id, to_id)
    DO UPDATE SET weight = weight + excluded.weight;
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

  const selectTopTokensReadonly: SelectTopTokensReadonlyStmt = database.query(`
    SELECT token AS pattern,
      log(1 + COALESCE((SELECT SUM(weight) FROM edges WHERE edges.from_id = nodes.id), 0)) AS confidence
    FROM nodes
    ORDER BY confidence DESC
    LIMIT $limit
  `);

  const listPatterns: ListPatternsStmt = database.query(`
    SELECT token AS pattern FROM nodes ORDER BY token;
  `);

  const getTransitionWeight: GetTransitionWeightStmt = database.query(`
    SELECT e.weight
    FROM edges e
    JOIN nodes nf ON nf.id = e.from_id
    JOIN nodes nt ON nt.id = e.to_id
    WHERE nf.token = $from AND nt.token = $to;
  `);

  const getConfidence: GetConfidenceStmt = database.query(`
    SELECT hub_score AS confidence FROM nodes WHERE token = $pattern;
  `);

  const getOutgoingTotal: GetOutgoingTotalStmt = database.query(`
    SELECT COALESCE(SUM(e.weight), 0) AS total
    FROM edges e
    WHERE e.from_id = (SELECT id FROM nodes WHERE token = $from);
  `);

  const selectAllLmEdges: SelectAllLmEdgesStmt = database.query(`
    SELECT f.token AS from_token, t.token AS to_token, e.weight
    FROM edges e
    JOIN nodes f ON f.id = e.from_id
    JOIN nodes t ON t.id = e.to_id
  `);

  if (options?.tokenCounts === false) {
    return {
      upsertNode,
      insertEdge,
      selectTransitions,
      selectNodeCount,
      selectTopTokens,
      selectTopTokensReadonly,
      listPatterns,
      getTransitionWeight,
      getConfidence,
      getOutgoingTotal,
      selectAllLmEdges,
    };
  }

  const recordEmission: RecordEmissionStmt = database.query(`
    INSERT INTO nodes (token, token_count)
    VALUES ($pattern, $delta)
    ON CONFLICT(token) DO UPDATE SET token_count = token_count + excluded.token_count;
  `);

  const getTokenCount: GetTokenCountStmt = database.query(`
    SELECT token_count FROM nodes WHERE token = $pattern;
  `);

  const getTotalEmissions: GetTotalEmissionsStmt = database.query(`
    SELECT COALESCE(SUM(token_count), 0) AS total FROM nodes;
  `);

  const getVocabSize: GetVocabSizeStmt = database.query(`
    SELECT COUNT(*) AS count FROM nodes;
  `);

  const selectAllTokenCounts: SelectAllTokenCountsStmt = database.query(`
    SELECT token, token_count FROM nodes
  `);

  return {
    upsertNode,
    insertEdge,
    selectTransitions,
    selectNodeCount,
    selectTopTokens,
    selectTopTokensReadonly,
    listPatterns,
    getTransitionWeight,
    getConfidence,
    recordEmission,
    getTokenCount,
    getTotalEmissions,
    getVocabSize,
    getOutgoingTotal,
    selectAllTokenCounts,
    selectAllLmEdges,
  };
};
