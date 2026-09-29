import type { Database } from "bun:sqlite";
import type { Atom, TerminalEntry } from "../../atom";
import { assertNonEmptyAtoms, atomsFromText } from "../../atom";
import type { ITrie, MatchCandidate } from "../../trie";
import { bind } from "../bind";
import {
  createTrieStatements,
  createTrieTable,
  type ListTerminalPatternsStmt,
  type ListTerminalRowsStmt,
  parentKey,
  type SelectTrieChildrenStmt,
  type SelectTrieNodeByIdStmt,
  type SelectTrieNodeStmt,
  type UpsertTrieNodeStmt,
} from "./trie.db";

export class Trie implements ITrie {
  private db: Database;

  private upsertTrieNode!: UpsertTrieNodeStmt;
  private selectTrieNode!: SelectTrieNodeStmt;
  private selectTrieChildren!: SelectTrieChildrenStmt;
  private listTerminalPatternsStmt!: ListTerminalPatternsStmt;
  private listTerminalRowsStmt!: ListTerminalRowsStmt;
  private selectTrieNodeById!: SelectTrieNodeByIdStmt;

  constructor(database: Database) {
    this.db = database;
    this.initSchema();
    this.prepareStatements();
  }

  private initSchema() {
    createTrieTable(this.db);
  }

  private prepareStatements() {
    const stmts = createTrieStatements(this.db);
    this.upsertTrieNode = stmts.upsertTrieNode;
    this.selectTrieNode = stmts.selectTrieNode;
    this.selectTrieChildren = stmts.selectTrieChildren;
    this.listTerminalPatternsStmt = stmts.listTerminalPatterns;
    this.listTerminalRowsStmt = stmts.listTerminalRows;
    this.selectTrieNodeById = stmts.selectTrieNodeById;
  }

  merge(atoms: readonly Atom[], pattern: string, markov_id: number): number {
    assertNonEmptyAtoms(atoms);
    if (pattern.length === 0) throw new Error("Cannot merge empty pattern");

    let parent_id: number | null = null;

    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i];
      if (atom === undefined) throw new Error("out of range");
      const isTerminal = i === atoms.length - 1;

      const row = this.upsertTrieNode.get(
        bind({
          parent_id,
          parent_key: parentKey(parent_id),
          char: atom,
          terminal: isTerminal ? 1 : 0,
          pattern: isTerminal ? pattern : null,
          markov_id: isTerminal ? markov_id : null,
        }),
      );
      if (!row) throw new Error(`Failed to insert trie node for atom: ${atom}`);
      parent_id = row.id;
    }

    if (parent_id === null) throw new Error("Failed to merge pattern");
    return parent_id;
  }

  nextAtoms(prefix: readonly Atom[]): Atom[] {
    let parent_id: number | null = null;

    for (const atom of prefix) {
      const row = this.selectTrieNode.get(bind({ parent_key: parentKey(parent_id), char: atom }));
      if (!row) return [];
      parent_id = row.id;
    }

    return this.selectTrieChildren
      .all(bind({ parent_key: parentKey(parent_id) }))
      .map((r) => r.char);
  }

  nextCharacters(prefix: string): string[] {
    return this.nextAtoms(atomsFromText(prefix));
  }

  matchCandidates(source: readonly Atom[], offset = 0): MatchCandidate[] {
    const matches: MatchCandidate[] = [];
    let parent_id: number | null = null;
    let length = 0;

    for (let i = offset; i < source.length; i++) {
      const atom = source[i];
      if (atom === undefined) break;

      const row = this.selectTrieNode.get(bind({ parent_key: parentKey(parent_id), char: atom }));
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

  listTerminalEntries(): TerminalEntry[] {
    const rows = this.listTerminalRowsStmt.all();
    const byPattern = new Map<string, Atom[]>();
    for (const row of rows) {
      if (byPattern.has(row.pattern)) continue;
      byPattern.set(row.pattern, this.atomsToRoot(row.id));
    }
    return [...byPattern.entries()].map(([pattern, atoms]) => ({ pattern, atoms }));
  }

  private atomsToRoot(nodeId: number): Atom[] {
    const atoms: Atom[] = [];
    let id: number | null = nodeId;
    while (id !== null) {
      const row = this.selectTrieNodeById.get(bind({ id }));
      if (!row) break;
      atoms.unshift(row.char);
      id = row.parent_id;
    }
    return atoms;
  }
}
