# Ingest pre-segmented patterns

Write `LatticeSegment` values into a lattice without running the sequencer or LZ gate.

## When to use

Segmentation happens outside tkn: trace parser, cycle detector, or another gate whose output you consume directly.

## Prerequisites

- Segments as `{ key: string; sequence: string[] }`
- Optional transition pairs `[from, to, weight?]`
- See [Log traces and symbol registries](../tutorials/log-traces-and-symbol-registries.md) for a full walkthrough

## Steps with `pipe`

1. Build segments:

```typescript
import type { LatticeSegment } from "@khoralabs/tkn";

const segments: LatticeSegment[] = [
  { key: "trace:abc", sequence: ["svc:payments", "lvl:err", "<0>"] },
  { key: "trace:def", sequence: ["svc:api", "lvl:warn", "<0>"] },
];
```

2. Yield from an async generator and call `pipe`:

```typescript
import { Lattice } from "@khoralabs/tkn/memory";

async function* source() {
  for (const seg of segments) yield seg;
}

const lattice = new Lattice();
await lattice.pipe(source());
```

3. Verify:

```typescript
console.log(lattice.getNext("trace:abc"));
lattice.close();
```

**Outcome:** `getNext("trace:abc")` includes `{ to: "trace:def", weight: 1 }` when segments were yielded in that order.

## Batched ingest and merge

```typescript
lattice.commitFeedBatch(
  [
    { key: "a", sequence: ["x", "<0>"] },
    { key: "b", sequence: ["y", "<0>"] },
  ],
  [
    ["a", "b", 2],
  ],
);
```

## Direct ingest and merge

```typescript
lattice.ingest({ key: "a", sequence: ["x"] });
lattice.ingest({ key: "b", sequence: ["y"] });
lattice.merge([["a", "b"]]);
```

Use `ingestBatch` for many segments without transitions in one call.

## After ingest

Call `invalidateCompiled()` before `tokenize()` if the lattice was previously compiled and you added more data.

## Related

- [Ingest a custom token stream](ingest-custom-token-stream.md)
- [API reference](../reference/api.md) — `ILattice` methods
