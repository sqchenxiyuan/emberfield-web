/** Reusable, bounded weighted graph search. */
// The heuristic must be consistent; use zero for a set of destinations (Dijkstra).
// Stable discovery order breaks ties, so identical worlds choose identical routes.
export class WeightedNavigation {
  private costs: Float64Array;
  private estimates: Float64Array;
  private parents: Int32Array;
  private stamps: Uint32Array;
  private slots: Int32Array;
  private order: Uint32Array;
  private heap: Int32Array;
  private epoch = 0;
  private size = 0;
  private serial = 0;

  constructor(readonly capacity: number) {
    this.costs = new Float64Array(capacity);
    this.estimates = new Float64Array(capacity);
    this.parents = new Int32Array(capacity);
    this.stamps = new Uint32Array(capacity);
    this.slots = new Int32Array(capacity);
    this.order = new Uint32Array(capacity);
    this.heap = new Int32Array(capacity);
  }
  get byteLength() {
    return this.costs.byteLength + this.estimates.byteLength + this.parents.byteLength +
      this.stamps.byteLength + this.slots.byteLength + this.order.byteLength + this.heap.byteLength;
  }
  private before(a: number, b: number) {
    return this.estimates[a] < this.estimates[b] ||
      (this.estimates[a] === this.estimates[b] && this.order[a] < this.order[b]);
  }
  private up(slot: number) {
    const cell = this.heap[slot];
    while (slot > 0) {
      const parent = (slot - 1) >>> 1, other = this.heap[parent];
      if (!this.before(cell, other)) break;
      this.heap[slot] = other; this.slots[other] = slot; slot = parent;
    }
    this.heap[slot] = cell; this.slots[cell] = slot;
  }
  private pop() {
    const cell = this.heap[0], last = this.heap[--this.size];
    this.slots[cell] = -1;
    if (this.size) {
      let slot = 0;
      while (slot * 2 + 1 < this.size) {
        let child = slot * 2 + 1;
        if (child + 1 < this.size && this.before(this.heap[child + 1], this.heap[child])) child++;
        if (!this.before(this.heap[child], last)) break;
        this.heap[slot] = this.heap[child]; this.slots[this.heap[slot]] = slot; slot = child;
      }
      this.heap[slot] = last; this.slots[last] = slot;
    }
    return cell;
  }
  find(start: number, isGoal: (cell: number) => boolean, neighbors: (cell: number) => number[],
    edgeCost: (from: number, to: number) => number, heuristic: (cell: number) => number = () => 0): number[] | null {
    if (!Number.isInteger(start) || start < 0 || start >= this.capacity) return null;
    if (++this.epoch === 0x100000000) { this.stamps.fill(0); this.epoch = 1; }
    this.size = 1; this.serial = 1;
    this.heap[0] = start; this.slots[start] = 0; this.stamps[start] = this.epoch;
    this.costs[start] = 0; this.estimates[start] = heuristic(start); this.parents[start] = -1; this.order[start] = 0;
    while (this.size) {
      const cell = this.pop();
      if (isGoal(cell)) {
        const path: number[] = [];
        for (let n = cell; this.parents[n] !== -1; n = this.parents[n]) path.push(n);
        return path.reverse();
      }
      for (const next of neighbors(cell)) {
        if (!Number.isInteger(next) || next < 0 || next >= this.capacity) continue;
        const cost = edgeCost(cell, next);
        if (!(cost > 0) || !Number.isFinite(cost)) continue;
        const total = this.costs[cell] + cost, seen = this.stamps[next] === this.epoch;
        if (seen && total >= this.costs[next]) continue;
        this.costs[next] = total; this.estimates[next] = total + heuristic(next); this.parents[next] = cell;
        if (!seen || this.slots[next] < 0) {
          this.stamps[next] = this.epoch; this.order[next] = this.serial++;
          this.slots[next] = this.size; this.heap[this.size++] = next;
        }
        this.up(this.slots[next]);
      }
    }
    return null;
  }
}
