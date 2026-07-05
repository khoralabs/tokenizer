import type { Database } from "bun:sqlite";
import type { IGraph } from "../../graph";
import { bind } from "../bind";
import {
  createGraphStatements,
  createGraphTables,
  type GetConfidenceStmt,
  type GetTransitionWeightStmt,
  type InsertEdgeStmt,
  type InsertNodeStmt,
  type ListPatternsStmt,
  type SelectNodeIdStmt,
  type SelectTopTokensStmt,
  type SelectTransitionsStmt,
} from "./graph.db";
import { DegreeScorer, type ISqliteHubScorer } from "./scorers";

export class Graph implements IGraph {
  private db: Database;
  private scorer: ISqliteHubScorer;

  private insertNode!: InsertNodeStmt;
  private selectNodeId!: SelectNodeIdStmt;
  private insertEdge!: InsertEdgeStmt;
  private selectTransitions!: SelectTransitionsStmt;
  private selectTopTokens!: SelectTopTokensStmt;
  private listPatternsStmt!: ListPatternsStmt;
  private getTransitionWeightStmt!: GetTransitionWeightStmt;
  private getConfidenceStmt!: GetConfidenceStmt;

  constructor(database: Database, scorer: ISqliteHubScorer = new DegreeScorer()) {
    this.db = database;
    this.scorer = scorer;
    this.initSchema();
    this.prepareStatements();
  }

  private initSchema() {
    createGraphTables(this.db);
  }

  private prepareStatements() {
    const {
      insertNode,
      selectNodeId,
      insertEdge,
      selectTransitions,
      selectTopTokens,
      listPatterns,
      getTransitionWeight,
      getConfidence,
    } = createGraphStatements(this.db);

    this.insertNode = insertNode;
    this.selectNodeId = selectNodeId;
    this.insertEdge = insertEdge;
    this.selectTransitions = selectTransitions;
    this.selectTopTokens = selectTopTokens;
    this.listPatternsStmt = listPatterns;
    this.getTransitionWeightStmt = getTransitionWeight;
    this.getConfidenceStmt = getConfidence;
  }

  /**
   * Gets or creates a Markov node for a token.
   * @param token - The token string
   * @returns The node id
   */
  getOrCreateNode(pattern: string): number {
    this.insertNode.run(bind({ pattern }));
    const row = this.selectNodeId.get(bind({ pattern }));
    if (!row) throw new Error(`Failed to get/create node for pattern: ${pattern}`);
    return row.id;
  }

  /**
   * Adds a transition between two tokens (creates nodes if needed).
   * @param from - Source token
   * @param to - Destination token
   */
  merge(from: string, to: string, delta = 1): { from_id: number; to_id: number } {
    const from_id = this.getOrCreateNode(from);
    const to_id = this.getOrCreateNode(to);
    if (delta > 0) {
      this.insertEdge.run(bind({ from_id, to_id, weight: delta }));
    }
    return { from_id, to_id };
  }

  /**
   * Bulk transition insertion for large sequences (transactional).
   * @param pairs - Array of [from, to] token pairs
   */
  mergeBatch(pairs: [string, string][]): { from_id: number; to_id: number }[] {
    const insertions: { from_id: number; to_id: number }[] = [];
    const tx = this.db.transaction(() => {
      for (const [from, to] of pairs) insertions.push(this.merge(from, to));
    });
    tx();

    return insertions;
  }

  /**
   * Retrieves all outgoing transitions for a token.
   * @param from - The source token
   * @returns Array of transitions with weights
   */
  getNext(from: string): { to: string; weight: number }[] {
    return this.selectTransitions.all(bind({ from }));
  }

  /**
   * Returns top N tokens by hub score using the configured scoring algorithm.
   * @param limit - Number of tokens to return (default 10)
   * @returns Array of tokens with confidences
   */
  getTopTokens(limit = 10): { pattern: string; confidence: number }[] {
    this.scorer.compute(this.db);
    return this.selectTopTokens.all(bind({ limit }));
  }

  listPatterns(): string[] {
    return this.listPatternsStmt.all().map((row) => row.pattern);
  }

  getTransitionWeight(from: string, to: string): number | null {
    const row = this.getTransitionWeightStmt.get(bind({ from, to }));
    return row?.weight ?? null;
  }

  getConfidence(pattern: string): number {
    const row = this.getConfidenceStmt.get(bind({ pattern }));
    return row?.confidence ?? 0;
  }
}
