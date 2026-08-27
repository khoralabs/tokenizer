# Algorithm

Mechanics of segmentation, lattice updates, and decoding.

## LZ gate segmentation

The sequencer maintains a dictionary of seen prefixes and a buffer for the current sequence.

For each input item:

1. Form `extended` as the current pattern plus the new item.
2. If the dictionary contains `extended`, keep growing. Update the pattern and add the item to the buffer.
3. If the dictionary does not contain `extended`, emit the buffer as a segment. Add `extended` to the dictionary. Reset the buffer to the new item.

Segmentation is greedy and single-pass. The gate returns `true` from `evaluate()` while the extended prefix is known.

## Discrete tokens and host symbols

Each `push()` or generator yield accepts one `SequencerInput` string. A string can be one logical token (for example `svc:api`) or one character. Character-by-character feed is a convention in text helpers, not a library constraint.

Hosts map domain objects to stable strings before feed. Delimiters and sentinels are host-defined. The library stores strings and builds graph nodes from ingested segment keys and sequence elements.

See [Custom symbol streams](../tutorials/custom-symbol-streams.md) for discrete-token ingest.

## Dictionary

The LZ gate uses an `IDictionary` implementation:

- `Unbounded` — no size limit
- `Bounded` — evicts oldest entries at capacity

`createLZSequencer` accepts `cacheOptions` for bounded, unbounded, or custom dictionary instances.

## Gates

A gate implements `IGate.evaluate(current, previous)`. The return value is `true` to continue the prefix or `false` to segment. `LZGate` uses dictionary membership. Custom gates can apply other rules.

## Sentinels

Input may include sentinel markers in the form `<number>`. Sentinels participate in the sequence and key like other input items.

## Queue and emission

When a gate signals segmentation, the sequencer pushes `{ key, sequence }` to the queue. Consumers read outputs through `read()`. Call `await flush()` to emit the remaining buffer at end of input.

## Lattice ingest

Each emitted segment becomes a `LatticeSegment`:

```typescript
{ key: string; sequence: string[] }
```

`ingest` stores the pattern in the vocabulary and updates emission counts in the graph. `merge` records weighted transitions between consecutive pattern keys from a feed batch.

`commitFeedBatch` performs ingest and merge in one storage transaction.

## Language model

Decode scores use:

- **Unigram emissions** — add-k smoothed log-probability from pattern emission counts
- **Bigram transitions** — normalized log-probability from outgoing edge weights

`buildLmTables(tokenCounts, edges)` constructs score functions from maps. Backends precompute these during `compile()`.

## Pattern matching

`ICompiledLattice.scan(text)` runs Aho-Corasick over the vocabulary. The result is match candidates `{ pattern, length }` at each offset.

## Decode search

The decoder builds a layered graph over input positions. At each offset it considers candidates from `scan()`. It accumulates emission and transition log-scores.

| Mode | Behavior |
|------|----------|
| `viterbi` | Default. Retains the best path per layer. |
| `beam` | Retains up to `beamWidth` hypotheses per layer. |

Backtracking yields the token string sequence.

## Hub scoring

`getTopTokens(limit)` ranks vocabulary patterns by hub score. SQLite, Turso, and memory backends use degree-based scorers by default.

## Unicode input

`Unicode.toCodepoints`, `Unicode.toString`, `Unicode.streamFile`, and `Unicode.streamGlob` support NFC-normalized character streaming for file ingest.
