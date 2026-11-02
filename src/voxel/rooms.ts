import { Block, CELLS, DEPTH, HEIGHT, WIDTH, index, inside, type Pos } from './types';

export interface VoxelRoomSummary {
  readonly id: number;
  readonly outdoor: boolean;
  /** Number of connected air voxels, not horizontal floor area. */
  readonly volume: number;
  /** Supported air foot cells with one air head cell above them. */
  readonly floorCells: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const SLICE = WIDTH * DEPTH;
const UNVISITED = -2;
const SOLID = -1;
const DOOR_FOOT = 1;
const DOOR_HEAD = 2;

/**
 * Cached, six-connected 3D air topology. Rebuild only after structural changes.
 * Furniture/vegetation do not enter this model. Every doorway occupies two cells
 * as a region boundary even when its door is open; thermal exchange belongs to a
 * separate portal model. Air reaching any world outer face is outdoor.
 *
 * IDs are deterministic for an unchanged topology, but can change after a split
 * or merge. Consumers retaining room state must map overlaps between rebuilds.
 * Each rebuild is O(CELLS + doors.length), with doors.length limited to CELLS.
 */
export class VoxelRooms {
  /** Read-only to consumers: -1 means solid/door, nonnegative values index rooms. */
  readonly roomIds = new Int32Array(CELLS).fill(SOLID);
  private readonly queue = new Int32Array(CELLS);
  private readonly doorMask = new Uint8Array(CELLS);
  private rooms: VoxelRoomSummary[] = [];

  /** Fixed owned typed-array bytes; excludes JS summaries and returned snapshots. */
  get memoryBytes() {
    return this.roomIds.byteLength + this.queue.byteLength + this.doorMask.byteLength;
  }

  rebuild(blocks: Uint8Array, doors: readonly Pos[] = []): void {
    if (!(blocks instanceof Uint8Array) || blocks.length !== CELLS) {
      throw new RangeError(`Room topology requires exactly ${CELLS} block cells`);
    }
    if (!Array.isArray(doors) || doors.length > CELLS) {
      throw new RangeError(`Room topology accepts at most ${CELLS} doors`);
    }
    // Validate before touching the previous cache; a doorway needs both cells.
    for (const door of doors) {
      if (!inside(door) || door.z + 1 >= HEIGHT) {
        throw new RangeError('A room doorway must have valid foot and head cells');
      }
    }
    this.doorMask.fill(0);
    for (const door of doors) {
      const foot = index(door.x, door.y, door.z);
      this.doorMask[foot] |= DOOR_FOOT;
      this.doorMask[foot + SLICE] |= DOOR_HEAD;
    }
    for (let cell = 0; cell < CELLS; cell++) {
      this.roomIds[cell] = blocks[cell] === Block.Air && !this.doorMask[cell] ? UNVISITED : SOLID;
    }

    const rooms: VoxelRoomSummary[] = [];
    for (let seed = 0; seed < CELLS; seed++) {
      if (this.roomIds[seed] !== UNVISITED) continue;
      const id = rooms.length;
      let head = 0, tail = 1, outdoor = false, floorCells = 0, minZ = HEIGHT, maxZ = -1;
      this.queue[0] = seed;
      this.roomIds[seed] = id;
      while (head < tail) {
        const cell = this.queue[head++];
        const x = cell % WIDTH, y = Math.floor(cell / WIDTH) % DEPTH, z = Math.floor(cell / SLICE);
        if (x === 0 || x === WIDTH - 1 || y === 0 || y === DEPTH - 1 || z === 0 || z === HEIGHT - 1) outdoor = true;
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        if (z > 0 && z < HEIGHT - 1 && blocks[cell - SLICE] !== Block.Air &&
            blocks[cell + SLICE] === Block.Air && !this.doorMask[cell + SLICE]) floorCells++;

        // Mark at enqueue time: every air cell enters the reusable queue once.
        if (x > 0 && this.roomIds[cell - 1] === UNVISITED) {
          this.roomIds[cell - 1] = id; this.queue[tail++] = cell - 1;
        }
        if (x + 1 < WIDTH && this.roomIds[cell + 1] === UNVISITED) {
          this.roomIds[cell + 1] = id; this.queue[tail++] = cell + 1;
        }
        if (y > 0 && this.roomIds[cell - WIDTH] === UNVISITED) {
          this.roomIds[cell - WIDTH] = id; this.queue[tail++] = cell - WIDTH;
        }
        if (y + 1 < DEPTH && this.roomIds[cell + WIDTH] === UNVISITED) {
          this.roomIds[cell + WIDTH] = id; this.queue[tail++] = cell + WIDTH;
        }
        if (z > 0 && this.roomIds[cell - SLICE] === UNVISITED) {
          this.roomIds[cell - SLICE] = id; this.queue[tail++] = cell - SLICE;
        }
        if (z + 1 < HEIGHT && this.roomIds[cell + SLICE] === UNVISITED) {
          this.roomIds[cell + SLICE] = id; this.queue[tail++] = cell + SLICE;
        }
      }
      rooms.push(Object.freeze({ id, outdoor, volume: tail, floorCells, minZ, maxZ }));
    }
    this.rooms = rooms;
  }

  roomAt(pos: Pos): VoxelRoomSummary | null {
    if (!inside(pos)) return null;
    return this.rooms[this.roomIds[index(pos.x, pos.y, pos.z)]] ?? null;
  }

  /** Frozen summaries with a fresh array, safe for UI snapshot consumers. */
  snapshot(): VoxelRoomSummary[] {
    return this.rooms.slice();
  }

  /**
   * Distinct regions beside the doorway's foot/head cells, ordered by region ID.
   * Without a door orientation, a cross-junction can expose more than two regions.
   * Vertical cells over/below the doorway are not horizontal door portals.
   */
  doorRegions(pos: Pos): VoxelRoomSummary[] {
    if (!inside(pos) || pos.z + 1 >= HEIGHT) return [];
    const foot = index(pos.x, pos.y, pos.z);
    if (!(this.doorMask[foot] & DOOR_FOOT)) return [];
    const ids = new Set<number>();
    for (const cell of [foot, foot + SLICE]) {
      if (pos.x > 0 && this.roomIds[cell - 1] >= 0) ids.add(this.roomIds[cell - 1]);
      if (pos.x + 1 < WIDTH && this.roomIds[cell + 1] >= 0) ids.add(this.roomIds[cell + 1]);
      if (pos.y > 0 && this.roomIds[cell - WIDTH] >= 0) ids.add(this.roomIds[cell - WIDTH]);
      if (pos.y + 1 < DEPTH && this.roomIds[cell + WIDTH] >= 0) ids.add(this.roomIds[cell + WIDTH]);
    }
    return [...ids].sort((a, b) => a - b).map(id => this.rooms[id]);
  }
}
