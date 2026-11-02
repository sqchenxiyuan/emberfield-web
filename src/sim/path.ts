import { SIZE } from './types';
// Reused search storage. One simulation worker owns this instance.
export class Pathfinder {
  blocked = new Uint8Array(SIZE * SIZE);
  private g = new Float32Array(SIZE * SIZE);
  private parent = new Int32Array(SIZE * SIZE);
  private seen = new Uint32Array(SIZE * SIZE);
  private closed = new Uint32Array(SIZE * SIZE);
  private stamp = 0;
  find(sx: number, sy: number, tx: number, ty: number, radius = 0): number[] | null {
    sx = Math.round(sx);
    sy = Math.round(sy);
    tx = Math.round(tx);
    ty = Math.round(ty);
    if (tx < 0 || ty < 0 || tx >= SIZE || ty >= SIZE) return null;
    const start = sy * SIZE + sx;
    const h = (i: number) =>
      Math.max(0, Math.abs((i % SIZE) - tx) + Math.abs(Math.floor(i / SIZE) - ty) - radius);
    if (h(start) === 0) return [];
    this.stamp++;
    const mark = this.stamp;
    const heap: { i: number; f: number }[] = [];
    const push = (i: number, f: number) => {
      heap.push({ i, f });
      let n = heap.length - 1;
      while (n > 0) {
        const p = (n - 1) >> 1;
        if (heap[p].f <= f) break;
        heap[n] = heap[p];
        n = p;
      }
      heap[n] = { i, f };
    };
    const pop = () => {
      const top = heap[0];
      const end = heap.pop()!;
      if (heap.length) {
        let n = 0;
        while (n * 2 + 1 < heap.length) {
          let c = n * 2 + 1;
          if (c + 1 < heap.length && heap[c + 1].f < heap[c].f) c++;
          if (heap[c].f >= end.f) break;
          heap[n] = heap[c];
          n = c;
        }
        heap[n] = end;
      }
      return top.i;
    };
    this.g[start] = 0;
    this.seen[start] = mark;
    this.parent[start] = -1;
    push(start, h(start));
    let count = 0;
    while (heap.length && count++ < SIZE * SIZE * 2) {
      const i = pop();
      if (this.closed[i] === mark) continue;
      this.closed[i] = mark;
      if (h(i) === 0) {
        const out: number[] = [];
        let n = i;
        while (n !== start) {
          out.push(n);
          n = this.parent[n];
        }
        return out.reverse();
      }
      const x = i % SIZE,
        y = Math.floor(i / SIZE);
      for (const n of [
        x > 0 ? i - 1 : -1,
        x < SIZE - 1 ? i + 1 : -1,
        y > 0 ? i - SIZE : -1,
        y < SIZE - 1 ? i + SIZE : -1,
      ]) {
        if (n < 0 || this.blocked[n] || this.closed[n] === mark) continue;
        const g = this.g[i] + 1;
        if (this.seen[n] !== mark || g < this.g[n]) {
          this.seen[n] = mark;
          this.g[n] = g;
          this.parent[n] = i;
          push(n, g + h(n));
        }
      }
    }
    return null;
  }
}
