# Custom symbol streams

This tutorial feeds discrete string tokens into a lattice. Each token is one `push()` call. The feed is not character-by-character.

## Prerequisites

- [Getting started](getting-started.md) completed, or equivalent familiarity with `Sequencer` and `Lattice`
- `@khoralabs/tkn` installed

## Symbol encoding

`SequencerInput` is `string | `<number>``. One yield or one `push()` is one logical token.

The sequencer forms gate keys by concatenation: `current = previous + input`. There is no separator between tokens. Use sentinel markers to mark boundaries:

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

## Step 1 — Define a symbol generator

Wrap your tokens in an async generator.

```typescript
import type { SequencerInput } from "@khoralabs/tkn";

async function* eventSymbols(
  events: Array<{ service: string; level: string; op: string }>,
): AsyncGenerator<SequencerInput> {
  for (const e of events) {
    yield `svc:${e.service}`;
    yield `lvl:${e.level}`;
    yield `op:${e.op}`;
    yield "<0>";
  }
}
```

## Step 2 — Implement a custom job

`IJob` supplies the generator to `Pipeline`.

```typescript
import type { IJob } from "@khoralabs/tkn";

class SymbolJob implements IJob {
  constructor(private source: AsyncGenerator<SequencerInput>) {}

  input(): AsyncGenerator<SequencerInput> {
    return this.source;
  }
}
```

## Step 3 — Build sequencer and pipeline

Use `LZGate` with a bounded dictionary for long streams.

```typescript
import { Pipeline } from "@khoralabs/tkn";
import { Lattice } from "@khoralabs/tkn/memory";
import { Bounded, LZGate, Queue, Sequencer } from "@khoralabs/tkn";

const dictionary = new Bounded(10_000);
const sequencer = new Sequencer({
  gates: [new LZGate({ cache: dictionary })],
  queue: new Queue({ historyOptions: { bounded: false } }),
});

const lattice = new Lattice();
const pipeline = new Pipeline({ lattice, sequencer, dictionary });
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

The LZ gate emits segments when an extended prefix is not in the dictionary. The pipeline ingests each segment and records transitions between consecutive segment keys.

## Step 5 — Inspect transitions

```typescript
for (const pattern of lattice.vocabulary()) {
  const next = lattice.getNext(pattern);
  if (next.length > 0) {
    console.log(pattern, "→", next);
  }
}

lattice.close();
```

## Decode and symbol streams

`tokenize(text)` scans one string with Aho-Corasick. It matches patterns as substrings of that string.

For discrete symbol streams, graph queries (`getNext`, `getTopTokens`, `vocabulary`) do not require serialization. Decode requires a host-defined string form where learned patterns are substring-safe, or a separate encoding step.

See [Decode text](../how-to/decode-text.md) for decode options and [Log traces and symbol registries](log-traces-and-symbol-registries.md) for structured log ingest.

## Next steps

- [Ingest a custom token stream](../how-to/ingest-custom-token-stream.md) — condensed procedure
- [Log traces and symbol registries](log-traces-and-symbol-registries.md) — symbol registry and host segmentation
- [Ingest pre-segmented patterns](../how-to/ingest-pre-segmented-patterns.md) — bypass the sequencer
