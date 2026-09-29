/** Opaque stream atom: feed, trie/AC edge label, and decode source unit. */
export type Atom = string;

export type TerminalEntry = {
  pattern: string;
  atoms: readonly Atom[];
};

/** Character-alphabet view of a string (one atom per UTF-16 code unit). */
export function atomsFromText(text: string): Atom[] {
  return Array.from(text);
}

/** Char-grain helper: each pattern key is split into UTF-16 atoms for compile/AC. */
export function terminalEntriesFromText(patterns: readonly string[]): TerminalEntry[] {
  return patterns.map((pattern) => ({ pattern, atoms: atomsFromText(pattern) }));
}

export function assertNonEmptyAtoms(atoms: readonly Atom[], label = "atoms"): void {
  if (atoms.length === 0) throw new Error(`Cannot merge empty ${label}`);
  for (const atom of atoms) {
    if (atom.length === 0) throw new Error("Cannot merge empty atom");
  }
}

/** Join atoms into a pattern key with an optional delimiter between atoms. */
export function joinAtoms(atoms: readonly Atom[], delimiter = ""): string {
  assertNonEmptyAtoms(atoms);
  return atoms.join(delimiter);
}

/**
 * Split a pattern key into atoms using a delimiter.
 * Empty trailing segments from a trailing delimiter are dropped.
 */
export function splitAtoms(key: string, delimiter: string): Atom[] {
  if (delimiter.length === 0) {
    return atomsFromText(key);
  }
  if (key.length === 0) return [];
  const parts = key.split(delimiter);
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts.filter((part) => part.length > 0);
}
