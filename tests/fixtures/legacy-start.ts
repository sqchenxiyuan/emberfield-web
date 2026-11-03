import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../../src/voxel/world';

const bytes = readFileSync(new URL('./voxel-v7-start.json', import.meta.url));
if (
  createHash('sha256').update(bytes).digest('hex') !==
  '203b82e8cf07279f2090a9576131dc47182a2c8fdce838542ed05b6480969076'
)
  throw new Error('Historical v7 fixture changed');
const legacyStart: unknown = JSON.parse(bytes.toString('utf8'));
/** Frozen generator-1 terrain and clock for historical feature regression cases. */
export const legacySimulation = () => {
  const sim = VoxelSimulation.load(legacyStart);
  // Historical isolated mechanism fixtures reshape terrain; exclude the newly
  // seeded ecology here. Genuine migration tests still load frozen bytes directly.
  sim.animals = [];
  return sim;
};
