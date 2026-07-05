#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { minimatch } from "minimatch";
import parse from "parse-gitignore";

/**
 * Find the project root by looking for bun.lock or .git directory
 */
function findProjectRoot(startDir: string = process.cwd()): string {
  let currentDir = resolve(startDir);

  while (currentDir !== resolve(currentDir, "..")) {
    // Check for bun.lock or .git directory
    if (
      existsSync(join(currentDir, "bun.lock")) ||
      existsSync(join(currentDir, "package-lock.json")) ||
      existsSync(join(currentDir, "pnpm-lock.yaml")) ||
      existsSync(join(currentDir, "poetry.lock")) ||
      existsSync(join(currentDir, "Gemfile.lock")) ||
      existsSync(join(currentDir, "go.sum")) ||
      existsSync(join(currentDir, "Cargo.lock")) ||
      existsSync(join(currentDir, "composer.lock")) ||
      existsSync(join(currentDir, "bun.lockb")) ||
      existsSync(join(currentDir, ".git"))
    ) {
      return currentDir;
    }
    currentDir = resolve(currentDir, "..");
  }

  // If no project root found, return the original directory
  return resolve(startDir);
}

interface GitignorePatterns {
  patterns: string[];
}

interface CollectOptions {
  targetDir?: string;
  outputDir?: string;
  includeHidden?: boolean;
  verbose?: boolean;
}

type MatchResult = "ignore" | "unignore" | "none";

class GitignoreFilter {
  private patterns: string[] = [];
  private negativePatterns: string[] = [];

  constructor(gitignoreContent: string) {
    const parsed = parse(gitignoreContent) as unknown as GitignorePatterns;

    for (const pattern of parsed.patterns) {
      if (pattern.startsWith("!")) {
        this.negativePatterns.push(this.normalizePattern(pattern.slice(1)));
      } else {
        this.patterns.push(this.normalizePattern(pattern));
      }
    }
  }

  private normalizePattern(pattern: string): string {
    let normalized = pattern;

    // If pattern doesn't start with / and doesn't contain /, it should match at any level
    if (!normalized.startsWith("/") && !normalized.includes("/")) {
      normalized = `**/${normalized}`;
    }

    // If pattern ends with /, it matches directories
    if (normalized.endsWith("/")) {
      normalized = `${normalized}**`;
    }

    // Remove leading slash (we're working with relative paths)
    if (normalized.startsWith("/")) {
      normalized = normalized.slice(1);
    }

    return normalized;
  }

  /**
   * Match a path (relative to the gitignore's directory).
   * Returns 'ignore', 'unignore', or 'none' if no rule applies.
   */
  match(filePath: string): MatchResult {
    const normalizedPath = filePath.replace(/\\/g, "/");

    let result: MatchResult = "none";
    for (const pattern of this.patterns) {
      if (minimatch(normalizedPath, pattern, { dot: true })) {
        result = "ignore";
        break;
      }
    }

    for (const pattern of this.negativePatterns) {
      if (minimatch(normalizedPath, pattern, { dot: true })) {
        result = "unignore";
        break;
      }
    }

    return result;
  }
}

interface ScopedFilter {
  baseDir: string;
  filter: GitignoreFilter;
}

class ContextCollector {
  private ancestorFilters: ScopedFilter[] = [];
  private gitRoot: string | null = null;
  private lockfileNames = new Set([
    "package-lock.json",
    "pnpm-lock.yaml",
    "go.sum",
    "npm-shrinkwrap.json",
  ]);

  private ignoredExtensions = [
    // Images
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".bmp",
    ".tiff",
    ".tif",
    ".avif",
    ".heic",
    ".heif",
    // Fonts
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
    // Archives
    ".zip",
    ".gz",
    ".tar",
    ".tar.gz",
    ".bz2",
    ".xz",
    ".7z",
    ".rar",
    // Compiled / binary
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".bin",
    ".wasm",
    ".o",
    ".obj",
    ".a",
    ".pyc",
    ".pyo",
    ".class",
    // Media
    ".mp3",
    ".mp4",
    ".wav",
    ".avi",
    ".mov",
    ".webm",
    ".ogg",
    ".flac",
    ".mkv",
    // Binary documents
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    // Packages / disk images
    ".deb",
    ".rpm",
    ".dmg",
    ".pkg",
    ".sqlite",
    ".db",
  ];

  constructor(private options: CollectOptions = {}) {}

  async initialize(targetDir: string): Promise<void> {
    // Walk up from targetDir collecting ancestor .gitignore files (outermost first).
    let currentDir = resolve(targetDir);
    const ancestors: ScopedFilter[] = [];

    while (currentDir !== resolve(currentDir, "..")) {
      const filter = await this.loadGitignore(currentDir);
      if (filter) {
        ancestors.unshift({ baseDir: currentDir, filter });
        this.gitRoot = currentDir;
        if (this.options.verbose) {
          console.log(`✅ Loaded .gitignore from: ${join(currentDir, ".gitignore")}`);
        }
      }
      currentDir = resolve(currentDir, "..");
    }

    this.ancestorFilters = ancestors;
    if (this.options.verbose && this.gitRoot) {
      console.log(`🎯 Git root determined as: ${this.gitRoot}`);
    }
  }

  private async loadGitignore(dir: string): Promise<GitignoreFilter | null> {
    const gitignorePath = join(dir, ".gitignore");
    if (!existsSync(gitignorePath)) return null;
    try {
      const content = await readFile(gitignorePath, "utf-8");
      return new GitignoreFilter(content);
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`⚠️  Failed to load .gitignore from ${gitignorePath}:`, error);
      }
      return null;
    }
  }

  private isLockfile(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    if (this.lockfileNames.has(lower)) return true;
    return lower.endsWith(".lock") || lower.endsWith(".lockb");
  }

  private isBinaryOrImageFile(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    return this.ignoredExtensions.some((ext) => lower.endsWith(ext));
  }

  private shouldIgnoreFile(
    fullPath: string,
    fileName: string,
    isDir: boolean,
    filterStack: ScopedFilter[],
  ): boolean {
    // Always ignore lockfiles
    if (!isDir && this.isLockfile(fileName)) {
      return true;
    }

    // Always ignore image and binary files
    if (!isDir && this.isBinaryOrImageFile(fileName)) {
      return true;
    }

    // Always ignore the .git directory itself
    if (isDir && fileName === ".git") return true;

    if (filterStack.length > 0) {
      // Apply filters from outermost to innermost; later (more specific) wins.
      let result: MatchResult = "none";
      const candidate = isDir ? `${fullPath}/` : fullPath;
      for (const { baseDir, filter } of filterStack) {
        const rel = relative(baseDir, candidate).replace(/\\/g, "/");
        // Skip if path is not under this filter's baseDir
        if (rel.startsWith("..")) continue;
        const m = filter.match(rel);
        if (m !== "none") result = m;
      }
      if (result !== "none") return result === "ignore";
    }

    // Fallback to basic patterns if no gitignore matched
    const basicIgnorePatterns = [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".cache",
      ".next",
      "coverage",
      ".idea",
      ".vscode",
    ];
    if (isDir && basicIgnorePatterns.includes(fileName)) return true;
    if (
      !isDir &&
      (fileName.endsWith(".log") || fileName === ".DS_Store" || fileName.startsWith(".env"))
    ) {
      return true;
    }

    return false;
  }

  private async getAllFiles(
    dir: string,
    baseDir: string,
    parentStack: ScopedFilter[],
  ): Promise<string[]> {
    const files: string[] = [];

    // Check for a .gitignore in this directory and extend the stack.
    const localFilter = await this.loadGitignore(dir);
    const filterStack = localFilter
      ? [...parentStack, { baseDir: dir, filter: localFilter }]
      : parentStack;

    if (localFilter && this.options.verbose) {
      console.log(`✅ Loaded nested .gitignore from: ${join(dir, ".gitignore")}`);
    }

    try {
      const entries = await readdir(dir);

      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const relativePath = relative(baseDir, fullPath);

        // Skip hidden files/directories unless explicitly included
        if (!this.options.includeHidden && entry.startsWith(".")) {
          continue;
        }

        const stats = await stat(fullPath);

        if (stats.isDirectory()) {
          if (!this.shouldIgnoreFile(fullPath, entry, true, filterStack)) {
            const subFiles = await this.getAllFiles(fullPath, baseDir, filterStack);
            files.push(...subFiles);
          }
        } else if (stats.isFile()) {
          if (!this.shouldIgnoreFile(fullPath, entry, false, filterStack)) {
            files.push(relativePath);
          }
        }
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`⚠️  Failed to read directory ${dir}:`, error);
      }
    }

    return files;
  }

  async collect(): Promise<void> {
    // Find and change to project root
    const projectRoot = findProjectRoot();
    const originalCwd = process.cwd();

    if (projectRoot !== originalCwd) {
      process.chdir(projectRoot);
      if (this.options.verbose) {
        console.log(
          `🏠 Changed working directory from ${originalCwd} to project root: ${projectRoot}`,
        );
      }
    } else if (this.options.verbose) {
      console.log(`🏠 Already in project root: ${projectRoot}`);
    }

    const targetDir = resolve(this.options.targetDir || projectRoot);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

    // Create output directory
    const outputDir = this.options.outputDir || join(targetDir, ".llm-context");
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
      console.log(`📁 Created context directory: ${outputDir}`);
    }

    console.log(`🤖 Collecting LLM context from: ${targetDir}`);

    // Initialize gitignore filter
    await this.initialize(targetDir);

    // Get all files
    console.log("📋 Scanning files...");
    const allFiles = await this.getAllFiles(targetDir, targetDir, this.ancestorFilters);

    console.log(`📊 Found ${allFiles.length} files to include`);

    // Create combined file
    const outputFile = join(outputDir, `combined_codebase_${timestamp}.txt`);
    console.log(`📝 Creating combined file: ${outputFile}`);

    let combinedContent = "";
    combinedContent += "# COMBINED CODEBASE CONTEXT\n";
    combinedContent += `# Generated on: ${new Date().toISOString()}\n`;
    combinedContent += `# Target: ${targetDir}\n`;
    combinedContent += `# Files included: ${allFiles.length}\n`;
    combinedContent +=
      "# Note: Files are filtered using .gitignore patterns; lockfiles, images, and binary files are excluded\n";
    combinedContent += "\n";
    combinedContent +=
      "================================================================================\n";
    combinedContent += "\n";

    let processed = 0;
    let skipped = 0;

    for (const file of allFiles.sort()) {
      const fullPath = join(targetDir, file);

      try {
        const content = await readFile(fullPath, "utf-8");

        // Add file header
        combinedContent += "\n";
        combinedContent +=
          "################################################################################\n";
        combinedContent += `# FILE PATH: ${file}\n`;
        combinedContent +=
          "################################################################################\n";
        combinedContent += "\n";

        // Add file contents
        combinedContent += content;

        // Add footer separator
        combinedContent += "\n";
        combinedContent += `# END OF FILE: ${file}\n`;
        combinedContent += "\n";

        processed++;

        if (processed % 50 === 0) {
          console.log(`⏳ Progress: ${processed} files processed`);
        }
      } catch (error) {
        // Skip binary files or files that can't be read as text
        if (this.options.verbose) {
          console.warn(`⚠️  Skipped ${file}: ${error}`);
        }
        skipped++;
      }
    }

    // Write combined file
    await writeFile(outputFile, combinedContent, "utf-8");

    // Calculate file size
    const stats = await stat(outputFile);
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

    console.log("");
    console.log("✅ File collection complete!");
    console.log(`📁 Combined file saved to: ${outputFile}`);
    console.log(`📊 Files processed: ${processed}`);
    console.log(`🚫 Files skipped: ${skipped}`);
    console.log(`📏 Combined file size: ${sizeInMB} MB`);
    console.log("");
    console.log("🎉 LLM context collection complete!");
    console.log("");
    console.log("💡 Usage tips:");
    console.log("   • Upload the combined file to your LLM for codebase analysis");
    console.log("   • Files are automatically filtered using .gitignore patterns");
    console.log("   • Lockfiles and binary files are excluded");
    console.log("   • Each file is clearly marked with its original path");
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options: CollectOptions = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      console.log("Usage: bun run collect-context.ts [options] [directory]");
      console.log("");
      console.log("Options:");
      console.log("  --verbose, -v    Enable verbose output");
      console.log("  --hidden         Include hidden files/directories");
      console.log("  --output, -o     Output directory (default: .llm-context)");
      console.log("  --help, -h       Show this help message");
      console.log("");
      console.log("Examples:");
      console.log("  bun run collect-context.ts");
      console.log("  bun run collect-context.ts /path/to/project");
      console.log("  bun run collect-context.ts --verbose --hidden");
      process.exit(0);
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--hidden") {
      options.includeHidden = true;
    } else if (arg === "--output" || arg === "-o") {
      options.outputDir = args[++i];
    } else if (!arg?.startsWith("-")) {
      options.targetDir = arg;
    }
  }

  const collector = new ContextCollector(options);
  await collector.collect();
}

// Run if called directly
if (import.meta.main) {
  main().catch(console.error);
}
