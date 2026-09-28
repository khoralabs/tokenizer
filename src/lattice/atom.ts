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

export function assertNonEmptyAtoms(atoms: readonly Atom[], label = "atoms"): void {
  if (atoms.length === 0) throw new Error(`Cannot merge empty ${label}`);
  for (const atom of atoms) {
    if (atom.length === 0) throw new Error("Cannot merge empty atom");
  }
}
