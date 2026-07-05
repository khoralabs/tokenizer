import type { Database } from "bun:sqlite";
import type { ITrie } from "../../trie";
import { bind } from "../bind";
import {
  createTrieStatements,
  createTrieTable,
  type InsertTrieNodeStmt,
  type SelectTrieChildrenStmt,
  type SelectTrieNodeStmt,
  type UpdateTrieTerminalStmt,
} from "./trie.db";

export class Trie implements ITrie {
  private db: Database;

  // Prepared statements
  private insertTrieNode!: InsertTrieNodeStmt;
  private selectTrieNode!: SelectTrieNodeStmt;
  private updateTrieTerminal!: UpdateTrieTerminalStmt;
  private selectTrieChildren!: SelectTrieChildrenStmt;

  constructor(database: Database) {
    this.db = database;
    this.initSchema();
    this.prepareStatements();
  }

  private initSchema() {
    createTrieTable(this.db);
  }

  private prepareStatements() {
    const { insertTrieNode, selectTrieNode, updateTrieTerminal, selectTrieChildren } =
      createTrieStatements(this.db);

    this.insertTrieNode = insertTrieNode;
    this.selectTrieNode = selectTrieNode;
    this.updateTrieTerminal = updateTrieTerminal;
    this.selectTrieChildren = selectTrieChildren;
  }

  /**
   * Inserts a token into the trie, creating nodes character by character.
   * Returns the markov_id column value for the terminal node.
   * @param token - The token to insert
   * @param markov_id - The markov node id to associate with this token
   * @returns The terminal node's trie id
   */
  merge(pattern: string, markov_id: number): number {
    if (pattern.length === 0) throw new Error("Cannot merge empty pattern");

    let parent_id: number | null = null;

    for (let i = 0; i < pattern.length; i++) {
      const char =
        pattern[i] ??
        (() => {
          throw new Error("out of range");
        })();
      const terminal = i === pattern.length - 1 ? 1 : 0;

      const row = this.insertTrieNode.get(bind({ parent_id, char, terminal }));
      if (!row) throw new Error(`Failed to insert trie node for char: ${char}`);
      parent_id = row.id;
    }

    if (parent_id === null) throw new Error("Failed to merge pattern");

    // Update terminal node with pattern and markov_id
    this.updateTrieTerminal.run(
      bind({
        id: parent_id,
        pattern,
        markov_id,
        terminal: 1,
      }),
    );

    return parent_id;
  }

  /**
   * Gets immediate child characters of a prefix in the trie.
   * @param prefix - The prefix to search for
   * @returns Array of child characters
   */
  nextCharacters(prefix: string): string[] {
    let parent_id: number | null = null;

    for (const char of prefix) {
      const row = this.selectTrieNode.get(bind({ parent_id, char }));
      if (!row) return [];
      parent_id = row.id;
    }

    return this.selectTrieChildren.all(bind({ parent_id })).map((r) => r.char);
  }
}
