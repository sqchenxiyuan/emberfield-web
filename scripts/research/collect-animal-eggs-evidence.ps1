param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Static derived PE and packaged XML only. Target code is not loaded or executed.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/animal-eggs-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/animal-eggs-manifest.json'
$reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static identity mismatch'}
$sources=@{}
foreach($m in $manifest.types){$file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)}
$rules=@(
 @('RimWorld.CompEggLayer','Props.eggLayFemaleOnly && pawn != null && pawn.gender != Gender.Female','Ordinary egg laying is female-only when the component default is retained.'),
 @('RimWorld.CompEggLayer','pawn != null && !pawn.ageTracker.CurLifeStage.milkable','The egg layer checks the milkable life-stage flag, not shearable.'),
 @('RimWorld.CompEggLayer','if (pawn.Sterile())','Sterile animals cannot grow or normally lay eggs.'),
 @('RimWorld.CompEggLayer','ModsConfig.AnomalyActive && pawn.IsShambler','Anomaly shamblers are excluded.'),
 @('Verse.Pawn','if (!ageTracker.CurLifeStage.reproductive)','Sterile includes nonreproductive life stages.'),
 @('Verse.Pawn','health.hediffSet.HasHediffPreventsPregnancy()','Sterility also respects pregnancy-preventing health conditions.'),
 @('Verse.Pawn','if (this.SterileGenes())','Sterility also respects applicable gene rules.'),
 @('RimWorld.CompProperties_EggLayer','public bool eggLayFemaleOnly = true','Female-only is the component default.'),
 @('RimWorld.CompProperties_EggLayer','public float eggProgressUnfertilizedMax = 1f','Unfertilized eggs can mature fully unless a species overrides the default.'),
 @('RimWorld.CompEggLayer','Scribe_Values.Look(ref eggProgress, "eggProgress", 0f)','Egg progress is persisted independently from fertilization.'),
 @('RimWorld.CompEggLayer','Scribe_Values.Look(ref fertilizationCount, "fertilizationCount", 0)','Remaining fertilized egg count is persisted.'),
 @('RimWorld.CompEggLayer','Scribe_References.Look(ref fertilizedBy, "fertilizedBy")','The remembered male parent is persisted.'),
 @('RimWorld.CompEggLayer','parent.IsHashIntervalTick(2500) && Active','Egg growth is checked on the animal hash every 2500 native ticks.'),
 @('RimWorld.CompEggLayer','float num = 2500f / (Props.eggLayIntervalDays * 60000f)','Growth increment converts the species interval from days.'),
 @('RimWorld.CompEggLayer','num *= PawnUtility.BodyResourceGrowthSpeed(pawn)','Growth shares the food-category multiplier with milk and wool.'),
 @('RimWorld.CompEggLayer','eggProgress = 1f','Growth caps at a single pending cycle.'),
 @('RimWorld.CompEggLayer','eggProgress = Props.eggProgressUnfertilizedMax','Species with a partial unfertilized cap stop at that cap; chicken retains the default one.'),
 @('RimWorld.PawnUtility','return pawn.needs?.food?.CurCategory.HungerMultiplier() ?? 1f','Missing food need defaults to growth multiplier one.'),
 @('RimWorld.HungerLevelUtility','HungerCategory.Fed => 1f','Fed multiplier is one.'),
 @('RimWorld.HungerLevelUtility','HungerCategory.Hungry => 0.5f','Hungry multiplier is one half.'),
 @('RimWorld.HungerLevelUtility','HungerCategory.UrgentlyHungry => 0.25f','Urgently hungry multiplier is one quarter.'),
 @('RimWorld.HungerLevelUtility','HungerCategory.Starving => 0f','Starvation stops new egg progress.'),
 @('RimWorld.CompEggLayer','public bool FullyFertilized => fertilizationCount >= Props.eggFertilizationCountMax','Mate eligibility uses remaining capacity, not egg progress.'),
 @('RimWorld.CompEggLayer','fertilizationCount = Props.eggFertilizationCountMax','Successful fertilization replaces the remaining quota with the maximum; it does not add beyond it.'),
 @('RimWorld.CompEggLayer','fertilizedBy = male','Fertilization retains the male reference.'),
 @('RimWorld.JobGiver_Mate','pawn.gender != Gender.Male || pawn.Sterile() || pawn.RaceProps.disableMating','Only eligible males initiate the ordinary mate job.'),
 @('RimWorld.JobGiver_Mate','if (pawn3.Faction != pawn.Faction)','Mate assignment requires the same faction.'),
 @('RimWorld.JobGiver_Mate','!pawn3.CanCasuallyInteractNow() || pawn3.IsForbidden(pawn)','Female mate must be casually interactible and not forbidden to the male.'),
 @('RimWorld.JobGiver_Mate','PathEndMode.Touch, TraverseParms.For(pawn), 30f, validator','Mate search requires a reachable contact destination within 30 cells.'),
 @('RimWorld.PawnUtility','return !compEggLayer.FullyFertilized','Egg-layer mate targets must have remaining fertilization capacity.'),
 @('Verse.AI.ThinkNode_ChancePerHour','GetLastTryTick(pawn) + 2500','The chance node checks no more often than once per native hour.'),
 @('Verse.AI.ThinkNode_ChancePerHour','Rand.MTBEventOccurs(num, 2500f, 2500f)','The species interval is an MTB chance parameter, not a fixed recurring deadline.'),
 @('Verse.AI.ThinkNode_ChancePerHour_Mate','return pawn.RaceProps.mateMtbHours','Mate frequency reads the species mateMtbHours.'),
 @('RimWorld.JobDriver_Mate','Toils_General.WaitWith(TargetIndex.A, 500)','Mating needs an actual contact wait of 500 native ticks.'),
 @('RimWorld.JobDriver_Mate','PawnUtility.Mated(pawn, Female)','Fertilization occurs only after the job reaches its final action.'),
 @('RimWorld.PawnUtility','compEggLayer.Fertilize(male)','Egg layers are fertilized directly; the following random pregnancy branch is for non-egg layers.'),
 @('RimWorld.CompEggLayer','fertilizationCount = Mathf.Max(0, fertilizationCount - randomInRange)','Fertilized production spends the laid egg count, clamped at zero.'),
 @('RimWorld.CompEggLayer','compHatcher.hatcheeFaction = parent.Faction','A freshly laid fertile stack remembers the laying animal faction.'),
 @('RimWorld.CompEggLayer','compHatcher.hatcheeParent = hatcheeParent','The laying animal becomes one parent of the stack.'),
 @('RimWorld.CompEggLayer','compHatcher.otherParent = fertilizedBy','The remembered mate becomes the other parent of the stack.'),
 @('RimWorld.JobGiver_LayEgg','compEggLayer == null || !compEggLayer.CanLayNow','Ordinary laying requires an active full component.'),
 @('RimWorld.JobGiver_LayEgg','if (pawn.Faction == Faction.OfPlayer)','Only the player-faction branch prefers an egg box.'),
 @('RimWorld.JobGiver_LayEgg','pawn.GetRoom() == null || x.GetRoom() == pawn.GetRoom()','Fallback existing same-type egg search prefers the same room, except a null current room.'),
 @('RimWorld.JobGiver_LayEgg','RCellFinder.RandomWanderDestFor(pawn, pawn.Position, 5f, null, Danger.Some)','Without a nearby egg stack, the animal chooses a nearby wander cell.'),
 @('RimWorld.JobGiver_LayEgg','thing.IsForbidden(pawn) || !pawn.CanReserve(thing) || !pawn.Position.InHorDistOf(thing.Position, 30f)','Egg-box candidate checks forbidden status, reservability and a 30-cell bound.'),
 @('RimWorld.JobGiver_LayEgg','((float?)compEggContainer.ContainedThing?.stackCount * 5f) ?? 0.5f','Nonfull existing egg contents score above an empty box.'),
 @('RimWorld.JobDriver_LayEgg','Toils_Goto.GotoCell(TargetIndex.A, PathEndMode.OnCell)','The laying animal moves onto the target cell.'),
 @('RimWorld.JobDriver_LayEgg','Toils_General.Wait(500)','Laying waits 500 ticks and does not consume colonist Handling labor.'),
 @('RimWorld.JobDriver_LayEgg','Thing thing = pawn.GetComp<CompEggLayer>().ProduceEgg()','Production happens after the movement and wait.'),
 @('RimWorld.JobDriver_LayEgg','EggBoxComp.innerContainer.TryAdd(thing)','An accepting targeted egg box receives the product; this call does not inspect the insertion result.'),
 @('RimWorld.JobDriver_LayEgg','t.SetForbidden(value: true)','Non-player laid ground eggs are marked forbidden in the placement callback.'),
 @('RimWorld.CompHatcher','Scribe_Values.Look(ref gestateProgress, "gestateProgress", 0f)','Incubation progress is per stack and persisted.'),
 @('RimWorld.CompHatcher','Scribe_References.Look(ref hatcheeFaction, "hatcheeFaction")','The hatch faction is persisted independently from the egg item faction.'),
 @('RimWorld.CompHatcher','if (!TemperatureDamaged)','Incubation advances until full temperature ruin, not only while current temperature is safe.'),
 @('RimWorld.CompHatcher','float num = 1f / (Props.hatcherDaystoHatch * 60000f)','Incubation uses a per-tick fraction of the declared duration.'),
 @('RimWorld.CompHatcher','if (gestateProgress > 1f)','Native completion condition is strictly greater than one.'),
 @('RimWorld.CompHatcher','Thing thing = ThingMaker.MakeThing(compProperties_EggLayer.eggUnfertilizedDef)','Temperature-ruined eggs inside an egg box become newly created unfertilized eggs.'),
 @('RimWorld.CompHatcher','GenSpawn.Spawn(compProperties_EggLayer.eggUnfertilizedDef, positionHeld, mapHeld).stackCount = stackCount2','Other temperature-ruined egg holders use a newly spawned unfertilized stack and retain its count.'),
 @('RimWorld.CompHatcher','DevelopmentalStage.Newborn','Hatching requests newborn pawns; the common generator handles newborn ages and needs.'),
 @('RimWorld.CompHatcher','for (int i = 0; i < parent.stackCount; i++)','One newborn pawn is generated per unit of the egg stack.'),
 @('RimWorld.CompHatcher','Pawn pawn = PawnGenerator.GeneratePawn(request)','Each iteration generates a new pawn through the common generator.'),
 @('Verse.PawnGenerator','!DevelopmentalStageExtensions.Newborn(request.AllowedDevelopmentalStages) && !request.ForceGenerateNewPawn','The newborn request bypasses the ordinary world-pawn reuse path.'),
 @('Verse.PawnGenerator','pawn.ageTracker.AgeBiologicalTicks = 0L','Newborn generation sets biological age to zero.'),
 @('Verse.PawnGenerator','pawn.ageTracker.AgeChronologicalTicks = 0L','Newborn generation sets chronological age to zero.'),
 @('Verse.PawnGenerator','else if (Rand.Value < 0.5f)','The ordinary species gender branch uses a half-probability male choice when no fixed or forced gender applies.'),
 @('Verse.PawnGenerator','pawn.needs.food.CurLevelPercentage = Mathf.Lerp(pawn.needs.food.PercentageThreshHungry, pawn.needs.food.PercentageThreshUrgentlyHungry, 0.5f)','Newborn food starts between the hungry and urgently-hungry thresholds; chicks are not created fully fed.'),
 @('Verse.ThingDef','public FloatRange startingHpRange = FloatRange.One','Fresh ordinary items default to their full starting HP fraction unless definitions override it.'),
 @('Verse.Thing','HitPoints = Mathf.RoundToInt((float)MaxHitPoints * Mathf.Clamp01(def.startingHpRange.RandomInRange))','Fresh item initialization reads its own definition starting HP range, not the destroyed source item HP.'),
 @('RimWorld.CompHatcher','PawnUtility.TrySpawnHatchedOrBornPawn(pawn, parent)','Spawn handling supports map-held eggs and selected caravan/world inventories.'),
 @('RimWorld.CompHatcher','hatcheeParent.Faction == hatcheeFaction','Inherited area restriction requires mother and hatch faction to agree.'),
 @('RimWorld.CompHatcher','pawn.relations.AddDirectRelation(PawnRelationDefOf.Parent, hatcheeParent)','Flesh newborns record the laying parent.'),
 @('RimWorld.CompHatcher','pawn.relations.AddDirectRelation(PawnRelationDefOf.Parent, otherParent)','An eligible distinct-sex other parent is recorded too.'),
 @('RimWorld.CompHatcher','Find.WorldPawns.PassToWorld(pawn, PawnDiscardDecideMode.Discard)','Failed placement sends the generated pawn to the discard path rather than retaining an unhatched unit.'),
 @('RimWorld.CompHatcher','TemperatureDamaged != comp.TemperatureDamaged','Hatcher stacking excludes stacks with differing fully ruined state.'),
 @('RimWorld.CompHatcher','gestateProgress = Mathf.Lerp(gestateProgress, b, t)','Stack absorption averages incubation progress weighted by counts; it does not retain each unit clock.'),
 @('RimWorld.CompHatcher','comp.hatcheeParent = hatcheeParent','Splitting copies the receiving new stack parent identity.'),
 @('RimWorld.CompHatcher','comp.hatcheeFaction = hatcheeFaction','Splitting copies the hatch faction.'),
 @('RimWorld.CompHatcher','hatcheeFaction = Faction.OfPlayer','Buying sets the resulting hatch faction to the player.'),
 @('RimWorld.CompHatcher','hatcheeFaction = trader.Faction','Selling sets the hatch faction to the trader faction.'),
 @('RimWorld.CompHatcher','hatcheeFaction = forFaction','Trader generation initializes the hatch faction from the supplied faction.'),
 @('RimWorld.CompTemperatureRuinable','public bool Ruined => ruinedPercent >= 1f','Full damage is a one-way ruin threshold unless another caller explicitly resets it.'),
 @('RimWorld.CompTemperatureRuinable','Scribe_Values.Look(ref ruinedPercent, "ruinedPercent", 0f)','Thermal damage is persistent.'),
 @('RimWorld.CompTemperatureRuinable','ruinedPercent += (ambientTemperature - Props.maxSafeTemperature) * Props.progressPerDegreePerTick','Overheating accumulates positive damage per excess degree.'),
 @('RimWorld.CompTemperatureRuinable','ruinedPercent -= (ambientTemperature - Props.minSafeTemperature) * Props.progressPerDegreePerTick','Freezing accumulates positive damage per degree below the minimum.'),
 @('RimWorld.CompTemperatureRuinable','ruinedPercent = Mathf.Lerp(ruinedPercent, comp.ruinedPercent, t)','Stack absorption averages thermal damage by actual absorbed count.'),
 @('RimWorld.CompTemperatureRuinable','return Ruined == comp.Ruined','Thermal ruin status must agree to stack.'),
 @('RimWorld.CompTemperatureRuinable','GetComp<CompTemperatureRuinable>().ruinedPercent = ruinedPercent','Splits preserve thermal damage.'),
 @('RimWorld.CompRottable','compHatcher != null && !compHatcher.TemperatureDamaged','disableIfHatcher stops rot while a viable hatcher exists.'),
 @('RimWorld.CompRottable','GenTemperature.RotRateAtTemperature(parent.AmbientTemperature)','Ordinary egg spoilage uses the ambient-temperature rate.'),
 @('RimWorld.CompRottable','Stage == RotStage.Rotting && PropsRot.rotDestroys','Spoiled eggs with rotDestroys are destroyed.'),
 @('Verse.Thing','return GenTemperature.GetTemperatureForCell(PositionHeld, MapHeld)','Held eggs use the holder position temperature when no earlier fixed-temperature override applies.'),
 @('Verse.Thing','ThingOwnerUtility.TryGetFixedTemperature(parentHolder, this, out var temperature)','Holder-defined fixed temperature can override ambient map temperature.'),
 @('Verse.Thing','ThingOwnerUtility.ContentsSuspended(cachedHolder)','Suspended holder contents skip normal recursive ticking.'),
 @('Verse.Thing','directlyHeldThings.DoTick()','Normal item ticking reaches contained inventories.'),
 @('Verse.Pawn','outChildren.Add(inventory)','Pawn inventory participates in the held-container chain.'),
 @('Verse.Pawn','outChildren.Add(carryTracker)','Hands participate in the held-container chain.'),
 @('Verse.ThingOwner','if (dontTickContents)','A holder can explicitly disable content ticking.'),
 @('RimWorld.CompThingContainer','innerContainer.DoTick()','Egg-box contents receive ordinary ticks.'),
 @('RimWorld.CompEggContainer','return ContainedThing.stackCount >= Props.minCountToEmpty','Automatic extraction uses its threshold, not the box capacity.'),
 @('RimWorld.WorkGiver_EmptyEggBox','if (!compEggContainer.CanEmpty && !forced)','Forced emptying can bypass the ordinary count threshold.'),
 @('RimWorld.JobDriver_EmptyThingContainer','WaitWhileExtractingContents(TargetIndex.A, TargetIndex.B, 120)','Egg-box emptying takes an actual 120-tick extraction wait before hauling.'),
 @('RimWorld.StatPart_BodySize','val *= bodySize','MaxNutrition includes body size.'),
 @('RimWorld.StatPart_LifeStageMaxFood','val *= pawn.ageTracker.CurLifeStage.foodMaxFactor','MaxNutrition includes the current life-stage multiplier.'),
 @('RimWorld.Need_Food','return lifeStage.hungerRateFactor * pawnDef.race.baseHungerRate * 2.6666667E-05f','Base hunger rate needs native tick/day conversion; it is not directly nutrition per day.'),
 @('RimWorld.Need_Food','if (CurLevelPercentage <= 0f)','The ordinary Starving category begins at zero food, not the UrgentlyHungry threshold.'),
 @('RimWorld.JobGiver_GetFood','bool flag2 = pawn.needs.food.CurCategory == HungerCategory.Starving','The ordinary GetFood caller passes desperate only when Starving.'),
 @('RimWorld.JobGiver_GetFood','foodPreferability = FoodPreferability.DesperateOnly','A mutant allowed to eat corpses can override minimum preference without ordinary starvation.'),
 @('RimWorld.FoodUtility','minPref = FoodPreferability.DesperateOnly','The map-food search permits DesperateOnly for its desperate caller branch.'),
 @('RimWorld.FoodUtility','minPref = (((int)eater.needs.food.CurCategory >= 2) ? FoodPreferability.RawBad : FoodPreferability.MealAwful)','Ordinary non-desperate humans at UrgentlyHungry can use RawBad, not DesperateOnly.'),
 @('RimWorld.FoodUtility','if (canUseInventory & canManipulateTools)','When higher-quality food fails, a tool-using eater can reach a separate inventory fallback.'),
 @('RimWorld.FoodUtility','thing = BestFoodInInventory(getter, eater, FoodPreferability.DesperateOnly, FoodPreferability.MealLavish, 0f, flag)','The inventory fallback explicitly lowers minimum preference to DesperateOnly.'),
 @('RimWorld.FoodUtility','thing = FirstFoodInClosestPackAnimalInventory(FoodPreferability.DesperateOnly)','The same fallback may consult eligible colony pack inventories.'),
 @('RimWorld.FoodUtility','(int)thing.def.ingestible.preferability >= (int)minFoodPref','Inventory selection applies its passed preference range and WillEat, not a separate built-in starvation requirement.'),
 @('RimWorld.FoodUtility','case FoodPreferability.DesperateOnly:','Even eligible DesperateOnly food receives an optimality penalty in FoodOptimality.'),
 @('RimWorld.FoodUtility','num -= 150f','DesperateOnly optimality penalty is 150; this is a ranking term separate from eligibility.')
)
$records=@(foreach($rule in $rules){
 $m=@($manifest.types|Where-Object type -eq $rule[0]);if($m.Count -ne 1){throw "Missing rule type $($rule[0])"}
 $lines=$sources[$rule[0]].Split("`n");$hits=@(for($i=0;$i -lt $lines.Length;$i++){if($lines[$i].Contains($rule[1])){[ordered]@{line=$i+1;text=$lines[$i].Trim()}}})
 if(!$hits.Count){throw "Missing anchor $($rule[0]): $($rule[1])"}
 [ordered]@{type=$rule[0];file=$m[0].local_file;sha256=$m[0].sha256;anchor=$rule[1];hits=$hits;interpretation=$rule[2]}
})
function BoundedAbsence([string]$type,[string]$start,[string]$end,[string[]]$tokens,[string]$meaning){
 $s=$sources[$type];$a=$s.IndexOf($start,[StringComparison]::Ordinal);if($a -lt 0){throw "Missing method start $start"}
 $b=if($end){$s.IndexOf($end,$a+$start.Length,[StringComparison]::Ordinal)}else{$s.Length};if($b -le $a){throw 'Missing method end'}
 $slice=$s.Substring($a,$b-$a);foreach($token in $tokens){if($slice.Contains($token)){throw "Unexpected $token in $type / $start"}}
 [ordered]@{type=$type;start=$start;end=$end;startLine=$s.Substring(0,$a).Split("`n").Count;endLine=$s.Substring(0,$b).Split("`n").Count;sliceSha256=TextHash $slice;absentTokens=$tokens;interpretation=$meaning}
}
$bounded=@(
 BoundedAbsence 'RimWorld.CompEggLayer' 'private bool Active' 'public bool CanLayNow' @('Faction','Temperature','Suspended','Downed','Awake') 'Egg activity itself has no faction or current-temperature gate; outer ticking and job eligibility remain separate.'
 BoundedAbsence 'RimWorld.CompEggLayer' 'public override void CompTick()' 'public void Fertilize' @('eggProgress = 0','fertilizationCount =','Nutrition','GetStatValue') 'Inactive growth retains progress and fertilization; there is no separate production nutrition debit.'
 BoundedAbsence 'RimWorld.CompHatcher' 'public override bool AllowStackWith' 'public override void PostSplitOff' @('hatcheeParent','otherParent','hatcheeFaction') 'Hatcher stack acceptance and absorption do not compare or replace parent/faction fields; the receiver retains them.'
 BoundedAbsence 'RimWorld.CompHatcher' 'CompProperties_EggLayer compProperties_EggLayer =' 'public void Hatch()' @('RotProgress','rotProgress','HitPoints','Quality','SetForbidden','hatcheeFaction') 'Thermal conversion only explicitly carries stack count, not condition, forbidden state, rot, quality or hatcher identity.'
 BoundedAbsence 'RimWorld.CompHatcher' 'public override void CompTick()' 'CompProperties_EggLayer compProperties_EggLayer =' @('minSafeTemperature','maxSafeTemperature','room','Power','Food','brood','hatcheeParent') 'Viable incubation does not require a brooding parent, powered incubator, safe-current-temperature test or food debit in this component.'
 BoundedAbsence 'RimWorld.CompTemperatureRuinable' 'public override void CompTick()' 'public override void PreAbsorbStack' @('ruinedPercent -= Props','Mathf.MoveTowards','Reset()') 'Safe-temperature branch supplies no gradual damage recovery; Reset is a separate callable method.'
 BoundedAbsence 'RimWorld.JobDriver_LayEgg' 'protected override IEnumerable<Toil> MakeNewToils()' '' @('Rand.Chance','AnimalGatherYield','AnimalGatherSpeed','Learn(','if (GenPlace.TryPlaceThing','if (EggBoxComp.innerContainer.TryAdd') 'Laying has no gather skill roll or handler XP and does not check final placement success for retry.'
 BoundedAbsence 'RimWorld.CompHatcher' 'public override void PrePreTraded' 'public override string CompInspectStringExtra' @('gestateProgress =','hatcheeParent =','otherParent =','ruinedPercent') 'Trade changes hatch faction without resetting incubation, damage or parent references.'
 BoundedAbsence 'RimWorld.FoodUtility' 'if (canUseInventory & canManipulateTools)' 'if (thing2 == null && getter == eater' @('desperate','CurCategory','Starving','UrgentlyHungry') 'The final own/pack inventory fallback has no additional hunger-category gate.'
)
$specs=@(
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_ChickenGroup.xml','/Defs/ThingDef[defName="Chicken"]',@('statBases','comps','race/baseBodySize','race/baseHealthScale','race/baseHungerRate','race/foodType','race/trainability','race/roamMtbDays','race/mateMtbHours','race/lifeStageAges','tradeTags'),'Chicken species and production declarations.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_ChickenGroup.xml','/Defs/PawnKindDef[defName="Chicken"]',@('race','labelMale','labelFemale','lifeStages/li/label','lifeStages/li/labelMale'),'Chicken life-stage and gender labels.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml','/Defs/ThingDef[@Name="AnimalThingBase"]',@('race/thinkTreeMain','race/hasGenders','race/trainability'),'Animal inheritance defaults.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalBaby"]',@('reproductive','milkable','bodySizeFactor','foodMaxFactor','hungerRateFactor'),'Baby nutrition and reproduction eligibility.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalBabyTiny"]',@('reproductive','milkable','bodySizeFactor','foodMaxFactor','hungerRateFactor'),'Chick inherits AnimalBaby but changes size and capacity factor.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalJuvenile"]',@('reproductive','milkable','bodySizeFactor','foodMaxFactor','hungerRateFactor'),'Juvenile defaults to ineligible for laying and mating.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalAdult"]',@('reproductive','milkable','bodySizeFactor','foodMaxFactor','hungerRateFactor'),'Adult explicit reproductive and milkable flags; numeric defaults are one.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[@Name="EggBase"]',@('ingestible','statBases','comps','stackLimit'),'Shared egg nutrition, durability, taste and rot settings.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[@Name="EggUnfertBase"]',@('ingestible','thingCategories','comps'),'Unfertilized eggs are RawBad.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[@Name="EggFertBase"]',@('tickerType','ingestible','thingCategories','comps'),'Fertilized eggs are DesperateOnly and carry thermal ruin.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[defName="EggChickenUnfertilized"]',@('statBases','comps'),'Unfertilized chicken egg overrides value only.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[defName="EggChickenFertilized"]',@('statBases','comps'),'Fertile chicken eggs hatch Chicken in 3.5 days.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_RawPlant.xml','/Defs/ThingDef[@Name="OrganicProductBase"]',@('statBases','tickerType','healthAffectsPrice'),'Eggs inherit healthAffectsPrice false.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_Base.xml','/Defs/ThingDef[@Name="ResourceBase"]',@('stackLimit','comps','alwaysHaulable','useHitPoints','selectable'),'Egg stack limit 75 and ordinary item interaction.'),
 @('Data/Core/Defs/ThingCategoryDefs/ThingCategories.xml','/Defs/ThingCategoryDef[defName="EggsUnfertilized"]',@('parent'),'Unfertilized egg category ancestry.'),
 @('Data/Core/Defs/ThingCategoryDefs/ThingCategories.xml','/Defs/ThingCategoryDef[defName="EggsFertilized"]',@('parent'),'Fertilized egg category ancestry.'),
 @('Data/Core/Defs/ThingCategoryDefs/ThingCategories.xml','/Defs/ThingCategoryDef[defName="AnimalProductRaw"]',@('parent'),'Animal products are FoodRaw rather than MeatRaw.'),
 @('Data/Core/Defs/RecipeDefs/Recipes_Meals.xml','/Defs/RecipeDef[@Name="CookMealBase"]',@('fixedIngredientFilter','defaultIngredientFilter'),'Fertile eggs are allowed by fixed raw-food domain but disabled by default bill choices.'),
 @('Data/Core/Defs/RecipeDefs/Recipes_Meals.xml','/Defs/RecipeDef[defName="CookMealSimple"]',@('allowMixingIngredients','ingredientValueGetterClass','ingredients','products'),'Simple meals use nutrition rather than equal units of meat and eggs.'),
 @('Data/Core/Defs/RecipeDefs/Recipes_Meals.xml','/Defs/RecipeDef[defName="CookMealFine"]',@('ingredients'),'Fine meal nonvegetable component accepts animal products.'),
 @('Data/Core/Defs/ThinkTreeDefs/Animal.xml','/Defs/ThinkTreeDef[defName="Animal"]',@('.//li[@Class="JobGiver_LayEgg"]','.//li[@Class="ThinkNode_ConditionalHasFaction"]/subNodes/li[@Class="ThinkNode_ChancePerHour_Mate"]'),'Egg laying is not under the mating faction branch; ordinary mating is faction-gated.'),
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Misc.xml','/Defs/ThingDef[defName="EggBox"]',@('description','tickerType','containedItemsSelectable','statBases','comps','stuffCategories','costStuffCount','pathCost','building'),'Egg box capacity 25 but automatic empty threshold 20; description alone says full.'),
 @('Data/Core/Defs/WorkGiverDefs/WorkGivers.xml','/Defs/WorkGiverDef[defName="EmptyEggBox"]',@('giverClass','workType','priorityInType','requiredCapacities'),'Emptying is a hauling job.'),
 @('Data/Core/Defs/Stats/Stats_Pawns_General.xml','/Defs/StatDef[defName="MaxNutrition"]',@('defaultBaseValue','minValue','parts'),'Nutrition capacity is body size times life-stage capacity.'),
 @('Data/Core/Defs/TraderKindDefs/TraderKinds_Caravan_Outlander.xml','/Defs/TraderKindDef[defName="Caravan_Outlander_BulkGoods"]',@('stockGenerators/li[@Class="StockGenerator_Category"][categoryDef="FoodRaw"]','stockGenerators/li[@Class="StockGenerator_Animals"]'),'Core bulk caravan excludes fertile eggs from raw-food stock; farm animals use AnimalFarm stock tags.')
)
$docs=@{}
$defs=@(foreach($spec in $specs){
 $file=Join-Path $GameRoot $spec[0]
 if(!$docs.ContainsKey($spec[0])){$doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null;$doc.Load($file);$docs[$spec[0]]=$doc}
 $nodes=@($docs[$spec[0]].SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected XML node count: $($spec[1])"}
 $node=$nodes[0];$fields=@(foreach($xpath in $spec[2]){$values=@($node.SelectNodes($xpath));[ordered]@{xpath=$xpath;count=$values.Count;xml=@($values|ForEach-Object OuterXml)}})
 [ordered]@{file=$spec[0];sha256=Hash $file;xpath=$spec[1];nameAttribute=$node.GetAttribute('Name');parentName=$node.GetAttribute('ParentName');fields=$fields;interpretation=$spec[3]}
})
$chicken=$docs['Data/Core/Defs/ThingDefs_Races/Races_Animal_ChickenGroup.xml'].SelectSingleNode('/Defs/ThingDef[defName="Chicken"]')
$eggComp=$chicken.SelectSingleNode('comps/li[@Class="CompProperties_EggLayer"]')
if($eggComp.eggLayIntervalDays -cne '1' -or $eggComp.eggCountRange -cne '1' -or $eggComp.eggFertilizationCountMax -cne '1'){throw 'Chicken egg declaration changed'}
$fertBase=$docs['Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml'].SelectSingleNode('/Defs/ThingDef[@Name="EggFertBase"]/comps/li[@Class="CompProperties_TemperatureRuinable"]')
if($fertBase.minSafeTemperature -cne '0' -or $fertBase.maxSafeTemperature -cne '50' -or $fertBase.progressPerDegreePerTick -cne '0.00003'){throw 'Egg thermal declaration changed'}
$biomeScan=@(foreach($file in Get-ChildItem -LiteralPath (Join-Path $GameRoot 'Data/Core/Defs/BiomeDefs') -File -Filter '*.xml' | Sort-Object Name){
 $doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null;$doc.Load($file.FullName)
 $nodes=@($doc.SelectNodes('/Defs/BiomeDef/wildAnimals/Chicken'));if($nodes.Count){throw "Unexpected Core wild Chicken declaration: $($file.Name)"}
 [ordered]@{file='Data/Core/Defs/BiomeDefs/'+$file.Name;sha256=Hash $file.FullName;xpath='/Defs/BiomeDef/wildAnimals/Chicken';count=$nodes.Count}
})
$native=[ordered]@{species='Chicken';juvenileMinAgeYears=.12;adultMinAgeYears=.2;bodySize=.3;baseHungerRate=.14;adultNutritionCapacity=.3;adultFedNutritionPerDayApprox=.14*2.6666667E-05*60000;foodType='VegetarianRoughAnimal';wildness=0;mateMtbHours=8;mateDuration=500;layDuration=500;eggTickInterval=2500;layIntervalDays=1;eggCount=1;fertilizationCountMax=1;unfertilizedProgressCap=1;eggNutrition=.25;eggStackLimit=75;eggHP=20;eggDeteriorationPerDay=2;eggMarketValue=7;eggMass=.15;eggFlammability=.7;eggHealthAffectsPrice=$false;eggFoodPoisonChanceFixedHuman=.02;eggRawThought='AteRawFood';unfertilizedPreferability='RawBad';fertilizedPreferability='DesperateOnly';ordinaryHumanGroundEggMinimumFoodFraction=0;inventoryFallbackRechecksStarvation=$false;unfertilizedDaysToRot=15;fertilizedRotDisabledWhileViable=$true;hatcherDays=3.5;minSafeTemperature=0;maxSafeTemperature=50;thermalDamagePerDegreePerTick=.00003;thermalDamageRecoversAtSafeTemperature=$false;temperatureRuinConvertsToUnfertilized=$true;eggBoxCapacity=25;eggBoxAutoEmptyThreshold=20;eggBoxExtractionTicks=120;perUnitIncubationIdentity=$false;stackIdentity='receiver parents and hatch faction; weighted incubation and thermal damage';tradeBuysChangeHatchFaction='player';tradeSellsChangeHatchFaction='trader'}
$record=[ordered]@{
 evidence_id='RW17-ANIMAL-EGGS-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash
 reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile)
 manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile);rules=$records;boundedChecks=$bounded;packagedXml=$defs;coreBiomeAbsence=$biomeScan;nativeReference=$native
 limits=@('Static derived C# and packaged XML are not original source or runtime gameplay proof.','Matching retained REA metadata is reused for assembly identity only.','No native game, browser, preview, GUI input or screenshot was launched.','Selected XML inheritance nodes are not a complete mod-patched effective Def database.','Biome absence is limited to direct Core BiomeDef wildAnimals Chicken entries in the enumerated files.','Per-stack hatcher identity does not preserve each egg parentage after a merge; every hatched unit nevertheless gets a distinct generated pawn.','Core bulk-trader exclusion does not prove no event, mod or other stock generator can ever offer fertile eggs.','Held-item ticking is established for ordinary on-map recursive holders; world/caravan scheduler coverage and all suspended-holder special cases are not runtime verified.','Checked placement retry, guaranteed merchant fertile-egg stock, cohort splitting and tuning changes are Web adaptations when implemented.','No native artwork, audio, assemblies or complete derived C# is published.')
 collectorSha256=Hash $PSCommandPath
}
$json=($record|ConvertTo-Json -Depth 20).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static projection differs'};"Checked animal-eggs: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) packaged XML projections, $($biomeScan.Count) Core biome absence files"}
else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));'Collected animal-eggs static mechanisms'}
