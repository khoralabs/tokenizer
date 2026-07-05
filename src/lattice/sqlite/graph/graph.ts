import type { Database } from "bun:sqlite";
import type { IGraph } from "../../graph";
import { bind } from "../bind";
import {
  createGraphStatements,
  createGraphTables,
  type GetConfidenceStmt,
  type GetTransitionWeightStmt,
  type InsertEdgeStmt,
  type ListPatternsStmt,
  type SelectTopTokensStmt,
  type SelectTransitionsStmt,
  type UpsertNodeStmt,
} from "./graph.db";
import { DegreeScorer, type ISqliteHubScorer } from "./scorers";

export class Graph implements IGraph {
  private db: Database;
  private scorer: ISqliteHubScorer;
  private nodeIdCache = new Map<string, number>();

  private upsertNode!: UpsertNodeStmt;
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
      upsertNode,
      insertEdge,
      selectTransitions,
      selectTopTokens,
      listPatterns,
      getTransitionWeight,
      getConfidence,
    } = createGraphStatements(this.db);

    this.upsertNode = upsertNode;
    this.insertEdge = insertEdge;
    this.selectTransitions = selectTransitions;
    this.selectTopTokens = selectTopTokens;
    this.listPatternsStmt = listPatterns;
    this.getTransitionWeightStmt = getTransitionWeight;
    this.getConfidenceStmt = getConfidence;
  }

  getOrCreateNode(pattern: string): number {
    const cached = this.nodeIdCache.get(pattern);
    if (cached !== undefined) return cached;

    const row = this.upsertNode.get(bind({ pattern }));
    if (!row) throw new Error(`Failed to get/create node for pattern: ${pattern}`);
    this.nodeIdCache.set(pattern, row.id);
    return row.id;
  }

  merge(from: string, to: string, delta = 1): { from_id: number; to_id: number } {
    const from_id = this.getOrCreateNode(from);
    const to_id = this.getOrCreateNode(to);
    if (delta > 0) {
      this.insertEdge.run(bind({ from_id, to_id, weight: delta }));
    }
    return { from_id, to_id };
  }

  mergeBatch(pairs: [string, string][]): { from_id: number; to_id: number }[] {
    const insertions: { from_id: number; to_id: number }[] = [];
    const tx = this.db.transaction(() => {
      for (const [from, to] of pairs) insertions.push(this.merge(from, to));
    });
    tx();

    return insertions;
  }

  getNext(from: string): { to: string; weight: number }[] {
    return this.selectTransitions.all(bind({ from }));
  }

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
