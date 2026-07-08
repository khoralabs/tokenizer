import type { Database } from "bun:sqlite";
import { buildLmTables, type LmTables } from "../../compiled-lattice";
import type { IGraph } from "../../graph";
import { bind } from "../bind";
import {
  createGraphStatements,
  createGraphTables,
  type GetConfidenceStmt,
  type GetOutgoingTotalStmt,
  type GetTokenCountStmt,
  type GetTotalEmissionsStmt,
  type GetTransitionWeightStmt,
  type GetVocabSizeStmt,
  hasTokenCountColumn,
  type InsertEdgeStmt,
  type ListPatternsStmt,
  type RecordEmissionStmt,
  type SelectAllLmEdgesStmt,
  type SelectAllTokenCountsStmt,
  type SelectTopTokensStmt,
  type SelectTransitionsStmt,
  type UpsertNodeStmt,
} from "./graph.db";
import { DegreeScorer, type ISqliteHubScorer } from "./scorers";

export class Graph implements IGraph {
  private db: Database;
  private scorer: ISqliteHubScorer;
  private nodeIdCache = new Map<string, number>();
  private tokenCountsEnabled: boolean;

  private upsertNode!: UpsertNodeStmt;
  private insertEdge!: InsertEdgeStmt;
  private selectTransitions!: SelectTransitionsStmt;
  private selectTopTokens!: SelectTopTokensStmt;
  private listPatternsStmt!: ListPatternsStmt;
  private getTransitionWeightStmt!: GetTransitionWeightStmt;
  private getConfidenceStmt!: GetConfidenceStmt;
  private recordEmissionStmt?: RecordEmissionStmt;
  private getTokenCountStmt?: GetTokenCountStmt;
  private getTotalEmissionsStmt?: GetTotalEmissionsStmt;
  private getVocabSizeStmt?: GetVocabSizeStmt;
  private getOutgoingTotalStmt!: GetOutgoingTotalStmt;
  private selectAllLmEdges!: SelectAllLmEdgesStmt;
  private selectAllTokenCounts?: SelectAllTokenCountsStmt;

  constructor(database: Database, scorer: ISqliteHubScorer = new DegreeScorer(), readonly = false) {
    this.db = database;
    this.scorer = scorer;
    this.initSchema(readonly);
    this.tokenCountsEnabled = hasTokenCountColumn(this.db);
    this.prepareStatements();
  }

  private initSchema(readonly: boolean) {
    createGraphTables(this.db, { readonly });
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
      recordEmission,
      getTokenCount,
      getTotalEmissions,
      getVocabSize,
      getOutgoingTotal,
      selectAllTokenCounts,
      selectAllLmEdges,
    } = createGraphStatements(this.db, { tokenCounts: this.tokenCountsEnabled });

    this.upsertNode = upsertNode;
    this.insertEdge = insertEdge;
    this.selectTransitions = selectTransitions;
    this.selectTopTokens = selectTopTokens;
    this.listPatternsStmt = listPatterns;
    this.getTransitionWeightStmt = getTransitionWeight;
    this.getConfidenceStmt = getConfidence;
    this.getOutgoingTotalStmt = getOutgoingTotal;
    this.selectAllLmEdges = selectAllLmEdges;
    if (this.tokenCountsEnabled) {
      this.recordEmissionStmt = recordEmission;
      this.getTokenCountStmt = getTokenCount;
      this.getTotalEmissionsStmt = getTotalEmissions;
      this.getVocabSizeStmt = getVocabSize;
      this.selectAllTokenCounts = selectAllTokenCounts;
    }
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

  recordEmission(pattern: string, delta = 1): void {
    if (delta <= 0 || !this.tokenCountsEnabled || !this.recordEmissionStmt) return;
    this.recordEmissionStmt.run(bind({ pattern, delta }));
    this.nodeIdCache.delete(pattern);
  }

  getTokenCount(pattern: string): number {
    if (!this.tokenCountsEnabled || !this.getTokenCountStmt) return 0;
    const row = this.getTokenCountStmt.get(bind({ pattern }));
    return row?.token_count ?? 0;
  }

  getTotalEmissions(): number {
    if (!this.tokenCountsEnabled || !this.getTotalEmissionsStmt) return 0;
    const row = this.getTotalEmissionsStmt.get();
    return row?.total ?? 0;
  }

  getVocabSize(): number {
    if (!this.tokenCountsEnabled || !this.getVocabSizeStmt) return 0;
    const row = this.getVocabSizeStmt.get();
    return row?.count ?? 0;
  }

  getOutgoingTotal(from: string): number {
    const row = this.getOutgoingTotalStmt.get(bind({ from }));
    return row?.total ?? 0;
  }

  buildLmTables(): LmTables {
    const tokenCounts = new Map<string, number>();
    if (this.selectAllTokenCounts) {
      for (const row of this.selectAllTokenCounts.all()) {
        if (row.token_count > 0) tokenCounts.set(row.token, row.token_count);
      }
    }
    const edges = this.selectAllLmEdges.all().map((row) => ({
      from: row.from_token,
      to: row.to_token,
      weight: row.weight,
    }));
    return buildLmTables(tokenCounts, edges);
  }
}
