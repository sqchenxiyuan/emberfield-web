import { describe, expect, it, vi } from 'vitest';
import { Simulation } from '../src/sim/world';
import { buildCells, planBuild } from '../src/sim/placement';
import { laborActivity } from '../src/sim/activity';
import { BUILDINGS, TECHS } from '../src/sim/defs';
import { DAY, HOUR, SIZE } from '../src/sim/types';

function plain() {
  const s = new Simulation(73129);
  s.world.terrain.fill(0); s.world.nature = []; s.world.crops = [];
  s.world.autoPause = false; s.world.nextRaid = DAY * 100; s.world.nextWeather = DAY * 100;
  s.rebuildNav();
  return s;
}

describe('reachable animal wandering', () => {
  it('moves in a narrow corridor with bounded rest and no full-map path requests', () => {
    const s = plain(), p = s.world.pawns.find((p) => p.animal)!;
    s.world.pawns = [s.world.pawns[0], p]; s.world.pawns[0].drafted = true;
    s.world.terrain.fill(2);
    for (let x = 30; x <= 35; x++) s.world.terrain[30 * SIZE + x] = 0;
    p.x = 30; p.y = 30; p.job = null; p.waitUntil = 0;
    s.rebuildNav();
    const find = vi.spyOn(s.nav, 'find');
    let still = 0, maxStill = 0, moving = 0;
    for (let i = 0; i < 2400; i++) {
      const x = p.x, y = p.y; s.step();
      if (Math.hypot(x - p.x, y - p.y) < 0.00001) still++; else { still = 0; moving++; }
      maxStill = Math.max(still, maxStill);
      expect(p.y).toBe(30); expect(p.x).toBeGreaterThanOrEqual(30); expect(p.x).toBeLessThanOrEqual(35);
    }
    expect(moving).toBeGreaterThan(1000); expect(maxStill).toBeLessThanOrEqual(81);
    expect(find).not.toHaveBeenCalled();
  });
  it('reports enclosure and retries after a passage opens', () => {
    const s = plain(), p = s.world.pawns.find((p) => p.animal)!;
    s.world.pawns = [s.world.pawns[0], p]; s.world.pawns[0].drafted = true;
    s.world.terrain.fill(2); s.world.terrain[30 * SIZE + 30] = 0;
    p.x = 30; p.y = 30; p.job = null; p.waitUntil = 0; s.rebuildNav();
    s.step(); expect(p.reason).toContain('没有可通行格'); expect(p.job).toBeNull();
    const retry = p.waitUntil;
    s.step(20); expect(p.waitUntil).toBe(retry);
    s.world.terrain[30 * SIZE + 31] = 0; s.rebuildNav(); s.step(81);
    expect(p.x).toBeGreaterThan(30); expect(p.reason).not.toContain('没有可通行格');
  });
  it('abandons a newly blocked step and recovers locally', () => {
    const s = plain(), p = s.world.pawns.find((p) => p.animal)!;
    s.world.pawns = [s.world.pawns[0], p]; s.world.pawns[0].drafted = true;
    p.x = 30; p.y = 30; p.waitUntil = 0; p.job = null; s.step();
    const next = p.job!.path[0]; s.world.terrain[next] = 2; s.rebuildNav();
    s.step(); expect(p.job).toBeNull(); expect(p.reason).toContain('前路被挡');
    s.step(11); expect(p.job).not.toBeNull(); expect(p.job!.path).not.toContain(next);
  });
});

describe('atomic linear building plans', () => {
  it('snaps walls and wires to one axis and leaves furniture as one footprint', () => {
    expect(buildCells('wall', 20, 20, 24, 22)).toEqual([20,21,22,23,24].map((x) => ({x,y:20})));
    expect(buildCells('wire', 20, 24, 21, 20)).toEqual([24,23,22,21,20].map((y) => ({x:20,y})));
    expect(buildCells('bed', 20, 20, 24, 22)).toEqual([{x:24,y:22}]);
    expect(buildCells('wall', 0, 0, 1000000000, 0)).toEqual([]);
  });
  it('previews total costs, commits a whole row, and never deducts blueprint resources', () => {
    const s = plain(), before = s.inventory().wood;
    const plan = planBuild(s.world, 'wall', 20, 20, 24, 20);
    expect(plan.ok).toBe(true); expect(plan.cost.wood).toBe(25);
    expect(s.command({type:'build',kind:'wall',x:20,y:20,x2:24,y2:20}).ok).toBe(true);
    expect(s.world.buildings).toHaveLength(5); expect(s.inventory().wood).toBe(before);
  });
  it('rejects a mixed valid/invalid row atomically with per-cell feedback', () => {
    const s = plain(); s.world.terrain[20 * SIZE + 22] = 2;
    const plan = planBuild(s.world,'wall',20,20,24,20);
    expect(plan.cells.filter((c)=>c.valid)).toHaveLength(4);
    expect(plan.cells[2].reason).toContain('深水');
    expect(s.command({type:'build',kind:'wall',x:20,y:20,x2:24,y2:20}).reason).toContain('整段未放置');
    expect(s.world.buildings).toHaveLength(0);
  });
  it('warns about a closed empty room but commits all four walls; a doorway removes the warning', () => {
    const s = plain();
    for (const [x,y,x2,y2] of [[20,20,24,20],[20,24,24,24],[20,21,20,23]])
      expect(s.command({type:'build',kind:'wall',x,y,x2,y2}).ok).toBe(true);
    const before = s.world.buildings.length;
    const plan = planBuild(s.world,'wall',24,21,24,23);
    expect(plan.ok).toBe(true); expect(plan.cells.every((c)=>c.valid)).toBe(true);
    expect(plan.warnings[0]).toContain('建议预留门口');
    expect(plan.warnings[0]).toContain('仍可规划');
    expect(s.command({type:'build',kind:'wall',x:24,y:21,x2:24,y2:23}).ok).toBe(true);
    expect(s.world.buildings).toHaveLength(before+3);
    expect(s.world.buildings).toHaveLength(16);
    expect(s.world.buildings.every((b)=>b.kind==='wall')).toBe(true);
    s.command({type:'mark',mode:'cancel',x:24,y:21,x2:24,y2:23});
    expect(s.command({type:'build',kind:'door',x:24,y:22}).ok).toBe(true);
    for (const y of [21,23]) {
      expect(planBuild(s.world,'wall',24,y).warnings).toEqual([]);
      expect(s.command({type:'build',kind:'wall',x:24,y}).ok).toBe(true);
    }
  });
  it('still rejects locked research and an occupied wall footprint', () => {
    const s = plain(), p = s.world.pawns[0];
    expect(planBuild(s.world,'wire',20,20,22,20).ok).toBe(false);
    expect(s.command({type:'build',kind:'wire',x:20,y:20,x2:22,y2:20}).reason).toContain('研究');
    p.x=21; p.y=20;
    expect(s.command({type:'build',kind:'wall',x:20,y:20,x2:22,y2:20}).reason).toContain('角色占用');
    expect(s.world.buildings).toHaveLength(0);
    p.dead=true;
    expect(planBuild(s.world,'wall',20,20,22,20).ok).toBe(true);
  });
  it('allows conduit under buildings but not duplicate conduit, and reports material shortage', () => {
    const s = plain();
    const tech = BUILDINGS.wire.tech; if (tech) s.world.research[tech] = TECHS[tech].cost;
    s.command({type:'build',kind:'bed',x:20,y:20}); s.world.items=[];
    expect(planBuild(s.world,'wire',20,20,22,20).ok).toBe(true);
    expect(Object.keys(planBuild(s.world,'wire',20,20,22,20).missing).length).toBeGreaterThan(0);
    expect(s.command({type:'build',kind:'wire',x:20,y:20,x2:22,y2:20}).ok).toBe(true);
    expect(planBuild(s.world,'wire',20,20).reason).toContain('已有导线');
  });
});

describe('inspection and truthful labor cues', () => {
  it('inspects one object with live quantities and a tombstone after depletion', () => {
    const s=plain(), item=s.world.items[0];
    const detail=s.inspect(item.id); expect(detail.kind).toBe('item');
    item.count=12; item.reserved=3;
    const updated=s.inspect(item.id);
    expect(updated.kind === 'item' && updated.value.count).toBe(12);
    expect(updated.kind === 'item' && updated.value.reserved).toBe(3);
    item.count=0; expect(s.inspect(item.id).kind).toBe('missing');
    expect('items' in s.summary()).toBe(false); expect('nature' in s.summary()).toBe(false);
  });
  it('inspects animals and enemies without granting draft or movement control', () => {
    const s=plain(), animal=s.world.pawns.find((p)=>p.animal)!;
    const enemy=structuredClone(s.world.pawns[0]); enemy.id=s.world.nextId++; enemy.enemy=true; s.world.pawns.push(enemy);
    for (const p of [animal,enemy]) {
      expect(s.inspect(p.id).kind).toBe('pawn');
      s.command({type:'draft',ids:[p.id],value:true}); expect(p.drafted).toBe(false);
      expect(s.command({type:'move',ids:[p.id],x:30,y:30}).ok).toBe(false);
    }
  });
  it('shows harvesting only when at a valid target, never while traveling', () => {
    const s=plain(), p=s.world.pawns[0];
    const n={id:s.world.nextId++,x:40,y:40,kind:'ore' as const,amount:30,marked:true}; s.world.nature.push(n);
    p.x=39; p.y=40; p.job={kind:'mine',target:n.id,x:40,y:40,path:[],progress:90,total:180};
    expect(laborActivity(p,s.world)).toMatchObject({x:40,y:40,progress:0.5,kind:'mine'});
    p.job.path=[40*SIZE+39]; expect(laborActivity(p,s.world)).toBeNull();
    p.job.path=[]; p.x=30; expect(laborActivity(p,s.world)).toBeNull();
    p.x=39; n.amount=0; expect(laborActivity(p,s.world)).toBeNull();
  });
  it('construction delivery has no hammer cue; actual work uses building progress', () => {
    const s=plain(),p=s.world.pawns[0]; s.command({type:'build',kind:'bed',x:30,y:30});
    const b=s.world.buildings[0]; p.x=29;p.y=30;
    p.job={kind:'build',target:b.id,x:30,y:30,path:[],progress:0,total:400,stage:1};
    expect(laborActivity(p,s.world)).toBeNull();
    p.job.stage=2; b.progress=BUILDINGS.bed.work*HOUR/2;
    expect(laborActivity(p,s.world)?.progress).toBe(0.5);
    p.downed=true; expect(laborActivity(p,s.world)).toBeNull();
  });
  it('retains version-1 save compatibility and deterministic wandering after reload', () => {
    const a=plain(); a.step(300); const old=a.save(), b=new Simulation(); b.load(old);
    expect(b.save()).toEqual(old); a.step(1200);b.step(1200);expect(b.save()).toEqual(a.save());
  });
});
