param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Read-only static projection. Never execute the target, launch a browser or capture GUI.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/animal-environment-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/animal-environment-manifest.json'
$reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static identity mismatch'}
$sources=@{}
foreach($m in $manifest.types){$file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)}
$rules=@(
 @('Verse.RaceProperties','public Intelligence intelligence;','Unspecified race intelligence uses enum zero, Animal.'),
 @('Verse.RaceProperties','public FleshTypeDef FleshType => fleshType ?? FleshTypeDefOf.Normal;','Unspecified flesh type resolves to Normal, not Insectoid.'),
 @('Verse.Pawn','health.HealthTickInterval(delta);','Pawn interval update calls the health tracker.'),
 @('Verse.Thing','return GenTemperature.GetTemperatureForCell(PositionHeld, MapHeld);','Carried things without a fixed-temperature holder use their carrier/root position temperature.'),
 @('Verse.Thing','ThingOwnerUtility.TryGetFixedTemperature(parentHolder, this, out var temperature)','A holder may explicitly override ambient temperature.'),
 @('Verse.AttachableThing','Scribe_References.Look(ref parent, "parent");','Fire attachment persists an entity reference across saves.'),
 @('Verse.AttachableThing','return parent.DrawPos + Vector3.up * 0.03292683f;','Attached fire visuals follow the parent draw position.'),
 @('Verse.CompAttachBase','attachments[i].Position = parent.Position;','Attachment component updates physical attachment positions to the parent each tick.'),
 @('Verse.GenTemperature','p.GetStatValue(StatDefOf.ComfyTemperatureMin','Comfort limits read effective pawn stats, not a single human default.'),
 @('Verse.GenTemperature','result.min -= 10f;','Safe minimum is ten degrees below comfortable minimum.'),
 @('Verse.GenTemperature','result.max += 10f;','Safe maximum is ten degrees above comfortable maximum.'),
 @('Verse.Pawn_HealthTracker','if (!pawn.IsHashIntervalTick(60, delta))','Race environmental hediff givers are gated by a sixty-tick hash interval.'),
 @('Verse.Pawn_HealthTracker','hediffGivers[num8].OnIntervalPassed(pawn, null);','Race hediff sets invoke the environmental damage/recovery logic.'),
 @('Verse.HediffGiver_Heat','if (ambientTemperature > floatRange2.max)','Heatstroke increases only strictly above safe maximum.'),
 @('Verse.HediffGiver_Heat','x = TemperatureOverageAdjustmentCurve.Evaluate(x);','Heat overage is nonlinear before multiplying by the per-interval coefficient.'),
 @('Verse.HediffGiver_Heat','float a = x * 6.45E-05f;','Heat accumulation is a severity delta per giver interval.'),
 @('Verse.HediffGiver_Heat','a = Mathf.Max(a, 0.000375f);','Heat accumulation has a positive minimum beyond the safe threshold.'),
 @('Verse.HediffGiver_Heat','ambientTemperature < floatRange.max','Heatstroke recovers only strictly below the comfortable maximum.'),
 @('Verse.HediffGiver_Heat','float value = firstHediffOfDef.Severity * 0.027f;','Recovery scales with present severity.'),
 @('Verse.HediffGiver_Heat','value = Mathf.Clamp(value, 0.0015f, 0.015f);','Recovery has minimum and maximum per-interval decrements.'),
 @('Verse.HediffGiver_Heat','!pawn.IsNestedHashIntervalTick(60, 420)','Very hot air burns are a separate nested check every 420 ticks.'),
 @('Verse.HediffGiver_Heat','float num = floatRange.max + 150f;','Air-burn threshold is comfortable maximum plus 150 degrees.'),
 @('Verse.HediffGiver_Heat','new DamageInfo(DamageDefOf.Burn, num2)','Very hot air can inflict a real burn in addition to heatstroke.'),
 @('Verse.HediffGiver_Hypothermia','ambientTemperature < floatRange2.min','Hypothermia accumulates only strictly below safe minimum.'),
 @('Verse.HediffGiver_Hypothermia','Mathf.Abs(ambientTemperature - floatRange2.min) * 6.45E-05f','Cold overage uses a linear coefficient.'),
 @('Verse.HediffGiver_Hypothermia','a = Mathf.Max(a, 0.00075f);','Cold accumulation has its own minimum.'),
 @('Verse.HediffGiver_Hypothermia','ambientTemperature > floatRange.min || !pawn.SpawnedOrAnyParentSpawned || pawn.PositionHeld.GetTerrain(pawn.MapHeld).heatPerTick > 0f','Cold recovery has warmer-environment, unspawned and hot-terrain branches.'),
 @('Verse.HediffGiver_Hypothermia','value = Mathf.Clamp(value, 0.0015f, 0.015f);','Cold recovery uses the same bounded severity decrement.'),
 @('Verse.HediffGiver_Hypothermia','firstHediffOfDef.Severity > 0.37f','Severe cold has a secondary frostbite branch.'),
 @('Verse.HediffGiver_Hypothermia','float num = 0.025f * firstHediffOfDef.Severity;','Frostbite uses a random severity-dependent chance.'),
 @('Verse.HediffGiver_Hypothermia','new DamageInfo(DamageDefOf.Frostbite, num2','Frostbite is actual anatomical damage, distinct from systemic hypothermia.'),
 @('Verse.HediffGiver_Hypothermia','pawn.RaceProps.FleshType == FleshTypeDefOf.Insectoid','Insectoids substitute HypothermicSlowdown; this does not describe the five Core species.'),
 @('Verse.Hediff','pawn.health.Notify_HediffChanged(this);','A stage change or lethal threshold invalidates capacities and checks health state.'),
 @('Verse.Hediff','bool flag = Severity >= def.lethalSeverity;','Lethal severity is an inclusive comparison.'),
 @('Verse.Hediff','if (!def.tendable || Severity <= 0f','Temperature conditions are not tendable merely because they are visible.'),
 @('Verse.HediffDef','public bool tendable;','Tendability defaults false unless a definition overrides it.'),
 @('Verse.Pawn_HealthTracker','hediffSet.DirtyCache();','Hediff changes invalidate health caches before state recalculation.'),
 @('Verse.Pawn_HealthTracker','!InPainShock && capacities.CanBeAwake && (capacities.CapableOf(PawnCapacityDefOf.Moving)','Downing depends on pain, consciousness and movement, not only a scalar HP.'),
 @('Verse.PawnCapacitiesHandler','GetLevel(PawnCapacityDefOf.Consciousness) >= 0.3f','Ordinary wakefulness requires consciousness at least .3.'),
 @('Verse.Pawn_HealthTracker','hediff.def.canApplyDodChanceForCapacityChanges','Some systemic diseases also qualify for nonplayer death-on-downed.'),
 @('Verse.Pawn_HealthTracker','num = 0.5f;','Ordinary nonplayer nonhost animals have a default eligible death-on-downed chance; enclosing branch retained separately.'),
 @('Verse.Pawn_HealthTracker','if (hediff.CauseDeathNow())','Health state checks systemic lethal hediffs, independently of injury sums.'),
 @('Verse.HediffSet','hediffs[i].CurStageIndex >= (int)minStage','Temperature injury AI uses definition stage indices.'),
 @('RimWorld.JobGiver_SeekSafeTemperature','public bool requiresInjury = true;','Default seek-temperature job waits for injury, not merely uncomfortable weather.'),
 @('RimWorld.JobGiver_SeekSafeTemperature','HasTemperatureInjury(TemperatureInjuryStage.Serious)','Default seek-temperature job requires serious or worse heatstroke/hypothermia.'),
 @('RimWorld.JobGiver_SeekSafeTemperature','FloatRange tempRange = pawn.ComfortableTemperatureRange();','Recovery destination is the comfortable range despite the class name SafeTemperature.'),
 @('RimWorld.JobGiver_SeekSafeTemperature','JobDefOf.Wait_SafeTemperature, 500','A patient already in the comfortable range waits for recovery and reevaluation.'),
 @('RimWorld.JobGiver_SeekSafeTemperature','JobDefOf.GotoSafeTemperature, cell','Otherwise the pawn physically walks to the selected temperature destination.'),
 @('RimWorld.JobGiver_SeekSafeTemperature','RegionTraverser.BreadthFirstTraverse','Search traverses reachable regions rather than teleporting the pawn.'),
 @('RimWorld.JobGiver_SeekSafeTemperature','if (r.IsDoorway)','Doorway regions are not recovery destinations.'),
 @('RimWorld.JobGiver_SeekSafeTemperature','tempRange.Includes(r.Room.Temperature)','Destination qualification uses region room temperature.'),
 @('RimWorld.JobGiver_SeekSafeTemperature','randomCell.InAllowedArea(pawn)','Destination cell remains constrained by allowed area.'),
 @('RimWorld.ThinkNode_ConditionalAnimalWrongSeason','!pawn.Map.mapTemperature.SeasonAcceptableFor(pawn.def)','Wildlife season departure uses the species seasonal acceptability check.'),
 @('Verse.MapTemperature','float seasonalTemp = SeasonalTemp;','Season acceptability uses seasonal temperature, not current room temperature.'),
 @('Verse.MapTemperature','seasonalTemp > animalRace.GetStatValueAbstract(StatDefOf.ComfyTemperatureMin) - buffer','Season acceptability has a strict lower species comfort bound.'),
 @('Verse.MapTemperature','seasonalTemp < animalRace.GetStatValueAbstract(StatDefOf.ComfyTemperatureMax) + buffer','Season acceptability has a strict upper species comfort bound.'),
 @('RimWorld.ThinkNode_ConditionalDangerousTemperature','!pawn.SafeTemperatureRange().Includes(pawn.AmbientTemperature)','Dangerous temperature checks actual ambient temperature against safe limits.'),
 @('RimWorld.ThinkNode_ConditionalOutdoorTemperature','pawn.Position.UsesOutdoorTemperature(pawn.Map)','Dangerous-weather departure also requires a cell using outdoor temperature.'),
 @('Verse.AI.JobGiver_ExitMap','if (pawn.Downed && !pawn.Crawling)','Downed noncrawling animals cannot begin an exit-map job.'),
 @('Verse.AI.JobGiver_ExitMapRandom','RCellFinder.TryFindRandomExitSpot','Departure requires finding an actual reachable exit spot.'),
 @('Verse.AI.JobGiver_ExitMap','job2.exitMapOnArrival = true;','Wildlife exits after physical arrival at a map edge.'),
 @('RimWorld.WildAnimalSpawner','map.mapTemperature.SeasonAcceptableFor(a.race)','Wildlife spawning also filters season suitability.'),
 @('RimWorld.Fire','public class Fire : AttachableThing','Burning is an independent attachment instance, not just an animal health boolean.'),
 @('RimWorld.Fire','public override int UpdateRateTicks => 15;','Fire interval updates use fifteen ticks.'),
 @('RimWorld.Fire','this.IsHashIntervalTick(150, delta)','Complex fire effects run on a separate 150-tick hash interval.'),
 @('RimWorld.FireUtility','t.def.category != ThingCategory.Pawn','Attachment eligibility is Pawn-based, not restricted to humans.'),
 @('RimWorld.FireUtility','t.TryGetComp<CompAttachBase>() == null','Attachment support and current flammability are explicit prerequisites.'),
 @('RimWorld.FireUtility','fire.AttachTo(t);','New fire is attached to the same target entity.'),
 @('RimWorld.FireUtility','pawn.jobs.StopAll();','Ignition interrupts current pawn jobs immediately.'),
 @('RimWorld.FireUtility','return 1f - Mathf.Pow(1f - num, freqInTicks / 60f);','Flammability-based per-second catch probability is converted to cumulative interval probability.'),
 @('RimWorld.Fire','parent == null && fireSize > 0.4f','A sufficiently large static fire can ignite co-located pawns.'),
 @('RimWorld.Fire','list[i].TryAttachFire(fireSize * 0.2f, instigator);','Static-fire ignition starts a smaller attached fire.'),
 @('RimWorld.Fire','thing2 = parent;','An attached fire damages its own parent.'),
 @('RimWorld.Fire','(!(fireSize < 0.4f) || thing2 == parent || thing2.def.category != ThingCategory.Pawn)','Small static fires exempt pawns from ordinary damage; attached fire still damages its parent.'),
 @('RimWorld.Fire','dinfo.SetBodyRegion(BodyPartHeight.Undefined, BodyPartDepth.Outside);','Fire selects an external anatomical region.'),
 @('RimWorld.Fire','GenTemperature.PushHeat(Position, Map, num);','Fire also heats the environment; thermal disease remains separate from burns.'),
 @('RimWorld.Fire','if (!Position.GetTerrain(Map).extinguishesFire)','Extinguishing terrain prevents collecting fuel even for attached fire.'),
 @('Verse.DamageWorker_Flame','public class DamageWorker_Flame : DamageWorker_AddInjury','Flame produces injuries through the ordinary anatomy damage pipeline.'),
 @('Verse.DamageWorker_Flame','!damageResult.deflected && !dinfo.InstantPermanentInjury','Flame event attachment is gated by the damage result.'),
 @('RimWorld.ThinkNode_ConditionalBurning','pawn.HasAttachment(ThingDefOf.Fire)','Burning AI reacts to the attachment, not the presence of a ground fire.'),
 @('RimWorld.JobGiver_ExtinguishSelf','if (Rand.Value < 0.1f)','Self-extinguish selection is probabilistic per job evaluation, not a per-tick probability.'),
 @('RimWorld.JobDriver_ExtinguishSelf','toil.defaultDuration = 150;','Successful self-extinguish job waits 150 ticks.'),
 @('RimWorld.JobDriver_ExtinguishSelf','TargetFire.Destroy();','Self-extinguish removes the attached fire; it does not heal burns.'),
 @('Verse.AI.JobGiver_RunRandom','wanderRadius = 7f;','Random fire panic movement uses a local seven-cell wander radius.'),
 @('Verse.AI.JobGiver_RunRandom','ticksBetweenWandersRange = new IntRange(5, 10);','Panic movement uses short wander delays.'),
 @('Verse.AI.JobGiver_RunRandom','locomotionUrgency = LocomotionUrgency.Sprint;','Fire panic runs at sprint urgency.'),
 @('RimWorld.WorkGiver_FightFires','if (fire.parent is Pawn pawn2)','Automatic rescuing from fire covers compatible animal pawns as well as humans.'),
 @('RimWorld.WorkGiver_FightFires','pawn2.HostFaction != pawn.Faction && pawn2.HostFaction != pawn.HostFaction','Automatic attached-fire assistance is faction/host gated.'),
 @('RimWorld.WorkGiver_FightFires','IntVec3Utility.ManhattanDistanceFlat(pawn.Position, pawn2.Position) > 15','Automatic attached-fire aid outside Home has a fifteen-cell distance gate.'),
 @('Verse.DamageWorker_Extinguish','fire.fireSize -= dinfo.Amount * 0.01f;','Ordinary extinguishing damage reduces fire size.'),
 @('Verse.DamageWorker_Extinguish','if (fire.fireSize < 0.1f)','A fire below the minimum size is removed.')
)
$records=@(foreach($r in $rules){
 $text=$sources[$r[0]];$matches=@();$lines=$text.Split("`n")
 for($i=0;$i -lt $lines.Length;$i++){if($lines[$i].Contains($r[1])){$matches+=,[ordered]@{line=$i+1;text=$lines[$i].Trim()}}}
 if(!$matches.Count){throw "Missing anchor $($r[0]): $($r[1])"}
 [ordered]@{type=$r[0];needle=$r[1];locations=$matches;interpretation=$r[2]}
})
function Bounded([string]$type,[string]$start,[string]$end,[string[]]$absent,[string[]]$present,[string]$meaning){
 $s=$sources[$type];$a=$s.IndexOf($start,[StringComparison]::Ordinal);if($a -lt 0){throw "Missing start $start"}
 $b=if($end){$s.IndexOf($end,$a+$start.Length,[StringComparison]::Ordinal)}else{$s.Length};if($b -le $a){throw "Missing end $end"}
 $body=$s.Substring($a,$b-$a)
 foreach($t in $absent){if($body.Contains($t)){throw "Unexpected bounded token $type $t"}}
 foreach($t in $present){if(!$body.Contains($t)){throw "Missing bounded token $type $t"}}
 [ordered]@{type=$type;start=$start;end=$end;lineStart=$s.Substring(0,$a).Split("`n").Count;lineEnd=$s.Substring(0,$b).Split("`n").Count;sha256=TextHash $body;absent=$absent;present=$present;interpretation=$meaning}
}
$bounded=@(
 (Bounded 'Verse.GenTemperature' 'public static FloatRange SafeTemperatureRange(this Pawn p)' 'public static FloatRange SafeTemperatureRange(this Pawn p, List' @() @('result.min -= 10f;','result.max += 10f;') 'Both safety margins apply to current pawn comfort stats.'),
 (Bounded 'Verse.HediffGiver_Heat' 'public override void OnIntervalPassed' '' @('medicine','Tended','IsTended') @('ambientTemperature > floatRange2.max','ambientTemperature < floatRange.max','DamageDefOf.Burn') 'Heat accumulation, environment recovery and extreme-air burn share an environmental giver; no tending gate here.'),
 (Bounded 'Verse.HediffGiver_Hypothermia' 'public override void OnIntervalPassed' '' @('medicine','Tended','IsTended') @('ambientTemperature < floatRange2.min','ambientTemperature > floatRange.min','DamageDefOf.Frostbite') 'Cold recovery and secondary frostbite are separate effects; no tending gate here.'),
 (Bounded 'RimWorld.JobGiver_SeekSafeTemperature' 'protected override Job TryGiveJob' 'public static Region ClosestRegionWithinTemperatureRange' @('GeneratePawn','SetFaction','Destroy','Teleport') @('TemperatureInjuryStage.Serious','pawn.ComfortableTemperatureRange()','GotoSafeTemperature') 'Seeking a comfortable room changes a job, not identity or faction.'),
 (Bounded 'RimWorld.JobGiver_SeekSafeTemperature' 'public static Region ClosestRegionWithinTemperatureRange' 'public static bool TryGetAllowedCellInRegion' @('maxRadius)','maxRadius,') @('r.Allows(traverseParms','TryGetAllowedCellInRegion(r, pawn, out var _)','RegionTraverser.BreadthFirstTraverse') 'The named maxRadius parameter is not forwarded in this region-search body; no claimed radius guarantee.'),
 (Bounded 'Verse.AI.JobGiver_ExitMap' 'protected override Job TryGiveJob' 'protected abstract bool TryFindGoodExitDest' @('GeneratePawn','SetFaction') @('pawn.Downed','TryFindGoodExitDest','job2.exitMapOnArrival = true;') 'Departure schedules a reachable physical exit rather than deleting an animal on temperature change.'),
 (Bounded 'RimWorld.FireUtility' 'public static bool CanEverAttachFire' 'public static float ChanceToStartFireIn' @('Humanlike','Faction') @('t.FlammableNow','ThingCategory.Pawn','CompAttachBase') 'Fire attachment eligibility is not human-only or faction-only.'),
 (Bounded 'RimWorld.JobDriver_ExtinguishSelf' 'protected override IEnumerable<Toil> MakeNewToils' '' @('.Heal(','TakeDamage','Medical','GeneratePawn') @('toil.defaultDuration = 150;','TargetFire.Destroy();') 'Self-extinguishing waits and destroys fire; no injury healing in this driver.'),
 (Bounded 'RimWorld.WorkGiver_FightFires' 'if (fire.parent is Pawn pawn2)' "`t`telse" @('Humanlike','WorkTagIsDisabled') @('pawn2.Faction','pawn2.HostFaction','ManhattanDistanceFlat','pawn.CanReach') 'Attached-pawn branch lacks the static-fire branch work-tag check; work-scheduling eligibility still exists outside this method.'),
 (Bounded 'Verse.MapTemperature' 'public bool SeasonAcceptableFor' 'public bool OutdoorTemperatureAcceptableFor' @('AmbientTemperature','Room') @('SeasonalTemp','ComfyTemperatureMin','ComfyTemperatureMax') 'Season departure is distinct from instantaneous room exposure.')
)
$docs=@{}
function XmlDoc([string]$rel){if(!$docs.ContainsKey($rel)){$d=[Xml.XmlDocument]::new();$d.XmlResolver=$null;$d.Load((Join-Path $GameRoot $rel));$docs[$rel]=$d};return ,$docs[$rel]}
$raceFields=@('statBases/ComfyTemperatureMin','statBases/ComfyTemperatureMax','statBases/Flammability','race/hediffGiverSets','race/intelligence','race/fleshType','race/lifeStageAges','race/thinkTreeMain','comps/li[compClass="CompAttachBase"]')
$specs=@(
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml','/Defs/ThingDef[@Name="BasePawn"]',$raceFields,'Base pawn supplies flammability and attachment support; comfort limits are stat defaults unless overridden.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml','/Defs/ThingDef[@Name="AnimalThingBase"]',$raceFields,'Animal parent selects OrganicStandard givers; unspecified intelligence uses the class and enum default Animal.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Hares.xml','/Defs/ThingDef[@Name="BaseHare"]',$raceFields,'Hare temperature inheritance template.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Hares.xml','/Defs/ThingDef[defName="Hare"]',$raceFields,'Concrete hare inherits BaseHare temperature minimum.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_PigGroup.xml','/Defs/ThingDef[defName="Deer"]',$raceFields,'Deer temperature definition.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_SheepGroup.xml','/Defs/ThingDef[defName="Alpaca"]',$raceFields,'Alpaca temperature definition.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_CowGroup.xml','/Defs/ThingDef[defName="Dromedary"]',$raceFields,'Dromedary temperature definition.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_ChickenGroup.xml','/Defs/ThingDef[defName="Chicken"]',$raceFields,'Chicken temperature definition.'),
 @('Data/Core/Defs/Stats/Stats_Pawns_General.xml','/Defs/StatDef[defName="ComfyTemperatureMin"]',@('defaultBaseValue','minValue','maxValue','parts'),'Unspecified minimum is zero; gear may modify effective stats.'),
 @('Data/Core/Defs/Stats/Stats_Pawns_General.xml','/Defs/StatDef[defName="ComfyTemperatureMax"]',@('defaultBaseValue','minValue','maxValue','parts'),'Unspecified maximum is forty, including hare, deer and chicken.'),
 @('Data/Core/Defs/HediffGiverSetDefs/HediffGiverSets.xml','/Defs/HediffGiverSetDef[defName="OrganicStandard"]',@('hediffGivers/li[@Class="HediffGiver_Heat"]','hediffGivers/li[@Class="HediffGiver_Hypothermia"]'),'Animal parent links to both environmental givers.'),
 @('Data/Core/Defs/HediffDefs/Hediffs_Global_Temperature.xml','/Defs/HediffDef[defName="Heatstroke"]',@('hediffClass','tendable','lethalSeverity','canApplyDodChanceForCapacityChanges','stages'),'Heatstroke phases and capacity modifiers.'),
 @('Data/Core/Defs/HediffDefs/Hediffs_Global_Temperature.xml','/Defs/HediffDef[defName="Hypothermia"]',@('hediffClass','tendable','lethalSeverity','canApplyDodChanceForCapacityChanges','stages'),'Hypothermia phases and capacity modifiers.'),
 @('Data/Core/Defs/ThinkTreeDefs/SubTrees_Misc.xml','/Defs/ThinkTreeDef[defName="BurningResponse"]',@('thinkRoot'),'Self-extinguish then panic movement; jumping into water requires ToolUser intelligence.'),
 @('Data/Core/Defs/ThinkTreeDefs/SubTrees_Misc.xml','/Defs/ThinkTreeDef[defName="LeaveIfWrongSeason"]',@('thinkRoot'),'Seasonal departure walks; dangerous outdoor exposure departure jogs.'),
 @('Data/Core/Defs/ThinkTreeDefs/Animal.xml','/Defs/ThinkTreeDef[defName="Animal"]',@('thinkRoot/subNodes/li/treeDef','.//li[@Class="JobGiver_SeekSafeTemperature"]'),'Animal root priority and seek-temperature placement; exact ancestor paths recorded separately.'),
 @('Data/Core/Defs/PawnCapacityDefs/PawnCapacity.xml','/Defs/PawnCapacityDef[defName="Consciousness"]',@('workerClass','minForCapable','lethalFlesh'),'Lethal capability and awake-capability thresholds are different.'),
 @('Data/Core/Defs/PawnCapacityDefs/PawnCapacity.xml','/Defs/PawnCapacityDef[defName="Moving"]',@('workerClass','minForCapable','zeroIfCannotBeAwake'),'Movement falls to zero when unable to be awake.')
)
$defs=@(foreach($spec in $specs){
 $doc=XmlDoc $spec[0];$nodes=@($doc.SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected XML node count: $($spec[1])"}
 $node=$nodes[0];$fields=@(foreach($xpath in $spec[2]){$values=@($node.SelectNodes($xpath));[ordered]@{xpath=$xpath;count=$values.Count;xml=@($values|ForEach-Object OuterXml)}})
 [ordered]@{file=$spec[0];sha256=Hash (Join-Path $GameRoot $spec[0]);xpath=$spec[1];nameAttribute=$node.GetAttribute('Name');parentName=$node.GetAttribute('ParentName');fields=$fields;interpretation=$spec[3]}
})
$thinkDoc=XmlDoc 'Data/Core/Defs/ThinkTreeDefs/Animal.xml'
$thinkNodes=@(foreach($node in $thinkDoc.SelectNodes('/Defs/ThinkTreeDef[defName="Animal"]//li[@Class="JobGiver_SeekSafeTemperature" or treeDef="LeaveIfWrongSeason" or treeDef="BurningResponse"]')){
 $anc=@();$p=$node.ParentNode;while($p -and $p.Name -ne 'ThinkTreeDef'){if($p.Attributes['Class']){$anc+=,[ordered]@{class=$p.GetAttribute('Class');invert=$p.SelectSingleNode('invert')?.InnerText}};$p=$p.ParentNode}
 [ordered]@{class=$node.GetAttribute('Class');treeDef=$node.SelectSingleNode('treeDef')?.InnerText;ancestorsNearestFirst=$anc}
})
$profiles=@(
 @('Hare','Races_Animal_Hares.xml','/Defs/ThingDef[@Name="BaseHare"]',-30,40),
 @('Deer','Races_Animal_PigGroup.xml','/Defs/ThingDef[defName="Deer"]',-30,40),
 @('Alpaca','Races_Animal_SheepGroup.xml','/Defs/ThingDef[defName="Alpaca"]',-20,45),
 @('Dromedary','Races_Animal_CowGroup.xml','/Defs/ThingDef[defName="Dromedary"]',-22,60),
 @('Chicken','Races_Animal_ChickenGroup.xml','/Defs/ThingDef[defName="Chicken"]',-10,40)
)
$statsDoc=XmlDoc 'Data/Core/Defs/Stats/Stats_Pawns_General.xml'
$defaultMaximum=[double]$statsDoc.SelectSingleNode('/Defs/StatDef[defName="ComfyTemperatureMax"]/defaultBaseValue').InnerText
if($defaultMaximum -ne 40){throw 'Default comfortable maximum changed'}
$species=@(foreach($p in $profiles){
 $node=(XmlDoc ('Data/Core/Defs/ThingDefs_Races/'+$p[1])).SelectSingleNode($p[2]);$min=[double]$node.statBases.ComfyTemperatureMin;$max=if($node.statBases.ComfyTemperatureMax){[double]$node.statBases.ComfyTemperatureMax}else{$defaultMaximum}
 if($min -ne $p[3] -or $max -ne $p[4]){throw "Species temperature drifted: $($p[0])"}
 [ordered]@{def=$p[0];comfyMin=$min;comfyMax=$max;safeMin=$min-10;safeMax=$max+10;maximumFromStatDefault=(!$node.statBases.ComfyTemperatureMax)}
})
$record=[ordered]@{
 evidence_id='RW17-ANIMAL-ENVIRONMENT-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash
 reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile)
 manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile)
 rules=$records;boundedChecks=$bounded;packagedXml=$defs;animalThinkTreeNodes=$thinkNodes
 nativeReference=[ordered]@{
  species=$species;giverIntervalTicks=60;safeTemperatureMargin=10
  heatOverageCurve=@(@(0,0),@(25,25),@(50,40),@(100,60),@(200,80),@(400,100),@(4000,1000))
  heatOverageCoefficient=.0000645;heatMinimumIncrease=.000375;coldOverageCoefficient=.0000645;coldMinimumIncrease=.00075
  recoverySeverityFactor=.027;recoveryMinimum=.0015;recoveryMaximum=.015;recoveryUsesComfortBoundaryStrictly=$true
  stages=@(0,.04,.2,.35,.62);extremeConsciousnessMaximum=.1;lethalSeverity=1;ordinaryAwakeConsciousnessMinimum=.3
  temperatureDiseasesTendableByDefault=$false;nonplayerNonhostAnimalDefaultDeathOnDownedChance=.5
  seekComfortableTemperatureMinimumStage='Serious';seekComfortableTemperatureFactionBranch='OfPlayerFaction';seekComfortableTemperatureWaitTicks=500
  wildSeasonExitLocomotion='Walk';wildDangerousOutdoorTemperatureExitLocomotion='Jog';exitRequiresPhysicalArrival=$true
  fireUpdateTicks=15;fireComplexIntervalTicks=150;staticFirePawnIgnitionMinimumExclusive=.4;attachedFireStartFactorFromStatic=.2
  selfExtinguishSelectionChancePerJobEvaluation=.1;selfExtinguishDelayTicks=150;selfExtinguishHealsInjuries=$false
  panicRadius=7;panicWanderDelayTicks=@(5,10);panicLocomotion='Sprint';animalJumpInWaterNodeEligible=$false
 }
 webDesignChoices=@('Keep species comfort, systemic temperature injuries, attached fire and anatomical burns separate.','Connect actual movement, rescue, recovery, death and item/carcass conservation before tuning rates.','A deterministic Web self-extinguish schedule differs from the native random job-selection gate.','No random death-on-downed, no secondary frostbite and no extreme-air burn are explicit prototype omissions if not implemented.','A simplified weather-only wildlife exit condition does not reproduce native seasonal-temperature departure.')
 limits=@('Static derived C# and packaged Core XML are not source or runtime proof.','REA metadata is reused only for the identical assembly identity; ILSpy reconstructed the separately hashed types.','No game, browser, preview, GUI or screenshot was launched.','Selected XML nodes are not the mod-patched effective Def database; DLC, scenarios and health effects can alter effective stats.','Bounded absence claims apply only to the named method body; surrounding scheduling and indirect callbacks can add gates.','Native thresholds and random probabilities are reference constants, not measured Web parity.','Full derived C#, assemblies and game assets remain ignored and unpublished.')
 collectorSha256=Hash $PSCommandPath
}
$json=($record|ConvertTo-Json -Depth 30).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static animal-environment projection differs'};"Checked animal-environment: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) XML projections, $($species.Count) species"}
else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));"Collected animal-environment: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) XML projections, $($species.Count) species"}
