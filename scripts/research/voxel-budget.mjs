import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Arithmetic model only. No browser, GPU, game code, or large allocations run here.
const MiB = 1024 ** 2;
const chunkEdge = 16;
const fields = [
  { name: 'blockId', type: 'Uint16', bytes: 2 },
  { name: 'blockState', type: 'Uint8', bytes: 1 },
  { name: 'flags', type: 'Uint8', bytes: 1 },
  { name: 'packedSkyAndBlockLight', type: 'Uint8', bytes: 1 },
  { name: 'roomId', type: 'Uint32', bytes: 4 },
  { name: 'navigationMask', type: 'Uint8', bytes: 1 },
  { name: 'zoneId', type: 'Uint8', bytes: 1 },
  { name: 'workDesignation', type: 'Uint8', bytes: 1 },
];
const bytesPerCell = fields.reduce((sum, field) => sum + field.bytes, 0);
const cellsPerChunk = chunkEdge ** 3;
const bytesPerColumn = 4; // Uint16 surface height + Uint8 fertility + Uint8 biome.
const packedMetadataPerResidentChunk = 256; // Design allocation, not JS object measurement.
const directoryBytesPerSlot = 4; // Dense packed directory handle; 0 may represent implicit air.
const amount = (bytes) => ({ bytes, MiB: bytes / MiB });

function world(width, depth, height, expandedFraction) {
  const chunkCounts = [width, depth, height].map((n) => Math.ceil(n / chunkEdge));
  const chunkSlots = chunkCounts.reduce((product, n) => product * n, 1);
  const residentChunks = Math.ceil(chunkSlots * expandedFraction);
  const expandedCells = residentChunks * cellsPerChunk;
  const cells = amount(expandedCells * bytesPerCell);
  const metadata = amount(residentChunks * packedMetadataPerResidentChunk);
  const directory = amount(chunkSlots * directoryBytesPerSlot);
  const columns = amount(width * depth * bytesPerColumn);
  return {
    dimensions: { width, depth, height }, logicalCells: width * depth * height,
    chunkCounts, chunkSlots, expandedFraction, residentChunks, expandedCells,
    cellArrays: cells, packedChunkMetadata: metadata, packedDirectory: directory,
    columnArrays: columns,
    subtotal: amount(cells.bytes + metadata.bytes + directory.bytes + columns.bytes),
  };
}

// Unshared indexed quad: four vertices (float32 position/normal/UV = 32 B each),
// six uint32 indices. Counts are after face culling and before any assumed merging.
const vertexBytes = 32;
const quadBytes = 4 * vertexBytes + 6 * 4;
const geometry = (label, quads) => ({
  label, quads, bytesPerQuad: quadBytes,
  oneGeometryCopy: amount(quads * quadBytes),
  retainedCpuPlusGpu: amount(quads * quadBytes * 2),
  oldAndNewCpuPlusGpuDuringReplacement: amount(quads * quadBytes * 4),
});
const map = { width: 256, depth: 256, height: 64 };
const fullCells = map.width * map.depth * map.height;
const solidExteriorFaces = 2 * (
  map.width * map.depth + map.width * map.height + map.depth * map.height
);
const checkerFaces = (fullCells / 2) * 6;
const pathBytesPerNode = 4 + 4 + 4 + 4 + 4 + 4; // g, parent, seen, closed, heap node, heap f.
const path = (label, nodes, contexts) => ({
  label, nodeCapacity: nodes, contexts, bytesPerNode: pathBytesPerNode,
  total: amount(nodes * contexts * pathBytesPerNode),
});
const fullMipTexture = (edge) => {
  let pixels = 0;
  for (let size = edge; size >= 1; size /= 2) pixels += size * size;
  return { edge, format: 'RGBA8', mipLevels: Math.log2(edge) + 1, total: amount(pixels * 4) };
};

const report = {
  kind: 'Design arithmetic; not a benchmark or measured browser memory',
  selectedDirection: {
    status: 'Confirmed user requirement',
    world: 'True multi-level voxel world',
    requiredCapabilities: ['Underground excavation', 'Multi-storey construction', 'Rotatable view'],
    implementationStatus: 'Design only; no 3D implementation or voxel benchmark delivered',
    note: 'Chunk size, dimensions, field layout and viewport settings below are proposed parameters, not user-mandated values',
  },
  units: { MiB: '1024^2 bytes', GiB: '1024^3 bytes' },
  assumptions: {
    chunkEdge, cellsPerChunk, fields, bytesPerCell,
    bytesPerColumn, packedMetadataPerResidentChunk, directoryBytesPerSlot,
    omitted: [
      'Actual JS objects/Map overhead, allocator alignment and fragmentation',
      'Pawn/item/job objects, room and portal graphs, paths currently owned by pawns',
      'Cold chunk records or procedural generator caches outside expanded arrays',
      'Mesh worker halo copies, upload buffers and retained graphics-driver allocations',
      'Save compression, serialization peaks, browser UI, audio, code and runtime overhead',
      'Other textures, shadows, post-processing, full-frame render targets',
    ],
  },
  currentPrototypeArrayCounts: {
    worldThreeByteGrids: amount(96 * 96 * 3),
    pathPersistentGrids: amount(96 * 96 * 17),
    threeInitialEntityFrameBuffers: amount(3 * 4096 * 12 * 4),
  },
  worldProfiles: [
    world(64, 64, 16, 1),
    world(128, 128, 32, 1),
    world(256, 256, 64, 1),
    world(256, 256, 64, 0.25),
    world(512, 512, 128, 1),
    world(512, 512, 128, 0.25),
  ],
  geometryProfiles: [
    geometry('Illustrative 250000 exposed quads; not a measured terrain', 250000),
    geometry('Completely solid 256x256x64 rectangular volume; exterior only, no greedy merge', solidExteriorFaces),
    geometry('256x256x64 alternating solid/air checkerboard; all six solid faces exposed', checkerFaces),
  ],
  instancing: {
    label: 'One float32 4x4 instance matrix for every cell of a full 256x256x64 volume',
    instanceCount: fullCells, oneMatrixBuffer: amount(fullCells * 16 * 4),
    cpuAndGpuMatrixBuffers: amount(fullCells * 16 * 4 * 2),
    note: 'Excludes base geometry, colors and objects; instancing does not itself remove hidden faces',
  },
  pathProfiles: [
    path('One full-volume dense context', fullCells, 1),
    path('Four full-volume dense contexts', fullCells, 4),
    path('Four bounded hierarchical-search contexts', 262144, 4),
  ],
  textureProfiles: [fullMipTexture(2048), fullMipTexture(4096)],
  renderTargets: {
    drawingBuffer: [3840, 2160],
    rgba8AndDepth32NoMsaa: amount(3840 * 2160 * 8),
    rgba8AndDepth32FourSamplesPlusResolvedRgba8: amount(3840 * 2160 * 36),
    note: 'Illustrative attachments only; actual formats, backbuffers, HDR and driver allocations differ',
  },
};

assert.equal(bytesPerCell, 12);
const referenceWorlds = report.worldProfiles.filter((profile) =>
  profile.dimensions.width === 256 && profile.dimensions.depth === 256 && profile.dimensions.height === 64
);
assert.equal(referenceWorlds.find((profile) => profile.expandedFraction === 1).cellArrays.MiB, 48);
assert.equal(referenceWorlds.find((profile) => profile.expandedFraction === 0.25).cellArrays.MiB, 12);
assert.equal(report.geometryProfiles[2].oneGeometryCopy.MiB, 1824);
assert.equal(report.pathProfiles[2].total.MiB, 24);

const output = JSON.stringify(report, null, 2) + '\n';
if (process.argv.includes('--write')) {
  const target = new URL('../../docs/research/rimworld/evidence/voxel-budget.json', import.meta.url);
  await mkdir(new URL('./', target), { recursive: true });
  await writeFile(target, output, 'utf8');
  console.log(`Wrote ${fileURLToPath(target)}`);
} else {
  process.stdout.write(output);
}
