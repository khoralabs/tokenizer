import type { Atom } from "../lattice/atom";
import { atomsFromText } from "../lattice/atom";
import type { SequencerInput } from "../sequencer";

/**
 * Character feed: one atom per UTF-16 code unit (matches historical text tokenize).
 * Choosing this feed selects a character alphabet for the lattice matcher.
 */
export async function* feedCharacters(text: string): AsyncGenerator<SequencerInput> {
  for (const atom of atomsFromText(text)) yield atom;
}

/**
 * Byte feed: one atom per byte, encoded as a Latin-1 code unit (`String.fromCharCode`).
 * Choosing this feed selects a byte alphabet for the lattice matcher.
 */
export async function* feedBytes(bytes: Uint8Array): AsyncGenerator<SequencerInput> {
  for (const byte of bytes) yield String.fromCharCode(byte);
}

/**
 * Symbol feed: each string is one opaque atom (no further splitting).
 * Choosing this feed selects a symbol alphabet for the lattice matcher.
 */
export async function* feedSymbols(symbols: readonly Atom[]): AsyncGenerator<SequencerInput> {
  for (const symbol of symbols) {
    if (symbol.length === 0) throw new Error("Cannot feed empty symbol atom");
    yield symbol;
  }
}
