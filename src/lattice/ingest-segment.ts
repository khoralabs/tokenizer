import type { IGraph } from "./graph";
import type { LatticeSegment } from "./segment";
import type { ITrie } from "./trie";

/** Ingest one segment into trie + graph with unigram emission counts. */
export function ingestSegment(graph: IGraph, trie: ITrie, segment: LatticeSegment): void {
  const markovId = graph.getOrCreateNode(segment.key);
  graph.recordEmission(segment.key);
  for (const element of segment.sequence) {
    graph.getOrCreateNode(element);
    graph.recordEmission(element);
    trie.merge(element, markovId);
  }
  trie.merge(segment.key, markovId);
}

export function ingestSegmentBatch(graph: IGraph, trie: ITrie, segments: LatticeSegment[]): void {
  for (const segment of segments) {
    ingestSegment(graph, trie, segment);
  }
}

export type AsyncGraph = {
  getOrCreateNode(pattern: string): Promise<number>;
  recordEmission(pattern: string, delta?: number): Promise<void>;
};

export type AsyncTrie = {
  merge(pattern: string, markov_id: number): Promise<number>;
};

export async function ingestSegmentAsync(
  graph: AsyncGraph,
  trie: AsyncTrie,
  segment: LatticeSegment,
): Promise<void> {
  const markovId = await graph.getOrCreateNode(segment.key);
  await graph.recordEmission(segment.key);
  for (const element of segment.sequence) {
    await graph.getOrCreateNode(element);
    await graph.recordEmission(element);
    await trie.merge(element, markovId);
  }
  await trie.merge(segment.key, markovId);
}

export async function ingestSegmentBatchAsync(
  graph: AsyncGraph,
  trie: AsyncTrie,
  segments: LatticeSegment[],
): Promise<void> {
  for (const segment of segments) {
    await ingestSegmentAsync(graph, trie, segment);
  }
}
