# Decode a symbol stream

Decode over discrete atoms (not a UTF-16 text string) with spans and scores.

## Prerequisites

- A lattice trained on the same atom alphabet (for example via `feedSymbols`)
- Bun and `@khoralabs/tkn` installed

## Steps

1. Compile the lattice and read trie terminals:

```typescript
import { decodeIndexed } from "@khoralabs/tkn";
import { Lattice } from "@khoralabs/tkn/memory";

const lattice = new Lattice();
// … ingest with feedSymbols / feedInputStream …

const compiled = lattice.compile();
const patterns = compiled.patterns;
```

2. Build candidates at each symbol offset (host logic). `MatchCandidate.length` is an atom count:

```typescript
function matchAt(symbols: string[], offset: number) {
  const out: { pattern: string; length: number }[] = [];
  let concat = "";
  for (let k = 1; offset + k <= symbols.length; k++) {
    concat += symbols[offset + k - 1]!;
    if (patterns.includes(concat)) out.push({ pattern: concat, length: k });
  }
  return out;
}
```

Or use the automaton when atoms match the compile alphabet:

```typescript
const byStart = compiled.scanAtoms(symbols);
```

3. Call `decodeIndexed`:

```typescript
const symbols = ["foo|", "bar|", "baz|"];

const result = decodeIndexed(
  {
    length: symbols.length,
    matchCandidates: (offset) => byStart[offset] ?? matchAt(symbols, offset),
    fallbackCandidate: (offset) => {
      const s = symbols[offset];
      return s === undefined ? null : { pattern: s, length: 1 };
    },
    emissionScore: (token) => compiled.emissionLogProb(token),
    transitionWeight: (from, to) => compiled.transitionLogProb(from, to),
  },
  { mode: "viterbi" },
);

if (!result.complete) throw new Error("no complete path");
console.log(result.tokens);
console.log(result.steps); // start/end atom offsets + score contributions
```

**Outcome:** `result.tokens` is the decoded pattern sequence; `result.steps` carry source-unit spans and cumulative scores.

## Options

```typescript
decodeIndexed(context, { mode: "beam", beamWidth: 32, useBigram: false });
```

- `useBigram: false` — transition contribution is zero
- Invalid candidate lengths / beam widths throw `RangeError`

## Related

- [Decode text](decode-text.md) — UTF-16 `tokenize` / `decodeDetailed`
- [Custom symbol streams](../tutorials/custom-symbol-streams.md)
- [API reference](../reference/api.md) — `IndexedDecodeContext`, `DecodeResult`
