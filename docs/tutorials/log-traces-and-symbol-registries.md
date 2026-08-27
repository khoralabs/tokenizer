# Log traces and symbol registries

This tutorial maps structured log events to string symbols and ingests them into a lattice. The host owns the symbol table. tkn does not store raw log objects.

## Prerequisites

- [Custom symbol streams](custom-symbol-streams.md), or familiarity with `SequencerInput` and `LatticeSegment`

## Host responsibilities

The host must:

1. Map each log event to a stable string symbol
2. Define boundaries (event, trace, session) with sentinels or segment keys
3. Choose ingest path: LZ discovery via `Pipeline`, or pre-segmented ingest via `pipe` / manual `ingest`

Delimiter choice (`|`, `:`, and field order) is a host concern. Use one consistent format per project.

## Step 1 — Define log events and a symbol registry

```typescript
type LogEvent = {
  traceId: string;
  spanId: string;
  level: string;
  service: string;
};

function symbolForEvent(e: LogEvent): string {
  return `trace:${e.traceId}|span:${e.spanId}|lvl:${e.level}|svc:${e.service}`;
}
```

Optional interning collapses repeated strings:

```typescript
class SymbolRegistry {
  private table = new Map<string, string>();

  intern(raw: string): string {
    let sym = this.table.get(raw);
    if (!sym) {
      sym = raw;
      this.table.set(raw, sym);
    }
    return sym;
  }

  fromEvent(e: LogEvent): string {
    return this.intern(symbolForEvent(e));
  }
}
```

## Step 2 — Path A: LZ discovery with Pipeline

Yield one symbol per event plus sentinels. Insert `<1>` when `traceId` changes.

```typescript
import type { IJob, SequencerInput } from "@khoralabs/tkn";

async function* traceSymbolStream(
  events: LogEvent[],
  registry: SymbolRegistry,
): AsyncGenerator<SequencerInput> {
  let lastTrace: string | null = null;

  for (const e of events) {
    if (e.traceId !== lastTrace) {
      if (lastTrace !== null) yield "<1>";
      lastTrace = e.traceId;
    }
    yield registry.fromEvent(e);
    yield "<0>";
  }
}

class TraceJob implements IJob {
  constructor(private source: AsyncGenerator<SequencerInput>) {}
  input(): AsyncGenerator<SequencerInput> {
    return this.source;
  }
}
```

Run the same `Pipeline` setup as [custom symbol streams](custom-symbol-streams.md):

```typescript
import { Bounded, LZGate, Pipeline, Queue, Sequencer } from "@khoralabs/tkn";
import { Lattice } from "@khoralabs/tkn/memory";

const events: LogEvent[] = [
  { traceId: "abc", spanId: "1", level: "err", service: "payments" },
  { traceId: "abc", spanId: "2", level: "ok", service: "payments" },
  { traceId: "def", spanId: "1", level: "warn", service: "api" },
];

const registry = new SymbolRegistry();
const lattice = new Lattice();
const dictionary = new Bounded(10_000);
const sequencer = new Sequencer({
  gates: [new LZGate({ cache: dictionary })],
  queue: new Queue({ historyOptions: { bounded: false } }),
});
const pipeline = new Pipeline({ lattice, sequencer, dictionary });

await pipeline.run(new TraceJob(traceSymbolStream(events, registry)));
```

Segmentation follows LZ rules. The resulting lattice depends on symbol order and dictionary state.

## Step 3 — Path B: Host segmentation with `pipe`

When the host already defines segment boundaries, build `LatticeSegment` values directly. Skip the sequencer.

One segment per trace: key is the trace id; sequence is the symbol tokens for that trace.

```typescript
import type { LatticeSegment } from "@khoralabs/tkn";
import { Lattice } from "@khoralabs/tkn/memory";

function segmentsForTraces(events: LogEvent[], registry: SymbolRegistry): LatticeSegment[] {
  const byTrace = new Map<string, string[]>();

  for (const e of events) {
    const sym = registry.fromEvent(e);
    const list = byTrace.get(e.traceId) ?? [];
    list.push(sym, "<0>");
    byTrace.set(e.traceId, list);
  }

  return [...byTrace.entries()].map(([traceId, sequence]) => ({
    key: `trace:${traceId}`,
    sequence,
  }));
}

async function* segmentSource(segments: LatticeSegment[]): AsyncGenerator<LatticeSegment> {
  for (const seg of segments) yield seg;
}

const lattice2 = new Lattice();
await lattice2.pipe(segmentSource(segmentsForTraces(events, registry)));

console.log(lattice2.getNext("trace:abc"));
lattice2.close();
```

`pipe` ingests each segment and merges transitions between consecutive segment keys.

## Step 4 — Manual ingest and merge

When transitions are known without streaming:

```typescript
const lattice3 = new Lattice();

lattice3.ingest({
  key: "trace:abc",
  sequence: [
    "trace:abc|span:1|lvl:err|svc:payments",
    "<0>",
    "trace:abc|span:2|lvl:ok|svc:payments",
    "<0>",
  ],
});

lattice3.ingest({
  key: "trace:def",
  sequence: ["trace:def|span:1|lvl:warn|svc:api", "<0>"],
});

lattice3.merge([
  ["trace:abc", "trace:def", 3],
]);

lattice3.close();
```

Use `ingestBatch` or `commitFeedBatch` for larger batches. See [API reference](../reference/api.md).

## Query vs decode

| Operation | Input | Use |
|-----------|-------|-----|
| `getNext(from)` | Pattern key | Outgoing transitions and weights |
| `getTopTokens(n)` | — | Ranked patterns by hub score |
| `vocabulary()` | — | All pattern keys in the graph |
| `tokenize(text)` | Single string | Substring scan plus Viterbi or beam |

For log symbol keys with `|` and `:`, decode may not align with discrete events unless the host serializes symbols into a scan-compatible string. Graph queries do not require decode.

## Incremental ingest

Feed more events into the same lattice. Call `invalidateCompiled()` after ingest or merge if a compiled index was cached.

```typescript
lattice.ingest({ key: "trace:ghi", sequence: ["trace:ghi|span:1|lvl:info|svc:api", "<0>"] });
lattice.invalidateCompiled();
```

## Gate and lattice content

The LZ gate runs only during Path A ingest. It does not run during decode.

Path B and manual ingest write segments the host defines. Decode on the same input string differs when the stored vocabulary and transition weights differ between lattices.

## Next steps

- [Ingest pre-segmented patterns](../how-to/ingest-pre-segmented-patterns.md) — condensed procedure
- [Ingest a custom token stream](../how-to/ingest-custom-token-stream.md) — Path A reference
- [Architecture](../explanation/architecture.md) — ingest and decode components
