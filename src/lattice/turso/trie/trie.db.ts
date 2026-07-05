import type { TrieNode, TrieNodeInsert } from "../../trie.model";
import type { TursoDatabase } from "../db";

export const createTrieTable = async (database: TursoDatabase) => {
  await database.exec(`
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
};

export type TrieStatements = Awaited<ReturnType<typeof createTrieStatements>>;

export type UpsertTrieNodeRow = Pick<TrieNode, "id">;
export type SelectTrieNodeArgs = { parent_key: number; char: string };
export type SelectTrieChildrenArgs = { parent_key: number };

export const createTrieStatements = async (database: TursoDatabase) => {
  const upsertTrieNode = await database.prepare(`
    INSERT INTO trie_nodes (parent_id, parent_key, char, terminal, pattern, markov_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(parent_key, char)
    DO UPDATE SET
      terminal = trie_nodes.terminal OR excluded.terminal,
      pattern = COALESCE(excluded.pattern, trie_nodes.pattern),
      markov_id = COALESCE(excluded.markov_id, trie_nodes.markov_id)
    RETURNING id;
  `);

  const selectTrieNode = await database.prepare(`
    SELECT id, terminal, pattern FROM trie_nodes WHERE parent_key = ? AND char = ?;
  `);

  const selectTrieChildren = await database.prepare(`
    SELECT char FROM trie_nodes WHERE parent_key = ?
  `);

  return {
    upsertTrieNode,
    selectTrieNode,
    selectTrieChildren,
  };
};

export type { TrieNodeInsert };

export function parentKey(parent_id: number | null): number {
  return parent_id ?? -1;
}

export function bindUpsertTrieNode(
  row: TrieNodeInsert,
): [
  TrieNodeInsert["parent_id"],
  number,
  TrieNodeInsert["char"],
  TrieNodeInsert["terminal"],
  string | null | undefined,
  number | null | undefined,
] {
  return [
    row.parent_id,
    parentKey(row.parent_id),
    row.char,
    row.terminal,
    row.pattern ?? null,
    row.markov_id ?? null,
  ];
}

export function bindSelectTrieNode(args: SelectTrieNodeArgs): [number, string] {
  return [args.parent_key, args.char];
}

export function bindSelectTrieChildren(args: SelectTrieChildrenArgs): [number] {
  return [args.parent_key];
}
