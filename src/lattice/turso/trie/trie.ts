import type { TursoDatabase } from "../db";
import { createTrieStatements, createTrieTable, type TrieStatements } from "./trie.db";

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
      const terminal = i === pattern.length - 1 ? 1 : 0;

      const row = await this.statements.insertTrieNode.get(parent_id, char, terminal, terminal);
      if (!row) throw new Error(`Failed to insert trie node for char: ${char}`);
      parent_id = row.id as number;
    }

    if (parent_id === null) throw new Error("Failed to merge pattern");

    await this.statements.updateTrieTerminal.run(pattern, markov_id, parent_id);

    return parent_id;
  }

  async nextCharacters(prefix: string): Promise<string[]> {
    let parent_id: number | null = null;

    for (const char of prefix) {
      const row = await this.statements.selectTrieNode.get(parent_id, char);
      if (!row) return [];
      parent_id = row.id as number;
    }

    const rows = await this.statements.selectTrieChildren.all(parent_id);
    return rows.map((r) => r.char as string);
  }
}
