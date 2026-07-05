import type { MatchCandidate } from "../../trie";
import type { TrieNodeInsert, TrieNodeUpdate } from "../../trie.model";
import type { TursoDatabase } from "../db";
import {
  bindInsertTrieNode,
  bindSelectTrieChildren,
  bindSelectTrieNode,
  bindUpdateTrieTerminal,
  createTrieStatements,
  createTrieTable,
  type InsertTrieNodeRow,
  type TrieStatements,
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

  async merge(pattern: string, markov_id: number): Promise<number> {
    if (pattern.length === 0) throw new Error("Cannot merge empty pattern");

    let parent_id: number | null = null;

    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      if (char === undefined) throw new Error("Out of range");
      const insert: TrieNodeInsert = {
        parent_id,
        char,
        terminal: i === pattern.length - 1 ? 1 : 0,
      };

      const row = (await this.statements.insertTrieNode.get(...bindInsertTrieNode(insert))) as
        | InsertTrieNodeRow
        | undefined;
      if (!row) throw new Error(`Failed to insert trie node for char: ${char}`);
      parent_id = row.id;
    }

    if (parent_id === null) throw new Error("Failed to merge pattern");

    const update: TrieNodeUpdate = {
      id: parent_id,
      pattern,
      markov_id,
      terminal: 1,
    };
    await this.statements.updateTrieTerminal.run(...bindUpdateTrieTerminal(update));

    return parent_id;
  }

  async nextCharacters(prefix: string): Promise<string[]> {
    let parent_id: number | null = null;

    for (const char of prefix) {
      const row = (await this.statements.selectTrieNode.get(
        ...bindSelectTrieNode({ parent_id, char }),
      )) as InsertTrieNodeRow | undefined;
      if (!row) return [];
      parent_id = row.id;
    }

    const rows = await this.statements.selectTrieChildren.all(
      ...bindSelectTrieChildren({ parent_id }),
    );
    return rows.map((r) => r.char as string);
  }

  async matchCandidates(text: string, offset = 0): Promise<MatchCandidate[]> {
    const matches: MatchCandidate[] = [];
    let parent_id: number | null = null;
    let length = 0;

    for (let i = offset; i < text.length; i++) {
      const char = text[i];
      if (char === undefined) break;

      const row = (await this.statements.selectTrieNode.get(
        ...bindSelectTrieNode({ parent_id, char }),
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
}
