import type { Summary } from './sim/types';
export const STRIDE = 12;
export type Frame = {
  type: 'frame';
  buffer: ArrayBuffer;
  count: number;
  tick: number;
  sequence: number;
};
export type TerrainMessage = {
  type: 'terrain';
  terrain: Uint8Array;
  zones: Uint8Array;
  seed: number;
};
export interface Metrics {
  tps: number;
  tickMs: number;
  tickP95: number;
  sentBytes: number;
  bufferCount: number;
  backend: string;
  renderWorker: boolean;
  fps: number;
  textureBytes: number;
  displayBytes: number;
  saveStatus: string;
}
export const EMPTY_METRICS: Metrics = {
  tps: 0,
  tickMs: 0,
  tickP95: 0,
  sentBytes: 0,
  bufferCount: 3,
  backend: '初始化',
  renderWorker: false,
  fps: 0,
  textureBytes: 0,
  displayBytes: 0,
  saveStatus: '尚未保存',
};
export interface ClientState {
  summary: Summary | null;
  speed: number;
  metrics: Metrics;
  ready: boolean;
  error: string | null;
  selection: number[];
  hover: { x: number; y: number } | null;
}
