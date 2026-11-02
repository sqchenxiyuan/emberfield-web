import { describe, expect, it } from 'vitest';
import { BATTERY_CAPACITY, VoxelPower } from '../src/voxel/power';
import { DAY, at, type Device, type DeviceKind, type Pos } from '../src/voxel/types';

// Isolated power-engine fixtures. These devices are not construction/gameplay evidence.
const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
function device(id: number, kind: DeviceKind, p: Pos, values: Partial<Device> = {}): Device {
  return {
    ...p, id, kind, axis: 'x', on: true, fuel: kind === 'generator' ? 75 : 0,
    energy: kind === 'battery' ? 100 : 0, target: 21, powered: false,
    active: kind === 'heater' || kind === 'cooler', networkId: null, watts: 0,
    reason: 'isolated power fixture', ...values,
  };
}
function setup(devices: Device[], wires: Pos[] = []) {
  const power = new VoxelPower(); power.rebuild(wires, devices); return power;
}
function stepDays(power: VoxelPower, devices: Device[], ticks = DAY, light = 1) {
  let generated = 0, consumed = 0;
  for (let tick = 1; tick <= ticks; tick++) {
    power.step(tick, devices, () => light);
    for (const n of power.snapshot()) {
      generated += n.generatedW / DAY; consumed += n.usedW / DAY;
      expect(n.usedW).toBeGreaterThanOrEqual(0);
      expect(n.storedWd).toBeGreaterThanOrEqual(-1e-8);
      expect(n.storedWd).toBeLessThanOrEqual(n.capacityWd + 1e-8);
    }
  }
  return { generated, consumed };
}

describe('voxel power topology', () => {
  it('connects six face neighbors through z without joining diagonal corners', () => {
    const power = setup([], [pos(10,10),pos(11,10),pos(11,10,9),pos(12,11,9),pos(11,11,10)]);
    expect(power.networkIds[at(pos(10,10))]).toBe(power.networkIds[at(pos(11,10,9))]);
    expect(power.networkIds[at(pos(12,11,9))]).not.toBe(power.networkIds[at(pos(11,10,9))]);
    expect(power.networkIds[at(pos(11,11,10))]).not.toBe(power.networkIds[at(pos(11,10,9))]);
    expect(power.snapshot()).toHaveLength(3);
  });

  it('uses the whole same-layer 13x13 square, including its corners, but no automatic cross-floor reach', () => {
    const corner = device(1,'heater',pos(16,16)), outside = device(2,'heater',pos(17,10));
    const upstairs = device(3,'cooler',pos(10,10,9)), devices = [corner,outside,upstairs];
    const power = setup(devices,[pos(10,10)]);
    expect(corner.networkId).not.toBeNull(); expect(outside.networkId).toBeNull(); expect(upstairs.networkId).toBeNull();
    power.rebuild([pos(10,10),pos(10,10,9)],devices);
    expect(upstairs.networkId).toBe(corner.networkId);
  });

  it('selects the nearest in-range wire component and stays within the map edges', () => {
    const near = device(1,'heater',pos(13,10)), edge = device(2,'heater',pos(0,0));
    const power = setup([near,edge],[pos(10,10),pos(14,10),pos(6,6)]);
    expect(near.networkId).toBe(power.networkIds[at(pos(14,10))]);
    expect(edge.networkId).toBe(power.networkIds[at(pos(6,6))]);
  });

  it('uses every conductive footprint cell and rotates the battery connection footprint', () => {
    const panel=device(1,'solar',pos(10,10)), battery=device(2,'battery',pos(14,10),{axis:'y'});
    const power=setup([panel,battery],[pos(16,10)]);
    expect(panel.networkId).toBe(battery.networkId);
    expect(power.networkIds[at(pos(16,10))]).toBe(panel.networkId);
    battery.axis='x'; power.rebuild([pos(16,10)],[panel,battery]);
    expect(power.networkIds[at(pos(16,10))]).not.toBe(panel.networkId);
  });

  it('rebuilds broken and restored wire networks without granting disconnected loads electricity', () => {
    const generator=device(1,'generator',pos(10,10)), heater=device(2,'heater',pos(30,10),{powered:true});
    const devices=[generator,heater], wires=Array.from({length:19},(_,i)=>pos(i+12,10));
    const power=setup(devices,wires); power.step(1,devices,()=>1); expect(heater.powered).toBe(true);
    power.rebuild(wires.filter(p=>p.x!==22),devices); power.step(2,devices,()=>1);
    expect(generator.networkId).not.toBe(heater.networkId); expect(heater.powered).toBe(false);
    expect(power.snapshot().find(n=>n.id===heater.networkId)!.usedW).toBe(0);
    power.rebuild(wires,devices); stepDays(power,devices,200);
    expect(heater.networkId).toBe(generator.networkId); expect(heater.powered).toBe(true);
  });
});

describe('fuel and solar generation', () => {
  it('burns exactly 22 wood per day at idle while generating 1000 W', () => {
    const generator=device(1,'generator',pos(10,10)); const devices=[generator], power=setup(devices);
    const ledger=stepDays(power,devices);
    expect(generator.fuel).toBeCloseTo(53,8); expect(ledger.generated).toBeCloseTo(1000,7);
    expect(ledger.consumed).toBe(0); expect(generator.active).toBe(true);
  });

  it('consumes a final partial fuel tick without creating a full tick of energy, then stops', () => {
    const generator=device(1,'generator',pos(10,10),{fuel:22/DAY/4});
    const devices=[generator],power=setup(devices); power.step(1,devices,()=>1);
    expect(generator.fuel).toBe(0); expect(generator.watts).toBeCloseTo(250,10);
    power.step(2,devices,()=>1); expect(generator.watts).toBe(0); expect(generator.powered).toBe(false); expect(generator.active).toBe(false);
  });

  it('switching the generator off stops both fuel burn and generation immediately', () => {
    const generator=device(1,'generator',pos(10,10)),devices=[generator],power=setup(devices);
    power.step(1,devices,()=>1); const fuel=generator.fuel; generator.on=false;
    stepDays(power,devices,100); expect(generator.fuel).toBe(fuel); expect(generator.watts).toBe(0); expect(generator.active).toBe(false);
  });

  it('solar generation follows available light and produces nothing at night or when switched off', () => {
    const solar=device(1,'solar',pos(10,10)),devices=[solar],power=setup(devices);
    power.step(1,devices,()=>1); expect(solar.watts).toBe(1700);
    power.step(2,devices,()=>.5); expect(solar.watts).toBe(850);
    power.step(3,devices,()=>0); expect(solar.watts).toBe(0); expect(solar.powered).toBe(false); expect(solar.active).toBe(false);
    solar.on=false; power.step(4,devices,()=>1); expect(solar.watts).toBe(0);
  });
});

describe('battery storage and network energy budgets', () => {
  it('reports connected battery storage immediately on rebuild without consuming energy or fuel', () => {
    const generator=device(1,'generator',pos(10,10)),a=device(2,'battery',pos(12,10),{energy:132.34020833333508});
    const b=device(3,'battery',pos(13,10),{energy:19.875}),off=device(4,'battery',pos(14,10),{energy:400,on:false});
    const devices=[generator,a,b,off],power=setup(devices),before=devices.map(d=>[d.fuel,d.energy]);
    for(let n=0;n<3;n++){
      power.rebuild([],devices);const network=power.snapshot()[0];
      expect(network.storedWd).toBeCloseTo(a.energy+b.energy,10);expect(network.capacityWd).toBe(1200);
      expect(network.generatedW).toBe(0);expect(network.usedW).toBe(0);
      expect(devices.map(d=>[d.fuel,d.energy])).toEqual(before);
    }
  });

  it('accounts for a full day of generator input, useful load, half-efficiency charging and battery self-consumption', () => {
    const generator=device(1,'generator',pos(10,10)),battery=device(2,'battery',pos(12,10));
    const heater=device(3,'heater',pos(14,10),{powered:true}),devices=[generator,battery,heater],power=setup(devices);
    const ledger=stepDays(power,devices);
    expect(ledger.generated).toBeCloseTo(1000,7); expect(ledger.consumed).toBeCloseTo(175,7);
    expect(battery.energy).toBeCloseTo(507.5,7);
    // 100 initial + 1000 input = final storage + heater + conversion loss + 5 Wd self-consumption.
    expect(100+ledger.generated).toBeCloseTo(battery.energy+ledger.consumed+412.5+5,7);
  });

  it('discharges without charging loss and includes the 5 W self-consumption budget', () => {
    const battery=device(1,'battery',pos(10,10),{energy:500}),heater=device(2,'heater',pos(13,10),{powered:true});
    const devices=[battery,heater],power=setup(devices),ledger=stepDays(power,devices);
    expect(ledger.generated).toBe(0); expect(ledger.consumed).toBeCloseTo(175,7);
    expect(battery.energy).toBeCloseTo(320,7); expect(battery.energy+ledger.consumed+5).toBeCloseTo(500,7);
  });

  it('self-discharges isolated or switched-off batteries without supplying nearby loads', () => {
    const battery=device(1,'battery',pos(10,10),{energy:100,on:false}),heater=device(2,'heater',pos(13,10),{powered:true});
    const devices=[battery,heater],power=setup(devices); const ledger=stepDays(power,devices);
    expect(battery.energy).toBeCloseTo(95,7); expect(battery.powered).toBe(false); expect(battery.active).toBe(false);
    expect(heater.powered).toBe(false); expect(ledger.consumed).toBe(0); expect(power.snapshot()[0].capacityWd).toBe(0);
  });

  it('caps each battery at 600 Wd and safely discards generation that cannot be stored', () => {
    const solar=device(1,'solar',pos(10,10)),battery=device(2,'battery',pos(14,10),{energy:599});
    const devices=[solar,battery],power=setup(devices); stepDays(power,devices,DAY/10);
    expect(BATTERY_CAPACITY).toBe(600); expect(battery.energy).toBeCloseTo(600,8);
    expect(power.snapshot()[0].capacityWd).toBe(600); expect(power.snapshot()[0].storedWd).toBeCloseTo(600,8);
  });

  it('shares charging equally between equally charged batteries regardless of their array order', () => {
    const outcome=(reverse:boolean)=>{
      const generator=device(1,'generator',pos(10,10)),a=device(2,'battery',pos(12,10)),b=device(3,'battery',pos(13,10));
      const devices=reverse?[b,a,generator]:[generator,a,b],power=setup(devices); stepDays(power,devices,DAY/10);
      expect(a.energy).toBeCloseTo(b.energy,10); return a.energy;
    };
    expect(outcome(false)).toBeCloseTo(124.5,8); expect(outcome(true)).toBeCloseTo(124.5,8);
  });

  it('redistributes excess charging from a full battery to a battery with free capacity', () => {
    const generator=device(1,'generator',pos(10,10)),full=device(2,'battery',pos(12,10),{energy:600});
    const empty=device(3,'battery',pos(13,10),{energy:0}),devices=[generator,full,empty],power=setup(devices);
    power.step(1,devices,()=>1);
    expect(full.energy).toBeCloseTo(600,10); expect(empty.energy).toBeGreaterThan(.04);
    // Initially empty storage cannot self-discharge; the full battery loses and replaces a small amount.
    expect(full.energy+empty.energy).toBeCloseTo(600+500/DAY-5/DAY,10);
  });

  it('redistributes discharge from an empty battery without overdrawing it', () => {
    const full=device(1,'battery',pos(10,10),{energy:100}),empty=device(2,'battery',pos(11,10),{energy:0});
    const heater=device(3,'heater',pos(14,10),{powered:true}),devices=[empty,heater,full],power=setup(devices);
    const ledger=stepDays(power,devices,DAY/10);
    expect(empty.energy).toBe(0); expect(full.energy).toBeCloseTo(82,8);
    expect(ledger.consumed).toBeCloseTo(17.5,8); expect(heater.powered).toBe(true);
  });

  it('shares discharge equally between nonempty batteries independent of array order', () => {
    const a=device(1,'battery',pos(10,10)),b=device(2,'battery',pos(11,10));
    const heater=device(3,'heater',pos(14,10),{powered:true}),devices=[b,heater,a],power=setup(devices);
    stepDays(power,devices,DAY/10); expect(a.energy).toBeCloseTo(90.75,8); expect(b.energy).toBeCloseTo(a.energy,10);
  });
});

describe('switching and hard power limits', () => {
  it('does not starve affordable standby loads when polling intervals and candidate count share factors', () => {
    const solar = device(1, 'solar', pos(10, 10));
    const loads = Array.from({ length: 16 }, (_, i) =>
      device(i + 2, 'heater', pos(15 + (i % 4), 10 + Math.floor(i / 4)), { active: i % 2 === 1 }),
    );
    const devices = [solar, ...loads],
      power = setup(devices);
    let generated = 0,
      used = 0;
    expect(loads.every((d) => d.networkId === solar.networkId)).toBe(true);
    for (let tick = 1; tick <= 2000; tick++) {
      power.step(tick, devices, () => 50 / 1700);
      const network = power.snapshot()[0];
      const paid = loads.reduce((sum, d) => sum + (d.powered ? -d.watts : 0), 0);
      expect(network.usedW).toBe(paid);
      expect(network.usedW).toBeLessThanOrEqual(50);
      expect(loads.some((d) => d.active && d.powered)).toBe(false);
      generated += network.generatedW / DAY;
      used += network.usedW / DAY;
    }
    // 50 W can fund two 17.5 W standby heaters, but none of the 175 W active ones.
    expect(loads.filter((d) => d.powered)).toHaveLength(2);
    expect(power.snapshot()[0].usedW).toBe(35);
    expect(used).toBeGreaterThan(0);
    expect(used).toBeLessThanOrEqual(generated);
    expect(power.snapshot()[0].storedWd).toBe(0);
  });

  it('can reach every candidate position when it is the only affordable standby load', () => {
    for (let affordable = 0; affordable < 16; affordable++) {
      const solar = device(1, 'solar', pos(10, 10));
      const loads = Array.from({ length: 16 }, (_, i) =>
        device(i + 2, 'heater', pos(15 + (i % 4), 10 + Math.floor(i / 4)), {
          active: i !== affordable,
        }),
      );
      const devices = [solar, ...loads],
        power = setup(devices);
      for (let tick = 1; tick <= 2000; tick++) power.step(tick, devices, () => 50 / 1700);
      expect(
        loads[affordable].powered,
        `affordable candidate ${affordable} must receive power`,
      ).toBe(true);
      expect(loads.filter((d) => d.powered)).toHaveLength(1);
      expect(power.snapshot()[0].usedW).toBe(17.5);
    }
  });

  it.each([[4.92,true],[4.9,false],[.09,true]])('gates startup before candidate affordability at %s Wd', (energy,expected) => {
    const generator=device(1,'generator',pos(10,10)),battery=device(2,'battery',pos(12,10),{energy});
    const heater=device(3,'heater',pos(14,10)),devices=[generator,battery,heater],power=setup(devices);
    expect(DAY).toBe(12000);
    power.step(67,devices,()=>1);
    expect(heater.powered).toBe(expected);
    expect(power.snapshot()[0].usedW).toBe(expected?175:0);
    // The 5 Wd reserve is comparison-only; self-consumption and charging are the only storage changes.
    expect(battery.energy).toBeCloseTo(energy-5/DAY+(1000-(expected?175:0))*.5/DAY,10);
  });

  it('starts loads with sufficient direct generation and keeps them powered without a battery', () => {
    const generator=device(1,'generator',pos(10,10)),heater=device(2,'heater',pos(14,10));
    const devices=[generator,heater],power=setup(devices); let started=false;
    for(let tick=1;tick<=500;tick++){
      power.step(tick,devices,()=>1);
      if(tick>=67)expect(heater.powered).toBe(true);
      if(started)expect(heater.powered).toBe(true); started ||= heater.powered;
    }
    expect(started).toBe(true);
  });

  it('remains stable after the low-battery startup reserve gate is satisfied', () => {
    const generator=device(1,'generator',pos(10,10)),battery=device(2,'battery',pos(12,10),{energy:1});
    const heater=device(3,'heater',pos(14,10)),devices=[generator,battery,heater],power=setup(devices); let start=0;
    for(let tick=1;tick<=500;tick++){
      power.step(tick,devices,()=>1);
      if(start)expect(heater.powered).toBe(true);
      if(!start&&heater.powered)start=tick;
      expect(power.snapshot()[0].usedW).toBeLessThanOrEqual(1000);
    }
    // Exact reserve timing is a source-derived switching policy, not an energy conservation law.
    expect(start).toBeGreaterThan(0); expect(start).toBeLessThanOrEqual(500);
  });

  it('denies an unfunded load immediately even between normal shedding polls', () => {
    const battery=device(1,'battery',pos(10,10),{energy:0}),heater=device(2,'heater',pos(14,10),{powered:true});
    const devices=[battery,heater],power=setup(devices); power.step(1,devices,()=>0);
    expect(heater.powered).toBe(false); expect(battery.energy).toBe(0); expect(power.snapshot()[0].usedW).toBe(0);
    stepDays(power,devices,200,0); expect(heater.powered).toBe(false); expect(battery.energy).toBe(0);
  });

  it('never sells more power than generation plus stored energy during overload or a fuel outage', () => {
    const generator=device(1,'generator',pos(10,10));
    const loads=Array.from({length:6},(_,i)=>device(i+2,'heater',pos(14,i+7),{powered:true}));
    const devices=[generator,...loads],power=setup(devices);
    for(let tick=1;tick<=300;tick++){
      if(tick===151)generator.fuel=0;
      power.step(tick,devices,()=>0); const n=power.snapshot()[0];
      expect(n.usedW).toBeLessThanOrEqual(n.generatedW+1e-8);
      expect(loads.filter(d=>d.powered).length).toBeLessThanOrEqual(tick<151?5:0);
      if(tick<151)expect(n.usedW).toBe(875); else expect(n.usedW).toBe(0);
    }
  });

  it('does not authorize switched-off or disconnected heaters/coolers, and accounts for standby power', () => {
    const generator=device(1,'generator',pos(10,10)),heater=device(2,'heater',pos(14,10),{powered:true,active:false});
    const cooler=device(3,'cooler',pos(14,11),{powered:true,active:false}),devices=[generator,heater,cooler],power=setup(devices);
    power.step(1,devices,()=>1); expect(power.snapshot()[0].usedW).toBe(37.5);
    heater.on=false; cooler.x=40; power.rebuild([],devices); power.step(2,devices,()=>1);
    expect(heater.powered).toBe(false); expect(cooler.powered).toBe(false); expect(cooler.networkId).toBeNull();
    // World thermal code requires powered AND on before delivering any heat.
    expect(power.snapshot()[0].usedW).toBe(0);
  });
});
