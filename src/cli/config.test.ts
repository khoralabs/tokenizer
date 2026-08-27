import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_CONFIG, loadConfig } from "./config.ts";

describe("loadConfig", () => {
  let tmpDir: string | undefined;
  let previousTknConfig: string | undefined;

  afterEach(() => {
    if (tmpDir !== undefined && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
    if (previousTknConfig === undefined) {
      delete process.env.TKN_CONFIG;
    } else {
      process.env.TKN_CONFIG = previousTknConfig;
    }
  });

  test("returns defaults when config file is missing", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-config-"));
    const config = await loadConfig({ cwd: tmpDir });
    expect(config.lattice.backend).toBe(DEFAULT_CONFIG.lattice.backend);
    expect(config.lattice.path).toBe(path.join(tmpDir, ".tkn/lattice.db"));
    expect(config.ingest.dictMax).toBe(DEFAULT_CONFIG.ingest.dictMax);
    expect(config.configFile).toBeUndefined();
  });

  test("loads tkn.config.json from cwd", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-config-"));
    const configPath = path.join(tmpDir, "tkn.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        lattice: { backend: "turso", path: "data/custom.db" },
        output: { topK: 3 },
      }),
    );
    const config = await loadConfig({ cwd: tmpDir });
    expect(config.lattice.backend).toBe("turso");
    expect(config.lattice.path).toBe(path.join(tmpDir, "data/custom.db"));
    expect(config.output.topK).toBe(3);
    expect(config.decode.decoder).toBe(DEFAULT_CONFIG.decode.decoder);
    expect(config.configFile).toBe(configPath);
  });

  test("respects TKN_CONFIG env var", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-config-"));
    previousTknConfig = process.env.TKN_CONFIG;
    const customPath = path.join(tmpDir, "custom.config.json");
    writeFileSync(customPath, JSON.stringify({ lattice: { backend: "sqlite", path: "alt.db" } }));
    process.env.TKN_CONFIG = customPath;
    const config = await loadConfig({ cwd: tmpDir });
    expect(config.lattice.path).toBe(path.join(tmpDir, "alt.db"));
    expect(config.configFile).toBe(customPath);
  });

  test("throws on invalid JSON", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-config-"));
    writeFileSync(path.join(tmpDir, "tkn.config.json"), "{ not json");
    await expect(loadConfig({ cwd: tmpDir })).rejects.toThrow(/failed to read config/);
  });

  test("throws when explicit TKN_CONFIG path is missing", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-config-"));
    previousTknConfig = process.env.TKN_CONFIG;
    process.env.TKN_CONFIG = path.join(tmpDir, "missing.config.json");
    await expect(loadConfig({ cwd: tmpDir })).rejects.toThrow(/config file not found/);
  });

  test("throws on invalid section type", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-config-"));
    writeFileSync(path.join(tmpDir, "tkn.config.json"), JSON.stringify({ ingest: "bad" }));
    await expect(loadConfig({ cwd: tmpDir })).rejects.toThrow(/invalid config/);
  });

  test("loads partial lattice.path override", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-config-"));
    writeFileSync(
      path.join(tmpDir, "tkn.config.json"),
      JSON.stringify({ lattice: { path: "custom.db" } }),
    );
    const config = await loadConfig({ cwd: tmpDir });
    expect(config.lattice.path).toBe(path.join(tmpDir, "custom.db"));
    expect(config.lattice.backend).toBe(DEFAULT_CONFIG.lattice.backend);
  });

  test("throws on unknown top-level keys", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-config-"));
    writeFileSync(path.join(tmpDir, "tkn.config.json"), JSON.stringify({ extra: true }));
    await expect(loadConfig({ cwd: tmpDir })).rejects.toThrow(/invalid config/);
  });
});
