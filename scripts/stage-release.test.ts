import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { stageRelease } from "./stage-release.ts";

describe("stageRelease", () => {
  let releaseDir: string | undefined;

  afterEach(() => {
    if (releaseDir !== undefined && existsSync(releaseDir)) {
      rmSync(releaseDir, { recursive: true, force: true });
      releaseDir = undefined;
    }
  });

  test("stages src, scripts, and publishable package.json", async () => {
    const workspaceRoot = path.resolve(import.meta.dir, "..");
    releaseDir = mkdtempSync(path.join(os.tmpdir(), "tkn-stage-"));
    const result = await stageRelease({
      workspaceRoot,
      version: "0.0.0-test",
      releaseDir,
    });
    expect(result.releaseDir).toBe(releaseDir);
    expect(existsSync(path.join(result.releaseDir, "src", "index.ts"))).toBe(true);
    expect(existsSync(path.join(result.releaseDir, "scripts", "tokenizer.ts"))).toBe(true);
    expect(existsSync(path.join(result.releaseDir, "scripts", "tokenize.ts"))).toBe(true);
    expect(existsSync(path.join(result.releaseDir, "scripts", "stage-release.test.ts"))).toBe(
      false,
    );
    expect(existsSync(path.join(result.releaseDir, "scripts", "context.ts"))).toBe(false);
    expect(existsSync(path.join(result.releaseDir, "LICENSE"))).toBe(true);

    const pkg = JSON.parse(await Bun.file(path.join(result.releaseDir, "package.json")).text()) as {
      version: string;
      private?: boolean;
      bin?: { tokenizer?: string; tokenize?: string };
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      scripts?: unknown;
      devDependencies?: unknown;
    };
    expect(pkg.version).toBe("0.0.0-test");
    expect(pkg.private).toBeUndefined();
    expect(pkg.bin?.tokenizer).toBe("./scripts/tokenizer.ts");
    expect(pkg.bin?.tokenize).toBe("./scripts/tokenize.ts");
    expect(pkg.dependencies?.typebox).toBeDefined();
    expect(pkg.peerDependencies?.typescript).toBeDefined();
    expect(pkg.dependencies?.typescript).toBeUndefined();
    expect(pkg.scripts).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
  });
});
