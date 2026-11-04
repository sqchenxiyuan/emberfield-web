param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Bounded, reproducible static projection. Does not execute the target assembly.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/egg-box-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/egg-box-manifest.json'
$reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static identity mismatch'}
$sources=@{}
foreach($m in $manifest.types){$file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)}
$rules=@(
 @('Verse.BuildableDef','public Traversability passability;','The field keeps enum zero unless a Def overrides it.'),
 @('Verse.Traversability','Standable,','The first enum member is zero: ordinary egg boxes are standable.'),
 @('Verse.ThingDef','public IntVec2 size = IntVec2.One;','EggBox inherits a one-cell footprint when size is absent.'),
 @('Verse.ThingDef','public bool blockLight;','Light blocking defaults to false.'),
 @('Verse.ThingDef','public bool blockWind;','Wind blocking defaults to false.'),
 @('Verse.ThingDef','public bool hasInteractionCell;','Without an interaction cell, extraction uses Touch.'),
 @('Verse.ThingDef','public bool canDeteriorateUnspawned;','Egg items inherit false unless explicitly overridden.'),
 @('Verse.ThingDef','if (passability != Traversability.Impassable && !IsDoor)','Region blocking is tied to impassable buildings, doors or fences; EggBox declares none of these.'),
 @('RimWorld.StatWorker','num *= req.StuffDef.stuffProps.statFactors.GetStatFactorFromList(stat);','Building statBases are modified by selected material factors.'),
 @('RimWorld.StatWorker','num += req.StuffDef.stuffProps.statOffsets.GetStatOffsetFromList(stat);','Material offsets also affect effective stats.'),
 @('RimWorld.JobGiver_LayEgg','compEggLayer == null || !compEggLayer.CanLayNow','A ready egg layer is required before selecting a site.'),
 @('RimWorld.JobGiver_LayEgg','ThingDef singleDef = compEggLayer.NextEggType();','Fallback search matches the next actual fertile/unfertile type.'),
 @('RimWorld.JobGiver_LayEgg','PathEndMode peMode = PathEndMode.OnCell;','The animal stands on the laying destination, including the box.'),
 @('RimWorld.JobGiver_LayEgg','TraverseParms.For(pawn, Danger.Some)','Search uses the animal traverse parameters and Danger.Some.'),
 @('RimWorld.JobGiver_LayEgg','if (pawn.Faction == Faction.OfPlayer)','Only player-faction animals enter the egg-box preference branch.'),
 @('RimWorld.JobGiver_LayEgg','return JobMaker.MakeJob(JobDefOf.LayEgg, bestEggBox);','A usable preferred box wins before the floor-egg fallback.'),
 @('RimWorld.JobGiver_LayEgg','pawn.GetRoom() == null || x.GetRoom() == pawn.GetRoom()','Same-room restriction belongs to the floor-egg fallback.'),
 @('RimWorld.JobGiver_LayEgg','RCellFinder.RandomWanderDestFor(pawn, pawn.Position, 5f, null, Danger.Some)','Without a reachable box or same-type floor egg, use a nearby wander cell.'),
 @('RimWorld.JobGiver_LayEgg','ThingRequest.ForDef(ThingDefOf.EggBox), peMode, tp, 30f, IsUsableBox, GetScore, 10','Boxes use a 30-cell prioritized regional search with minimum ten regions.'),
 @('RimWorld.JobGiver_LayEgg','compEggContainer == null || compEggContainer.Full','Full boxes score zero and also fail acceptance.'),
 @('RimWorld.JobGiver_LayEgg','compEggContainer.ContainedThing?.stackCount * 5f) ?? 0.5f','Nonempty boxes score first-stack count times five; empty boxes score one half.'),
 @('RimWorld.JobGiver_LayEgg','if (!thing.Spawned)','Candidates must be spawned.'),
 @('RimWorld.JobGiver_LayEgg','thing.IsForbidden(pawn) || !pawn.CanReserve(thing) || !pawn.Position.InHorDistOf(thing.Position, 30f)','Forbidden, reservation and horizontal-distance checks gate the candidate.'),
 @('RimWorld.JobGiver_LayEgg','compEggContainer == null || !compEggContainer.Accepts(eggDef)','A box must accept the next egg Def.'),
 @('Verse.GenClosest','int minRegions = 24, int maxRegions = 30, bool lookInHaulSources = false)','The caller leaves maximum scanned regions at thirty.'),
 @('Verse.RegionProcessorClosestThingReachable','if (regionsSeenScan >= minRegions)','The region traversal may stop after the minimum when a candidate exists.'),
 @('Verse.RegionProcessorClosestThingReachable','return closestThing != null;','Finding a candidate after minimum regions terminates this processor.'),
 @('Verse.RegionProcessorClosestThingReachable','(num > bestPrio || num2 < closestDistSquared) && num2 < maxDistSquared','Within visited candidates, priority wins; equal priority uses nearer squared distance. Radius comparison is strict here.'),
 @('RimWorld.JobDriver_LayEgg','yield return Toils_Goto.GotoCell(TargetIndex.A, PathEndMode.OnCell);','The animal walks to the selected box or cell.'),
 @('RimWorld.JobDriver_LayEgg','yield return Toils_General.Wait(500);','Laying waits five hundred native ticks before producing the egg.'),
 @('RimWorld.JobDriver_LayEgg','Thing thing = pawn.GetComp<CompEggLayer>().ProduceEgg();','The final action produces the actual item.'),
 @('RimWorld.JobDriver_LayEgg','job.GetTarget(TargetIndex.A).HasThing && EggBoxComp.Accepts(thing.def)','At completion, acceptance is rechecked against the egg actually produced.'),
 @('RimWorld.JobDriver_LayEgg','EggBoxComp.innerContainer.TryAdd(thing);','Accepted eggs enter the physical container.'),
 @('RimWorld.JobDriver_LayEgg','GenPlace.TryPlaceThing(thing, pawn.Position, pawn.Map, ThingPlaceMode.Near','A box no longer accepting the egg falls back to nearby floor placement.'),
 @('RimWorld.CompThingContainer','innerContainer = new ThingOwner<Thing>(this);','The box owns real Thing entries, not a numeric stock ledger.'),
 @('RimWorld.CompThingContainer','return innerContainer[0];','ContainedThing refers to the first stack.'),
 @('RimWorld.CompThingContainer','return innerContainer.TotalStackCountOfDef(innerContainer[0].def);','TotalStackCount totals the first stack Def across physical entries.'),
 @('RimWorld.CompThingContainer','return TotalStackCount >= Props.stackLimit;','Full uses the declared container count limit.'),
 @('RimWorld.CompThingContainer','if (TotalStackCount < Props.stackLimit)','Existing contents permit more only below the declared capacity.'),
 @('RimWorld.CompThingContainer','return thingDef == ContainedThing.def;','A nonempty box only accepts the same exact ThingDef.'),
 @('Verse.ThingOwner','protected int maxStacks = 999999;','The generic owner is not itself the declared twenty-five-egg capacity clamp.'),
 @('Verse.ThingOwner','if (maxStacks == 999999)','Default generic acceptance can accept the whole incoming stack.'),
 @('Verse.ThingOwner`1','val.TryAbsorbStack(other, respectStackLimit: true);','Container insertion merges compatible item stacks using ordinary item absorption.'),
 @('RimWorld.CompEggContainer','ContainedThing != null && EggsRuined','A currently ruined first egg stack makes the box refuse more eggs.'),
 @('RimWorld.CompEggContainer','thingDef.thingCategories.Contains(ThingCategoryDefOf.EggsFertilized) || thingDef.thingCategories.Contains(ThingCategoryDefOf.EggsUnfertilized)','Only explicit fertilized/unfertilized egg categories pass the specialized acceptance check.'),
 @('RimWorld.CompEggContainer','return ContainedThing.stackCount >= Props.minCountToEmpty;','Ordinary automatic emptying uses the first stack count threshold, not Full.'),
 @('RimWorld.CompEggContainer','if (EggsRuined)','Ruined eggs also permit automatic emptying before the count threshold.'),
 @('RimWorld.CompEggContainer','compTemperatureRuinable != null && compTemperatureRuinable.Ruined','Thermal ruin is one ruined-egg signal.'),
 @('RimWorld.CompEggContainer','compHatcher != null && compHatcher.TemperatureDamaged','A damaged hatcher is the other ruined-egg signal.'),
 @('RimWorld.CompThingContainer','innerContainer.DoTick();','The container ticks its contents from CompTick.'),
 @('Verse.ThingOwner','if (dontTickContents)','Generic ThingOwner can explicitly suspend content ticking; egg boxes do not set this in the inspected code.'),
 @('Verse.ThingOwner','at.DoTick();','Each held Thing uses its own ticker behavior.'),
 @('Verse.ThingOwner','if (at.Destroyed && removeContentsIfDestroyed)','Destroyed contents are removed after their tick.'),
 @('Verse.ThingWithComps','comps[i].CompTick();','A normal-tick building dispatches component ticks.'),
 @('Verse.Thing','cachedHolder = this as IThingHolder;','Generic recursive holder ticking tests the Thing itself; ordinary Building is not the CompThingContainer holder.'),
 @('Verse.Building','public class Building : ThingWithComps','EggBox uses ordinary Building, so component ticking is its container path.'),
 @('Verse.Thing','ThingOwnerUtility.TryGetFixedTemperature(parentHolder, this, out var temperature)','Held temperature consults fixed-temperature overrides first.'),
 @('Verse.Thing','return GenTemperature.GetTemperatureForCell(PositionHeld, MapHeld);','An ordinary spawned egg box falls through to its held map-cell temperature.'),
 @('Verse.ThingOwnerUtility','holder is Pawn_InventoryTracker && forThing.TryGetComp<CompHatcher>() != null','Fertile eggs in pawn inventory have a special fixed-temperature branch.'),
 @('Verse.ThingOwnerUtility','temperature = 14f;','Pawn inventory hatchers and listed transport/trade holders use fourteen degrees.'),
 @('RimWorld.CompTemperatureRuinable','float ambientTemperature = parent.AmbientTemperature;','Thermal damage uses the held egg ambient temperature.'),
 @('RimWorld.CompHatcher','gestateProgress += num;','Viable held eggs continue incubation without a brooding animal.'),
 @('RimWorld.CompHatcher','parent.ParentHolder is CompEggContainer compEggContainer','Thermal ruin has a dedicated egg-box conversion branch.'),
 @('RimWorld.CompHatcher','compEggContainer.innerContainer.Remove(parent);','Conversion removes the old fertile instance from the box.'),
 @('RimWorld.CompHatcher','Thing thing = ThingMaker.MakeThing(compProperties_EggLayer.eggUnfertilizedDef);','Conversion creates a fresh unfertilized egg instance.'),
 @('RimWorld.CompHatcher','compEggContainer.innerContainer.TryAdd(thing);','The replacement remains inside the same box.'),
 @('RimWorld.CompHatcher','for (int i = 0; i < parent.stackCount; i++)','Hatching generates one pawn per egg, including box contents.'),
 @('RimWorld.PawnUtility','return GenSpawn.Spawn(pawn, positionOverride ?? motherOrEgg.PositionHeld, motherOrEgg.MapHeld) != null;','On-map box hatchlings spawn at the held egg position.'),
 @('RimWorld.CompRottable','compHatcher != null && !compHatcher.TemperatureDamaged','Viable hatchers disable ordinary egg rot.'),
 @('RimWorld.CompRottable','GenTemperature.RotRateAtTemperature(parent.AmbientTemperature)','Unfertilized held eggs still rot according to temperature.'),
 @('RimWorld.SteadyEnvironmentEffects','t.SpawnedOrAnyParentSpawned && !t.def.canDeteriorateUnspawned','Held eggs default to zero ordinary outdoor deterioration.'),
 @('RimWorld.ForbidUtility','if (!c.InAllowedArea(pawn))','IsForbidden(pawn) includes allowed-area restrictions, not only item flags.'),
 @('RimWorld.JobGiver_Work','if (!t.IsForbidden(pawn))','The ordinary work scanner checks forbidden before asking HasJobOnThing.'),
 @('RimWorld.WorkGiver_EmptyEggBox','ThingRequest.ForDef(ThingDefOf.EggBox)','The work giver scans actual egg-box buildings.'),
 @('RimWorld.WorkGiver_EmptyEggBox','pawn.CanReserve(t, 1, -1, null, forced)','The forced flag is passed to reservation availability; it does not skip the call.'),
 @('RimWorld.WorkGiver_EmptyEggBox','compEggContainer?.ContainedThing == null','An empty box cannot provide an extraction job.'),
 @('RimWorld.WorkGiver_EmptyEggBox','if (!compEggContainer.CanEmpty && !forced)','Forced work can bypass the automatic count/damage trigger.'),
 @('RimWorld.WorkGiver_EmptyEggBox','StoragePriority.Unstored, pawn.Faction','Both automatic and forced work still require better accepted storage.'),
 @('RimWorld.WorkGiver_EmptyEggBox','JobMaker.MakeJob(JobDefOf.EmptyThingContainer, t, compEggContainer.ContainedThing, foundCell)','A job retains box, actual content object and destination cell.'),
 @('RimWorld.WorkGiver_EmptyEggBox','job.count = compEggContainer.ContainedThing.stackCount;','Assigned count is the current physical first-stack count.'),
 @('RimWorld.JobDriver_EmptyThingContainer','return PathEndMode.Touch;','A box without an interaction cell is approached by touch.'),
 @('RimWorld.JobDriver_EmptyThingContainer','base.job.def.containerReservationLayer','The driver reserves the container on the job-defined reservation layer.'),
 @('RimWorld.JobDriver_EmptyThingContainer','return pawn.Reserve(base.job.GetTarget(TargetIndex.C), base.job, 1, -1, null, errorOnFailed);','Destination reservation must also succeed.'),
 @('RimWorld.JobDriver_EmptyThingContainer','FailOnDespawnedNullOrForbidden(TargetIndex.A)','Approach fails if the box disappears or becomes forbidden.'),
 @('RimWorld.JobDriver_EmptyThingContainer','comp.Empty);','Approach also fails when contents disappeared.'),
 @('RimWorld.JobDriver_EmptyThingContainer','WaitWhileExtractingContents(TargetIndex.A, TargetIndex.B, 120)','Extraction is an actual wait of one hundred twenty native ticks.'),
 @('Verse.AI.Toils_General','Wait(openTicks, containerInd).WithProgressBarToilDelay(containerInd).FailOnDespawnedOrNull(containerInd)','The extraction wait displays progress and fails when its container despawns.'),
 @('RimWorld.JobDriver_EmptyThingContainer','TryDropAll(pawn.Position, pawn.Map, ThingPlaceMode.Near)','Contents first leave the box and become ground items near the worker.'),
 @('RimWorld.JobDriver_EmptyThingContainer','yield return Toils_Reserve.Reserve(TargetIndex.B);','The newly dropped actual item is then reserved.'),
 @('RimWorld.JobDriver_EmptyThingContainer','Toils_Haul.StartCarryThing(TargetIndex.B, putRemainderInQueue: false, subtractNumTakenFromJobCount: true)','The worker physically picks up contents, subject to ordinary carrying behavior.'),
 @('RimWorld.JobDriver_EmptyThingContainer','Toils_Haul.CarryHauledThingToCell(TargetIndex.C)','The worker then walks to storage carrying the eggs.'),
 @('RimWorld.JobDriver_EmptyThingContainer','storageMode: true, tryStoreInSameStorageIfSpotCantHoldWholeStack: true','Final placement uses storage-mode handling, including same-storage remainder handling.'),
 @('RimWorld.CompThingContainer','if (mode != DestroyMode.WillReplace)','Normal despawn drops contents; replacement mode explicitly skips this.'),
 @('RimWorld.CompThingContainer','innerContainer.TryDropAll(parent.Position, map, ThingPlaceMode.Near);','Destroyed or removed on-map boxes attempt nearby physical ejection.'),
 @('Verse.ThingWithComps','comps[i].PostDeSpawn(map, mode);','The destruction/despawn chain notifies the container component.'),
 @('Verse.Thing','DeSpawn(mode);','A spawned Thing first despawns as part of destruction.'),
 @('Verse.ThingOwner','if (GenDrop.TryDropSpawn(thing, dropLoc, map, mode, out lastResultingThing','An item is only removed from its owner after successful drop spawning.'),
 @('Verse.ThingOwner','if (!TryDrop(GetAt(num), dropLoc, map, mode, out var _','TryDropAll reports failure if any entry cannot be placed.'),
 @('RimWorld.CompThingContainer','Scribe_Deep.Look(ref innerContainer, "innerContainer", this);','Container contents are saved deeply, preserving physical item state.'),
 @('RimWorld.CompThingContainer','Building.SelectContainedItemGizmo(parent, item)','Contained entries can be selected through building gizmos.'),
 @('RimWorld.CompEggContainer','string text2 = compHatcher.CompInspectStringExtra();','Box inspection includes fertile egg progress when not ruined.')
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
 $body=$s.Substring($a,$b-$a);foreach($token in $tokens){if($body.Contains($token)){throw "Unexpected token $type $token"}}
 [ordered]@{type=$type;start=$start;end=$end;lineStart=$s.Substring(0,$a).Split("`n").Count;lineEnd=$s.Substring(0,$b).Split("`n").Count;sha256=TextHash $body;absent=$tokens;interpretation=$meaning}
}
$bounded=@(
 (BoundedAbsence 'RimWorld.JobGiver_LayEgg' 'private Thing GetBestEggBox' '' @('GetRoom(','.Faction','minCountToEmpty','CompPower','CompFlickable') 'The specialized box selector has no room, box-faction, autoempty-threshold or power/switch test.'),
 (BoundedAbsence 'RimWorld.JobDriver_LayEgg' 'public override bool TryMakePreToilReservations' 'protected override IEnumerable<Toil>' @('pawn.Reserve','Reserve(') 'The lay driver returns true without acquiring a reservation.'),
 (BoundedAbsence 'RimWorld.CompThingContainer' 'public override void CompTick()' 'public override void PostDraw()' @('Forbidden','Power','Flick','dontTickContents') 'Normal egg-box ticking is not gated by forbidden, power or a switch.'),
 (BoundedAbsence 'Verse.ThingOwnerUtility' 'public static bool TryGetFixedTemperature' '' @('CompEggContainer','Pawn_CarryTracker') 'Neither egg boxes nor hand carrying have a fixed-temperature override in this method.'),
 (BoundedAbsence 'RimWorld.WorkGiver_EmptyEggBox' 'public override bool HasJobOnThing' 'public override Job JobOnThing' @('t.Faction','t.IsForbidden','ContainedThing.IsForbidden') 'This method leaves general forbidden checks to caller/job flow and adds no box-faction comparison.'),
 (BoundedAbsence 'RimWorld.CompHatcher' 'if (parent.ParentHolder is CompEggContainer' 'public void Hatch()' @('RotProgress','rotProgress','HitPoints','SetForbidden','hatcheeFaction') 'Thermal replacement explicitly preserves count, not former condition/forbid/hatcher identity.'),
 (BoundedAbsence 'RimWorld.CompThingContainer' 'public override void PostDeSpawn' 'public override string CompInspectStringExtra' @('if (innerContainer.TryDropAll','throw','ClearAndDestroyContents') 'The despawn component does not branch on failed ejection or explicitly destroy remaining contents.'),
 (BoundedAbsence 'RimWorld.CompEggContainer' 'public override IEnumerable<Gizmo> CompGetGizmosExtra' '' @('emptyRequested','EmptyThingContainer','CanEmpty') 'The shown component gizmos provide no persisted player empty-request flag; such a Web flag is a design choice.'),
 (BoundedAbsence 'RimWorld.JobDriver_LayEgg' 'protected override IEnumerable<Toil> MakeNewToils()' '' @('if (EggBoxComp.innerContainer.TryAdd','if (GenPlace.TryPlaceThing') 'Native laying does not guard final consumption by checking insertion/placement success.')
)
$specs=@(
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Misc.xml','/Defs/ThingDef[defName="EggBox"]',@('description','size','passability','fillPercent','blockLight','blockWind','hasInteractionCell','tickerType','containedItemsSelectable','statBases','comps','stuffCategories','costStuffCount','pathCost','designationCategory','rotatable','minifiedDef','building','researchPrerequisites'),'EggBox declaration, geometry defaults, build inputs and container settings.'),
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Base.xml','/Defs/ThingDef[@Name="BuildingBase"]',@('category','thingClass','size','passability','terrainAffordanceNeeded','leaveResourcesWhenKilled','comps','statBases'),'EggBox parent is an ordinary selectable building; default terrain requirement is Light.'),
 @('Data/Core/Defs/WorkGiverDefs/WorkGivers.xml','/Defs/WorkGiverDef[defName="EmptyEggBox"]',@('giverClass','workType','priorityInType','requiredCapacities'),'Egg extraction belongs to hauling with Manipulation capability.'),
 @('Data/Core/Defs/JobDefs/Jobs_Misc.xml','/Defs/JobDef[defName="EmptyThingContainer"]',@('driverClass','containerReservationLayer','reportString'),'Extraction job driver and its unspecialized reservation declaration.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[@Name="EggBase"]',@('tickerType','statBases','comps','canDeteriorateUnspawned'),'Common egg rot and deterioration settings.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[@Name="EggFertBase"]',@('tickerType','comps','thingCategories','canDeteriorateUnspawned'),'Fertile eggs use normal ticks and 0..50 degree thermal limits.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[@Name="EggUnfertBase"]',@('thingCategories','comps','canDeteriorateUnspawned'),'Unfertilized replacement loses hatcher/thermal components.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[defName="EggChickenFertilized"]',@('comps','canDeteriorateUnspawned'),'Chicken hatcher duration and output species.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[defName="EggChickenUnfertilized"]',@('comps','canDeteriorateUnspawned'),'Chicken unfertilized egg adds no hatcher.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_RawPlant.xml','/Defs/ThingDef[@Name="OrganicProductBase"]',@('tickerType','canDeteriorateUnspawned'),'Organic products inherit ordinary rare ticks.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_Base.xml','/Defs/ThingDef[@Name="ResourceBase"]',@('stackLimit','comps','canDeteriorateUnspawned'),'Resource stack limit and common item components.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_Stuff.xml','/Defs/ThingDef[defName="WoodLog"]',@('stuffProps/categories','stuffProps/statFactors','stuffProps/statOffsets'),'Wood material modifiers are separate from EggBox statBases.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_Stuff.xml','/Defs/ThingDef[defName="Steel"]',@('stuffProps/categories','stuffProps/statFactors','stuffProps/statOffsets'),'Steel material modifiers are separate from EggBox statBases.'),
 @('Data/Core/Defs/Stats/Stats_Building_Special.xml','/Defs/StatDef[defName="WorkToBuild"]',@('defaultBaseValue','minValue','toStringStyle','roundToFiveOver'),'WorkToBuild denotes work amount, not an unconditional wall-clock duration.'),
 @('Data/Core/Defs/Stats/Stats_Basics_General.xml','/Defs/StatDef[defName="MaxHitPoints"]',@('defaultBaseValue','minValue','roundValue','roundToFiveOver'),'Effective maximum HP is finalized and rounded.'),
 @('Data/Core/Defs/Stats/Stats_Basics_General.xml','/Defs/StatDef[defName="Flammability"]',@('defaultBaseValue','minValue','maxValue'),'Flammability is a stat with material modifications and bounds.')
)
$docs=@{}
$defs=@(foreach($spec in $specs){
 $file=Join-Path $GameRoot $spec[0]
 if(!$docs.ContainsKey($spec[0])){$doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null;$doc.Load($file);$docs[$spec[0]]=$doc}
 $nodes=@($docs[$spec[0]].SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected XML node count: $($spec[1])"}
 $node=$nodes[0];$fields=@(foreach($xpath in $spec[2]){$values=@($node.SelectNodes($xpath));[ordered]@{xpath=$xpath;count=$values.Count;xml=@($values|ForEach-Object OuterXml)}})
 [ordered]@{file=$spec[0];sha256=Hash $file;xpath=$spec[1];nameAttribute=$node.GetAttribute('Name');parentName=$node.GetAttribute('ParentName');fields=$fields;interpretation=$spec[3]}
})
$box=$docs['Data/Core/Defs/ThingDefs_Buildings/Buildings_Misc.xml'].SelectSingleNode('/Defs/ThingDef[defName="EggBox"]')
$container=$box.SelectSingleNode('comps/li[@Class="CompProperties_ThingContainer"]')
if($container.stackLimit -cne '25' -or $container.minCountToEmpty -cne '20' -or $box.costStuffCount -cne '20' -or $box.statBases.WorkToBuild -cne '2000' -or $box.statBases.MaxHitPoints -cne '50'){throw 'Egg-box declaration changed'}
foreach($node in @($box,$docs['Data/Core/Defs/ThingDefs_Buildings/Buildings_Base.xml'].SelectSingleNode('/Defs/ThingDef[@Name="BuildingBase"]'))){
 foreach($field in @('size','passability','hasInteractionCell','blockLight','blockWind')){if($node.SelectSingleNode($field)){throw "Unexpected geometry override $field"}}
}
$record=[ordered]@{
 evidence_id='RW17-EGG-BOX-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash
 reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile)
 manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile);rules=$records;boundedChecks=$bounded;packagedXml=$defs
 nativeReference=[ordered]@{size=@(1,1);passability='Standable';fillPercent=.3;pathCost=10;blockLight=$false;blockWind=$false;interactionCell=$false;terrainAffordance='Light';costStuffCount=20;stuffCategories=@('Metallic','Woody');baseWorkToBuild=2000;baseMaxHitPoints=50;baseFlammability=1;baseMass=3;stackLimit=25;minCountToEmpty=20;nextEggTypeMustMatch=$true;boxSearchRadius=30;boxSearchMinRegions=10;boxSearchMaxRegions=30;nonemptyScorePerEgg=5;emptyScore=.5;boxRequiresSameRoom=$false;floorEggRequiresSameRoomWhenKnown=$true;fallbackWanderRadius=5;layWaitTicks=500;extractionWaitTicks=120;haulingPriorityInType=20;heldEggTemperature='Map-held cell for ordinary egg box; not a fixed-temperature holder';pawnInventoryHatcherFixedTemperature=14;forcedStillNeedsStorage=$true;destroyDropMode='Near, except WillReplace';declaredCostAndStatsAreNotFinalMaterialStats=$true}
 limits=@('Static derived C# and packaged XML are not original source or runtime gameplay proof.','Existing REA metadata is reused for exact assembly identity only; new types are independently re-extracted.','No game, browser, preview, GUI input or screenshot was launched.','Selected XML inheritance nodes are not a complete mod-patched effective Def database.','Native region-limited prioritized search is not an exhaustive global best-box search.','General forbidden and reservation behavior depends on caller, pawn state and job stage.','Drop failure returns false; native despawn does not demonstrate guaranteed recovery after the building is destroyed.','One Cargo per Web box, persistent empty requests, exhaustive local search and capacity-preflight retry are Web implementation choices.','No game assets, assemblies or complete derived C# is published.')
 collectorSha256=Hash $PSCommandPath
}
$json=($record|ConvertTo-Json -Depth 20).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static egg-box projection differs'};"Checked egg-box: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) packaged XML projections"}
else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));'Collected egg-box static mechanisms'}
