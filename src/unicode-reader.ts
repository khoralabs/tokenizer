import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Convert a text string into an array of Unicode codepoints
 * Each codepoint is a number that represents one logical character
 */
export function toCodepoints(text: string): number[] {
  const codepoints: number[] = [];
  for (let i = 0; i < text.length; i++) {
    codepoints.push(
      text[i]?.codePointAt(0) ??
        (() => {
          throw new Error("Out of range");
        })(),
    );
  }
  return codepoints;
}

/**
 * Convert an array of Unicode codepoints back to a string
 */
export function codepointsToString(codepoints: number[]): string {
  return String.fromCodePoint(...codepoints);
}

/**
 * Stream a file, character by character, normalizing the text to NFC
 */
export async function* streamUnicodeFile(file: Bun.BunFile | File) {
  const textStream = file.stream().pipeThrough(new TextDecoderStream());
  const reader = textStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      const text = value.normalize("NFC");
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char !== undefined) yield char;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Stream characters from all files matching a glob pattern (NFC-normalized).
 * If pattern resolves to a single existing file, streams that file directly.
 */
export async function* streamUnicodeGlob(pattern: string, cwd = process.cwd()) {
  const directPath = resolve(cwd, pattern);
  if (existsSync(directPath) && statSync(directPath).isFile()) {
    for await (const char of streamUnicodeFile(Bun.file(directPath))) {
      yield char;
    }
    return;
  }

  const glob = new Bun.Glob(pattern);
  let matched = false;
  for await (const path of glob.scan({ cwd, onlyFiles: true })) {
    matched = true;
    const filePath = path.startsWith("/") ? path : join(cwd, path);
    for await (const char of streamUnicodeFile(Bun.file(filePath))) {
      yield char;
    }
  }

  if (!matched && !hasGlobMeta(pattern)) {
    throw new Error(`No files matched pattern: ${pattern}`);
  }
}

function hasGlobMeta(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern);
}

/** Unicode-aware text reader utilities */
export const Unicode = {
  toCodepoints,
  toString: codepointsToString,
  streamFile: streamUnicodeFile,
  streamGlob: streamUnicodeGlob,
};
