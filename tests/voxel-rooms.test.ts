import { describe, expect, it } from 'vitest';
import { VoxelRooms } from '../src/voxel/rooms';
import { Block, CELLS, DEPTH, HEIGHT, WIDTH, index, type Pos } from '../src/voxel/types';

const pos = (x: number, y: number, z: number): Pos => ({ x, y, z });
const solidWorld = () => new Uint8Array(CELLS).fill(Block.Stone);
function carve(blocks: Uint8Array, from: Pos, to = from) {
  for (let z = from.z; z <= to.z; z++) for (let y = from.y; y <= to.y; y++) for (let x = from.x; x <= to.x; x++)
    blocks[index(x, y, z)] = Block.Air;
}

describe('six-connected voxel room topology', () => {
  it('counts sealed 3D volume separately from supported two-cell floor area', () => {
    const blocks = solidWorld(), rooms = new VoxelRooms();
    carve(blocks, pos(10, 10, 4), pos(12, 13, 6));
    const original = blocks.slice();
    rooms.rebuild(blocks);
    expect(rooms.roomAt(pos(11, 12, 5))).toEqual({ id: 0, outdoor: false, volume: 36, floorCells: 12, minZ: 4, maxZ: 6 });
    expect(rooms.roomAt(pos(10, 10, 3))).toBeNull();
    expect(rooms.roomAt(pos(-1, 10, 4))).toBeNull();
    expect(rooms.roomAt(pos(10.5, 10, 4))).toBeNull();
    expect(blocks).toEqual(original);
  });

  it('merges after a two-cell wall opening and separates again after rebuilding it', () => {
    const blocks = solidWorld(), rooms = new VoxelRooms();
    carve(blocks, pos(10, 10, 4), pos(11, 11, 5));
    carve(blocks, pos(13, 10, 4), pos(14, 11, 5));
    rooms.rebuild(blocks);
    expect(rooms.snapshot()).toHaveLength(2);
    expect(rooms.roomAt(pos(10, 10, 4))?.id).not.toBe(rooms.roomAt(pos(13, 10, 4))?.id);
    carve(blocks, pos(12, 10, 4), pos(12, 10, 5));
    // Mutating the structural input alone does not mutate this last-built cache.
    expect(rooms.snapshot()).toHaveLength(2);
    rooms.rebuild(blocks);
    expect(rooms.snapshot()).toEqual([{ id: 0, outdoor: false, volume: 18, floorCells: 9, minZ: 4, maxZ: 5 }]);
    blocks[index(12, 10, 4)] = blocks[index(12, 10, 5)] = Block.Wood;
    rooms.rebuild(blocks);
    expect(rooms.snapshot().map(room => room.volume)).toEqual([8, 8]);
  });

  it('a single open roof voxel connects the room to outdoor sky, and resealing restores it', () => {
    const blocks = solidWorld(), rooms = new VoxelRooms();
    carve(blocks, pos(10, 10, 4), pos(12, 12, 5));
    carve(blocks, pos(0, 0, 7), pos(WIDTH - 1, DEPTH - 1, HEIGHT - 1));
    rooms.rebuild(blocks);
    expect(rooms.roomAt(pos(11, 11, 4))?.outdoor).toBe(false);
    blocks[index(11, 11, 6)] = Block.Air;
    rooms.rebuild(blocks);
    expect(rooms.roomAt(pos(11, 11, 4))?.outdoor).toBe(true);
    expect(rooms.roomAt(pos(11, 11, 4))?.id).toBe(rooms.roomAt(pos(11, 11, 15))?.id);
    blocks[index(11, 11, 6)] = Block.Wood;
    rooms.rebuild(blocks);
    expect(rooms.roomAt(pos(11, 11, 4))).toMatchObject({ outdoor: false, volume: 18, floorCells: 9 });
  });

  it('an actual vertical floor opening merges upper and lower rooms across all connected levels', () => {
    const blocks = solidWorld(), rooms = new VoxelRooms();
    carve(blocks, pos(10, 10, 3), pos(12, 12, 4));
    carve(blocks, pos(10, 10, 6), pos(12, 12, 7));
    rooms.rebuild(blocks);
    expect(rooms.snapshot().map(room => room.floorCells)).toEqual([9, 9]);
    blocks[index(11, 11, 5)] = Block.Air;
    rooms.rebuild(blocks);
    expect(rooms.snapshot()).toEqual([{ id: 0, outdoor: false, volume: 37, floorCells: 17, minZ: 3, maxZ: 7 }]);
    expect(rooms.roomAt(pos(10, 10, 3))?.id).toBe(rooms.roomAt(pos(12, 12, 7))?.id);
    blocks[index(11, 11, 5)] = Block.Wood;
    rooms.rebuild(blocks);
    expect(rooms.snapshot()).toHaveLength(2);
  });

  it('doors isolate their foot and head cells regardless of open state and expose adjacent regions', () => {
    const blocks = solidWorld(), rooms = new VoxelRooms();
    carve(blocks, pos(10, 10, 4), pos(14, 10, 5));
    const door = { ...pos(12, 10, 4), open: false };
    rooms.rebuild(blocks, [door]);
    expect(rooms.snapshot().map(room => room.volume)).toEqual([4, 4]);
    expect(rooms.roomAt(door)).toBeNull();
    expect(rooms.roomAt(pos(12, 10, 5))).toBeNull();
    expect(rooms.doorRegions(door).map(room => room.id)).toEqual([0, 1]);
    expect(rooms.doorRegions(pos(12, 10, 5))).toEqual([]);
    const closed = rooms.snapshot();
    door.open = true; rooms.rebuild(blocks, [door]);
    expect(rooms.snapshot()).toEqual(closed);
    rooms.rebuild(blocks, []);
    expect(rooms.snapshot()).toEqual([{ id: 0, outdoor: false, volume: 10, floorCells: 5, minZ: 4, maxZ: 5 }]);
    expect(rooms.doorRegions(door)).toEqual([]);
  });

  it('does not pretend a directionless door at a four-way junction has exactly two sides', () => {
    const blocks = solidWorld(), rooms = new VoxelRooms(), door = pos(20, 20, 4);
    carve(blocks, door, pos(20, 20, 5));
    for (const [x, y] of [[19, 20], [21, 20], [20, 19], [20, 21]]) carve(blocks, pos(x, y, 4), pos(x, y, 5));
    rooms.rebuild(blocks, [door]);
    expect(rooms.doorRegions(door)).toHaveLength(4);
    expect(rooms.doorRegions(door).every(room => room.volume === 2)).toBe(true);
  });

  it('labels an entry door between indoor and outdoor regions without joining them', () => {
    const blocks = solidWorld(), rooms = new VoxelRooms();
    carve(blocks, pos(0, 10, 4), pos(6, 10, 5));
    const door = pos(4, 10, 4);
    rooms.rebuild(blocks, [door]);
    expect(rooms.doorRegions(door).map(room => room.outdoor)).toEqual([true, false]);
    expect(rooms.roomAt(pos(6, 10, 4))?.outdoor).toBe(false);
    rooms.rebuild(blocks);
    expect(rooms.roomAt(pos(6, 10, 4))?.outdoor).toBe(true);
  });

  it.each([
    pos(0, 12, 4), pos(WIDTH - 1, 12, 4), pos(12, 0, 4), pos(12, DEPTH - 1, 4),
    pos(12, 12, 0), pos(12, 12, HEIGHT - 1),
  ])('air touching the world outer face at $x,$y,$z is outdoor', boundary => {
    const blocks = solidWorld(), rooms = new VoxelRooms(); carve(blocks, boundary); rooms.rebuild(blocks);
    expect(rooms.roomAt(boundary)).toMatchObject({ outdoor: true, volume: 1 });
  });

  it('retains different IDs for disconnected exterior components', () => {
    const blocks = solidWorld(), rooms = new VoxelRooms();
    carve(blocks, pos(0, 8, 4), pos(0, 8, 5));
    carve(blocks, pos(WIDTH - 1, 54, 4), pos(WIDTH - 1, 54, 5));
    rooms.rebuild(blocks);
    expect(rooms.snapshot().map(room => room.outdoor)).toEqual([true, true]);
    expect(rooms.roomAt(pos(0, 8, 4))?.id).not.toBe(rooms.roomAt(pos(WIDTH - 1, 54, 4))?.id);
  });

  it('does not connect diagonal neighbors or wrap rows/slices through linear array neighbors', () => {
    const blocks = solidWorld(), rooms = new VoxelRooms();
    const cells = [pos(10, 10, 4), pos(11, 11, 4), pos(10, 11, 5),
      pos(WIDTH - 1, 20, 4), pos(0, 21, 4), pos(20, DEPTH - 1, 4), pos(20, 0, 5)];
    for (const cell of cells) carve(blocks, cell);
    rooms.rebuild(blocks);
    expect(rooms.snapshot()).toHaveLength(cells.length);
    expect(new Set(cells.map(cell => rooms.roomAt(cell)?.id)).size).toBe(cells.length);
  });

  it('requires real support and in-bounds air headroom for floor cells', () => {
    const blocks = solidWorld(), rooms = new VoxelRooms();
    carve(blocks, pos(10, 10, 4), pos(10, 10, 5));
    carve(blocks, pos(12, 10, 4));
    carve(blocks, pos(14, 10, 0), pos(14, 10, HEIGHT - 1));
    carve(blocks, pos(16, 10, HEIGHT - 1));
    rooms.rebuild(blocks);
    expect(rooms.roomAt(pos(10, 10, 4))?.floorCells).toBe(1);
    expect(rooms.roomAt(pos(12, 10, 4))?.floorCells).toBe(0);
    expect(rooms.roomAt(pos(14, 10, 4))?.floorCells).toBe(0);
    expect(rooms.roomAt(pos(16, 10, HEIGHT - 1))?.floorCells).toBe(0);
  });

  it('handles the largest connected component and reuses a fixed 576 KiB array budget', () => {
    const blocks = new Uint8Array(CELLS), rooms = new VoxelRooms(), ids = rooms.roomIds;
    expect(rooms.snapshot()).toEqual([]); expect(rooms.roomAt(pos(10, 10, 4))).toBeNull();
    rooms.rebuild(blocks);
    expect(rooms.snapshot()).toEqual([{ id: 0, outdoor: true, volume: CELLS, floorCells: 0, minZ: 0, maxZ: HEIGHT - 1 }]);
    expect(rooms.memoryBytes).toBe(CELLS * (4 + 4 + 1));
    expect(rooms.memoryBytes).toBe(576 * 1024);
    const first = rooms.snapshot(), firstIds = rooms.roomIds.slice();
    rooms.rebuild(blocks);
    expect(rooms.snapshot()).toEqual(first); expect(rooms.roomIds).toEqual(firstIds); expect(rooms.roomIds).toBe(ids);
    const external = rooms.snapshot(); external.pop();
    expect(rooms.snapshot()).toHaveLength(1); expect(Object.isFrozen(rooms.roomAt(pos(10, 10, 4)))).toBe(true);
    blocks.fill(Block.Stone); rooms.rebuild(blocks);
    expect(rooms.snapshot()).toEqual([]); expect(rooms.roomIds.every(id => id === -1)).toBe(true);
  });

  it('handles a checkerboard of isolated air components without queue overflow', () => {
    const blocks = solidWorld(), rooms = new VoxelRooms();
    for (let z = 0; z < HEIGHT; z++) for (let y = 0; y < DEPTH; y++) for (let x = 0; x < WIDTH; x++)
      if ((x + y + z) % 2 === 0) blocks[index(x, y, z)] = Block.Air;
    rooms.rebuild(blocks);
    expect(rooms.snapshot()).toHaveLength(CELLS / 2);
    expect(rooms.snapshot().every(room => room.volume === 1 && room.floorCells === 0)).toBe(true);
    expect(rooms.memoryBytes).toBe(576 * 1024);
  });

  it('rejects malformed structures before changing a valid existing cache', () => {
    const blocks = solidWorld(), rooms = new VoxelRooms();
    carve(blocks, pos(10, 10, 4), pos(10, 10, 5)); rooms.rebuild(blocks);
    const before = rooms.snapshot(), ids = rooms.roomIds.slice();
    expect(() => rooms.rebuild(new Uint8Array(CELLS - 1))).toThrow(RangeError);
    expect(() => rooms.rebuild(blocks, [pos(10, 10, HEIGHT - 1)])).toThrow(RangeError);
    expect(() => rooms.rebuild(blocks, [pos(-1, 10, 4)])).toThrow(RangeError);
    expect(() => rooms.rebuild(blocks, new Array(CELLS + 1).fill(pos(10, 10, 4)))).toThrow(RangeError);
    expect(rooms.snapshot()).toEqual(before); expect(rooms.roomIds).toEqual(ids);
  });
});
