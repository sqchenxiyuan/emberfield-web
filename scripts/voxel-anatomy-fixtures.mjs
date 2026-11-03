// Explicitly controlled UI fixture: prepared injuries and equipment, not normal combat evidence.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const out = 'test-results/voxel-anatomy-controlled';
await mkdir(out, { recursive: true });
const b = await build({
  stdin: {
    contents: `export { VoxelSimulation } from './src/voxel/world'; export { applyInjury } from './src/voxel/injuries'; export { BODY_PARTS } from './src/voxel/anatomy'; export { makeWeapon } from './src/voxel/weapons';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { VoxelSimulation, applyInjury, BODY_PARTS, makeWeapon } = await import(
  'data:text/javascript;base64,' + Buffer.from(b.outputFiles[0].text).toString('base64')
);
const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
for (const p of s.pawns) {
  for (const k of Object.keys(p.priorities)) p.priorities[k] = 0;
  p.schedule.fill('work');
}
const patient = s.pawns[0];
patient.weapon = makeWeapon(s.nextId++, 'steelKnife');
applyInjury(patient.trauma, s.nextId++, 'rightHand', 'cut', BODY_PARTS.rightHand.hitPoints + 1);
applyInjury(patient.trauma, s.nextId++, 'leftEye', 'cut', 5);
s.step();
const data = s.save();
VoxelSimulation.load(data);
const bytes = JSON.stringify(data) + '\n',
  file = out + '/hand-eye.json';
await writeFile(file, bytes);
await writeFile(
  out + '/provenance.json',
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      scope:
        'Controlled hand loss, eye injury and knife prepared with direct simulation APIs solely for UI/treatment checks; ordinary combat is separately recorded.',
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      patientId: patient.id,
      doctorId: s.pawns[1].id,
    },
    null,
    2,
  ) + '\n',
);
console.log(file);
