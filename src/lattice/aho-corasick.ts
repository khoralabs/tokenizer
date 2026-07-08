import type { MatchCandidate } from "./tokenize";

type Node = {
  next: Map<string, number>;
  fail: number;
  output: string[];
};

/** Multi-pattern matcher for vocabulary terminals (one scan → matches by start offset). */
export class AhoCorasick {
  private nodes: Node[] = [];

  constructor(patterns: Iterable<string>) {
    this.nodes.push({ next: new Map(), fail: 0, output: [] });
    for (const pattern of patterns) {
      if (pattern.length > 0) this.insert(pattern);
    }
    this.buildFailures();
  }

  /** All trie-valid tokens starting at each text offset. */
  matchStarts(text: string): MatchCandidate[][] {
    const n = text.length;
    const byStart: MatchCandidate[][] = Array.from({ length: n }, () => []);
    let state = 0;

    for (let end = 0; end < n; end++) {
      const char = text[end];
      if (char === undefined) break;

      state = this.go(state, char);
      this.collectOutputs(state, end, byStart);
    }

    return byStart;
  }

  private insert(pattern: string): void {
    let state = 0;
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      if (char === undefined) return;

      let next = this.nodes[state]?.next.get(char);
      if (next === undefined) {
        next = this.nodes.length;
        this.nodes.push({ next: new Map(), fail: 0, output: [] });
        this.nodes[state]?.next.set(char, next);
      }
      state = next;
    }

    this.nodes[state]?.output.push(pattern);
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

      for (const [char, child] of currentNode.next) {
        queue.push(child);

        const childNode = this.nodes[child];
        if (!childNode) continue;

        let fail = currentNode.fail;
        while (fail !== 0) {
          const failNode = this.nodes[fail];
          if (!failNode || failNode.next.has(char)) break;
          fail = failNode.fail;
        }

        const failNode = this.nodes[fail];
        const nextFail = failNode?.next.get(char) ?? 0;
        childNode.fail = nextFail;

        const inherited = this.nodes[nextFail]?.output ?? [];
        if (inherited.length > 0) {
          childNode.output.push(...inherited);
        }
      }
    }
  }

  private go(state: number, char: string): number {
    let current = state;
    while (current !== 0) {
      const node = this.nodes[current];
      if (!node || node.next.has(char)) break;
      current = node.fail;
    }
    return this.nodes[current]?.next.get(char) ?? 0;
  }

  private collectOutputs(state: number, end: number, byStart: MatchCandidate[][]): void {
    const outputs = this.nodes[state]?.output;
    if (!outputs || outputs.length === 0) return;

    for (const pattern of outputs) {
      const start = end - pattern.length + 1;
      if (start < 0) continue;
      byStart[start]?.push({ pattern, length: pattern.length });
    }
  }
}
