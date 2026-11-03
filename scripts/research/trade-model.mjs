// Independent static-derived arithmetic. No game implementation imports.
// JavaScript double precision, explicit native ties-to-even; not a native RNG replay.
import {fields,chain,listValues,curve,clamp} from './storyteller-model.mjs';
export {fields,chain,listValues,curve,clamp};
export function roundEven(x){const n=Math.floor(x),f=x-n;return f<.5?n:f>.5?n+1:n%2===0?n:n+1;}
export function generators(records,id){
 const r=records.find(r=>r.id===id);if(!r)throw Error(id);
 return r.node_attributes.filter(a=>/\/stockGenerators\/li(?:\[\d+\])?$/.test(a.xpath)).map(a=>({
  class:a.attributes.Class,mayRequire:a.attributes.MayRequire??null,
  values:Object.fromEntries(r.fields.filter(f=>f.xpath.startsWith(a.xpath+'/')).map(f=>[f.xpath.slice(a.xpath.length+1),f.value])),
 }));
}
export function categoryAncestors(records,name){const result=[];while(name){if(result.includes(name))throw Error('Category cycle');result.push(name);const r=records.find(r=>r.id==='ThingCategoryDef_'+name);if(!r)throw Error('Missing category '+name);name=r.fields.find(f=>f.xpath===r.source.xpath+'/parent')?.value;}return result;}
export function itemInfo(records,name){const id='ThingDef_'+name,a=fields(records,id),categories=listValues(records,id,'thingCategories');return{
 id,name,tradeability:a.tradeability??'All',sellFactor:+(a['statBases/SellPriceFactor']??1),
 baseValue:a['statBases/MarketValue']===undefined?null:+a['statBases/MarketValue'],
 stackLimit:+(a.stackLimit??1),smallVolume:a.smallVolume==='true',volume:a.smallVolume==='true'?.1:1,
 category:a.category??'Item',categories,ancestors:[...new Set(categories.flatMap(n=>categoryAncestors(records,n)))],
 tags:listValues(records,id,'tradeTags'),generic:a.genericMarketSellable!=='false',
 tech:a.techLevel??'Undefined',startingHpRange:a.startingHpRange??'1~1',
 };}
const values=(v,p)=>Object.entries(v).filter(([k])=>new RegExp('^'+p+'/li(?:\\[\\d+\\])?$').test(k)).map(([,v])=>v);
export function handles(g,item){const v=g.values,tag=v.tradeTag??v.tag;
 if(g.mayRequire)return false;
 switch(g.class){
 case 'StockGenerator_SingleDef':case 'StockGenerator_BuySingleDef':return v.thingDef===item.name;
 case 'StockGenerator_MultiDef':return values(v,'thingDefs').includes(item.name);
 case 'StockGenerator_Category':return item.tradeability!=='None'&&item.ancestors.includes(v.categoryDef)&&!values(v,'excludedThingDefs').includes(item.name)&&!values(v,'excludedCategories').some(n=>item.ancestors.includes(n));
 case 'StockGenerator_Tag':case 'StockGenerator_BuyTradeTag':case 'StockGenerator_MarketValue':return item.tradeability!=='None'&&item.tags.includes(tag);
 case 'StockGenerator_BuyExpensiveSimple':return item.category==='Item'&&!item.ancestors.some(n=>['Apparel','Weapons','Medicine','Drugs'].includes(n))&&item.generic&&item.baseValue!==null&&item.baseValue/item.volume>=+(v.minValuePerUnit??15);
 default:return false; // Other generator families do not handle the selected non-pawn catalog.
 }
}
export function acceptItem(records,traderId,name){const i=itemInfo(records,name);return{playerSellable:['All','Sellable'].includes(i.tradeability),willTrade:generators(records,traderId).some(g=>handles(g,i)),sellFactor:i.sellFactor};}
export function evaluate(model,i,d){switch(model){
 case 'negotiator':{const factors=[i.talking??1,i.hearing??1].map((n,j)=>.1+.9*Math.min(1,n<1?clamp(n/(1-d.allowedDefects[j]),0,1):n));return{factors,gain:clamp(.015*i.social*factors[0]*factors[1]+(i.offset??0),0,.395)};}
 case 'price':{
  if(i.currency)return{buy:i.value,sell:i.value};
  let buy=i.value*d.buyGlobal*(i.buyType??1)*(i.joinAs??1)*(1+(i.loss??0))*(1-(i.gain??0)-(i.settlement??0));
  let sell=i.value*d.sellGlobal*(i.sellType??1)*(i.sellFactor??1)*(i.humanFactor??1)*(1-(i.loss??0))*(1+(i.gain??0)+(i.settlement??0)+(i.drug??0)+(i.animal??0));
  buy=Math.max(d.minimumBuy,buy);sell=Math.max(d.minimumSell,sell);
  if(buy>d.roundAbove)buy=roundEven(buy);if(sell>d.roundAbove)sell=roundEven(sell);
  if(i.favor!==undefined)sell=i.favor;
  return{buy,sell:Math.min(sell,buy)};
 }
 case 'settlement':{
  // Positive quantity buys; negative sells. Unit prices already finalized.
  const net=i.rows.reduce((n,r)=>n+r.quantity*(r.quantity>0?r.buy:r.sell),0),due=roundEven(net);
  const player=i.playerSilver??0,trader=i.traderSilver??0;
  if(player-due<0)return{net,due,status:'player-insufficient',playerSilver:player,traderSilver:trader,shortfall:0};
  const shortfall=Math.max(0,-due-trader);
  if(shortfall&&!i.confirmShortfall)return{net,due,status:'needs-shortfall-confirmation',playerSilver:player,traderSilver:trader,shortfall};
  const paid=Math.max(-trader,Math.min(player,due));
  return{net,due,status:'committed',playerSilver:player-paid,traderSilver:trader+paid,shortfall};
 }
 case 'eligibility':return{sellable:['All','Sellable'].includes(i.tradeability??'All')&&(i.abstractValue??1)>0&&(i.category??'Item')==='Item'&&i.fresh!==false&&!i.tainted&&!i.biocoded&&i.spawned!==false&&!i.fogged&&(i.home===true||i.stored===true)&&i.reachable!==false&&!i.nearbyBlocker&&i.willTrade!==false};
 case 'gift':{
  let base=i.lines.reduce((n,l)=>n+l.count*l.price*(l.sameFactionPrisoner?2:1)/d.giftDivisor,0),remaining=base,delta=0;
  while(remaining>=.25){delta+=.25*curve(d.giftCurve,Math.min(i.goodwill+delta,100));remaining-=.25;if(delta>=200)break;}
  if(delta<200)delta+=remaining*curve(d.giftCurve,Math.min(i.goodwill+delta,100));
  return{base,delta:Math.trunc(Math.min(delta,200)),after:clamp(i.goodwill+Math.trunc(Math.min(delta,200)),-100,100)};
 }
 case 'tradeGoodwill':return{delta:Math.trunc(i.soldValue/d.tradeGoodwillDivisor)};
 case 'goodwill':{
  let adjusted=i.delta;const current=i.current,natural=i.natural;
  if(natural<current&&adjusted<0||natural>current&&adjusted>0){const toward=Math.min(Math.abs(current-natural),Math.abs(adjusted));adjusted+=Math.sign(adjusted)*roundEven(.25*toward);}
  const after=clamp((i.base??current)+adjusted,-100,100),effective=Math.min(after,i.maxGoodwill??100);let relation=i.relation??'Neutral';
  if(relation!=='Hostile'&&effective<=-75)relation='Hostile';
  if(relation!=='Ally'&&effective>=75)relation='Ally';
  if(relation==='Hostile'&&effective>=0)relation='Neutral';
  if(relation==='Ally'&&effective<=0)relation='Neutral';
  return{adjusted,after,effective,relation};
 }
 case 'harm':return{rawDelta:i.mutuallyHostileCrossfire||i.exempt?0:Math.trunc(-1.3*Math.min(100,i.amount))};
 case 'pawnQuality':return{quality:i.forceNormal?2:i.forceQuality??clamp((i.center??2)+(i.roll<.1?-1:i.roll<.2?1:0),i.min??0,i.max??4)};
 case 'gearHp':return{hp:i.roll<1?Math.max(1,roundEven(i.roll*i.maxHp)):i.maxHp};
 case 'stockCount':{
  const count=i.countRange??[0,0],value=i.priceRange??[0,0];let n=0,attempts=0;
  if(count[1]>0&&value[1]<=0){n=i.countRoll;attempts=1;}
  else if(count[1]<=0&&value[1]>0){n=roundEven(i.priceRoll/i.baseValue);attempts=1;}
  else if(count[1]>0&&value[1]>0){do{n=i.countRolls[Math.min(attempts,i.countRolls.length-1)];attempts++;}while(attempts<=100&&(n*i.baseValue<value[0]||n*i.baseValue>value[1]));}
  return{count:n,generated:Math.max(0,n),attempts};
 }
 case 'quality':return{quality:Math.trunc(clamp(i.gaussian,2,5))};
 case 'stockWeight':return{weight:curve(d.stockWeight,i.baseValue)};
 case 'carriers':return{carriers:Math.ceil(i.nonPawnEntries/8),guardBudget:i.totalPoints-45};
 case 'schedule':{const interval=Math.floor(i.ticks/1000),relative=interval-300;return{interval,relative,cycle:relative<0?-1:Math.floor(relative/3600),offset:relative<0?-1:relative%3600};}
 case 'allyFraction':return{fraction:i.nonHostile===0?-1:curve(d.allyCurve,i.nonHostile/Math.max(i.canBeNonHostile,1))};
 case 'stay':return{leave:i.elapsed>i.duration};
 case 'loss':return{fightingExit:i.violent>=i.ever*.2,importantExit:!!i.important||i.violent>0&&i.violent/i.ever>=.5};
 case 'accept':return acceptItem(d.xmlRecords,i.traderId,i.name);
 default:throw Error('Unknown trade model '+model);
}}
