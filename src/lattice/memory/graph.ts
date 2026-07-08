import { buildLmTables, type LmTables } from "../compiled-lattice";
import type { IGraph } from "../graph";
import { DegreeScorer, type IMemoryHubScorer } from "./scorers";

/** In-memory node shape (not validated by graph.model — that schema is for SQL backends). */
interface Node {
  id: number;
  token: string;
  hubScore: number;
  tokenCount: number;
}

interface Edge {
  from_id: number;
  to_id: number;
  weight: number;
}

/**
 * In-memory implementation of a directed graph for token transitions.
 */
export class Graph implements IGraph {
  private nodes: Map<string, Node> = new Map();
  private nodeIdCounter = 0;
  private edges: Map<string, Edge> = new Map();
  private adjacencyList: Map<number, Map<number, number>> = new Map();
  private scorer: IMemoryHubScorer;

  constructor(scorer: IMemoryHubScorer = new DegreeScorer()) {
    this.scorer = scorer;
  }

  /**
   * Gets or creates a node for a token.
   */
  getOrCreateNode(token: string): number {
    let node = this.nodes.get(token);
    if (!node) {
      node = {
        id: ++this.nodeIdCounter,
        token,
        hubScore: 0,
        tokenCount: 0,
      };
      this.nodes.set(token, node);
      this.adjacencyList.set(node.id, new Map());
    }
    return node.id;
  }

  merge(from: string, to: string, delta = 1): { from_id: number; to_id: number } {
    if (delta <= 0) return { from_id: this.getOrCreateNode(from), to_id: this.getOrCreateNode(to) };

    const from_id = this.getOrCreateNode(from);
    const to_id = this.getOrCreateNode(to);

    const key = `${from_id}:${to_id}`;
    const edge = this.edges.get(key);

    if (edge) {
      edge.weight += delta;
    } else {
      this.edges.set(key, { from_id, to_id, weight: delta });
    }

    const fromAdj = this.adjacencyList.get(from_id);
    if (!fromAdj) throw new Error(`Missing adjacency list for node ${from_id}`);
    fromAdj.set(to_id, (fromAdj.get(to_id) || 0) + delta);

    return { from_id, to_id };
  }

  mergeBatch(pairs: [string, string][]): { from_id: number; to_id: number }[] {
    return pairs.map(([from, to]) => this.merge(from, to));
  }

  getNext(from: string): { to: string; weight: number }[] {
    const node = this.nodes.get(from);
    if (!node) return [];

    const adj = this.adjacencyList.get(node.id);
    if (!adj) return [];

    const results: { to: string; weight: number }[] = [];
    for (const [to_id, weight] of adj.entries()) {
      const toNode = Array.from(this.nodes.values()).find((n) => n.id === to_id);
      if (toNode) {
        results.push({ to: toNode.token, weight });
      }
    }

    return results;
  }

  getTopTokens(limit = 10): { pattern: string; confidence: number }[] {
    this.scorer.compute({
      nodes: this.nodes,
      adjacencyList: this.adjacencyList,
    });

    return Array.from(this.nodes.values())
      .sort((a, b) => b.hubScore - a.hubScore)
      .slice(0, limit)
      .map((node) => ({ pattern: node.token, confidence: node.hubScore }));
  }

  listPatterns(): string[] {
    return Array.from(this.nodes.keys());
  }

  getTransitionWeight(from: string, to: string): number | null {
    const fromNode = this.nodes.get(from);
    const toNode = this.nodes.get(to);
    if (!fromNode || !toNode) return null;

    const weight = this.adjacencyList.get(fromNode.id)?.get(toNode.id);
    return weight ?? null;
  }

  getConfidence(pattern: string): number {
    return this.nodes.get(pattern)?.hubScore ?? 0;
  }

  recordEmission(pattern: string, delta = 1): void {
    if (delta <= 0) return;
    this.getOrCreateNode(pattern);
    const node = this.nodes.get(pattern);
    if (node) node.tokenCount += delta;
  }

  getTokenCount(pattern: string): number {
    return this.nodes.get(pattern)?.tokenCount ?? 0;
  }

  getTotalEmissions(): number {
    let total = 0;
    for (const node of this.nodes.values()) total += node.tokenCount;
    return total;
  }

  getVocabSize(): number {
    return this.nodes.size;
  }

  getOutgoingTotal(from: string): number {
    const fromNode = this.nodes.get(from);
    if (!fromNode) return 0;
    const adj = this.adjacencyList.get(fromNode.id);
    if (!adj) return 0;
    let total = 0;
    for (const weight of adj.values()) total += weight;
    return total;
  }

  buildLmTables(): LmTables {
    const tokenCounts = new Map<string, number>();
    for (const node of this.nodes.values()) {
      if (node.tokenCount > 0) tokenCounts.set(node.token, node.tokenCount);
    }
    const idToToken = new Map<number, string>();
    for (const node of this.nodes.values()) idToToken.set(node.id, node.token);
    const edges = [];
    for (const { from_id, to_id, weight } of this.edges.values()) {
      const from = idToToken.get(from_id);
      const to = idToToken.get(to_id);
      if (from && to) edges.push({ from, to, weight });
    }
    return buildLmTables(tokenCounts, edges);
  }
}
