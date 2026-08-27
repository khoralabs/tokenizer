import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function getPackageVersion(): string {
  const pkgPath = resolve(import.meta.dir, "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}
