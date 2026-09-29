import type { Atom, TerminalEntry } from "./atom";
import { assertNonEmptyAtoms } from "./atom";
import type { MatchCandidate } from "./tokenize";

type Output = { pattern: string; length: number };

type Node = {
  next: Map<Atom, number>;
  fail: number;
  output: Output[];
};

/** Multi-pattern matcher over opaque atoms (one scan → matches by start offset). */
export class AhoCorasick {
  private nodes: Node[] = [];

  constructor(entries: Iterable<TerminalEntry>) {
    this.nodes.push({ next: new Map(), fail: 0, output: [] });
    for (const entry of entries) {
      if (entry.atoms.length === 0 || entry.pattern.length === 0) continue;
      this.insert(entry.pattern, entry.atoms);
    }
    this.buildFailures();
  }

  /** All trie-valid tokens starting at each source-atom offset. */
  matchStarts(source: readonly Atom[]): MatchCandidate[][] {
    const n = source.length;
    const byStart: MatchCandidate[][] = Array.from({ length: n }, () => []);
    let state = 0;

    for (let end = 0; end < n; end++) {
      const atom = source[end];
      if (atom === undefined) break;

      state = this.go(state, atom);
      this.collectOutputs(state, end, byStart);
    }

    return byStart;
  }

  private insert(pattern: string, atoms: readonly Atom[]): void {
    assertNonEmptyAtoms(atoms);
    let state = 0;
    for (const atom of atoms) {
      let next = this.nodes[state]?.next.get(atom);
      if (next === undefined) {
        next = this.nodes.length;
        this.nodes.push({ next: new Map(), fail: 0, output: [] });
        this.nodes[state]?.next.set(atom, next);
      }
      state = next;
    }

    this.nodes[state]?.output.push({ pattern, length: atoms.length });
  }

  private buildFailures(): void {
    const queue: number[] = [];
    const root = this.nodes[0];
    if (!root) return;

    for (const child of root.next.values()) {
      const childNode = this.nodes[child];
      if (!childNode) continue;
      childNode.fail = 0;
      queue.push(child);
    }

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;

      const currentNode = this.nodes[current];
      if (!currentNode) continue;

      for (const [atom, child] of currentNode.next) {
        queue.push(child);

        const childNode = this.nodes[child];
        if (!childNode) continue;

        let fail = currentNode.fail;
        while (fail !== 0) {
          const failNode = this.nodes[fail];
          if (!failNode || failNode.next.has(atom)) break;
          fail = failNode.fail;
        }

        const failNode = this.nodes[fail];
        const nextFail = failNode?.next.get(atom) ?? 0;
        childNode.fail = nextFail;

        const inherited = this.nodes[nextFail]?.output ?? [];
        if (inherited.length > 0) {
          childNode.output.push(...inherited);
        }
      }
    }
  }

  private go(state: number, atom: Atom): number {
    let current = state;
    while (current !== 0) {
      const node = this.nodes[current];
      if (!node || node.next.has(atom)) break;
      current = node.fail;
    }
    return this.nodes[current]?.next.get(atom) ?? 0;
  }

  private collectOutputs(state: number, end: number, byStart: MatchCandidate[][]): void {
    const outputs = this.nodes[state]?.output;
    if (!outputs || outputs.length === 0) return;

    for (const { pattern, length } of outputs) {
      const start = end - length + 1;
      if (start < 0) continue;
      byStart[start]?.push({ pattern, length });
    }
  }
}
