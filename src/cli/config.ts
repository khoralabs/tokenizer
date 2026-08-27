import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Value } from "typebox/value";
import {
  type TknConfig,
  type TknConfigFile,
  TknConfigFileSchema,
  TknConfigSchema,
} from "./config.schema.ts";

export const DEFAULT_CONFIG: TknConfig = {
  lattice: { backend: "sqlite", path: ".tkn/lattice.db" },
  ingest: { dictMax: 10_000 },
  decode: { decoder: "viterbi", beamWidth: 32 },
  output: { topK: 5 },
};

export type LoadConfigOptions = {
  cwd?: string;
  configPath?: string;
};

export type LoadedConfig = TknConfig & {
  /** Absolute path to the config file used, if any was read. */
  configFile?: string;
};

type ResolvedConfigPath = {
  path: string;
  explicit: boolean;
};

function resolveConfigPath(cwd: string, explicitPath?: string): ResolvedConfigPath {
  if (explicitPath !== undefined) {
    return { path: resolve(cwd, explicitPath), explicit: true };
  }
  const envPath = process.env.TKN_CONFIG;
  if (envPath !== undefined && envPath.length > 0) {
    return { path: resolve(cwd, envPath), explicit: true };
  }
  return { path: resolve(cwd, "tkn.config.json"), explicit: false };
}

function mergeFileConfig(file: TknConfigFile): TknConfig {
  return {
    lattice: { ...DEFAULT_CONFIG.lattice, ...file.lattice },
    ingest: { ...DEFAULT_CONFIG.ingest, ...file.ingest },
    decode: { ...DEFAULT_CONFIG.decode, ...file.decode },
    output: { ...DEFAULT_CONFIG.output, ...file.output },
  };
}

function parseConfigFile(parsed: unknown, configFile: string): TknConfigFile {
  if (!Value.Check(TknConfigFileSchema, parsed)) {
    const errors = [...Value.Errors(TknConfigFileSchema, parsed)];
    const detail = errors.map((e) => `${e.instancePath}: ${e.message}`).join("; ");
    throw new Error(`${configFile}: invalid config: ${detail}`);
  }
  return Value.Parse(TknConfigFileSchema, parsed);
}

function resolveLatticePath(cwd: string, config: TknConfig): TknConfig {
  return {
    ...config,
    lattice: {
      ...config.lattice,
      path: resolve(cwd, config.lattice.path),
    },
  };
}

function validateConfig(config: TknConfig, configFile?: string): TknConfig {
  if (!Value.Check(TknConfigSchema, config)) {
    const errors = [...Value.Errors(TknConfigSchema, config)];
    const detail = errors.map((e) => `${e.instancePath}: ${e.message}`).join("; ");
    const prefix = configFile !== undefined ? `${configFile}: ` : "";
    throw new Error(`${prefix}invalid config: ${detail}`);
  }
  return config;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const cwd = options.cwd ?? process.cwd();
  const { path: configPath, explicit } = resolveConfigPath(cwd, options.configPath);

  if (!existsSync(configPath)) {
    if (explicit) {
      throw new Error(`config file not found: ${configPath}`);
    }
    return resolveLatticePath(cwd, { ...DEFAULT_CONFIG });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${configPath}: failed to read config: ${message}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${configPath}: invalid config: root must be an object`);
  }

  const fileConfig = parseConfigFile(parsed, configPath);
  const merged = mergeFileConfig(fileConfig);
  const validated = validateConfig(merged, configPath);
  const resolved = resolveLatticePath(cwd, validated);

  return { ...resolved, configFile: configPath };
}

export function applyDbOverride(
  config: TknConfig,
  dbPath: string | undefined,
  cwd: string,
): TknConfig {
  if (dbPath === undefined) return config;
  return {
    ...config,
    lattice: { ...config.lattice, path: resolve(cwd, dbPath) },
  };
}
