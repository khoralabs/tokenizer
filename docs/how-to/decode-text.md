# Decode text

Decode splits input text into token strings using a trained lattice.

## Prerequisites

- A lattice database with at least one ingested pattern
- Bun and `@khoralabs/tkn` installed

## CLI decode (Viterbi)

Ensure `tkn.config.json` points at your trained database, then:

```bash
bun run tokenize --text "hello world"
```

Equivalent via `tkn`:

```bash
bun run tkn tokenize --text "hello world"
```

**Outcome:** stdout is a JSON array, for example `["he","llo"," wor","ld"]`. Stderr is quiet by default; add `--verbose` for lattice stats.

Other input sources:

```bash
bun run tokenize -f input.txt
echo "hello world" | bun run tokenize
```

Decoder settings (`decoder`, `beamWidth`) live in `tkn.config.json` under `decode`, or override with flags:

## CLI decode (beam)

```bash
bun run tokenize --text "hello world" --decoder beam --beam-width 32
```

## TypeScript decode (sync lattice)

Open a readonly SQLite lattice or use an in-memory lattice after feed.

```typescript
import { Lattice } from "@khoralabs/tkn/bun-sqlite";

const lattice = new Lattice({ filename: ".tkn/lattice.db", readonly: true });

const tokens = lattice.tokenize("hello world");
console.log(tokens);

lattice.close();
```

Pass decode options:

```typescript
lattice.tokenize("hello world", { mode: "beam", beamWidth: 32, useBigram: true });
```

`tokenize()` compiles the lattice on first use if no compiled index is cached.

## Detailed text decode

```typescript
import { createViterbiContext, decodeDetailed } from "@khoralabs/tkn";

// … build ViterbiContext …
const detailed = decodeDetailed("hello", ctx, { mode: "viterbi" });
detailed.tokens;
detailed.steps; // start/end, emission/transition, cumulativeScore
detailed.score;
detailed.complete;
```

`decode(text, ctx)` returns `detailed.tokens`. For discrete atoms (not UTF-16 text), see [Decode a symbol stream](decode-symbol-stream.md).

## TypeScript decode (async lattice)

```typescript
import { TursoLattice } from "@khoralabs/tkn/turso";

const lattice = await TursoLattice.open(".tkn/lattice.db");
const tokens = await lattice.tokenize("hello world");
await lattice.close();
```

## Invalidate compile cache after ingest

If you ingest more data into an open lattice, drop the cached compile index before the next decode.

```typescript
lattice.ingest({ key: "new", sequence: ["n", "e", "w"] });
lattice.invalidateCompiled();
lattice.tokenize("new text");
```

## Low-level decode without a backend

Build LM tables and a compiled index from pattern lists and edge weights.

```typescript
import { buildLmTables, compilePatterns, tokenizeCompiled } from "@khoralabs/tkn";

const tokenCounts = new Map([
  ["he", 10],
  ["llo", 8],
]);
const edges = [{ from: "he", to: "llo", weight: 5 }];

const lm = buildLmTables(tokenCounts, edges, { smoothing: 0.1 });
const compiled = compilePatterns(["he", "llo"], lm);
const tokens = tokenizeCompiled("hello", compiled);
```

## Direct compile and scan

```typescript
const compiled = lattice.compile();
compiled.patternCount;
compiled.patterns; // trie terminals
compiled.scan("hello");
compiled.scanAtoms(["h", "e", "l", "l", "o"]);
compiled.emissionLogProb("he");
compiled.transitionLogProb("he", "llo");
```

Non-default smoothing returns an uncached snapshot:

```typescript
lattice.compile({ smoothing: 0.5 });
```

**Outcome:** `scan()` / `scanAtoms()` return match candidates per offset. Log-prob methods return precomputed scores used by the decoder.
