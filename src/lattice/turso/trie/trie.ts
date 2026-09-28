import type { Atom, TerminalEntry } from "../../atom";
import { assertNonEmptyAtoms, atomsFromText } from "../../atom";
import type { MatchCandidate } from "../../trie";
import type { TrieNodeInsert } from "../../trie.model";
import type { TursoDatabase } from "../db";
import {
  bindSelectTrieChildren,
  bindSelectTrieNode,
  bindUpsertTrieNode,
  createTrieStatements,
  createTrieTable,
  parentKey,
  type TrieStatements,
  type UpsertTrieNodeRow,
} from "./trie.db";

export class Trie {
  private statements!: TrieStatements;

  private constructor(_database: TursoDatabase) {}

  static async open(database: TursoDatabase): Promise<Trie> {
    const trie = new Trie(database);
    await createTrieTable(database);
    trie.statements = await createTrieStatements(database);
    return trie;
  }

  async merge(atoms: readonly Atom[], pattern: string, markov_id: number): Promise<number> {
    assertNonEmptyAtoms(atoms);
    if (pattern.length === 0) throw new Error("Cannot merge empty pattern");

    let parent_id: number | null = null;

    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i];
      if (atom === undefined) throw new Error("Out of range");
      const isTerminal = i === atoms.length - 1;
      const insert: TrieNodeInsert = {
        parent_id,
        parent_key: parentKey(parent_id),
        char: atom,
        terminal: isTerminal ? 1 : 0,
        pattern: isTerminal ? pattern : null,
        markov_id: isTerminal ? markov_id : null,
      };

      const row = (await this.statements.upsertTrieNode.get(...bindUpsertTrieNode(insert))) as
        | UpsertTrieNodeRow
        | undefined;
      if (!row) throw new Error(`Failed to insert trie node for atom: ${atom}`);
      parent_id = row.id;
    }

    if (parent_id === null) throw new Error("Failed to merge pattern");
    return parent_id;
  }

  async nextAtoms(prefix: readonly Atom[]): Promise<Atom[]> {
    let parent_id: number | null = null;

    for (const atom of prefix) {
      const row = (await this.statements.selectTrieNode.get(
        ...bindSelectTrieNode({ parent_key: parentKey(parent_id), char: atom }),
      )) as UpsertTrieNodeRow | undefined;
      if (!row) return [];
      parent_id = row.id;
    }

    const rows = await this.statements.selectTrieChildren.all(
      ...bindSelectTrieChildren({ parent_key: parentKey(parent_id) }),
    );
    return rows.map((r) => r.char as string);
  }

  async nextCharacters(prefix: string): Promise<string[]> {
    return this.nextAtoms(atomsFromText(prefix));
  }

  async matchCandidates(source: readonly Atom[], offset = 0): Promise<MatchCandidate[]> {
    const matches: MatchCandidate[] = [];
    let parent_id: number | null = null;
    let length = 0;

    for (let i = offset; i < source.length; i++) {
      const atom = source[i];
      if (atom === undefined) break;

      const row = (await this.statements.selectTrieNode.get(
        ...bindSelectTrieNode({ parent_key: parentKey(parent_id), char: atom }),
      )) as { id: number; terminal: number; pattern: string | null } | undefined;
      if (!row) break;

      parent_id = row.id;
      length++;

      if (row.terminal === 1 && row.pattern !== null) {
        matches.push({ pattern: row.pattern, length });
      }
    }

    return matches;
  }

  async listTerminalPatterns(): Promise<string[]> {
    const rows = await this.statements.listTerminalPatterns.all();
    return rows.map((row) => row.pattern as string);
  }

  async listTerminalEntries(): Promise<TerminalEntry[]> {
    const rows = await this.statements.listTerminalRows.all();
    const byPattern = new Map<string, Atom[]>();
    for (const row of rows) {
      const pattern = row.pattern as string;
      if (byPattern.has(pattern)) continue;
      byPattern.set(pattern, await this.atomsToRoot(row.id as number));
    }
    return [...byPattern.entries()].map(([pattern, atoms]) => ({ pattern, atoms }));
  }

  private async atomsToRoot(nodeId: number): Promise<Atom[]> {
    const atoms: Atom[] = [];
    let id: number | null = nodeId;
    while (id !== null) {
      const row = (await this.statements.selectTrieNodeById.get(id)) as
        | { id: number; parent_id: number | null; char: string }
        | undefined;
      if (!row) break;
      atoms.unshift(row.char);
      id = row.parent_id;
    }
    return atoms;
  }
}
