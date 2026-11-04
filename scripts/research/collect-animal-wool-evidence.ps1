param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Static derived PE and packaged XML only. No game, browser, preview or GUI launch.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/animal-wool-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/animal-wool-manifest.json'
$reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static identity mismatch'}
$sources=@{}
foreach($m in $manifest.types){$file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)}
$rules=@(
 @('RimWorld.CompHasGatherableBodyResource','if (parent.Faction == null)','The base component rejects factionless animals, not only animals outside the player faction.'),
 @('RimWorld.CompHasGatherableBodyResource','if (parent.Suspended)','Suspended parents do not produce resources.'),
 @('RimWorld.CompHasGatherableBodyResource','return fullness >= 1f','Assignment uses ActiveAndFull; partially filled animals do not offer ordinary gathering jobs.'),
 @('RimWorld.CompHasGatherableBodyResource','Scribe_Values.Look(ref fullness, SaveKey, 0f)','Fullness persists on the animal and defaults to zero.'),
 @('RimWorld.CompHasGatherableBodyResource','float num = 1f / (float)(GatherResourcesIntervalDays * 60000)','Fullness grows per active component tick using the species interval in native days.'),
 @('RimWorld.CompHasGatherableBodyResource','num *= PawnUtility.BodyResourceGrowthSpeed(pawn)','Hunger changes the accumulation speed rather than directly reducing the eventual batch amount.'),
 @('RimWorld.CompHasGatherableBodyResource','fullness = 1f','Fullness is capped at one cycle; missed gathering does not bank unlimited cycles.'),
 @('RimWorld.HungerLevelUtility','HungerCategory.Fed => 1f','Fed growth multiplier is one.'),
 @('RimWorld.HungerLevelUtility','HungerCategory.Hungry => 0.5f','Hungry growth multiplier is one half.'),
 @('RimWorld.HungerLevelUtility','HungerCategory.UrgentlyHungry => 0.25f','Urgently hungry growth multiplier is one quarter.'),
 @('RimWorld.HungerLevelUtility','HungerCategory.Starving => 0f','Starving stops new wool accumulation.'),
 @('RimWorld.WorkGiver_GatherAnimalBodyResources','return pawn.Map.mapPawns.SpawnedPawnsInFaction(pawn.Faction)','Ordinary scanning searches spawned pawns of the worker faction.'),
 @('RimWorld.WorkGiver_GatherAnimalBodyResources','comp == null || !comp.ActiveAndFull || pawn2.Downed','Gather assignment requires full active resource and an animal that is not downed.'),
 @('RimWorld.WorkGiver_GatherAnimalBodyResources','pawn2.roping != null && pawn2.roping.IsRopedByPawn','Assignment excludes animals currently roped by a pawn.'),
 @('RimWorld.WorkGiver_GatherAnimalBodyResources','!pawn2.CanCasuallyInteractNow() || !pawn.CanReserve(pawn2, 1, -1, null, forced)','Assignment needs casual-interaction eligibility and an ordinary reservation.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','Scribe_Values.Look(ref gatherProgress, "gatherProgress", 0f)','Work progress is saved on the driver, separately from animal fullness.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','return pawn.Reserve(job.GetTarget(TargetIndex.A), job, 1, -1, null, errorOnFailed)','The job reserves its target to prevent simultaneous handlers.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','this.FailOnDespawnedNullOrForbidden(TargetIndex.A)','Target disappearance or forbidden status interrupts the driver.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','this.FailOnDowned(TargetIndex.A)','Target downing interrupts work.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','this.FailOnNotCasualInterruptible(TargetIndex.A)','The driver also rejects loss of casual interruptibility.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','Toils_Goto.GotoThing(TargetIndex.A, PathEndMode.Touch)','Wooling requires reaching contact with the animal.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','PawnUtility.ForceWait(pawn, 15000, null, maintainPosture: true)','Starting work asks the animal to wait and preserves posture.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','actor.skills.Learn(SkillDefOf.Animals, 0.13f * (float)delta)','Actual gathering intervals grant Animals experience before reading speed.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','gatherProgress += actor.GetStatValue(StatDefOf.AnimalGatherSpeed) * (float)delta','Progress scales with AnimalGatherSpeed and elapsed simulation ticks.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','GetComp((Pawn)(Thing)job.GetTarget(TargetIndex.A)).Gathered(pawn)','The normal driver invokes Gathered only after work reaches its total.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','pawn.CurJobDef == JobDefOf.Wait_MaintainPosture','Finish action releases the animal only when it is still in the imposed maintain-posture wait.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','wait.FailOnCannotTouch(TargetIndex.A, PathEndMode.Touch)','Contact loss interrupts the work toil.'),
 @('RimWorld.JobDriver_GatherAnimalBodyResources','ActiveAndFull ? JobCondition.Ongoing : JobCondition.Incompletable','The work toil rechecks active full resource during work, including after load.'),
 @('RimWorld.CompHasGatherableBodyResource','!Rand.Chance(doer.GetStatValue(StatDefOf.AnimalGatherYield))','Yield stat is a single all-or-nothing success roll, not an amount multiplier.'),
 @('RimWorld.CompHasGatherableBodyResource','"TextMote_ProductWasted".Translate()','Failed gathering produces a wasted-product feedback branch without spawning wool.'),
 @('RimWorld.CompHasGatherableBodyResource','GenMath.RoundRandom((float)ResourceAmount * fullness)','On success, output amount is stochastically rounded species amount times actual fullness.'),
 @('RimWorld.CompHasGatherableBodyResource','Mathf.Clamp(num, 1, ResourceDef.stackLimit)','Successful output is split into real stacks bounded by the resource stack limit.'),
 @('RimWorld.CompHasGatherableBodyResource','GenPlace.TryPlaceThing(thing, doer.Position, doer.Map, ThingPlaceMode.Near)','Each output stack is placed near the worker, not remotely credited to colony stock; the return value is ignored here.'),
 @('RimWorld.CompHasGatherableBodyResource','fullness = 0f','Fullness resets after success, product waste or placement failure.'),
 @('RimWorld.CompShearable','protected override string SaveKey => "woolGrowth"','Wool fullness is saved on the animal, separately from driver progress.'),
 @('RimWorld.CompShearable','pawn != null && !pawn.ageTracker.CurLifeStage.shearable','The current life stage must permit shearing.'),
 @('RimWorld.CompShearable','ModsConfig.AnomalyActive && pawn.IsShambler','Anomaly shambler animals cannot grow wool.'),
 @('RimWorld.LifeStageDef','public bool shearable;','The life-stage flag defaults false.'),
 @('RimWorld.WorkGiver_Shear','return animal.TryGetComp<CompShearable>()','The worker requires the species shearable component.'),
 @('RimWorld.JobDriver_Shear','protected override float WorkTotal => 1700f','Shearing requires 1700 work, not fixed ticks.'),
 @('RimWorld.PawnUtility','return pawn.needs?.food?.CurCategory.HungerMultiplier() ?? 1f','Hunger affects accumulation speed.'),
 @('RimWorld.Need_Food','return lifeStage.hungerRateFactor * pawnDef.race.baseHungerRate * 2.6666667E-05f','XML hunger base is converted to per-tick nutrition before additional modifiers.'),
 @('Verse.StuffProperties','if (t.stuffCategories[i] == categories[j])','Material compatibility requires overlapping stuff categories.'),
 @('RimWorld.RecipeDefGenerator','r.productHasIngredientStuff = true','Generated apparel recipes retain actual material identity.'),
 @('RimWorld.RecipeDefGenerator','ingredientCount.filter.SetAllowAllWhoCanMake(def)','Material filters follow the target item stuff compatibility.'),
 @('Verse.RecipeDef','public bool allowMixingIngredients;','Ingredient mixing defaults false.'),
 @('RimWorld.WorkGiver_DoBill','if (availableThings[num4].def != availableCounts.GetDef(num2))','No-mix bill selection combines only stacks of the same resource for one requirement.'),
 @('Verse.AI.Toils_Recipe','ThingDef stuff = (curJob.RecipeDef.unfinishedThingDef.MadeFromStuff ? thing.def : null)','Unfinished clothing retains its chosen material.'),
 @('Verse.AI.Toils_Recipe','return uft.ingredients.First((Thing ing) => ing.def == uft.Stuff)','Resumption uses the unfinished item existing stuff.'),
 @('Verse.GenRecipe','ThingDef stuff = (thingDefCountClass.thingDef.MadeFromStuff ? dominantIngredient.def : null)','The finished product receives actual stuff identity.'),
 @('Verse.Thing','Scribe_Defs.Look(ref stuffInt, "stuff")','The material identity is persisted.'),
 @('RimWorld.StatWorker','num *= req.StuffDef.stuffProps.statFactors.GetStatFactorFromList(stat)','Item stats use stuff factors, not the resource own stat bases.'),
 @('RimWorld.StatUtility','return modList.GetStatValueFromList(stat, 1f)','Missing stuff factors default one.'),
 @('RimWorld.StatPart_Stuff','value += GetMultiplier(req) * num','Material power contributes garment multiplier times material power.'),
 @('RimWorld.StatDef','parts.SortBy((StatPart x) => 0f - x.priority','Higher-priority material parts run before default-priority quality parts.'),
 @('RimWorld.StatPart','public float priority;','Part priority defaults zero.'),
 @('RimWorld.StatPart_Quality','float a = val * QualityMultiplier(req.QualityCategory) - val','Quality multiplies accumulated material-aware value, subject to configured gain caps.'),
 @('RimWorld.StatWorker_MarketValue','def.CostStuffCount / stuffDef.VolumePerUnit * stuffDef.GetStatValueAbstract(StatDefOf.MarketValue)','Computed item base value includes its actual material value.'),
 @('RimWorld.StatWorker_MarketValue','num += num2 * 0.0036f','Computed base value adds work times 0.0036 when work exceeds two.'),
 @('RimWorld.StatPart_Health','return req.Thing.def.healthAffectsPrice','The HP market-value curve respects the item definition healthAffectsPrice flag.')
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
 BoundedAbsence 'RimWorld.CompShearable' 'protected override bool Active' 'public override string CompInspectStringExtra' @('Gender','Pregnant','Lactating','Downed','Awake','BodySize','Temperature') 'Wool-specific activity has no sex or pregnancy gate.'
 BoundedAbsence 'RimWorld.CompHasGatherableBodyResource' 'public override void CompTick' 'public void Gathered' @('fullness = 0','Nutrition','GetStatValue') 'Inactive accumulation preserves existing fullness; no separate feed debit.'
 BoundedAbsence 'RimWorld.WorkGiver_GatherAnimalBodyResources' 'public override bool HasJobOnThing' 'public override Job JobOnThing' @('MinimumHandlingSkill','SkillDefOf.Animals') 'No taming minimum-skill gate is imposed by this gathering work giver.'
 BoundedAbsence 'RimWorld.JobDriver_GatherAnimalBodyResources' 'wait.AddFinishAction' 'wait.FailOnDespawnedOrNull' @('Gathered','fullness','ThingMaker') 'Interruption does not gather or empty the resource.'
 BoundedAbsence 'RimWorld.CompHasGatherableBodyResource' 'public void Gathered' '' @('if (GenPlace.TryPlaceThing','holdingOwner','retry') 'Native gathering has no checked placement retry owner.'
 BoundedAbsence 'RimWorld.RecipeDefGenerator' 'private static RecipeDef CreateRecipeDefFromMaker' 'public static void SetIngredients' @('allowMixingIngredients =') 'Generated clothing recipes do not enable mixed material requirements.'
)
$specs=@(
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_SheepGroup.xml','/Defs/ThingDef[defName="Alpaca"]',@('statBases','comps','race/baseBodySize','race/baseHungerRate','race/foodType','race/roamMtbDays','race/trainability','race/gestationPeriodDays','race/lifeStageAges'),'Alpaca lifecycle, food and wool declarations.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_SheepGroup.xml','/Defs/PawnKindDef[defName="Alpaca"]',@('race','wildGroupSize'),'Wild group size.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml','/Defs/ThingDef[@Name="AnimalThingBase"]',@('race/trainability','race/hasGenders','thingCategories'),'Inherited animal defaults.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalBaby"]',@('shearable'),'AnimalBaby eligibility.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalJuvenile"]',@('shearable'),'AnimalJuvenile eligibility.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalAdult"]',@('shearable'),'AnimalAdult eligibility.'),
 @('Data/Core/Defs/BiomeDefs/Biomes_Temperate.xml','/Defs/BiomeDef[defName="TemperateForest"]',@('wildAnimals/Alpaca'),'Relative commonality, not a percentage.'),
 @('Data/Core/Defs/BiomeDefs/Biomes_Temperate.xml','/Defs/BiomeDef[defName="TemperateSwamp"]',@('wildAnimals/Alpaca'),'Relative commonality, not a percentage.'),
 @('Data/Core/Defs/BiomeDefs/Biomes_Warm.xml','/Defs/BiomeDef[defName="TropicalRainforest"]',@('wildAnimals/Alpaca'),'Relative commonality, not a percentage.'),
 @('Data/Core/Defs/BiomeDefs/Biomes_Warm.xml','/Defs/BiomeDef[defName="TropicalSwamp"]',@('wildAnimals/Alpaca'),'Relative commonality, not a percentage.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_CowGroup.xml','/Defs/ThingDef[defName="Dromedary"]',@('comps/li[@Class="CompProperties_Shearable"]'),'No native dromedary shearing component in this node.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_Stuff.xml','/Defs/ThingDef[defName="WoolAlpaca"]',@('stackLimit','statBases','stuffProps','comps','ingestible','healthAffectsPrice','thingCategories'),'Alpaca wool'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_Stuff.xml','/Defs/ThingDef[@Name="WoolBase"]',@('stackLimit','statBases','stuffProps','comps','ingestible','healthAffectsPrice','thingCategories'),'Wool parent'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_Stuff.xml','/Defs/ThingDef[defName="Cloth"]',@('stackLimit','statBases','stuffProps','comps','ingestible','healthAffectsPrice','thingCategories'),'Cloth comparison'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_Base.xml','/Defs/ThingDef[@Name="ResourceBase"]',@('statBases','comps','ingestible','alwaysHaulable'),'Resource ancestor; no rot or ingestion path.'),
 @('Data/Core/Defs/WorkGiverDefs/WorkGivers.xml','/Defs/WorkGiverDef[defName="Shear"]',@('giverClass','workType','priorityInType','requiredCapacities'),'Native Handling job priority 85.'),
 @('Data/Core/Defs/Stats/Stats_Pawns_WorkGeneral.xml','/Defs/StatDef[defName="AnimalGatherSpeed"]',@('defaultBaseValue','minValue','statFactors','skillNeedFactors','capacityFactors'),'AnimalGatherSpeed'),
 @('Data/Core/Defs/Stats/Stats_Pawns_WorkGeneral.xml','/Defs/StatDef[defName="AnimalGatherYield"]',@('defaultBaseValue','minValue','statFactors','skillNeedFactors','capacityFactors'),'AnimalGatherYield'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[@Name="ApparelNoQualityBase"]',@('statBases'),'Apparel base flammability 1.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[@Name="ApparelMakeableBase"]',@('recipeMaker'),'Tailoring and unfinished apparel.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[defName="Apparel_BasicShirt"]',@('stuffCategories','costStuffCount','statBases'),'Apparel_BasicShirt material compatibility.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[defName="Apparel_Pants"]',@('stuffCategories','costStuffCount','statBases'),'Apparel_Pants material compatibility.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[defName="Apparel_Parka"]',@('stuffCategories','costStuffCount','statBases'),'Apparel_Parka material compatibility.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[defName="Apparel_Duster"]',@('stuffCategories','costStuffCount','statBases'),'Apparel_Duster material compatibility.'),
 @('Data/Core/Defs/Stats/Stats_Apparel.xml','/Defs/StatDef[@Name="ArmorRatingBase"]',@('defaultBaseValue','parts'),'ArmorRatingBase quality factors.'),
 @('Data/Core/Defs/Stats/Stats_Apparel.xml','/Defs/StatDef[@Name="InsulationBase"]',@('defaultBaseValue','parts'),'InsulationBase quality factors.'),
 @('Data/Core/Defs/Stats/Stats_Apparel.xml','/Defs/StatDef[defName="ArmorRating_Sharp"]',@('parts'),'ArmorRating_Sharp material power and priority.'),
 @('Data/Core/Defs/Stats/Stats_Apparel.xml','/Defs/StatDef[defName="ArmorRating_Blunt"]',@('parts'),'ArmorRating_Blunt material power and priority.'),
 @('Data/Core/Defs/Stats/Stats_Apparel.xml','/Defs/StatDef[defName="ArmorRating_Heat"]',@('parts'),'ArmorRating_Heat material power and priority.'),
 @('Data/Core/Defs/Stats/Stats_Apparel.xml','/Defs/StatDef[defName="Insulation_Cold"]',@('parts'),'Insulation_Cold material power and priority.'),
 @('Data/Core/Defs/Stats/Stats_Apparel.xml','/Defs/StatDef[defName="Insulation_Heat"]',@('parts'),'Insulation_Heat material power and priority.'),
 @('Data/Core/Defs/Stats/Stats_Basics_General.xml','/Defs/StatDef[defName="MaxHitPoints"]',@('defaultBaseValue','parts'),'MaxHitPoints defaults and modifiers.'),
 @('Data/Core/Defs/Stats/Stats_Basics_General.xml','/Defs/StatDef[defName="Flammability"]',@('defaultBaseValue','parts'),'Flammability defaults and modifiers.'),
 @('Data/Core/Defs/Stats/Stats_Basics_General.xml','/Defs/StatDef[defName="MarketValue"]',@('defaultBaseValue','parts'),'MarketValue defaults and modifiers.'),
 @('Data/Core/Defs/Stats/Stats_Basics_General.xml','/Defs/StatDef[@Name="MarketValueBase"]',@('workerClass','parts'),'Quality and other item value modifiers.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Unfinished.xml','/Defs/ThingDef[@Name="UnfinishedBase"]',@('statBases'),'No UFT base flammability.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Unfinished.xml','/Defs/ThingDef[defName="UnfinishedApparel"]',@('statBases','stuffCategories'),'No unfinished apparel flammability override.')
)
$docs=@{}
$defs=@(foreach($spec in $specs){
 $file=Join-Path $GameRoot $spec[0]
 if(!$docs.ContainsKey($spec[0])){$doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null;$doc.Load($file);$docs[$spec[0]]=$doc}
 $nodes=@($docs[$spec[0]].SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected XML node count: $($spec[1])"}
 $node=$nodes[0];$fields=@(foreach($xpath in $spec[2]){$values=@($node.SelectNodes($xpath));[ordered]@{xpath=$xpath;count=$values.Count;xml=@($values|ForEach-Object OuterXml)}})
 [ordered]@{file=$spec[0];sha256=Hash $file;xpath=$spec[1];nameAttribute=$node.GetAttribute('Name');parentName=$node.GetAttribute('ParentName');fields=$fields;interpretation=$spec[3]}
})
$alpaca=$docs["Data/Core/Defs/ThingDefs_Races/Races_Animal_SheepGroup.xml"].SelectSingleNode('/Defs/ThingDef[defName="Alpaca"]')
$woolComp=$alpaca.SelectSingleNode('comps/li[@Class="CompProperties_Shearable"]')
if($woolComp.woolDef -cne "WoolAlpaca" -or $woolComp.woolAmount -cne "45" -or $woolComp.shearIntervalDays -cne "10"){throw "Alpaca production declaration changed"}
$stuffDoc=$docs["Data/Core/Defs/ThingDefs_Items/Items_Resource_Stuff.xml"]
$wool=$stuffDoc.SelectSingleNode('/Defs/ThingDef[defName="WoolAlpaca"]');$woolBase=$stuffDoc.SelectSingleNode('/Defs/ThingDef[@Name="WoolBase"]');$cloth=$stuffDoc.SelectSingleNode('/Defs/ThingDef[defName="Cloth"]')
if($wool.statBases.MarketValue -cne "3.8" -or $wool.statBases.StuffPower_Insulation_Cold -cne "30" -or $wool.statBases.StuffPower_Insulation_Heat -cne "16"){throw "Alpaca wool powers changed"}
foreach($node in @($wool,$woolBase,$cloth)){if($node.SelectNodes("stuffProps/statFactors/MaxHitPoints | stuffProps/statOffsets/MaxHitPoints | stuffProps/statFactors/WorkToMake | stuffProps/statOffsets/WorkToMake").Count){throw "Cloth or wool HP/work modifiers changed"}}
$native=[ordered]@{species="Alpaca";product="WoolAlpaca";saveKey="woolGrowth";sexRestricted=$false;lifeStage="AnimalAdult";intervalDays=10;amount=45;workTotal=1700;xpPerWorkTick=.13;priority=85;wildness=.25;bodySize=1;baseHungerRate=.275;adultFedNutritionPerDayApprox=.275*2.6666667E-05*60000;stackLimit=100;resourceHP=90;deteriorationPerDay=3.4;marketValue=3.8;rawFlammability=.4;coldPower=30;heatPower=16;sharpPower=.36;bluntPower=0;heatArmorPower=1.10;apparelHpFactor=1;apparelWorkFactor=1;stuffFlammability=1.7;ordinaryApparelBaseFlammability=1;unfinishedApparelBaseFlammability=0}
$record=[ordered]@{
 evidence_id='RW17-ANIMAL-WOOL-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash
 reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile)
 manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile);rules=$records;boundedChecks=$bounded;packagedXml=$defs;nativeReference=$native
 limits=@('Static derived C# and packaged XML are not original source or runtime gameplay proof.','Matching REA metadata is reused for identity only.','No game, browser, preview, GUI or screenshot was launched.','Selected XML inheritance nodes are not a complete mod-patched effective Def database.','Apparel effects cover ordinary material-aware clothing, not every scenario, style, hediff or mod rule.','Protected output retries, changed timings, wildlife selection and combustible unfinished apparel are Web adaptations.','No native artwork, audio, assemblies or complete derived code is published.')
 collectorSha256=Hash $PSCommandPath
}
$json=($record|ConvertTo-Json -Depth 18).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static projection differs'};"Checked animal-wool: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) packaged XML projections"}
else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));'Collected animal-wool static mechanisms'}
