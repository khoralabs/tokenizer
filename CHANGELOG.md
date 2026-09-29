# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Opaque feed **atoms** as trie and Aho-Corasick edge labels (`Atom`, `atomsFromText`, `joinAtoms`, `splitAtoms`)
- Convenience atom feeds: `feedCharacters`, `feedBytes`, `feedSymbols`
- Configurable `atomDelimiter` on `Sequencer` / `createLZSequencer` for multi-atom pattern keys
- Indexed decode: `decodeIndexed` / `decodeIndexedAsync`, `DecodeResult` / `DecodeStep`, text adapters `decodeDetailed` / `decodeDetailedAsync`
- `ICompiledLattice.patterns`, `scanAtoms`, and `LmCompileOptions.smoothing` on `compile()`
- Decode option `useBigram` to disable transition scores
- Docs for atom feeds, delimiters, and symbol-stream decode ([API](docs/reference/api.md), [Decode a symbol stream](docs/how-to/decode-symbol-stream.md))

### Changed

- Trie / Aho-Corasick ingest and scan follow feed atom edges; `MatchCandidate.length` is an atom count

## [0.1.1] - 2026-09-28

### Fixed

- Reject invalid `beamWidth` and cover empty-vocabulary decode
- Use source-specific totals for unseen bigram transitions
- Clear sequencer candidates on `flush`; add `endSequence`

## [0.1.0] - 2026-08-27

### Added

- Initial public release of `@khoralabs/tkn` (LZ sequencer, lattice backends, Viterbi/beam decode, CLI)

[unreleased]: https://github.com/khoralabs/tokenizer/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/khoralabs/tokenizer/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/khoralabs/tokenizer/releases/tag/v0.1.0
