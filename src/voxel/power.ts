import {
  CELLS,
  DAY,
  WIDTH,
  DEPTH,
  HEIGHT,
  at,
  inside,
  position,
  deviceCells,
  type Counts,
  type Device,
  type DeviceKind,
  type Pos,
  type PowerNetwork,
} from './types';

export const DEVICE_COSTS: Record<DeviceKind, Partial<Counts>> = {
  generator: { steel: 100, components: 2 },
  solar: { steel: 100, components: 3 },
  battery: { steel: 70, components: 2 },
  heater: { steel: 50, components: 1 },
  cooler: { steel: 90, components: 3 },
};
export const BATTERY_CAPACITY = 600;
// Base work at skill multiplier one, preserving seconds under 20 instead of 60 TPS.
export const DEVICE_WORK: Record<DeviceKind, number> = {
  generator: 834,
  solar: 834,
  battery: 267,
  heater: 334,
  cooler: 534,
};
export const isDeviceKind = (s: string): s is DeviceKind => Object.hasOwn(DEVICE_COSTS, s);
const conductive = (d: Device) =>
  d.kind === 'generator' || d.kind === 'solar' || d.kind === 'battery';
const directions = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
export class VoxelPower {
  readonly networkIds = new Int32Array(CELLS).fill(-1);
  private nodes = new Uint8Array(CELLS);
  private queue = new Int32Array(CELLS);
  private networks: PowerNetwork[] = [];
  private groups: Device[][] = [];
  get memoryBytes() {
    return this.networkIds.byteLength + this.nodes.byteLength + this.queue.byteLength;
  }
  rebuild(wires: readonly Pos[], devices: Device[]) {
    this.nodes.fill(0);
    this.networkIds.fill(-1);
    this.groups = [];
    for (const p of wires) if (inside(p)) this.nodes[at(p)] = 1;
    for (const d of devices)
      if (conductive(d)) for (const p of deviceCells(d)) this.nodes[at(p)] = 1;
    let id = 0;
    for (let start = 0; start < CELLS; start++) {
      if (!this.nodes[start] || this.networkIds[start] >= 0) continue;
      this.groups.push([]);
      let head = 0,
        tail = 1;
      this.queue[0] = start;
      this.networkIds[start] = id;
      while (head < tail) {
        const p = position(this.queue[head++]);
        for (const [dx, dy, dz] of directions) {
          const q = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
          if (!inside(q)) continue;
          const i = at(q);
          if (this.nodes[i] && this.networkIds[i] < 0) {
            this.networkIds[i] = id;
            this.queue[tail++] = i;
          }
        }
      }
      id++;
    }
    for (const d of devices) {
      let network = -1;
      if (conductive(d)) network = this.networkIds[at(d)];
      else {
        // Native connector search is a same-map 13x13 square, not a radius-6 circle.
        // Preserve it within each z layer. Cross-layer networks require actual vertical wires.
        let distance = Infinity;
        for (let y = Math.max(0, d.y - 6); y <= Math.min(DEPTH - 1, d.y + 6); y++)
          for (let x = Math.max(0, d.x - 6); x <= Math.min(WIDTH - 1, d.x + 6); x++) {
            const n = this.networkIds[at({ x, y, z: d.z })],
              dist = (x - d.x) ** 2 + (y - d.y) ** 2;
            if (n >= 0 && dist < distance) {
              network = n;
              distance = dist;
            }
          }
      }
      d.networkId = network < 0 ? null : network;
      if (network >= 0) this.groups[network].push(d);
      else d.powered = false;
    }
    this.networks = this.groups.map((group, id) => {
      const batteries = group.filter((d) => d.kind === 'battery' && d.on);
      return {
        id,
        generatedW: 0,
        demandW: 0,
        usedW: 0,
        storedWd: batteries.reduce((s, d) => s + d.energy, 0),
        capacityWd: batteries.length * BATTERY_CAPACITY,
        surplusW: 0,
        devices: group.map((d) => d.id),
      };
    });
  }
  step(tick: number, devices: Device[], solarLight: (d: Device) => number) {
    for (const d of devices) {
      if (d.kind === 'generator') {
        const fuelUsed = d.on ? Math.min(d.fuel, 22 / DAY) : 0;
        d.fuel = Math.max(0, d.fuel - fuelUsed);
        d.watts = (1000 * fuelUsed) / (22 / DAY);
        d.powered = d.watts > 0;
        d.active = d.powered;
        d.reason = !d.on ? '已关闭' : d.powered ? '燃木发电中' : '等待燃料';
      } else if (d.kind === 'solar') {
        d.watts = d.on ? 1700 * Math.max(0, Math.min(1, solarLight(d))) : 0;
        d.powered = d.watts > 0;
        d.active = d.powered;
        d.reason = !d.on ? '已关闭' : d.powered ? '太阳能发电' : '夜间或上方遮挡';
      } else if (d.kind === 'battery') {
        d.energy = Math.max(0, d.energy - 5 / DAY);
        d.watts = 0;
        d.powered = d.on && d.networkId !== null;
        d.active = false;
        d.reason = d.on ? '接入电网' : '已隔离（仍会自放电）';
      } else {
        if (!d.on || d.networkId === null) d.powered = false;
        d.watts = -(d.kind === 'heater' ? 175 : 200) * (d.active ? 1 : 0.1);
        if (!d.on) d.reason = '已关闭';
        else if (d.networkId === null) d.reason = '本层 6 格接线范围内无线路';
      }
    }
    for (let id = 0; id < this.groups.length; id++) {
      const group = this.groups[id],
        batteries = group.filter((d) => d.kind === 'battery' && d.on);
      const consumers = group.filter((d) => d.kind === 'heater' || d.kind === 'cooler');
      const generation = group.reduce((s, d) => s + Math.max(0, d.watts), 0);
      let stored = batteries.reduce((s, d) => s + d.energy, 0);
      let used = consumers.reduce((s, d) => s + (d.on && d.powered ? -d.watts : 0), 0);
      const waiting = consumers.filter((d) => d.on && !d.powered);
      // Source-inspired staggered switching. Deterministic tick/id hash replaces native global RNG.
      const random = (salt: number, n: number) => {
        // Mix high bits into low bits before modulo: aligned polling intervals
        // must not restrict power-of-two candidate counts to one parity class.
        let hash = (tick + Math.imul(salt, 374761393) + id) | 0;
        hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
        hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
        return ((hash ^ (hash >>> 16)) >>> 0) % n;
      };
      if (stored + (generation - used) / DAY >= -1e-7) {
        const interval = Math.max(10, Math.floor(67 / Math.max(1, waiting.length)));
        // Native startup hysteresis gates the waiting branch before selecting a load.
        // The candidate affordability check below uses real storage, not this reserve.
        const buffered = batteries.length && stored >= 0.1 ? stored - 5 : stored;
        if (
          waiting.length &&
          buffered + (generation - used) / DAY >= -1e-7 &&
          tick % interval === id % interval
        ) {
          const attempts = Math.max(1, Math.round(waiting.length * 0.05));
          for (let n = 0; n < attempts; n++) {
            const d = waiting[random(n + 1, waiting.length)];
            if (d.powered) continue;
            if (stored + (generation - used + d.watts) / DAY >= -1e-7) {
              d.powered = true;
              used -= d.watts;
            }
          }
        }
      } else if (tick % 7 === id % 7) {
        const enabled = consumers.filter((d) => d.on && d.powered),
          attempts = Math.max(1, Math.round(enabled.length * 0.05));
        for (let n = 0; enabled.length && n < attempts; n++) {
          const d = enabled[random(n + 2, enabled.length)];
          if (d.powered) {
            d.powered = false;
            used += d.watts;
          }
        }
      }
      // With an empty battery, an unshed load must not receive energy for free between switch polls.
      const available = generation + stored * DAY;
      let paid = 0;
      for (const d of consumers) {
        if (!d.on || !d.powered) {
          if (d.on && d.networkId !== null) d.reason = '电力不足，等待启动';
          continue;
        }
        const watts = -d.watts;
        if (paid + watts > available + 1e-7) {
          d.powered = false;
          d.reason = '供电中断';
          continue;
        }
        paid += watts;
      }
      used = paid;
      let balance = (generation - used) / DAY;
      if (balance >= 0) {
        // Share input between available batteries; full batteries are removed before redistributing.
        let open = batteries.filter((d) => d.energy < 600 - 1e-9);
        while (balance > 1e-10 && open.length) {
          const each = balance / open.length;
          let input = 0;
          for (const d of open) {
            const take = Math.min(each, (600 - d.energy) / 0.5);
            d.energy += take * 0.5;
            input += take;
            d.active = take > 0;
            d.reason = take > 0 ? '充电中' : '已充满';
          }
          balance -= input;
          open = open.filter((d) => d.energy < 600 - 1e-9);
        }
      } else {
        let demand = -balance,
          open = batteries.filter((d) => d.energy > 1e-9);
        while (demand > 1e-10 && open.length) {
          const each = demand / open.length;
          let output = 0;
          for (const d of open) {
            const take = Math.min(each, d.energy);
            d.energy -= take;
            output += take;
            d.active = take > 0;
            d.reason = '向电网供电';
          }
          demand -= output;
          open = open.filter((d) => d.energy > 1e-9);
        }
      }
      stored = batteries.reduce((s, d) => s + d.energy, 0);
      this.networks[id] = {
        id,
        generatedW: generation,
        demandW: consumers.reduce((s, d) => s + (d.on ? -d.watts : 0), 0),
        usedW: used,
        storedWd: stored,
        capacityWd: batteries.length * 600,
        surplusW: generation - used,
        devices: group.map((d) => d.id),
      };
    }
  }
  snapshot() {
    return this.networks.map((n) => ({ ...n, devices: [...n.devices] }));
  }
}
