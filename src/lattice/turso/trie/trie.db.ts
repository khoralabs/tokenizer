import type { TursoDatabase } from "../db";

export const createTrieTable = async (database: TursoDatabase) => {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS trie_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      char TEXT NOT NULL,
      pattern TEXT,
      terminal INTEGER DEFAULT 0,
      markov_id INTEGER,
      FOREIGN KEY (parent_id) REFERENCES trie_nodes(id),
      FOREIGN KEY (markov_id) REFERENCES nodes(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_trie_parent_char ON trie_nodes(parent_id, char);
    CREATE INDEX IF NOT EXISTS idx_trie_pattern ON trie_nodes(pattern);
  `);
};

export type TrieStatements = Awaited<ReturnType<typeof createTrieStatements>>;

export const createTrieStatements = async (database: TursoDatabase) => {
  const insertTrieNode = await database.prepare(`
    INSERT INTO trie_nodes (parent_id, char, terminal)
    VALUES (?, ?, ?)
    ON CONFLICT(parent_id, char)
    DO UPDATE SET terminal = terminal OR ?
    RETURNING id;
  `);

  const selectTrieNode = await database.prepare(`
    SELECT id FROM trie_nodes WHERE parent_id IS ? AND char = ?;
  `);

  const updateTrieTerminal = await database.prepare(`
    UPDATE trie_nodes
    SET terminal = 1, pattern = ?, markov_id = ?
    WHERE id = ?;
  `);

  const selectTrieChildren = await database.prepare(`
    SELECT char FROM trie_nodes WHERE parent_id = ?
  `);

  return {
    insertTrieNode,
    selectTrieNode,
    updateTrieTerminal,
    selectTrieChildren,
  };
};
