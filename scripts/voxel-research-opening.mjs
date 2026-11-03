import assert from 'node:assert/strict';

/** Ordinary campaign prerequisite, shared by fresh-world forestry and weapon runs.
 * Only public commands/step callers mutate the simulation. Site selection inspects
 * existing terrain and paths; this helper never grants knowledge or materials.
 */
export async function researchOpening({
  getSim,
  command,
  until,
  check,
  projects,
  reserved = [],
  elevated = false,
  steelTarget = 160,
  fixture = async () => {},
}) {
  const point = (p) => ({ x: p.x, y: p.y, z: p.z });
  const key = (p) => `${p.x}/${p.y}/${p.z}`;
  const at = (p) => (p.z * 64 + p.y) * 64 + p.x;
  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const s = getSim();
  const place = (tool, p, extra = {}) =>
    command({ type: 'designate', tool, from: point(p), ...extra });
  const reachable = (p) => s.standable(p) && s.path(s.pawns[0], p) !== null;
  const surface = [];
  for (let y = 2; y < 61; y++)
    for (let x = 2; x < 61; x++) {
      let z = 14;
      while (z > 0 && !s.blocks[at({ x, y, z })]) z--;
      const p = { x, y, z: z + 1 };
      if (s.standable(p) && !s.ladders[at(p)]) surface.push(p);
    }
  surface.sort((a, b) => dist(a, s.spawn) - dist(b, s.spawn));
  const blocked = new Set(
    [
      ...reserved,
      ...s.stockpiles,
      ...s.items,
      ...s.trees,
      ...s.farms,
      ...s.treePlots,
      ...s.stoves,
      ...s.beds,
      ...s.doors,
      ...s.weaponBenches,
      ...s.researchBenches,
      ...s.jobs,
    ].map(key),
  );
  const base = surface.find(
    (p) =>
      p.z >= 4 &&
      p.z <= 10 &&
      reachable(p) &&
      [0, 1, 2, 3, 4].every((dx) =>
        [-1, 0, 1, 2, 3].every((dy) => {
          const q = { ...p, x: p.x + dx, y: p.y + dy };
          return s.standable(q) && !blocked.has(key(q));
        }),
      ),
  );
  assert(base, 'research bench site with operating position and access');
  for (let dx = 0; dx <= 4; dx++)
    for (let dy = -1; dy <= 3; dy++) blocked.add(key({ ...base, x: base.x + dx, y: base.y + dy }));
  const shaft = surface.find(
    (p) => p.z >= 4 && !blocked.has(key(p)) && !s.ladders[at(p)] && reachable(p),
  );
  assert(shaft, 'finite ore access');
  blocked.add(key(shaft));
  // New long research sessions need a food loop. Existing scenario farms/stoves remain in use.
  if (!s.stoves.length && !s.jobs.some((j) => j.kind === 'stove')) {
    const stove = surface.find((p) => !blocked.has(key(p)) && reachable(p));
    assert(stove);
    blocked.add(key(stove));
    place('stove', stove);
  }
  if (s.stockpiles.length < 24) {
    for (const p of surface
      .filter((p) => !blocked.has(key(p)))
      .slice(0, 24 - s.stockpiles.length)) {
      place('stock', p);
      blocked.add(key(p));
    }
  }
  if (s.farms.length < 80) {
    const farms = surface
      .filter(
        (p) => !blocked.has(key(p)) && [1, 8, 10].includes(s.blocks[at({ ...p, z: p.z - 1 })]),
      )
      .slice(0, 80 - s.farms.length);
    assert.equal(farms.length, 80 - s.farms.length, 'food production land');
    for (const p of farms) {
      place('farm', p, { crop: 'rice' });
      blocked.add(key(p));
    }
  }
  const targetWood = elevated ? 260 : 130;
  const trees = s.trees
    .filter(
      (t) =>
        t.growth >= 0.8 &&
        !s.jobs.some((j) => j.kind === 'cut' && key(j) === key(t)) &&
        dirs.some(([dx, dy]) => reachable({ ...t, x: t.x + dx, y: t.y + dy })),
    )
    .sort((a, b) => dist(a, s.spawn) - dist(b, s.spawn));
  let n = 0;
  while (s.counts().wood < targetWood && n < trees.length) {
    for (const t of trees.slice(n, n + 8)) place('cut', t);
    n += 8;
    until(
      'normal forestry supplies research construction and food fuel',
      () => !s.jobs.some((j) => j.kind === 'cut'),
      60000,
    );
  }
  until(
    'food plots and cooking station are physically prepared',
    () => s.stoves.length > 0 && s.crops.length >= Math.min(80, s.farms.length),
    60000,
  );
  command({ type: 'bill', stoveId: s.stoves[0].id, target: 8, paused: false });
  if (s.counts().steel < Math.min(25, steelTarget)) {
    place('shaft', shaft);
    until(
      'research supply miners excavate three real levels',
      () => !s.jobs.some((j) => j.kind === 'ladder' || j.kind === 'digLadder'),
      60000,
    );
    const z = shaft.z - 3,
      ores = [];
    for (let y = 3; y < 61; y++)
      for (let x = 3; x < 61; x++)
        if (s.blocks[at({ x, y, z })] === 3 || s.blocks[at({ x, y, z: z + 1 })] === 3)
          ores.push({ x, y, z });
    ores.sort((a, b) => dist(a, { ...shaft, z }) - dist(b, { ...shaft, z }));
    for (const ore of ores) {
      if (s.counts().steel >= steelTarget) break;
      const line = [];
      for (let x = shaft.x; x !== ore.x; x += Math.sign(ore.x - shaft.x))
        line.push({ x, y: shaft.y, z });
      for (let y = shaft.y; y !== ore.y; y += Math.sign(ore.y - shaft.y))
        line.push({ x: ore.x, y, z });
      line.push(ore);
      for (const p of line)
        if (s.blocks[at(p)] || s.blocks[at({ ...p, z: z + 1 })]) place('mine', p);
      until(
        'finite underground ore supplies research and subsequent technology',
        () => !s.jobs.some((j) => j.kind === 'mine'),
        60000,
      );
    }
    assert(s.counts().steel >= steelTarget, 'mine enough metal for bench and unlock usage');
  }
  let bench = { ...base, x: base.x + 1 };
  if (elevated) {
    place('up', base);
    until(
      'research floor is reached by physical ladders',
      () => s.ladders[at({ ...base, z: base.z + 3 })] === 1,
      60000,
    );
    const upper = { ...base, z: base.z + 3 };
    place('floor', { ...upper, y: upper.y + 1 });
    until('research landing is constructed', () => !s.jobs.some((j) => j.kind === 'floor'), 60000);
    for (let dx = 1; dx <= 4; dx++) {
      for (let dy = -1; dy <= 3; dy++)
        place('floor', { ...upper, x: upper.x + dx, y: upper.y + dy });
      until(
        'upper research floor expands with carried wood',
        () => !s.jobs.some((j) => j.kind === 'floor'),
        60000,
      );
    }
    // Leave a full-width aisle between the landing and the 3x2 bench.
    bench = { ...upper, x: upper.x + 2 };
  }
  command({ type: 'research', project: projects[0] });
  assert.equal(s.research.progress[projects[0]], 0, 'project selection alone grants no points');
  place('researchBench', bench, { axis: 'x' });
  until(
    '75 wood and 25 steel are physically delivered and the research bench is built',
    () => s.researchBenches.some((b) => key(b) === key(bench)),
    60000,
  );
  const layout = { base, bench: point(bench), shaft };
  await fixture('bench-built', layout);
  const priorities = s.pawns.map((p) => ({ id: p.id, research: p.priorities.research }));
  // Assign the existing passionate Intellectual specialist through ordinary work controls.
  const researcher = s.pawns
    .filter((p) => p.faction === 'colony' && !p.dead)
    .sort((a, b) => b.skills.intellectual.level - a.skills.intellectual.level)[0];
  for (const p of s.pawns)
    command({
      type: 'priority',
      pawnId: p.id,
      work: 'research',
      value: p.id === researcher.id ? 1 : 0,
    });
  for (const [i, project] of projects.entries()) {
    if (s.research.current !== project) command({ type: 'research', project });
    until(`actual work on ${project} begins`, () => s.research.progress[project] > 0.2, 60000);
    if (i === 0) await fixture('research-working', layout);
    until(
      `partial ${project} research is earned through actual work`,
      () => s.research.progress[project] > 5,
      120000,
    );
    if (i === 0) await fixture('research-partial', layout);
    until(
      `${project} completes through finite work sessions and normal needs`,
      () => s.research.current === null,
      240000,
    );
    if (i === 0) await fixture('research-complete', layout);
    check('technology completed without injected knowledge', {
      project,
      points: s.research.progress[project],
    });
  }
  for (const p of priorities)
    command({ type: 'priority', pawnId: p.id, work: 'research', value: p.research });
  return layout;
}
