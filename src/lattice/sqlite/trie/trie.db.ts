import type { Database, Statement } from "bun:sqlite";
import type { TrieNode, TrieNodeInsert } from "../../trie.model";
import type { BunBind } from "../bind";

export type UpsertTrieNodeStmt = Statement<Pick<TrieNode, "id">, [BunBind<TrieNodeInsert>]>;
export type SelectTrieNodeStmt = Statement<
  Pick<TrieNode, "id" | "terminal" | "pattern">,
  [BunBind<Pick<TrieNode, "parent_key" | "char">>]
>;
export type SelectTrieChildrenStmt = Statement<
  Pick<TrieNode, "char">,
  [BunBind<Pick<TrieNode, "parent_key">>]
>;
export type ListTerminalPatternsStmt = Statement<{ pattern: string }, []>;

export const createTrieTable = (database: Database) =>
  database.run(`
    CREATE TABLE IF NOT EXISTS trie_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      parent_key INTEGER NOT NULL DEFAULT -1,
      char TEXT NOT NULL,
      pattern TEXT,
      terminal INTEGER DEFAULT 0,
      markov_id INTEGER,
      FOREIGN KEY (parent_id) REFERENCES trie_nodes(id),
      FOREIGN KEY (markov_id) REFERENCES nodes(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_trie_parent_char ON trie_nodes(parent_key, char);
    CREATE INDEX IF NOT EXISTS idx_trie_pattern ON trie_nodes(pattern);
  `);

export const createTrieStatements = (database: Database) => {
  const upsertTrieNode: UpsertTrieNodeStmt = database.query(`
    INSERT INTO trie_nodes (parent_id, parent_key, char, terminal, pattern, markov_id)
    VALUES ($parent_id, $parent_key, $char, $terminal, $pattern, $markov_id)
    ON CONFLICT(parent_key, char)
    DO UPDATE SET
      terminal = trie_nodes.terminal OR excluded.terminal,
      pattern = COALESCE(excluded.pattern, trie_nodes.pattern),
      markov_id = COALESCE(excluded.markov_id, trie_nodes.markov_id)
    RETURNING id;
  `);

  const selectTrieNode: SelectTrieNodeStmt = database.query(`
    SELECT id, terminal, pattern FROM trie_nodes WHERE parent_key = $parent_key AND char = $char;
  `);

  const selectTrieChildren: SelectTrieChildrenStmt = database.query(`
    SELECT char FROM trie_nodes WHERE parent_key = $parent_key
  `);

  const listTerminalPatterns: ListTerminalPatternsStmt = database.query(`
    SELECT DISTINCT pattern AS pattern
    FROM trie_nodes
    WHERE terminal = 1 AND pattern IS NOT NULL
  `);

  return {
    upsertTrieNode,
    selectTrieNode,
    selectTrieChildren,
    listTerminalPatterns,
  };
};

export function parentKey(parent_id: number | null): number {
  return parent_id ?? -1;
}
