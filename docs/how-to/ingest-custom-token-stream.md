# Ingest a custom token stream

Feed discrete string atoms into a lattice through the sequencer and LZ gate.

## Prerequisites

- Symbols encoded as `SequencerInput` (`string` or `<number>` sentinel)
- One atom per `push()` / yield
- See [Custom symbol streams](../tutorials/custom-symbol-streams.md) for a full walkthrough

## Symbol rules

- Default gate keys concatenate atoms: `previous + input`
- Optional `atomDelimiter` on `Sequencer` / `createLZSequencer` inserts a separator between atoms
- Use `<0>` for event boundaries and `<1>` for trace boundaries when needed
- Map domain objects to strings before feed
- Trie edges follow each `LatticeSegment.sequence` atom (not UTF-16 splits of the key)

## Steps

1. Prefer `feedSymbols(symbols)` or define `async function* symbols(...): AsyncGenerator<SequencerInput>`.

2. Implement `IJob`:

```typescript
import type { IJob, SequencerInput } from "@khoralabs/tkn";

class SymbolJob implements IJob {
  constructor(private source: AsyncGenerator<SequencerInput>) {}
  input(): AsyncGenerator<SequencerInput> {
    return this.source;
  }
}
```

3. Build sequencer and lattice:

```typescript
import { createLZSequencer, Pipeline } from "@khoralabs/tkn";
import { Lattice } from "@khoralabs/tkn/memory";

const sequencer = createLZSequencer({
  cacheOptions: { bounded: true, max: 10_000 },
  historyOptions: { bounded: false },
  atomDelimiter: "", // set when multi-atom keys need a separator
});
const lattice = new Lattice();
const pipeline = new Pipeline({ lattice, sequencer });
```

4. Run ingest:

```typescript
import { feedSymbols } from "@khoralabs/tkn";

await pipeline.run(new SymbolJob(feedSymbols(["svc:api", "lvl:err", "<0>"])));
```

5. Verify:

```typescript
console.log(lattice.vocabulary().length > 0);
console.log(lattice.compile().patterns);
lattice.close();
```

**Outcome:** `vocabulary().length` is greater than zero; `compile().patterns` lists trie terminals.

## Without Pipeline

Call `feedInputStream` directly:

```typescript
import { createFeedState, feedInputStream, feedSymbols } from "@khoralabs/tkn";

const state = createFeedState();
await feedInputStream(lattice, sequencer, feedSymbols(["a", "b"]), state, 1000);
```

Use `feedInputStreamAsync` with `AsyncPipeline` and an async lattice backend.

Also available: `feedCharacters(text)`, `feedBytes(uint8Array)`.

## Per-symbol online ingest

For symbol-at-a-time loops (for example before compile/decode/forecast), use `feedInput` and an explicit `flushFeedState`:

```typescript
import { createFeedState, feedInput, flushFeedState } from "@khoralabs/tkn";

const state = createFeedState();
const batchSize = 1000;

feedInput(lattice, sequencer, "a", state, batchSize);
feedInput(lattice, sequencer, "b", state, batchSize);
flushFeedState(lattice, state, batchSize);

console.log(lattice.getNext("a")); // reflects committed transitions
```

`flushFeedState` commits pending segments and edges only. It does not call `sequencer.flush()`, so the unfinished LZ candidate stays open. Prefer this over `endSequence()` when you need lattice visibility mid-sequence.

## Related

- [Decode a symbol stream](decode-symbol-stream.md)
- [Log traces and symbol registries](../tutorials/log-traces-and-symbol-registries.md)
- [Ingest pre-segmented patterns](ingest-pre-segmented-patterns.md)
