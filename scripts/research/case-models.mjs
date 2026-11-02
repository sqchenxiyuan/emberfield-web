// Analyst-written arithmetic models for the documented examples, not game code.
// They validate the stated assumptions only; no engine, RNG or Def loader runs.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const curve = (pts, x) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [a,b] = pts[i-1], [c,d] = pts[i];
      return b + (d-b)*(x-a)/(c-a);
    }
  }
  return pts.at(-1)[1];
};
const adaptCurve = [[-30,.4],[0,.8],[30,1],[60,1.2],[120,1.6],[180,2]];
const room = p => {
  const f = x => Math.abs(x)<1 ? x : Math.sign(x)*(1+Math.log(Math.abs(x)));
  const a = [p.wealth/1500,p.beauty/3,p.space/125,1+Math.min(p.cleanliness,0)/2.5].map(f);
  const q = .65*a.reduce((v,x)=>v+x,0)/4 + .35*Math.min(...a);
  return {before_space_penalty:q, impressiveness:100*(q>5*a[2] ? .25*q+.75*5*a[2] : q)};
};
const roof = p => {
  const d = p.outside_c-p.inside_c;
  const adjusted = Math.abs(d)<100 ? d : Math.sign(d)*100+5*(d-Math.sign(d)*100);
  return {temperature_delta_c:adjusted*(p.thin_roof_fraction*.00005+p.no_roof_fraction*.0007)*120};
};
const cooler = p => {
  const efficiency = Math.max(0,1-(p.hot_c-Math.min(p.cold_c,p.hot_c))/130);
  const energy = p.heat_per_second*efficiency*(25/6);
  const cold_delta_c = Math.min(0,Math.max(p.target_c-p.cold_c,energy/p.cold_cell_count));
  return {efficiency,cold_delta_c,exhaust_heat:cold_delta_c!==0 ? -energy*1.25 : 0};
};
const trade = p => {
  const round = v => v>99.5 ? Math.round(v) : v; // Cases avoid half-ties.
  const buy = round(Math.max(.5,p.value*1.4*(1+p.loss)*(1-p.negotiator)));
  return {buy,sell:Math.min(buy,round(Math.max(.01,p.value*.6*(1-p.loss)*(1+p.negotiator))))};
};
// Generation examples use nearest-even integer rounding and distributions instead
// of consuming randomness. These helpers do not change the four earlier groups.
const roundEven = value => {
  const lower=Math.floor(value),fraction=value-lower;
  return fraction===.5 ? (lower%2===0 ? lower : lower+1) : Math.round(value);
};
const addOutcome = (distribution,output,probability) => {
  if(probability>0) distribution[output]=(distribution[output]??0)+probability;
};
const roundedDistribution = (value,minimum=0) => {
  if(!Number.isFinite(value) || value<0) throw new Error('RoundRandom example requires a finite nonnegative value.');
  const lower=Math.floor(value),fraction=value-lower,result={};
  addOutcome(result,Math.max(minimum,lower),1-fraction);
  addOutcome(result,Math.max(minimum,lower+1),fraction);
  return result;
};
const expectation = distribution => Object.entries(distribution).reduce((sum,[output,p])=>sum+Number(output)*p,0);
export const models = {
  work: {
    '手动排序与emergency分类':p=>{
      const cooking_key=p.cooking_natural+(4-p.cooking_priority)*100000;
      const growing_key=p.growing_natural+(4-p.growing_priority)*100000;
      return {cooking_key,growing_key,first:growing_key>cooking_key?'Growing':'Cooking',cooking_key_when_priority_1:p.cooking_natural+300000,doctor_in_emergency_list:p.doctor_priority<=p.best_normal_priority};
    },
    '部分数量预留':p=>{
      const allowed=(count,max)=>max===p.existing_max_pawns && p.existing_distinct_claimants<max && p.existing_quantity+count<=p.stack;
      return {sum_at_45:p.existing_quantity+p.request_allowed,sum_at_46:p.existing_quantity+p.request_excess,request_45_allowed:allowed(p.request_allowed,p.request_max_pawns),request_46_allowed:allowed(p.request_excess,p.request_max_pawns),request_max_pawns_1_allowed:allowed(p.request_allowed,1)};
    },
    '单次拿取与剩余任务量':p=>{
      const taken=Math.min(p.job_count,p.available_carry_space,p.source_stack);
      return {taken,job_remaining:p.job_count-(p.subtract_actual_taken?taken:0)};
    },
    '仓储格提前结束的反例':p=>{
      const threshold_index=Math.floor(p.cell_count*p.random_fraction),early_exit=p.first_accepted_index>=threshold_index;
      return {threshold_index,chosen_distance_squared:p.accepted_distance**2,later_closer_distance_squared:p.later_closer_distance**2,early_exit,later_cell_visited:!early_exit};
    },
    '顺路搬运几何门槛':p=>{
      const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
      const D=dist(p.P,p.T);
      const measure=I=>{
        const a=dist(p.P,I),b=dist(I,p.S),c=dist(p.S,p.T),IT=dist(I,p.T),detour_length=a+b+c,detour_limit=1.7*D;
        return {D,a,b,c,IT,detour_length,detour_limit,geometry_passes:D>=3&&a<=30&&a<=.5*D&&a+IT<=1.7*D&&c<=50&&c<=.6*D&&detour_length<=detour_limit&&a+c<=D};
      };
      return {...measure(p.I),rejected_geometry_passes:measure(p.rejected_I).geometry_passes};
    },
    '格成本与移动紧迫度':p=>{
      const grid_cost=Math.max(p.terrain_cost,p.thing_cost,p.snow_cost),C=Math.min(450,p.base_cardinal_ticks+grid_cost);
      return {grid_cost,C,Jog:C,Walk:Math.max(2*C,50),Amble:Math.max(3*C,60),Sprint:Math.round(.75*C)};
    },
    '启发值与基础路线耗时':p=>{
      const h=13*p.strength*(p.dx+p.dz-.58579004*Math.min(p.dx,p.dz));
      return {h,animal_h:h/p.strength*p.animal_strength,hypothetical_unobstructed_base_ticks:Math.min(p.dx,p.dz)*p.diagonal_ticks+Math.abs(p.dx-p.dz)*p.cardinal_ticks};
    }
  },
  environment: {
    balanced_room:room, dirty_room:room, sterile_room_same_impressiveness:room, small_room_penalty:room,
    full_thin_roof_loss:roof, ten_percent_open_roof_loss:roof,
    outdoor_threshold_small_room:p=>({open_roof_cells_at_outdoor_threshold:Math.ceil(p.cell_count*.25)}),
    heater_one_rare_call:p=>({temperature_delta_c:Math.max(0,Math.min(p.target_c-p.inside_c,p.heat_per_second*p.efficiency*(25/6)/p.cell_count))}),
    cooler_one_rare_call:cooler, cooler_near_target_exhaust:cooler,
    battery_ideal_discharge:p=>({game_days:p.stored_wd/(p.load_w+p.self_discharge_w),game_hours:24*p.stored_wd/(p.load_w+p.self_discharge_w)}),
    battery_ideal_charge:p=>({net_wd_per_day:p.surplus_w*p.efficiency-p.self_discharge_w,game_days:(p.capacity_wd-p.initial_wd)/(p.surplus_w*p.efficiency-p.self_discharge_w)})
  },
  economy: {
    home_wealth_threat:p=>{
      const wealth=p.items+.5*p.buildings+p.pawns;
      const wealthPoints=curve([[0,0],[14000,0],[400000,2400],[700000,3600],[1000000,4200]],wealth);
      const pawnPoints=p.colonists*curve([[0,15],[10000,15],[400000,140],[1000000,200]],wealth);
      const base=wealthPoints+pawnPoints;
      return {wealth,wealthPoints,pawnPoints,base,points:base*(1+p.effect*(curve(adaptCurve,p.adapt)-1))*p.scale*curve([[10,.7],[40,1]],p.days)};
    },
    health_contribution:p=>({factor:.35+.65*p.health}),
    adaptation_max_and_loss:p=>({maxRawFactor:curve(adaptCurve,p.cap),after:p.before-p.loss,rawFactor:curve(adaptCurve,p.before-p.loss),effectiveFactor:1+p.effect*(curve(adaptCurve,p.before-p.loss)-1)}),
    raid_minimum_and_remainder:p=>{
      const adjusted=Math.max(p.points*p.arrival*p.strategy,p.minimum*1.05),count=Math.floor(adjusted/p.unitCost);
      return {adjusted,count,remainder:adjusted-count*p.unitCost};
    },
    cycle_interval:p=>({spacingIntervals:Math.round(p.spacingDays*60),spacingTicks:Math.round(p.spacingDays*60)*1000,onIntervals:Math.round(p.onDays*60)}),
    normal_trade:trade,hard_trade:trade,minimum_trade:trade
  },
  combat: {
    'E01 命中估计与掩体组合':p=>{
      const shooter=Math.max(.0201,p.perCellAccuracy**p.distance*p.shooterDistanceMultiplier);
      const standard=Math.max(.0201,shooter*p.weaponFactor*p.weatherFactor*p.gasFactor+p.darknessOffset);
      const aim=standard*clamp(p.size,.5,2)*p.posture;
      const twoCoverPass=p.adjustedCoverBlocks.reduce((n,x)=>n*(1-x),1);
      return {aim,oneCoverHitEstimate:clamp(aim*(1-p.adjustedCoverBlocks[0]),0,1),twoCoverPass,twoCoverHitEstimate:clamp(aim*twoCoverPass,0,1)};
    },
    'E02 单层护甲条件期望':p=>{
      const effectiveArmor=Math.max(0,p.armor-p.penetration),fullBlockProbability=clamp(effectiveArmor/2,0,1);
      const halfDamageProbability=clamp(effectiveArmor,0,1)-fullBlockProbability,fullDamageProbability=1-clamp(effectiveArmor,0,1);
      return {effectiveArmor,fullBlockProbability,halfDamageProbability,fullDamageProbability,conditionalExpectedDamage:p.incomingDamage*(.5*halfDamageProbability+fullDamageProbability),armorItemDamageBeforeRoll:p.incomingDamage*.25};
    },
    'E03 草药护理质量及批处理':p=>{
      const baseQuality=clamp(p.doctorQuality*p.potency+p.bedOffset,0,p.cap),selfTendBaseQuality=clamp((p.doctorQuality*p.potency+p.bedOffset)*.7,0,p.cap);
      const range=q=>[clamp(q-.25,0,p.cap),clamp(q+.25,0,p.cap)];
      const treatedSeverities=[],remainingSeverities=[];
      let total=0;
      for(const severity of p.priorityOrderedInjuries){if(!treatedSeverities.length || total+severity<=20){treatedSeverities.push(severity);total+=severity;}else remainingSeverities.push(severity);}
      return {baseQuality,finalQualityRange:range(baseQuality),selfTendBaseQuality,selfTendQualityRange:range(selfTendBaseQuality),treatedSeverities,remainingSeverities,medicineConsumed:1};
    },
    'E04 两阶段伤口感染':p=>{
      if(p.animal || !p.eligibilitySurvives) throw new Error('This case models an eligible surviving humanlike wound only.');
      const qualityFactor=.7-.3*p.tendQuality;
      const chance=severity=>p.initialGunshotChance*curve([[1,.1],[12,1]],severity)*p.recordedRoomFactor*qualityFactor*p.difficultyFactor;
      return {qualityFactor,unconditionalInfectionProbability:chance(p.currentSeverity),untendedProbability:p.initialGunshotChance,probabilityIfCurrentSeverity6:chance(6)};
    },
    'E05 固定伤势的出血与恢复':p=>{
      const bleedPerDay=p.gunshotSeverity*p.injuryBleedFactor*p.raceFactor*p.partFactor*p.otherBleedFactor/p.healthScale;
      return {bleedPerDay,bloodLossPer60Tick:bleedPerDay*.001,hoursToBloodLoss0_6IfConstant:(.6-p.startBloodLoss)/bleedPerDay*24,noBleedDaysToRecover0_6:.6/(1000*.00033333333)};
    },
    'E06 伤口感染的严重度-免疫竞赛':p=>{
      const immuneDays=(1-p.initialImmunity)/(p.immunityPerDay*p.immunitySpeed*p.instanceFactor);
      const remaining=p.lethalSeverity-p.initialSeverity,tendedGrowthPerDay=p.severityPerDay+p.tendSeverityFactor*p.continuousActualQuality;
      const crit=f=>(p.severityPerDay-remaining*p.immunityPerDay*p.immunitySpeed*f/(1-p.initialImmunity))/-p.tendSeverityFactor;
      return {immuneDays,untendedLethalDays:remaining/p.severityPerDay,tendedGrowthPerDay,tendedLethalDaysWithoutImmunity:remaining/tendedGrowthPerDay,severityAtImmunity:p.initialSeverity+immuneDays*tendedGrowthPerDay,minimumContinuousQualityToWinAtFactor1:crit(1),minimumContinuousQualityToWinAtFactor0_8:crit(.8)};
    }
  },
  generation: {
    'G01 世界格点温度':p=>{
      if(p.overallCurve!=='identity') throw new Error('This temperature example assumes an identity overall curve.');
      const latitudeBase=curve([[0,30],[.1,29],[.5,7],[1,-37]],Math.abs(p.latitude)/90);
      const elevationReduction=40*clamp((p.elevation-250)/4750,0,1);
      return {latitudeBase,elevationReduction,temperature:latitudeBase-elevationReduction+p.noiseOffset};
    },
    'G02 矿脉尝试数及双重取整':p=>{
      const cellDivisors=p.rates.map(rate=>roundEven(10000/(rate*p.nomadicFactor)));
      return {cellDivisors,attemptCounts:cellDivisors.map(divisor=>roundEven(roundEven(p.mapSizeX**2/divisor)*p.placementFactor))};
    },
    'G03 土壤与石地分支边界':p=>{
      if(p.patchResult!==null || p.preferRock || p.caves!==0) throw new Error('This boundary example excludes terrain patches and forced rock floors.');
      const terrain=p.cells.map(({e,f})=>{
        if(e>.55 && e<.61 && !p.noGravel) return 'Gravel';
        if(e>=.61) return 'naturalStone';
        if(f>=-999 && f<=.87) return 'Soil';
        if(f>=.87 && f<=999) return 'SoilRich';
        return 'Sand';
      });
      return {terrain,spawnsRock:p.cells.map(({e})=>e>.7 && p.caves<=0)};
    },
    'G04 矿种抽签权重':p=>{
      if(!p.eligibleOnlyTheseSeven) throw new Error('This example restricts eligibility to the seven supplied minerals.');
      const totalWeight=Object.values(p.weights).reduce((sum,weight)=>sum+weight,0);
      return {totalWeight,steelProbability:p.weights.steel/totalWeight,componentProbability:p.weights.components/totalWeight,goldProbability:p.weights.gold/totalWeight};
    },
    'G05 两名矿工累计矿产量':p=>{
      const yieldPct=p.mining.reduce((sum,slice)=>sum+slice.effectiveDamage/p.maxHP*slice.yieldStat,0);
      const effectiveBase=roundEven(p.baseYield*p.mineYieldFactor);
      const baseOutput=Math.max(1,effectiveBase),preRoundYield=baseOutput*(p.wasteable?yieldPct:1);
      const outputDistribution={},dropProbability=clamp(p.dropChance,0,1);
      addOutcome(outputDistribution,0,1-dropProbability);
      for(const [output,probability] of Object.entries(roundedDistribution(preRoundYield,1))) addOutcome(outputDistribution,output,dropProbability*probability);
      return {yieldPct,effectiveBase,preRoundYield,outputDistribution,expectedYield:expectation(outputDistribution)};
    },
    'G06 肥力敏感度与休眠':p=>({
      riceFertilityFactors:p.fertilities.map(f=>f*p.riceSensitivity+1-p.riceSensitivity),
      potatoFertilityFactors:p.fertilities.map(f=>f*p.potatoSensitivity+1-p.potatoSensitivity),
      riceIdealCalendarDaysOnSoil:p.riceGrowDays/(p.activeDayFraction*p.allOtherGrowthFactors)
    }),
    'G07 早收受损作物与采收失败':p=>{
      const growthFactor=.5+.5*clamp((p.growth-p.minGrowth)/(1-p.minGrowth),0,1);
      const hpFactor=.5+.5*clamp(p.hpFraction,0,1);
      const canYield=p.growth>p.minGrowth && p.baseYield>0 && !p.blighted;
      const preRoundYield=canYield?p.baseYield*growthFactor*hpFactor*p.cropYieldFactor:0;
      const failProbability=p.humanlike && p.harvestFailable && !p.blighted?clamp(1-p.harvestStat,0,1):0;
      const outputDistribution={};
      addOutcome(outputDistribution,0,failProbability);
      for(const [initial,probability] of Object.entries(roundedDistribution(preRoundYield))){
        // The first random rounding precedes a second rounding when stat > 1.
        const afterStat=p.harvestStat>1?roundedDistribution(Number(initial)*p.harvestStat):{[initial]:1};
        for(const [output,conditional] of Object.entries(afterStat)) addOutcome(outputDistribution,output,(1-failProbability)*probability*conditional);
      }
      return {growthFactor,hpFactor,preRoundYield,failProbability,outputDistribution,expectedYield:expectation(outputDistribution)};
    },
    'G08 生态密度目标':p=>{
      if(!p.ordinaryOutdoorCells || p.fertilities.some(f=>f<=0)) throw new Error('This example models ordinary positive-fertility outdoor cells.');
      return {desiredPlantsPerCell:p.fertilities.map(f=>Math.min(p.biomePlantDensity*p.plantDensityFactor*f*f,1)),desiredAnimalWeight:p.area*p.desiredAnimalDensity/10000};
    }
  }
};
