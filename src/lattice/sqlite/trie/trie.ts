import type { Database } from "bun:sqlite";
import type { ITrie, MatchCandidate } from "../../trie";
import { bind } from "../bind";
import {
  createTrieStatements,
  createTrieTable,
  type ListTerminalPatternsStmt,
  parentKey,
  type SelectTrieChildrenStmt,
  type SelectTrieNodeStmt,
  type UpsertTrieNodeStmt,
} from "./trie.db";

export class Trie implements ITrie {
  private db: Database;

  private upsertTrieNode!: UpsertTrieNodeStmt;
  private selectTrieNode!: SelectTrieNodeStmt;
  private selectTrieChildren!: SelectTrieChildrenStmt;
  private listTerminalPatternsStmt!: ListTerminalPatternsStmt;

  constructor(database: Database) {
    this.db = database;
    this.initSchema();
    this.prepareStatements();
  }

  private initSchema() {
    createTrieTable(this.db);
  }

  private prepareStatements() {
    const { upsertTrieNode, selectTrieNode, selectTrieChildren, listTerminalPatterns } =
      createTrieStatements(this.db);

    this.upsertTrieNode = upsertTrieNode;
    this.selectTrieNode = selectTrieNode;
    this.selectTrieChildren = selectTrieChildren;
    this.listTerminalPatternsStmt = listTerminalPatterns;
  }

  merge(pattern: string, markov_id: number): number {
    if (pattern.length === 0) throw new Error("Cannot merge empty pattern");

    let parent_id: number | null = null;

    for (let i = 0; i < pattern.length; i++) {
      const char =
        pattern[i] ??
        (() => {
          throw new Error("out of range");
        })();
      const isTerminal = i === pattern.length - 1;

      const row = this.upsertTrieNode.get(
        bind({
          parent_id,
          parent_key: parentKey(parent_id),
          char,
          terminal: isTerminal ? 1 : 0,
          pattern: isTerminal ? pattern : null,
          markov_id: isTerminal ? markov_id : null,
        }),
      );
      if (!row) throw new Error(`Failed to insert trie node for char: ${char}`);
      parent_id = row.id;
    }

    if (parent_id === null) throw new Error("Failed to merge pattern");
    return parent_id;
  }

  nextCharacters(prefix: string): string[] {
    let parent_id: number | null = null;

    for (const char of prefix) {
      const row = this.selectTrieNode.get(bind({ parent_key: parentKey(parent_id), char }));
      if (!row) return [];
      parent_id = row.id;
    }

    return this.selectTrieChildren
      .all(bind({ parent_key: parentKey(parent_id) }))
      .map((r) => r.char);
  }

  matchCandidates(text: string, offset = 0): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    let parent_id: number | null = null;
    let length = 0;

    for (let i = offset; i < text.length; i++) {
      const char = text[i];
      if (char === undefined) break;

      const row = this.selectTrieNode.get(bind({ parent_key: parentKey(parent_id), char }));
      if (!row) break;

      parent_id = row.id;
      length++;

      if (row.terminal === 1 && row.pattern !== null) {
        matches.push({ pattern: row.pattern, length });
      }
    }

    return matches;
  }

  listTerminalPatterns(): string[] {
    return this.listTerminalPatternsStmt.all().map((row) => row.pattern);
  }
}
