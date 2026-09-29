# Custom symbol streams

This tutorial feeds discrete string atoms into a lattice. Each atom is one `push()` / generator yield. The trie stores one edge per atom (not UTF-16 character splits).

## Prerequisites

- [Getting started](getting-started.md) completed, or equivalent familiarity with `Sequencer` and `Lattice`
- `@khoralabs/tkn` installed

## Symbol encoding

`SequencerInput` is `string | `<number>``. One yield or one `push()` is one opaque atom.

Gate keys default to concatenation: `current = previous + input`. Optional `atomDelimiter` inserts a separator between atoms. Sentinels still mark boundaries when you need them:

| Sentinel | Typical use |
|----------|-------------|
| `<0>` | End of one event or sample |
| `<1>` | End of one trace or session |

Example tokens for a simple event stream:

```typescript
const events = [
  "svc:api",
  "lvl:err",
  "op:read",
  "<0>",
  "svc:api",
  "lvl:ok",
  "op:write",
  "<0>",
];
```

The host maps domain values to stable strings before feed. tkn stores strings only.

## Step 1 — Use `feedSymbols` (or a custom generator)

```typescript
import { feedSymbols, type SequencerInput } from "@khoralabs/tkn";

const source = feedSymbols(events);

// Or hand-roll the same shape:
async function* eventSymbols(
  rows: Array<{ service: string; level: string; op: string }>,
): AsyncGenerator<SequencerInput> {
  for (const e of rows) {
    yield `svc:${e.service}`;
    yield `lvl:${e.level}`;
    yield `op:${e.op}`;
    yield "<0>";
  }
}
```

Other alphabets: `feedCharacters(text)`, `feedBytes(uint8Array)`.

## Step 2 — Implement a custom job

`IJob` supplies the generator to `Pipeline`.

```typescript
import type { IJob, SequencerInput } from "@khoralabs/tkn";

class SymbolJob implements IJob {
  constructor(private source: AsyncGenerator<SequencerInput>) {}

  input(): AsyncGenerator<SequencerInput> {
    return this.source;
  }
}
```

## Step 3 — Build sequencer and pipeline

Use `LZGate` with a bounded dictionary for long streams. Set `atomDelimiter` when keys should not be bare concatenation.

```typescript
import { createLZSequencer, Pipeline } from "@khoralabs/tkn";
import { Lattice } from "@khoralabs/tkn/memory";

const sequencer = createLZSequencer({
  cacheOptions: { bounded: true, max: 10_000 },
  historyOptions: { bounded: false },
  atomDelimiter: "", // or "|" when joining multi-atom keys
});

const lattice = new Lattice();
const pipeline = new Pipeline({ lattice, sequencer });
```

## Step 4 — Run ingest

```typescript
const sample = [
  { service: "api", level: "err", op: "read" },
  { service: "api", level: "ok", op: "write" },
  { service: "api", level: "err", op: "read" },
];

await pipeline.run(new SymbolJob(eventSymbols(sample)));

console.log(lattice.vocabulary().length);
console.log(lattice.getTopTokens(5));
```

The LZ gate emits segments when an extended prefix is not in the dictionary. Ingest walks `sequence` as atom edges in the trie.

## Step 5 — Decode over symbols

`tokenize(text)` is for UTF-16 text. For discrete atoms, compile and call `decodeIndexed`:

```typescript
import { decodeIndexed } from "@khoralabs/tkn";

const symbols = ["svc:api", "lvl:err", "op:read", "<0>"];
const compiled = lattice.compile();
const byStart = compiled.scanAtoms(symbols);

const result = decodeIndexed({
  length: symbols.length,
  matchCandidates: (offset) => byStart[offset] ?? [],
  fallbackCandidate: (offset) => {
    const s = symbols[offset];
    return s === undefined ? null : { pattern: s, length: 1 };
  },
  emissionScore: (t) => compiled.emissionLogProb(t),
  transitionWeight: (from, to) => compiled.transitionLogProb(from, to),
});

console.log(result.tokens, result.steps);
lattice.close();
```

See [Decode a symbol stream](../how-to/decode-symbol-stream.md).

## Next steps

- [Ingest a custom token stream](../how-to/ingest-custom-token-stream.md) — condensed procedure
- [Log traces and symbol registries](log-traces-and-symbol-registries.md) — symbol registry and host segmentation
- [Ingest pre-segmented patterns](../how-to/ingest-pre-segmented-patterns.md) — bypass the sequencer
