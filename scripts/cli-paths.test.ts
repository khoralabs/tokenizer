import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tokenizerScript = path.resolve(import.meta.dir, "tokenizer.ts");
const tokenizeScript = path.resolve(import.meta.dir, "tokenize.ts");

function writeDefaultConfig(tmpDir: string): void {
  writeFileSync(
    path.join(tmpDir, "tkn.config.json"),
    JSON.stringify({ lattice: { backend: "sqlite", path: ".tkn/lattice.db" } }),
  );
}

describe("CLI path resolution", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir !== undefined && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  test("tokenizer ingest resolves --db relative to caller cwd", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-cli-"));
    writeDefaultConfig(tmpDir);
    writeFileSync(path.join(tmpDir, "sample.txt"), "hello world hello world ");

    const proc = Bun.spawn(
      ["bun", tokenizerScript, "ingest", "-f", "*.txt", "--db", "data/lattice.db"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(existsSync(path.join(tmpDir, "data", "lattice.db"))).toBe(true);
  });

  test("tokenize resolves --file and --db relative to caller cwd", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tkn-cli-"));
    writeDefaultConfig(tmpDir);
    writeFileSync(path.join(tmpDir, "sample.txt"), "hello world hello world ");
    writeFileSync(path.join(tmpDir, "input.txt"), "hello");

    const ingest = Bun.spawn(
      ["bun", tokenizerScript, "ingest", "-f", "*.txt", "--db", "data/lattice.db"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" },
    );
    expect(await ingest.exited).toBe(0);

    const tokenize = Bun.spawn(
      ["bun", tokenizeScript, "--file", "input.txt", "--db", "data/lattice.db"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(tokenize.stdout).text();
    const exitCode = await tokenize.exited;
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBeTruthy();
  });
});
