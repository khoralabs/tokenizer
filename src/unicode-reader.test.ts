import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codepointsToString,
  streamUnicodeFile,
  streamUnicodeGlob,
  toCodepoints,
  Unicode,
} from "./unicode-reader";

describe("unicode-reader", () => {
  test("toCodepoints and codepointsToString round-trip ascii", () => {
    expect(toCodepoints("hello")).toEqual([104, 101, 108, 108, 111]);
    expect(codepointsToString([104, 101, 108, 108, 111])).toBe("hello");
  });

  test("Unicode namespace mirrors standalone helpers", () => {
    expect(Unicode.toCodepoints("hi")).toEqual(toCodepoints("hi"));
    expect(Unicode.toString([104, 105])).toBe("hi");
  });

  test("streamUnicodeFile yields NFC-normalized characters", async () => {
    const file = new File(["caf\u0301"], "test.txt", { type: "text/plain" });
    const chars = [];
    for await (const char of streamUnicodeFile(file)) chars.push(char);
    expect(chars.join("")).toBe("caf\u0301".normalize("NFC"));
  });

  test("streamUnicodeGlob streams a direct file path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "unicode-reader-"));
    const path = join(dir, "direct.txt");
    await writeFile(path, "abc");
    const chars = [];
    for await (const char of streamUnicodeGlob(path)) chars.push(char);
    expect(chars.join("")).toBe("abc");
  });
});
