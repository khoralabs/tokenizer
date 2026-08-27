import Type, { type Static } from "typebox";

const positiveInteger = Type.Integer({ exclusiveMinimum: 0 });

export const LatticeBackendSchema = Type.Union([Type.Literal("sqlite"), Type.Literal("turso")]);

export const LatticeConfigSchema = Type.Object({
  backend: LatticeBackendSchema,
  path: Type.String({ minLength: 1 }),
});

export const IngestConfigSchema = Type.Object({
  dictMax: positiveInteger,
});

export const DecodeConfigSchema = Type.Object({
  decoder: Type.Union([Type.Literal("viterbi"), Type.Literal("beam")]),
  beamWidth: positiveInteger,
});

export const OutputConfigSchema = Type.Object({
  topK: Type.Integer({ exclusiveMinimum: 0, maximum: 100 }),
});

export const TknConfigSchema = Type.Object({
  lattice: LatticeConfigSchema,
  ingest: IngestConfigSchema,
  decode: DecodeConfigSchema,
  output: OutputConfigSchema,
});

/** Partial config as stored in tkn.config.json (unknown keys rejected). */
export const TknConfigFileSchema = Type.Object(
  {
    lattice: Type.Optional(Type.Partial(LatticeConfigSchema)),
    ingest: Type.Optional(Type.Partial(IngestConfigSchema)),
    decode: Type.Optional(Type.Partial(DecodeConfigSchema)),
    output: Type.Optional(Type.Partial(OutputConfigSchema)),
  },
  { additionalProperties: false },
);

export type TknConfigFile = Static<typeof TknConfigFileSchema>;

export type LatticeBackend = Static<typeof LatticeBackendSchema>;
export type LatticeConfig = Static<typeof LatticeConfigSchema>;
export type IngestConfig = Static<typeof IngestConfigSchema>;
export type DecodeConfig = Static<typeof DecodeConfigSchema>;
export type OutputConfig = Static<typeof OutputConfigSchema>;
export type TknConfig = Static<typeof TknConfigSchema>;
