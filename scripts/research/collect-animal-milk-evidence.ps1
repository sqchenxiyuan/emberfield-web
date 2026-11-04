param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Static derived PE and packaged XML only. No game, browser, preview or GUI launch.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/animal-milk-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/animal-milk-manifest.json'
$reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static identity mismatch'}
$sources=@{}
foreach($m in $manifest.types){$file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)}
$rules=@(
 @('RimWorld.CompMilkable','protected override string SaveKey => "milkFullness"','Milk fullness is saved under milkFullness by the shared component.'),
 @('RimWorld.CompProperties_Milkable','public bool milkFemaleOnly = true','Milk defaults to females only unless explicitly overridden by a definition.'),
 @('RimWorld.CompMilkable','Props.milkFemaleOnly && pawn != null && pawn.gender != Gender.Female','The configured sex condition gates both fullness growth and ActiveAndFull.'),
 @('RimWorld.CompMilkable','pawn != null && !pawn.ageTracker.CurLifeStage.milkable','Milkability is an explicit life-stage flag; it is not equivalent to every reproductive stage in arbitrary species.'),
 @('RimWorld.CompMilkable','ModsConfig.AnomalyActive && pawn.IsShambler','Anomaly shambler animals are inactive.'),
 @('RimWorld.CompHasGatherableBodyResource','if (parent.Faction == null)','The base component rejects factionless animals, not only animals outside the player faction.'),
 @('RimWorld.CompHasGatherableBodyResource','if (parent.Suspended)','Suspended parents do not produce resources.'),
 @('RimWorld.CompHasGatherableBodyResource','return fullness >= 1f','Assignment uses ActiveAndFull; partially filled animals do not offer ordinary gathering jobs.'),
 @('RimWorld.CompHasGatherableBodyResource','Scribe_Values.Look(ref fullness, SaveKey, 0f)','Fullness persists on the animal and defaults to zero.'),
 @('RimWorld.CompHasGatherableBodyResource','float num = 1f / (float)(GatherResourcesIntervalDays * 60000)','Fullness grows per active component tick using the species interval in native days.'),
 @('RimWorld.CompHasGatherableBodyResource','num *= PawnUtility.BodyResourceGrowthSpeed(pawn)','Hunger changes the accumulation speed rather than directly reducing the eventual batch amount.'),
 @('RimWorld.CompHasGatherableBodyResource','fullness = 1f','Fullness is capped at one cycle; missed gathering does not bank unlimited cycles.'),
 @('RimWorld.PawnUtility','return pawn.needs?.food?.CurCategory.HungerMultiplier() ?? 1f','BodyResourceGrowthSpeed depends on the food category, defaulting to one without a food need.'),
 @('RimWorld.HungerLevelUtility','HungerCategory.Fed => 1f','Fed growth multiplier is one.'),
 @('RimWorld.HungerLevelUtility','HungerCategory.Hungry => 0.5f','Hungry growth multiplier is one half.'),
 @('RimWorld.HungerLevelUtility','HungerCategory.UrgentlyHungry => 0.25f','Urgently hungry growth multiplier is one quarter.'),
 @('RimWorld.HungerLevelUtility','HungerCategory.Starving => 0f','Starving stops new milk accumulation.'),
 @('RimWorld.Need_Food','return lifeStage.hungerRateFactor * pawnDef.race.baseHungerRate * 2.6666667E-05f','The XML hunger rate is not itself daily nutrition; multiply this per-tick factor by native ticks/day and effective modifiers.'),
 @('RimWorld.WorkGiver_Milk','return animal.TryGetComp<CompMilkable>()','Milk jobs require a milk component; ordinary hares/deer cannot be milked without one.'),
 @('RimWorld.WorkGiver_GatherAnimalBodyResources','return pawn.Map.mapPawns.SpawnedPawnsInFaction(pawn.Faction)','Ordinary scanning searches spawned pawns of the worker faction.'),
 @('RimWorld.WorkGiver_GatherAnimalBodyResources','comp == null || !comp.ActiveAndFull || pawn2.Downed','Gather assignment requires full active resource and an animal that is not downed.'),
 @('RimWorld.WorkGiver_GatherAnimalBodyResources','pawn2.roping != null && pawn2.roping.IsRopedByPawn','Assignment excludes animals currently roped by a pawn.'),
 @('RimWorld.WorkGiver_GatherAnimalBodyResources','!pawn2.CanCasuallyInteractNow() || !pawn.CanReserve(pawn2, 1, -1, null, forced)','Assignment needs casual-interaction eligibility and an ordinary reservation.'),
 @('RimWorld.PawnUtility','if (!p.Awake() && !canInteractWhileSleeping)','Ordinary casual interaction rejects a sleeping target; this is distinct from milk growth.'),
 @('RimWorld.PawnUtility','if (p.IsFormingCaravan())','Ordinary casual interaction also rejects caravan assembly; other reviewed checks include drafting, invisibility, following a master and aggressive/roaming mental states.'),
 @('RimWorld.JobDriver_Milk','protected override float WorkTotal => 400f','Native milk gathering requires 400 work, not 400 fixed elapsed ticks.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','Scribe_Values.Look(ref gatherProgress, "gatherProgress", 0f)','Work progress is saved on the driver, separately from animal fullness.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','return pawn.Reserve(job.GetTarget(TargetIndex.A), job, 1, -1, null, errorOnFailed)','The job reserves its target to prevent simultaneous handlers.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','this.FailOnDespawnedNullOrForbidden(TargetIndex.A)','Target disappearance or forbidden status interrupts the driver.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','this.FailOnDowned(TargetIndex.A)','Target downing interrupts work.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','this.FailOnNotCasualInterruptible(TargetIndex.A)','The driver also rejects loss of casual interruptibility.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','Toils_Goto.GotoThing(TargetIndex.A, PathEndMode.Touch)','Milking requires reaching contact with the animal.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','PawnUtility.ForceWait(pawn, 15000, null, maintainPosture: true)','Starting work asks the animal to wait and preserves posture.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','actor.skills.Learn(SkillDefOf.Animals, 0.13f * (float)delta)','Actual gathering intervals grant Animals experience before reading speed.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','gatherProgress += actor.GetStatValue(StatDefOf.AnimalGatherSpeed) * (float)delta','Progress scales with AnimalGatherSpeed and elapsed simulation ticks.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','GetComp((Pawn)(Thing)job.GetTarget(TargetIndex.A)).Gathered(pawn)','The normal driver invokes Gathered only after work reaches its total.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','pawn.CurJobDef == JobDefOf.Wait_MaintainPosture','Finish action releases the animal only when it is still in the imposed maintain-posture wait.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','wait.FailOnCannotTouch(TargetIndex.A, PathEndMode.Touch)','Contact loss interrupts the work toil.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','ActiveAndFull ? JobCondition.Ongoing : JobCondition.Incompletable','The work toil rechecks active full resource during work, including after load.'),
 @('Verse.AI.JobDriver','if (CheckCurrentToilEndOrFail())','The shared driver checks termination before work updates and before toil init.'),
 @('RimWorld.CompHasGatherableBodyResource','!Rand.Chance(doer.GetStatValue(StatDefOf.AnimalGatherYield))','Yield stat is a single all-or-nothing success roll, not an amount multiplier.'),
 @('RimWorld.CompHasGatherableBodyResource','"TextMote_ProductWasted".Translate()','Failed gathering produces a wasted-product feedback branch without spawning milk.'),
 @('RimWorld.CompHasGatherableBodyResource','GenMath.RoundRandom((float)ResourceAmount * fullness)','On success, output amount is stochastically rounded species amount times actual fullness.'),
 @('RimWorld.CompHasGatherableBodyResource','Mathf.Clamp(num, 1, ResourceDef.stackLimit)','Successful output is split into real stacks bounded by the resource stack limit.'),
 @('RimWorld.CompHasGatherableBodyResource','GenPlace.TryPlaceThing(thing, doer.Position, doer.Map, ThingPlaceMode.Near)','Each output stack is placed near the worker, not remotely credited to colony stock; the return value is ignored here.'),
 @('RimWorld.CompHasGatherableBodyResource','fullness = 0f','Fullness resets after success, product waste or placement failure.'),
 @('Verse.Rand','if (chance >= 1f)','Rand.Chance returns true at or above one, so excess yield stat does not increase milk output.'),
 @('Verse.GenMath','return (int)f + ((Rand.Value < f % 1f) ? 1 : 0)','RoundRandom uses truncation plus fractional-probability rounding, not floor.'),
 @('Verse.GenPlace','!TryFindPlaceSpotNear(center, rot.Value, map, thing, allowStacking: true, out var bestSpot, extraValidator)','Near placement can return false when no suitable spot exists; milk gathering has no retained pending-output owner.'),
 @('RimWorld.SkillNeed_BaseBonus','return baseValue + bonusPerLevel * (float)level','Gather speed uses the declared linear Animals skill factor.'),
 @('RimWorld.SkillNeed_Direct','return valuesPerLevel[level]','Gather yield uses the declared level-indexed Animals factor.'),
 @('RimWorld.StatWorker','num = Mathf.Lerp(num, num * factor, pawnCapacityFactor.weight)','Stat capacity factors are weighted multiplicatively.'),
 @('RimWorld.StatWorker_MinimumHandlingSkill','new CurvePoint(0.15f, 1f)','Handling requirement curve is distinct from milking speed/yield.'),
 @('RimWorld.StatWorker_MinimumHandlingSkill','new CurvePoint(0.98f, 10f)','Dromedary wildness 0.25 falls between these two handling-curve points.'),
 @('Verse.RaceProperties','public bool FenceBlocked => Roamer','Roaming animals are fence-blocked.'),
 @('Verse.RaceProperties','public bool Roamer => roamMtbDays.HasValue','Dromedary roamMtbDays establishes the Roamer flag.'),
 @('Verse.AnimalPenUtility','if (td.race != null && td.race.Roamer)','Rope-managed animal classification combines Roamer with the Animals category.'),
 @('RimWorld.FoodTypeFlags','VegetarianRoughAnimal = VegetarianAnimal | Plant','The dromedary diet does not include Fluid or AnimalProduct; raw milk is not ordinary rough-herbivore feed.'),
 @('RimWorld.FoodTypeFlags','OmnivoreHuman = OmnivoreAnimal | Fluid | AnimalProduct','Human omnivore diet includes both raw milk flags.'),
 @('RimWorld.IngestibleProperties','public ThoughtDef tasteThought','Taste thought defaults null when no inherited definition supplies one.'),
 @('RimWorld.FoodUtility','foodDef.ingestible.tasteThought != null','Ordinary taste thought is added only when configured; this is not immunity to every ideology/trait/environment thought.'),
 @('RimWorld.CompRottable','RotProgress += num * (float)delta','Rot accumulates by temperature-adjusted elapsed simulation ticks.'),
 @('RimWorld.CompRottable','Stage == RotStage.Rotting && PropsRot.rotDestroys','Milk is destroyed on reaching the rotting stage when rotDestroys is true.'),
 @('RimWorld.CompRottable','RotProgress = Mathf.Lerp(RotProgress, rotProgress, t)','Merging rot-capable stacks computes an amount-weighted rot progress.'),
 @('RimWorld.CompRottable','GetComp<CompRottable>().RotProgress = RotProgress','Splitting preserves the original rot progress.'),
 @('Verse.GenTemperature','public static float RotRateAtTemperature(float temperature)','Native rot rate is zero below zero Celsius, linear from zero to ten, and one at ten or above.'),
 @('Verse.ThingDef','public Tradeability tradeability = Tradeability.All','Milk inherits normal tradability unless a definition or patch overrides it.'),
 @('RimWorld.StockGenerator_Category','categoryDef.DescendantThingDefs.Contains(t) && t.tradeability != Tradeability.None','A category trader can handle allowed descendant food definitions, subject to tech and exclusion checks.'),
 @('RimWorld.StockGenerator_Category','!generatedDefs.Contains(t)','A trader samples a limited variety of definitions; category acceptance does not guarantee every visit stocks milk.'),
 @('RimWorld.WildAnimalSpawner','TryRandomElementByWeight((PawnKindDef kind) => CommonalityOfAnimalNow(kind, loc)','Species selection is weighted and filtered by acceptable season, not a fixed independent spawn percentage.'),
 @('RimWorld.WildAnimalSpawner','int randomInRange = animalKind.wildGroupSize.RandomInRange','Native dromedary group size is sampled from its declared range.'),
 @('RimWorld.WildAnimalSpawner','return num / def.wildGroupSize.Average','Effective animal commonality divides by expected group size after biome/pollution/coast/mutator factors.')
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
 BoundedAbsence 'RimWorld.CompMilkable' 'protected override bool Active' 'public override string CompInspectStringExtra' @('Pregnant','Lactating','birth','Hediff_Pregnant','food','Temperature','Awake','Faction.OfPlayer') 'No pregnancy, birth-history, lactation, direct hunger threshold, weather, sleeping or player-only condition exists in the milk-specific activity getter.'
 BoundedAbsence 'RimWorld.CompHasGatherableBodyResource' 'protected virtual bool Active' 'public bool ActiveAndFull' @('Pregnant','Lactating','Downed','Awake','Temperature','Faction.OfPlayer','BodySize') 'The shared activity getter only tests non-null faction and suspension; other gameplay systems can still stop ticking.'
 BoundedAbsence 'RimWorld.CompHasGatherableBodyResource' 'public override void CompTick' 'public void Gathered' @('fullness = 0','fullness *=','CurLevel -=','Nutrition','GetStatValue') 'Inactive state does not clear fullness, and ticking does not subtract an extra food amount or use handler stats.'
 BoundedAbsence 'RimWorld.CompHasGatherableBodyResource' 'public void Gathered' '' @('fullness -=','TryAdd','holdingOwner','retry','gatherProgress','ResourceAmount * doer','if (GenPlace.TryPlaceThing') 'Gathered empties the cycle, uses a chance instead of multiplying amount by yield, and declares no retained output retry owner/check on placement success.'
 BoundedAbsence 'RimWorld.WorkGiver_GatherAnimalBodyResources' 'public override bool HasJobOnThing' 'public override Job JobOnThing' @('MinimumHandlingSkill','SkillDefOf.Animals','Pregnant','Slaughter','ReleaseAnimalToWild') 'This work giver does not impose taming minimum skill or directly veto pregnancy/manual slaughter/release designations.'
 BoundedAbsence 'RimWorld.JobDriver_GatherAnimalBodyResources' 'wait.AddFinishAction' 'wait.FailOnDespawnedOrNull' @('Gathered','fullness','gatherProgress','ThingMaker') 'Finish action releases an imposed animal wait; interruption does not milk the animal, empty fullness or create output.'
 BoundedAbsence 'RimWorld.JobDriver_GatherAnimalBodyResources' 'protected override IEnumerable<Toil> MakeNewToils' '' @('Learn(SkillDefOf.Animals, 400','MinimumHandlingSkill','fullness =','gatherProgress = 0') 'Work uses interval XP and driver-local progress; it does not reset animal fullness except by the completed Gathered call.'
 BoundedAbsence 'RimWorld.CompMilkable' 'public class CompMilkable' '' @('Notify_Pawn','PostSpawnSetup','PostPostMake','Rand.') 'No milk-specific random initialization or faction-transition refill/reset hook is declared by this component.'
)
$specs=@(
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_CowGroup.xml','/Defs/ThingDef[defName="Dromedary"]',@('statBases','comps/li[@Class="CompProperties_Milkable"]','race/body','race/baseBodySize','race/baseHealthScale','race/baseHungerRate','race/foodType','race/roamMtbDays','race/trainability','race/packAnimal','race/gestationPeriodDays','race/lifeExpectancy','race/lifeStageAges','tradeTags'),'Dromedary species declarations; art and audio resources are not copied.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_CowGroup.xml','/Defs/PawnKindDef[defName="Dromedary"]',@('race','combatPower','ecoSystemWeight','wildGroupSize'),'Native wildlife group and ecosystem declarations.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml','/Defs/ThingDef[@Name="AnimalThingBase"]',@('race/hasGenders','race/trainability','thingCategories'),'Animal category and sex defaults inherited by dromedaries.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalBaby"]',@('reproductive','milkable','bodySizeFactor','foodMaxFactor','healthScaleFactor','hungerRateFactor'),'Baby milkable/reproductive flags are absent and default false.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalJuvenile"]',@('reproductive','milkable','bodySizeFactor','foodMaxFactor','healthScaleFactor','hungerRateFactor'),'Juveniles remain non-milkable; body/food factors differ from babies.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalAdult"]',@('reproductive','milkable','bodySizeFactor','foodMaxFactor','healthScaleFactor','hungerRateFactor'),'Adult reproductive/milkable flags are explicit; omitted body/food factors use class defaults.'),
 @('Data/Core/Defs/BiomeDefs/Biomes_WarmArid.xml','/Defs/BiomeDef[defName="AridShrubland"]',@('animalDensity','wildAnimals/Dromedary'),'Arid shrubland relative wild dromedary commonality and biome animal density.'),
 @('Data/Core/Defs/BiomeDefs/Biomes_WarmArid.xml','/Defs/BiomeDef[defName="Desert"]',@('animalDensity','wildAnimals/Dromedary'),'Desert relative wild dromedary commonality and density.'),
 @('Data/Core/Defs/BiomeDefs/Biomes_WarmArid.xml','/Defs/BiomeDef[defName="ExtremeDesert"]',@('animalDensity','wildAnimals/Dromedary'),'Extreme desert relative wild dromedary commonality and density.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[defName="Milk"]',@('statBases','comps/li[@Class="CompProperties_Rottable"]','ingestible','thingCategories','tradeability','socialPropernessMatters'),'Milk nutrition, raw ingestion, spoilage and category data.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_RawPlant.xml','/Defs/ThingDef[@Name="OrganicProductBase"]',@('statBases','tickerType','healthAffectsPrice','ingestible/tasteThought','tradeability'),'Milk inherits deterioration rate, rare ticking and health-independent price; no taste thought here.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_Base.xml','/Defs/ThingDef[@Name="ResourceBase"]',@('stackLimit','alwaysHaulable','comps','ingestible/tasteThought','tradeability'),'Milk inherits a 75-item stack limit and ordinary haul/forbidden component.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_RawPlant.xml','/Defs/ThingDef[@Name="PlantFoodRawBase"]',@('ingestible/preferability','ingestible/tasteThought'),'The raw-food negative taste thought belongs to this sibling branch, not OrganicProductBase or Milk.'),
 @('Data/Core/Defs/Stats/Stats_Pawns_WorkGeneral.xml','/Defs/StatDef[defName="AnimalGatherSpeed"]',@('defaultBaseValue','minValue','statFactors','skillNeedFactors','capacityFactors'),'Gather speed stat and handler skill/capacity factors.'),
 @('Data/Core/Defs/Stats/Stats_Pawns_WorkGeneral.xml','/Defs/StatDef[defName="AnimalGatherYield"]',@('defaultBaseValue','minValue','maxValue','skillNeedFactors','capacityFactors'),'Yield success probability factors; no direct maxValue is declared in this node.'),
 @('Data/Core/Defs/Stats/Stats_Pawns_General.xml','/Defs/StatDef[defName="MinimumHandlingSkill"]',@('workerClass','roundValue','minValue'),'Handling requirement is rounded; the gather work giver does not use it as an assignment gate.'),
 @('Data/Core/Defs/WorkGiverDefs/WorkGivers.xml','/Defs/WorkGiverDef[defName="Milk"]',@('giverClass','workType','priorityInType','requiredCapacities'),'Milk belongs to Handling, needs Manipulation and has native priority 90.'),
 @('Data/Core/Defs/JobDefs/Jobs_Work.xml','/Defs/JobDef[defName="Milk"]',@('driverClass','reportString','allowOpportunisticPrefix'),'Ordinary Milk job uses the reviewed driver.'),
 @('Data/Core/Defs/RecipeDefs/Recipes_Meals.xml','/Defs/RecipeDef[@Name="CookMealBase"]',@('fixedIngredientFilter','defaultIngredientFilter','workSkill'),'Base meals accept FoodRaw with listed exclusions; Milk is not excluded here.'),
 @('Data/Core/Defs/RecipeDefs/Recipes_Meals.xml','/Defs/RecipeDef[defName="CookMealSimple"]',@('allowMixingIngredients','ingredientValueGetterClass','ingredients','products'),'Simple meals can use Milk as FoodRaw, counting nutrition rather than number of objects.'),
 @('Data/Core/Defs/RecipeDefs/Recipes_Meals.xml','/Defs/RecipeDef[defName="CookMealFine"]',@('ingredients','products'),'Fine meals accept AnimalProductRaw in the protein half alongside meat, plus plant nutrition.'),
 @('Data/Core/Defs/RecipeDefs/Recipes_Meals.xml','/Defs/RecipeDef[defName="CookMealFine_Veg"]',@('ingredients','fixedIngredientFilter','products'),'Vegetarian fine meals also allow animal products; raw milk is not meat.'),
 @('Data/Core/Defs/ThingCategoryDefs/ThingCategories.xml','/Defs/ThingCategoryDef[defName="AnimalProductRaw"]',@('parent'),'AnimalProductRaw is a descendant of FoodRaw.'),
 @('Data/Core/Defs/TraderKindDefs/TraderKinds_Caravan_Outlander.xml','/Defs/TraderKindDef[defName="Caravan_Outlander_BulkGoods"]',@('stockGenerators/li[@Class="StockGenerator_Category" and categoryDef="FoodRaw"]'),'A concrete ordinary trader accepts FoodRaw; its generated stock samples only three eligible definitions.'),
 @('Data/Core/Defs/Stats/Stats_Pawns_WorkGeneral.xml','/Defs/StatDef[defName="PlantHarvestYield"]',@('maxValue','skillNeedFactors','capacityFactors'),'Comparison only: same skill curve and capacity factors as AnimalGatherYield, but a different skill, explicit max and downstream consumer.')
)
$docs=@{}
$defs=@(foreach($spec in $specs){
 $file=Join-Path $GameRoot $spec[0]
 if(!$docs.ContainsKey($spec[0])){$doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null;$doc.Load($file);$docs[$spec[0]]=$doc}
 $nodes=@($docs[$spec[0]].SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected XML node count: $($spec[1])"}
 $node=$nodes[0];$fields=@(foreach($xpath in $spec[2]){$values=@($node.SelectNodes($xpath));[ordered]@{xpath=$xpath;count=$values.Count;xml=@($values|ForEach-Object OuterXml)}})
 [ordered]@{file=$spec[0];sha256=Hash $file;xpath=$spec[1];nameAttribute=$node.GetAttribute('Name');parentName=$node.GetAttribute('ParentName');fields=$fields;interpretation=$spec[3]}
})
$dromedary=$docs[$specs[0][0]].SelectSingleNode($specs[0][1]);$milk=$docs[$specs[9][0]].SelectSingleNode($specs[9][1])
$milkComp=$dromedary.SelectSingleNode('comps/li[@Class="CompProperties_Milkable"]')
if($milkComp.milkDef -cne 'Milk' -or $milkComp.milkAmount -cne '18' -or $milkComp.milkIntervalDays -cne '2' -or $milkComp.SelectNodes('milkFemaleOnly').Count -ne 0){throw 'Dromedary milk declaration changed'}
if($milk.SelectSingleNode('statBases/Nutrition').InnerText -cne '0.05' -or $milk.SelectSingleNode('comps/li[@Class="CompProperties_Rottable"]/daysToRotStart').InnerText -cne '14'){throw 'Milk resource declaration changed'}
foreach($node in @($milk,$docs[$specs[10][0]].SelectSingleNode($specs[10][1]),$docs[$specs[11][0]].SelectSingleNode($specs[11][1]))){if($node.SelectNodes('ingestible/tasteThought').Count){throw 'Milk inheritance now has a taste thought'}}
$yieldNode=$docs[$specs[14][0]].SelectSingleNode($specs[14][1]);$curve=@($yieldNode.SelectNodes('skillNeedFactors/li/valuesPerLevel/li')|ForEach-Object {[double]::Parse($_.InnerText,[Globalization.CultureInfo]::InvariantCulture)})
$expected=@(.6,.7,.75,.8,.85,.9,.95,.975,1,1.01,1.02,1.03,1.04,1.05,1.06,1.07,1.08,1.09,1.10,1.12,1.13)
if($curve.Count -ne $expected.Count){throw 'Yield curve length changed'}
for($i=0;$i -lt $curve.Count;$i++){if($curve[$i] -ne $expected[$i]){throw "Yield curve changed at $i"}}
$plantYield=$docs[$specs[24][0]].SelectSingleNode($specs[24][1])
if($plantYield.SelectSingleNode('skillNeedFactors/li/valuesPerLevel').OuterXml -cne $yieldNode.SelectSingleNode('skillNeedFactors/li/valuesPerLevel').OuterXml -or $plantYield.SelectSingleNode('capacityFactors').OuterXml -cne $yieldNode.SelectSingleNode('capacityFactors').OuterXml){throw 'Plant versus animal yield-factor comparison changed'}
$native=[ordered]@{species='Dromedary';milkAmount=18;milkIntervalDays=2;milkFemaleOnly=$true;workTotal=400;xpPerWorkTick=.13;milkNutrition=.05;milkRotStartDays=14;milkStackLimit=75;milkMarketValue=1.9;milkMass=.045;milkHP=60;milkFlammability=.2;milkDeteriorationRate=6;dromedaryBaseHungerRate=.535;adultFedNutritionPerDayApprox=.535*2.6666667E-05*60000;gatherYieldCurveLevels0To20=$curve}
$record=[ordered]@{
 evidence_id='RW17-ANIMAL-MILK-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash
 reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile)
 manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile);rules=$records;boundedChecks=$bounded;packagedXml=$defs;nativeReference=$native
 limits=@('Static derived C# and packaged XML are not original source or runtime gameplay proof.','Matching retained REA metadata is reused for artifact identity only.','No native game, browser, preview, GUI input or screenshot was run.','XML parent fields are explicitly projected, not a complete mod-patched or enabled-DLC effective Def database.','Milk job and component paths are covered; not every special job, world-pawn tick provider or mod override is traced.','Normal full-cycle gathering is 18 dromedary milk on success; no output is guaranteed when yield or physical placement fails.','The native placement return is ignored; protected pending output, preflight placement and no-reroll retry would be Web adaptations.','Food-category and recipe/trader declarations establish compatibility, not observed ingestion, actual trader stock or universal bill acceptance.','Ordinary missing raw taste thought does not exclude all ideology, trait, dining or special ingestion thoughts.','Biome values are relative commonalities with season/group-size and other modifiers, not measured spawn rates.','Native values are recorded references; Web timing, deterministic randomness, growth and economy may remain provisional.','No animal assets, textures, meshes, sounds, game assemblies or complete derived source are published by this evidence collector.')
 collectorSha256=Hash $PSCommandPath
}
$json=($record|ConvertTo-Json -Depth 18).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static projection differs'};"Checked animal-milk: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) packaged XML projections"}
else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));'Collected animal-milk static mechanisms'}
