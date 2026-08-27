import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_CONFIG } from "./config.ts";
import { runTopk } from "./run-topk.ts";

describe("runTopk", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir !== undefined && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  test("returns bounded top patterns as json", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-topk-"));
    const dbPath = path.join(tmpDir, "lattice.db");
    writeFileSync(path.join(tmpDir, "sample.txt"), "hello world hello world ");

    const ingest = Bun.spawn(
      [
        "bun",
        path.resolve(import.meta.dir, "../../scripts/tokenizer.ts"),
        "ingest",
        "-f",
        "*.txt",
        "--db",
        dbPath,
      ],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" },
    );
    expect(await ingest.exited).toBe(0);

    const config = {
      ...DEFAULT_CONFIG,
      lattice: { backend: "sqlite" as const, path: dbPath },
    };

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (line?: unknown) => {
      if (typeof line === "string") lines.push(line);
    };
    try {
      await runTopk({ config, limit: 3, format: "json" });
    } finally {
      console.log = originalLog;
    }

    const payload = JSON.parse(lines.join("")) as {
      vocabularySize: number;
      top: { pattern: string; confidence: number }[];
    };
    expect(payload.vocabularySize).toBeGreaterThan(0);
    expect(payload.top.length).toBeLessThanOrEqual(3);
  });

  test("prints human output format", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-topk-"));
    const dbPath = path.join(tmpDir, "lattice.db");
    writeFileSync(path.join(tmpDir, "sample.txt"), "hello world hello world ");

    const ingest = Bun.spawn(
      [
        "bun",
        path.resolve(import.meta.dir, "../../scripts/tokenizer.ts"),
        "ingest",
        "-f",
        "*.txt",
        "--db",
        dbPath,
      ],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" },
    );
    expect(await ingest.exited).toBe(0);

    const config = {
      ...DEFAULT_CONFIG,
      lattice: { backend: "sqlite" as const, path: dbPath },
    };

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (line?: unknown) => {
      if (typeof line === "string") lines.push(line);
    };
    try {
      await runTopk({ config, limit: 2, format: "human" });
    } finally {
      console.log = originalLog;
    }

    expect(lines[0]?.endsWith("patterns")).toBe(true);
    expect(lines.length).toBeGreaterThan(1);
  });

  test("rejects invalid limit", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-topk-"));
    const config = {
      ...DEFAULT_CONFIG,
      lattice: { backend: "sqlite" as const, path: path.join(tmpDir, "missing.db") },
    };
    await expect(runTopk({ config, limit: 0 })).rejects.toThrow(
      /--limit must be a positive number/,
    );
  });

  test("rejects missing database file", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-topk-"));
    const config = {
      ...DEFAULT_CONFIG,
      lattice: { backend: "sqlite" as const, path: path.join(tmpDir, "nope.db") },
    };
    await expect(runTopk({ config })).rejects.toThrow(/Database not found/);
  });

  test("runs against readonly sqlite database file", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-topk-"));
    const dbPath = path.join(tmpDir, "lattice.db");
    writeFileSync(path.join(tmpDir, "sample.txt"), "hello world hello world ");

    const ingest = Bun.spawn(
      [
        "bun",
        path.resolve(import.meta.dir, "../../scripts/tokenizer.ts"),
        "ingest",
        "-f",
        "*.txt",
        "--db",
        dbPath,
      ],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" },
    );
    expect(await ingest.exited).toBe(0);

    const { chmodSync } = await import("node:fs");
    chmodSync(dbPath, 0o444);

    const config = {
      ...DEFAULT_CONFIG,
      lattice: { backend: "sqlite" as const, path: dbPath },
    };

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (line?: unknown) => {
      if (typeof line === "string") lines.push(line);
    };
    try {
      await runTopk({ config, limit: 2, format: "json" });
    } finally {
      console.log = originalLog;
      chmodSync(dbPath, 0o644);
    }

    const payload = JSON.parse(lines.join("")) as { vocabularySize: number };
    expect(payload.vocabularySize).toBeGreaterThan(0);
  });
});
