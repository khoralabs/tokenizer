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

Equivalent via `tokenizer`:

```bash
bun run tokenizer tokenize --text "hello world"
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
lattice.tokenize("hello world", { mode: "beam", beamWidth: 32 });
```

`tokenize()` compiles the lattice on first use if no compiled index is cached.

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

const lm = buildLmTables(tokenCounts, edges);
const compiled = compilePatterns(["he", "llo"], lm);
const tokens = tokenizeCompiled("hello", compiled);
```

## Direct compile and scan

```typescript
const compiled = lattice.compile();
compiled.patternCount;
compiled.scan("hello");
compiled.emissionLogProb("he");
compiled.transitionLogProb("he", "llo");
```

**Outcome:** `scan()` returns match candidates per offset. Log-prob methods return precomputed scores used by the decoder.
