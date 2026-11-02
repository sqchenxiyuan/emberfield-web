import { VoxelRooms } from './rooms';
import {
  Block, CELLS, DEPTH, HEIGHT, WIDTH, index, inside,
  type Axis, type Door, type Pos, type RoomTemperature, type SavedTemperature,
} from './types';

export const MIN_TEMPERATURE = -273.15;
export const MAX_TEMPERATURE = 1000;
const OUTDOOR = -1;
const GROUND = -2;
const CELL_CAPACITY = 0.5;
const SLICE = WIDTH * DEPTH;
const DIRECTIONS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

export interface ThermalOptions {
  /** Heat units / second / degree / one voxel wall face. */
  wallConductance: number;
  /** A boundary backed by more solid cells exchanges with a reservoir. */
  reservoirConductance: number;
  groundTemperature: number;
  /** Heat units / second / degree toward the unweighted portal-room mean. */
  doorOpenRate: number;
  doorClosedRate: number;
}

/**
 * Explicit 3D adaptation, not the original game's temperature simulation.
 * Wall: 120 * .00017 / 2 s; thick boundaries use half that conductance.
 * Natural solid boundaries have a bidirectional 15 C ground reservoir; wood
 * boundaries use outdoors. These reservoirs and volume/2 capacity are our rules.
 * Door rates convert the original 60 TPS, rate 1, 34/375 tick calls to seconds;
 * a continuous, simultaneous conservative solver replaces discrete hash ticks.
 */
export const THERMAL_DEFAULTS: Readonly<ThermalOptions> = Object.freeze({
  wallConductance: 0.0102,
  reservoirConductance: 0.0051,
  groundTemperature: 15,
  doorOpenRate: 60 / 34,
  doorClosedRate: 60 / 375,
});

/** For coolers axis is the normal: negative side cold, positive side hot.
 * Door orientation is deliberately unused: all four horizontal neighbors count.
 */
export interface ThermalPortal extends Pos { kind: 'door' | 'cooler'; axis: Axis }

/** Energy is sensible heat relative to 0 C, in capacity * degrees, not joules. */
export interface ThermalMigration {
  beforeEnergy: number;
  afterEnergy: number;
  addedCapacity: number;
  addedEnergy: number;
  removedCapacity: number;
  removedEnergy: number;
  enclosedCapacity: number;
  enclosedEnergy: number;
  exposedCapacity: number;
  exposedEnergy: number;
}
export interface ThermalExchange {
  beforeEnergy: number;
  afterEnergy: number;
  /** Positive means heat entered indoor rooms from this infinite reservoir. */
  outdoorHeat: number;
  groundHeat: number;
  substeps: number;
}

interface Edge { a: number; b: number; conductance: number; door: number }
interface PortalRooms { cell: number; rooms: Int32Array }

function checkedTemperature(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Temperature must be finite');
  return Math.max(MIN_TEMPERATURE, Math.min(MAX_TEMPERATURE, value));
}

/**
 * Rebuild the air topology first, then call sync only on structural changes.
 * Routine steps traverse cached room/edge arrays, never the voxel grid.
 * All transfers in a substep use the same old temperatures; equal and opposite
 * heat deltas preserve indoor energy. The timestep bound makes every update a
 * convex combination, including reservoirs, without temperature-clamp heat loss.
 */
export class VoxelThermal {
  readonly options: Readonly<ThermalOptions>;
  // Owned copy: VoxelRooms mutates its roomIds in place on every rebuild.
  private readonly roomIds = new Int32Array(CELLS).fill(-1);
  private capacity = new Float64Array(0);
  private temperature = new Float64Array(0);
  private outdoor = new Uint8Array(0);
  private anchor = new Int32Array(0);
  private delta = new Float64Array(0);
  private totalConductance = new Float64Array(0);
  private edgeA = new Int32Array(0);
  private edgeB = new Int32Array(0);
  private edgeConductance = new Float64Array(0);
  private edgeDoor = new Int32Array(0);
  private activeConductance = new Float64Array(0);
  private portals: PortalRooms[] = [];
  private portalLookup = new Map<number, number>();

  constructor(options: Partial<ThermalOptions> = {}) {
    const resolved = { ...THERMAL_DEFAULTS, ...options };
    for (const [name, value] of Object.entries(resolved)) {
      if (!Number.isFinite(value) || (name !== 'groundTemperature' && value < 0))
        throw new RangeError(`Invalid thermal option: ${name}`);
    }
    resolved.groundTemperature = checkedTemperature(resolved.groundTemperature);
    this.options = Object.freeze(resolved);
  }

  /** Owned typed arrays, including edge storage and scratch; excludes JS objects,
   * temporary rebuild maps, portal lookup Map, and caller-owned blocks/rooms.
   */
  get memoryBytes(): number {
    return this.roomIds.byteLength + this.capacity.byteLength + this.temperature.byteLength +
      this.outdoor.byteLength + this.anchor.byteLength + this.delta.byteLength + this.totalConductance.byteLength +
      this.edgeA.byteLength + this.edgeB.byteLength + this.edgeConductance.byteLength +
      this.edgeDoor.byteLength + this.activeConductance.byteLength +
      this.portals.reduce((bytes, portal) => bytes + portal.rooms.byteLength, 0);
  }

  sync(blocks: Uint8Array, rooms: VoxelRooms, portals: readonly ThermalPortal[], outdoor: number): ThermalMigration {
    const ambient = checkedTemperature(outdoor);
    if (!(blocks instanceof Uint8Array) || blocks.length !== CELLS)
      throw new RangeError(`Thermal topology requires exactly ${CELLS} block cells`);
    if (!Array.isArray(portals) || portals.length > CELLS)
      throw new RangeError('Invalid thermal portal list');
    const portalCells = new Set<number>();
    for (const portal of portals) {
      if (!portal || (portal.kind !== 'door' && portal.kind !== 'cooler') ||
          (portal.axis !== 'x' && portal.axis !== 'y') || !inside(portal) || portal.z + 1 >= HEIGHT)
        throw new RangeError('Invalid thermal portal');
      const cell = index(portal.x, portal.y, portal.z);
      for (const occupied of [cell, cell + SLICE]) {
        if (portalCells.has(occupied) || blocks[occupied] !== Block.Air || rooms.roomIds[occupied] !== -1)
          throw new RangeError('Rebuild rooms with nonoverlapping air portals before thermal sync');
        portalCells.add(occupied);
      }
    }
    const summary = rooms.snapshot(), count = summary.length;
    const capacities = new Float64Array(count), temperatures = new Float64Array(count);
    const exterior = new Uint8Array(count), anchors = new Int32Array(count).fill(-1);
    const firstTemperature = new Float64Array(count), mixedTemperature = new Uint8Array(count);
    for (const room of summary) {
      capacities[room.id] = room.volume * CELL_CAPACITY;
      exterior[room.id] = room.outdoor ? 1 : 0;
    }
    const migration: ThermalMigration = {
      beforeEnergy: this.energy(), afterEnergy: 0,
      addedCapacity: 0, addedEnergy: 0, removedCapacity: 0, removedEnergy: 0,
      enclosedCapacity: 0, enclosedEnergy: 0, exposedCapacity: 0, exposedEnergy: 0,
    };
    for (let cell = 0; cell < CELLS; cell++) {
      const old = this.roomIds[cell], next = rooms.roomIds[cell];
      const oldIndoor = old >= 0 && !this.outdoor[old];
      const nextIndoor = next >= 0 && !exterior[next];
      if (nextIndoor) {
        const value = oldIndoor ? this.temperature[old] : ambient;
        if (anchors[next] < 0) firstTemperature[next] = value;
        else if (firstTemperature[next] !== value) mixedTemperature[next] = 1;
        temperatures[next] += value * CELL_CAPACITY;
        if (old < 0) {
          migration.addedCapacity += CELL_CAPACITY; migration.addedEnergy += ambient * CELL_CAPACITY;
        } else if (!oldIndoor) {
          migration.enclosedCapacity += CELL_CAPACITY; migration.enclosedEnergy += ambient * CELL_CAPACITY;
        }
      } else if (oldIndoor) {
        const heat = this.temperature[old] * CELL_CAPACITY;
        if (next < 0) {
          migration.removedCapacity += CELL_CAPACITY; migration.removedEnergy += heat;
        } else {
          migration.exposedCapacity += CELL_CAPACITY; migration.exposedEnergy += heat;
        }
      }
      if (next >= 0 && anchors[next] < 0) anchors[next] = cell;
    }
    for (let room = 0; room < count; room++) {
      // An unchanged room or split keeps its exact temperature, including
      // fractional values at the bounds; don't round it once per air cell.
      temperatures[room] = exterior[room] ? ambient : mixedTemperature[room]
        ? checkedTemperature(temperatures[room] / capacities[room]) : firstTemperature[room];
      if (!exterior[room]) migration.afterEnergy += capacities[room] * temperatures[room];
    }

    const edges = new Map<string, Edge>();
    const addEdge = (first: number, second: number, conductance: number, door = -1) => {
      if (first === second || conductance === 0) return;
      let a = first, b = second;
      if (a >= 0 && exterior[a]) a = OUTDOOR;
      if (b >= 0 && exterior[b]) b = OUTDOOR;
      if (a < 0 && b < 0) return;
      if (a < 0 || (b >= 0 && a > b)) [a, b] = [b, a];
      if (a === b) return;
      const key = `${a}/${b}/${door}`, previous = edges.get(key);
      if (previous) previous.conductance += conductance;
      else edges.set(key, { a, b, conductance, door });
    };
    // Only indoor faces need scanning. A shared wall is inserted by its lower
    // room ID once; exterior rooms are reservoirs and never own reverse edges.
    for (let cell = 0; cell < CELLS; cell++) {
      const room = rooms.roomIds[cell];
      if (room < 0 || exterior[room]) continue;
      const x = cell % WIDTH, y = Math.floor(cell / WIDTH) % DEPTH, z = Math.floor(cell / SLICE);
      for (const [dx, dy, dz] of DIRECTIONS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= DEPTH || nz < 0 || nz >= HEIGHT) continue;
        const adjacent = index(nx, ny, nz), material = blocks[adjacent];
        // Air including excluded portal cells is handled by its explicit portal.
        if (material === Block.Air) continue;
        const bx = nx + dx, by = ny + dy, bz = nz + dz;
        if (bx >= 0 && bx < WIDTH && by >= 0 && by < DEPTH && bz >= 0 && bz < HEIGHT) {
          const beyond = index(bx, by, bz), other = rooms.roomIds[beyond];
          if (other >= 0) {
            if (other !== room && (exterior[other] || room < other))
              addEdge(room, other, this.options.wallConductance);
            continue;
          }
          if (blocks[beyond] === Block.Air) continue;
        }
        addEdge(room, material === Block.Wood ? OUTDOOR : GROUND, this.options.reservoirConductance);
      }
    }
    const cachedPortals: PortalRooms[] = [];
    const lookup = new Map<number, number>();
    for (const portal of [...portals].sort((a, b) => index(a.x, a.y, a.z) - index(b.x, b.y, b.z))) {
      const cell = index(portal.x, portal.y, portal.z), ids = new Set<number>();
      if (portal.kind === 'door') {
        for (const room of rooms.doorRegions(portal)) ids.add(room.id);
        const neighbors = [...ids].sort((a, b) => a - b);
        // Sum_j ((T_j - T_i) * rate / n) = (mean - T_i) * rate.
        for (let a = 0; a < neighbors.length; a++) for (let b = a + 1; b < neighbors.length; b++)
          addEdge(neighbors[a], neighbors[b], 1 / neighbors.length, cell);
      } else {
        const dx = portal.axis === 'x' ? 1 : 0, dy = portal.axis === 'y' ? 1 : 0;
        for (let z = portal.z; z <= portal.z + 1; z++) {
          const negative = { x: portal.x - dx, y: portal.y - dy, z };
          const positive = { x: portal.x + dx, y: portal.y + dy, z };
          const a = inside(negative) ? rooms.roomIds[index(negative.x, negative.y, z)] : -1;
          const b = inside(positive) ? rooms.roomIds[index(positive.x, positive.y, z)] : -1;
          if (a >= 0) ids.add(a);
          if (b >= 0) ids.add(b);
          if (a >= 0 && b >= 0) addEdge(a, b, this.options.wallConductance);
        }
      }
      lookup.set(cell, cachedPortals.length); lookup.set(cell + SLICE, cachedPortals.length);
      cachedPortals.push({ cell, rooms: Int32Array.from([...ids].sort((a, b) => a - b)) });
    }
    // Canonical ordering also removes small rounding differences caused by input
    // portal ordering. Structural scans and allocations end here.
    const ordered = [...edges.values()].sort((a, b) => a.a - b.a || a.b - b.b || a.door - b.door);
    this.edgeA = Int32Array.from(ordered, edge => edge.a);
    this.edgeB = Int32Array.from(ordered, edge => edge.b);
    this.edgeConductance = Float64Array.from(ordered, edge => edge.conductance);
    this.edgeDoor = Int32Array.from(ordered, edge => edge.door);
    this.activeConductance = new Float64Array(ordered.length);
    this.capacity = capacities; this.temperature = temperatures; this.outdoor = exterior; this.anchor = anchors;
    this.delta = new Float64Array(count); this.totalConductance = new Float64Array(count);
    this.roomIds.set(rooms.roomIds); this.portals = cachedPortals; this.portalLookup = lookup;
    return migration;
  }

  step(seconds: number, outdoor: number, doors: readonly Door[] = [], tick = 0): ThermalExchange {
    const ambient = checkedTemperature(outdoor);
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(tick))
      throw new RangeError('Thermal duration and tick must be finite and duration nonnegative');
    const report: ThermalExchange = {
      beforeEnergy: this.energy(), afterEnergy: 0, outdoorHeat: 0, groundHeat: 0, substeps: 0,
    };
    const open = new Set<number>();
    for (const door of doors) {
      if (door.mode === 'open' || (door.mode === 'auto' && tick <= door.openUntil))
        open.add(index(door.x, door.y, door.z));
    }
    this.totalConductance.fill(0);
    for (let edge = 0; edge < this.edgeA.length; edge++) {
      const portal = this.edgeDoor[edge];
      const rate = portal < 0 ? 1 : open.has(portal) ? this.options.doorOpenRate : this.options.doorClosedRate;
      const conductance = this.edgeConductance[edge] * rate;
      this.activeConductance[edge] = conductance;
      this.totalConductance[this.edgeA[edge]] += conductance;
      if (this.edgeB[edge] >= 0) this.totalConductance[this.edgeB[edge]] += conductance;
    }
    let maxStep = Infinity;
    for (let room = 0; room < this.capacity.length; room++) {
      if (!this.outdoor[room] && this.totalConductance[room] > 0)
        maxStep = Math.min(maxStep, 0.5 * this.capacity[room] / this.totalConductance[room]);
    }
    const steps = seconds === 0 || maxStep === Infinity ? 0 : Math.ceil(seconds / maxStep);
    // Guard accidental unbounded catch-up. Ordinary 20 TPS steps use one substep.
    if (!Number.isSafeInteger(steps) || steps > 100_000)
      throw new RangeError('Thermal duration needs too many substeps; advance in bounded intervals');
    const dt = steps ? seconds / steps : 0;
    for (let substep = 0; substep < steps; substep++) {
      this.delta.fill(0);
      for (let edge = 0; edge < this.edgeA.length; edge++) {
        const a = this.edgeA[edge], b = this.edgeB[edge];
        const other = b === OUTDOOR ? ambient : b === GROUND ? this.options.groundTemperature : this.temperature[b];
        const heat = (other - this.temperature[a]) * this.activeConductance[edge] * dt;
        this.delta[a] += heat;
        if (b >= 0) this.delta[b] -= heat;
        else if (b === OUTDOOR) report.outdoorHeat += heat;
        else report.groundHeat += heat;
      }
      for (let room = 0; room < this.capacity.length; room++) {
        if (!this.outdoor[room]) this.temperature[room] += this.delta[room] / this.capacity[room];
      }
    }
    for (let room = 0; room < this.capacity.length; room++) if (this.outdoor[room]) this.temperature[room] = ambient;
    report.substeps = steps; report.afterEnergy = this.energy();
    return report;
  }

  temperatureAt(pos: Pos, outdoor: number): number {
    const ambient = checkedTemperature(outdoor);
    if (!inside(pos)) return ambient;
    const cell = index(pos.x, pos.y, pos.z), room = this.roomIds[cell];
    if (room >= 0) return this.outdoor[room] ? ambient : this.temperature[room];
    const portal = this.portalLookup.get(cell);
    if (portal === undefined || !this.portals[portal].rooms.length) return ambient;
    let total = 0;
    for (const id of this.portals[portal].rooms) total += this.outdoor[id] ? ambient : this.temperature[id];
    return total / this.portals[portal].rooms.length;
  }

  /** Returns actual applied heat after optional directional target/bounds limit.
   * Outdoor, solid, and portal cells cannot store device heat: place the source
   * in a real air region (coolers use their negative/positive adjacent cells).
   */
  pushHeat(pos: Pos, heat: number, target?: number): number {
    if (!Number.isFinite(heat)) throw new RangeError('Heat must be finite');
    const limit = target === undefined ? undefined : checkedTemperature(target);
    if (!inside(pos) || heat === 0) return 0;
    const room = this.roomIds[index(pos.x, pos.y, pos.z)];
    if (room < 0 || this.outdoor[room]) return 0;
    const before = this.temperature[room];
    if (limit !== undefined && (heat > 0 ? limit <= before : limit >= before)) return 0;
    const lower = heat < 0 && limit !== undefined ? limit : MIN_TEMPERATURE;
    const upper = heat > 0 && limit !== undefined ? limit : MAX_TEMPERATURE;
    const after = Math.max(lower, Math.min(upper, before + heat / this.capacity[room]));
    this.temperature[room] = after;
    return (after - before) * this.capacity[room];
  }

  snapshot(): RoomTemperature[] {
    return Array.from(this.temperature, (temperature, roomId) => ({ roomId, temperature, capacity: this.capacity[roomId] }));
  }

  save(): SavedTemperature[] {
    const records: SavedTemperature[] = [];
    for (let room = 0; room < this.capacity.length; room++) {
      if (!this.outdoor[room]) records.push({ cell: this.anchor[room], temperature: this.temperature[room] });
    }
    return records;
  }

  /** Call after sync rebuilt this saved geometry. Missing records initialize to
   * current outdoors; stale/duplicate anchors are rejected atomically.
   */
  restore(records: readonly SavedTemperature[], rooms: VoxelRooms, outdoor: number): void {
    const ambient = checkedTemperature(outdoor);
    if (!Array.isArray(records) || records.length > this.capacity.length)
      throw new RangeError('Invalid saved room temperatures');
    const values = new Map<number, number>();
    for (const record of records) {
      if (!record || !Number.isInteger(record.cell) || record.cell < 0 || record.cell >= CELLS ||
          !Number.isFinite(record.temperature) || record.temperature < MIN_TEMPERATURE || record.temperature > MAX_TEMPERATURE)
        throw new RangeError('Invalid saved room temperature');
      const room = this.roomIds[record.cell];
      if (room < 0 || this.outdoor[room] || room !== rooms.roomIds[record.cell] || values.has(room))
        throw new RangeError('Saved temperature must uniquely anchor a current indoor room');
      values.set(room, record.temperature);
    }
    for (let room = 0; room < this.temperature.length; room++) this.temperature[room] = values.get(room) ?? ambient;
  }

  private energy(): number {
    let total = 0;
    for (let room = 0; room < this.capacity.length; room++) if (!this.outdoor[room]) total += this.capacity[room] * this.temperature[room];
    return total;
  }
}
