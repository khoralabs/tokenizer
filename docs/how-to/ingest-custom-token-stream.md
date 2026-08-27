# Ingest a custom token stream

Feed discrete string tokens into a lattice through the sequencer and LZ gate.

## Prerequisites

- Symbols encoded as `SequencerInput` (`string` or `<number>` sentinel)
- One token per `push()` — not character-by-character
- See [Custom symbol streams](../tutorials/custom-symbol-streams.md) for a full walkthrough

## Symbol rules

- Concatenate gate keys have no separator: `previous + input`
- Use `<0>` for event boundaries and `<1>` for trace boundaries when needed
- Map domain objects to strings before feed

## Steps

1. Define `async function* symbols(...): AsyncGenerator<SequencerInput>`.

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
import { Bounded, LZGate, Pipeline, Queue, Sequencer } from "@khoralabs/tkn";
import { Lattice } from "@khoralabs/tkn/memory";

const dictionary = new Bounded(10_000);
const sequencer = new Sequencer({
  gates: [new LZGate({ cache: dictionary })],
  queue: new Queue({ historyOptions: { bounded: false } }),
});
const lattice = new Lattice();
const pipeline = new Pipeline({ lattice, sequencer, dictionary });
```

4. Run ingest:

```typescript
await pipeline.run(new SymbolJob(symbols()));
```

5. Verify:

```typescript
console.log(lattice.vocabulary().length > 0);
lattice.close();
```

**Outcome:** `vocabulary().length` is greater than zero.

## Without Pipeline

Call `feedInputStream` directly:

```typescript
import { createFeedState, feedInputStream } from "@khoralabs/tkn";

const state = createFeedState();
await feedInputStream(lattice, sequencer, symbols(), state, 1000);
```

Use `feedInputStreamAsync` with `AsyncPipeline` and an async lattice backend.

## Related

- [Log traces and symbol registries](../tutorials/log-traces-and-symbol-registries.md)
- [Ingest pre-segmented patterns](ingest-pre-segmented-patterns.md)
