# Use from TypeScript

Choose a lattice backend and a sync or async tokenizer helper.

## Backends

| Backend | Import | Constructor | Persistence |
|---------|--------|-------------|-------------|
| Memory | `@khoralabs/tkn/memory` | `new Lattice()` | None |
| Bun SQLite | `@khoralabs/tkn/bun-sqlite` | `new Lattice(config)` | File or `:memory:` |
| Turso | `@khoralabs/tkn/turso` | `await TursoLattice.open(config)` | File or `:memory:` |

Each subpath re-exports the full main API.

### Memory

```typescript
import { Lattice, createLatticeTokenizer } from "@khoralabs/tkn/memory";

const lattice = new Lattice();
const tokenizer = createLatticeTokenizer(lattice);
```

Memory storage uses `PatternVocabulary` and an in-memory graph.

### Bun SQLite

```typescript
import { Lattice } from "@khoralabs/tkn/bun-sqlite";

const lattice = new Lattice({ filename: ".tkn/lattice.db" });
const readonly = new Lattice({ filename: ".tkn/lattice.db", readonly: true });
```

SQLite storage uses a trie plus a graph backed by `bun:sqlite`.

### Turso

```typescript
import { TursoLattice } from "@khoralabs/tkn/turso";

const lattice = await TursoLattice.open({ filename: ".tkn/lattice.db" });
```

Turso implements `IAsyncLattice`. All mutating and read methods return promises where noted in the [API reference](../reference/api.md).

## Sync tokenizer helper

```typescript
import { createLatticeTokenizer } from "@khoralabs/tkn";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";

const tokenizer = createLatticeTokenizer(new Lattice());

await tokenizer.feed(corpus);
tokenizer.tokenize("hello");
tokenizer.vocabulary();
tokenizer.getTopTokens(10);
```

Options:

```typescript
createLatticeTokenizer(lattice, {
  sequencer: customSequencer,
  transitionBatchSize: 1000,
});
```

## Async tokenizer helper

```typescript
import { createAsyncLatticeTokenizer, TursoLattice } from "@khoralabs/tkn/turso";

const lattice = await TursoLattice.open();
const tokenizer = createAsyncLatticeTokenizer(lattice);

await tokenizer.feed(corpus);
await tokenizer.tokenize("hello");
await tokenizer.vocabulary();
await lattice.close();
```

## Custom sequencer dictionary

Pass `cacheOptions` to `createLZSequencer` for a bounded dictionary.

```typescript
import { createLZSequencer } from "@khoralabs/tkn";

const sequencer = createLZSequencer({
  cacheOptions: { bounded: true, max: 10_000 },
  historyOptions: { bounded: true, maxLength: 1000 },
});
```

Pass a custom `IDictionary` instance as `cacheOptions` to supply your own dictionary implementation.

## Custom gates

Implement `IGate` and pass the gate to `Sequencer`.

```typescript
import { Queue, Sequencer, type IGate } from "@khoralabs/tkn";

class LengthGate implements IGate {
  evaluate(current: string, previous: string): boolean {
    return current.length < 8;
  }
  reset() {}
  async snapshot() {
    return { name: "LengthGate", ingested: 0, passRate: 0 };
  }
}

const sequencer = new Sequencer({
  gates: [new LengthGate()],
  queue: new Queue({}),
});
```

For non-text symbol streams (events, logs, sensors), see [Custom symbol streams](../tutorials/custom-symbol-streams.md) and [Ingest a custom token stream](../how-to/ingest-custom-token-stream.md).

## Manual lattice ingest

Write segments and transitions directly.

```typescript
lattice.ingest({ key: "hello", sequence: ["h", "e", "l", "l", "o"] });
lattice.merge([["hello", "world"]]);
```

Use `ingestBatch` or `commitFeedBatch` for batched writes. See [API reference](../reference/api.md).
