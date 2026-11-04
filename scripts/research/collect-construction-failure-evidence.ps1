param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Static source/packaged XML projection; no target, browser, preview or GUI launch.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/construction-failure-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/construction-failure-manifest.json'
$reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static identity mismatch'}
$sources=@{}
foreach($m in $manifest.types){$file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)}
$rules=@(
 @('RimWorld.WorkGiver_ConstructFinishFrames','if (!frame.IsCompleted())','FinishFrame work requires all construction materials to be delivered.'),
 @('RimWorld.WorkGiver_ConstructFinishFrames','GenConstruct.CanConstruct(frame, pawn, checkSkills: true, forced)','Assignment checks construction eligibility, including skill prerequisites.'),
 @('RimWorld.GenConstruct','p.skills.GetSkill(SkillDefOf.Construction).Level < t.def.constructionSkillPrerequisite','Definition skill requirement is an eligibility gate separate from success chance.'),
 @('RimWorld.JobDriver_ConstructFinishFrame','if (frame.resourceContainer.Count > 0 && actor.skills != null)','Construction learning requires materials in the frame and a pawn skill tracker.'),
 @('RimWorld.JobDriver_ConstructFinishFrame','actor.skills.Learn(SkillDefOf.Construction, 0.25f * (float)delta)','Learning happens before construction speed and success stat reads in this interval.'),
 @('RimWorld.JobDriver_ConstructFinishFrame','actor.GetStatValue(StatDefOf.ConstructionSpeed) * 1.7f * (float)delta','Work delta depends on construction speed and elapsed logical ticks.'),
 @('RimWorld.JobDriver_ConstructFinishFrame','num *= frame.Stuff.GetStatValueAbstract(StatDefOf.ConstructionSpeedFactor)','Selected construction material changes work delta.'),
 @('RimWorld.JobDriver_ConstructFinishFrame','if (actor.Faction == Faction.OfPlayer)','The failure hazard is evaluated only for the player faction.'),
 @('RimWorld.JobDriver_ConstructFinishFrame','!TutorSystem.TutorialMode && Rand.Value < 1f - Mathf.Pow(statValue, num / workToBuild)','The non-tutorial player interval samples before applying work; probability uses the full work delta divided by total work.'),
 @('RimWorld.JobDriver_ConstructFinishFrame','frame.FailConstruction(actor)','Failure destroys the frame and returns before incrementing workDone.'),
 @('RimWorld.JobDriver_ConstructFinishFrame','if (frame.def.entityDefToBuild is TerrainDef)','Terrain frames pass through the same preceding failure hazard; terrain-specific clearing follows it.'),
 @('RimWorld.JobDriver_ConstructFinishFrame','frame.workDone += num','Only surviving intervals apply their work increment, then test completion.'),
 @('RimWorld.JobDriver_ConstructFinishFrame','build.FailOnDespawnedNullOrForbidden(TargetIndex.A)','Despawn/null/forbidden interrupt ordinary work independently of a construction mishap.'),
 @('RimWorld.JobDriver_ConstructFinishFrame','build.FailOn(() => !GenConstruct.CanConstruct(Frame, pawn))','Loss of construction eligibility interrupts work, rather than invoking FailConstruction.'),
 @('RimWorld.JobDriver_ConstructFinishFrame','build.defaultDuration = 5000','The work toil is finite; reaching the duration is not a construction mishap call.'),
 @('RimWorld.Frame','Scribe_Values.Look(ref workDone, "workDone", 0f)','Work progress is stored on the frame and saved independently of the current job.'),
 @('RimWorld.Frame','Destroy(DestroyMode.FailConstruction)','Failure uses a dedicated destruction mode, distinct from KillFinalize auto-rebuild.'),
 @('RimWorld.Frame','blueprint_Build = (Blueprint_Build)ThingMaker.MakeThing(def.entityDefToBuild.blueprintDef)','Failure creates a new ordinary blueprint if the final definition has one.'),
 @('RimWorld.Frame','blueprint_Build.stuffToUse = Stuff','Retry preserves chosen building material.'),
 @('RimWorld.Frame','blueprint_Build.SetFactionDirect(Faction)','Retry preserves faction.'),
 @('RimWorld.Frame','blueprint_Build.InheritStyle(StyleSourcePrecept, StyleDef)','Retry inherits style through Blueprint.InheritStyle.'),
 @('RimWorld.Frame','storageGroupMember.Group = storageGroup','A compatible retry blueprint retains the storage group reference.'),
 @('RimWorld.Frame','blueprint_Storage.settings.CopyFrom(storageSettings)','A storage retry blueprint copies frame storage settings when present.'),
 @('RimWorld.Frame','GenSpawn.Spawn(blueprint_Build, Position, map, Rotation, WipeMode.FullRefund)','Retry spawns at the old anchor/rotation without an ordinary placement eligibility recheck in this method.'),
 @('RimWorld.Frame','MoteMaker.ThrowText(DrawPos, map, "TextMote_ConstructionFail".Translate(), 6f)','The failure gives local visual feedback; a separate message is gated by player faction and WorkToBuild > 1400.'),
 @('Verse.Thing','GenLeaving.DoLeavingsFor(this, map, mode, list)','Spawned thing destruction invokes material leavings using the actual destroy mode.'),
 @('Verse.Thing','RemoveAllReservationsAndDesignationsOnThis()','Destroyed frame identity loses its old reservations and designations.'),
 @('RimWorld.GenLeaving','for (int num4 = frame.resourceContainer.Count - 1; num4 >= 0; num4--)','Frame resource recovery visits actual delivered stacks in reverse container order.'),
 @('RimWorld.GenLeaving','GetBuildingResourcesLeaveCalculator(diedThing, mode)(frame.resourceContainer[num4].stackCount)','Recovery applies to each actual stack, not the full recipe or undelivered carried resources.'),
 @('RimWorld.GenLeaving','frame.resourceContainer.TryTransferToContainer(frame.resourceContainer[num4], thingOwner, num5)','Surviving material is transferred as real Thing contents to the leavings owner.'),
 @('RimWorld.GenLeaving','frame.resourceContainer.ClearAndDestroyContents()','The delivered remainder is destroyed after surviving portions transfer.'),
 @('RimWorld.GenLeaving','DestroyMode.FailConstruction => (int count) => Mathf.Max(GenMath.RoundRandom((float)count * 0.5f), 1)','Each positive stack leaves stochastic half with a minimum of one surviving item.'),
 @('RimWorld.GenLeaving','mode == DestroyMode.KillFinalize && !map.areaManager.Home[list3[num9]]','Automatic outside-Home forbidding here applies to kill leavings, not failure leavings.'),
 @('RimWorld.GenLeaving','thingOwner.TryDrop(thingOwner[0], list3[num9], map, ThingPlaceMode.Near','Survivors are dropped near the old footprint; failed placement logs a warning then breaks.'),
 @('Verse.GenMath','return (int)f + ((Rand.Value < f % 1f) ? 1 : 0)','RoundRandom uses truncation plus a fractional-probability increment; it reads Rand.Value even for an integer.'),
 @('Verse.Rand','public static float Value =>','The source generator uses global seed/iterations, increments each Value read and returns a float.'),
 @('RimWorld.Blueprint_Build','Frame frame = (Frame)ThingMaker.MakeThing(def.entityDefToBuild.frameDef, stuffToUse)','The next blueprint-to-frame transition creates a fresh frame, so prior work and frame damage are not inherited.'),
 @('RimWorld.Blueprint_Storage','frame.storageSettings.CopyFrom(GetStoreSettings())','Storage blueprint-to-frame transfer uses effective group settings when linked.'),
 @('RimWorld.Blueprint_Install','return thingToInstall','Installation returns the original thing rather than constructing a new frame.'),
 @('Verse.AI.JobDriver_HaulToContainer','Toils_Construct.MakeSolidThingFromBlueprintIfNecessary(TargetIndex.B, TargetIndex.C)','Delivery/installation performs blueprint conversion without the FinishFrame failure sampler.'),
 @('RimWorld.Designator_Build','DebugSettings.godMode || entDef.GetStatValueAbstract(StatDefOf.WorkToBuild, StuffDef) == 0f','God mode or zero work directly places terrain/building instead of a build blueprint.'),
 @('RimWorld.SkillNeed_Direct','return valuesPerLevel[level]','The ordinary construction skill factor selects the declared level entry.'),
 @('RimWorld.StatWorker','num *= stat.skillNeedFactors[num16].ValueFor(pawn)','Success calculation multiplies the skill factor before capacity factors.'),
 @('RimWorld.StatWorker','num = Mathf.Lerp(num, num * factor, pawnCapacityFactor.weight)','Capacity factors are weighted multiplicatively; they are not a direct percentage point subtraction.'),
 @('RimWorld.PawnCapacityFactor','public float max = 9999f','An omitted capacity-factor maximum defaults to 9999, not 1.'),
 @('RimWorld.PawnCapacityFactor','if (num > max)','The capacity-factor maximum is applied before weighting.'),
 @('RimWorld.StatWorker','val = Mathf.Clamp(val, stat.minValue, stat.maxValue)','Ordinary postprocessed stat finalization clamps only after the prior skill/capacity and other modifiers.')
)
$records=@(foreach($rule in $rules){
 $m=@($manifest.types|Where-Object type -eq $rule[0]);if($m.Count -ne 1){throw 'Missing rule type'}
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
 BoundedAbsence 'RimWorld.Frame' 'public void FailConstruction' 'protected override void DrawAt' @('autoRebuild','CheckAutoRebuild','areaManager.Home','IsResearchFinished','CanPlaceBlueprintAt','glowerColorOverride','workDone','HitPoints','resourceContainer') 'The retry method has no auto-rebuild/Home/research/placement gates and does not copy progress, damage, light-color override or surviving materials into the new blueprint.'
 BoundedAbsence 'RimWorld.JobDriver_ConstructFinishFrame' 'build.tickIntervalAction =' 'build.WithEffect' @('Mathf.Min','WorkLeft','useHitPoints','TotalMaterialCost','PushState','PopState') 'The hazard uses the full delta and global RNG without a terrain-HP/material-cost exclusion or a local seeded RNG scope.'
 BoundedAbsence 'RimWorld.JobDriver_ConstructFinishFrame' 'protected override IEnumerable<Toil> MakeNewToils' '' @('AddFinishAction','workDone = 0','DestroyMode.Cancel') 'No finish-action reset/cancellation of saved frame progress is declared by this driver.'
 BoundedAbsence 'RimWorld.Blueprint_Install' 'protected override Thing MakeSolidThing' 'public override bool TryReplaceWithSolidThing' @('MakeThing','Frame','FailConstruction','ConstructSuccessChance') 'Reviewed installation conversion does not construct a fresh frame or sample failure.'
 BoundedAbsence 'Verse.AI.JobDriver_HaulToContainer' 'protected override IEnumerable<Toil> MakeNewToils' 'private void UpdateEnrouteTrackers' @('FailConstruction','ConstructSuccessChance') 'Reviewed ordinary haul/install job does not use the FinishFrame construction-failure roll.'
)
$specs=@(
 @('Data/Core/Defs/Stats/Stats_Pawns_WorkGeneral.xml','/Defs/StatDef[defName="ConstructSuccessChance"]',@('defaultBaseValue','minValue','maxValue','skillNeedFactors','capacityFactors'),'Packaged full success curve and manipulation/sight factors.'),
 @('Data/Core/Defs/Stats/Stats_Pawns_WorkGeneral.xml','/Defs/StatDef[defName="ConstructionSpeed"]',@('defaultBaseValue','minValue','statFactors','skillNeedFactors','capacityFactors'),'Construction speed controls work delta rather than being a per-frame constant failure chance.'),
 @('Data/Core/Defs/TerrainDefs/Terrain_Floors.xml','/Defs/TerrainDef[defName="WoodPlankFloor"]',@('statBases/WorkToBuild','costList'),'An ordinary terrain example has positive work and material cost; it follows Frame finishing.'),
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml','/Defs/ThingDef[@Name="SleepingSpotBase"]',@('statBases/WorkToBuild','useHitPoints'),'A zero-work placement example uses the instant designator path.')
)
$docs=@{}
$defs=@(foreach($spec in $specs){
 $file=Join-Path $GameRoot $spec[0]
 if(!$docs.ContainsKey($spec[0])){$doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null;$doc.Load($file);$docs[$spec[0]]=$doc}
 $nodes=@($docs[$spec[0]].SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected Def node count: $($spec[1])"}
 $node=$nodes[0];$fields=@(foreach($xpath in $spec[2]){$values=@($node.SelectNodes($xpath));[ordered]@{xpath=$xpath;count=$values.Count;xml=@($values|ForEach-Object OuterXml)}})
 [ordered]@{file=$spec[0];sha256=Hash $file;xpath=$spec[1];nameAttribute=$node.GetAttribute('Name');parentName=$node.GetAttribute('ParentName');fields=$fields;interpretation=$spec[3]}
})
$success=$docs[$specs[0][0]].SelectSingleNode($specs[0][1])
$curve=@($success.SelectNodes('skillNeedFactors/li/valuesPerLevel/li')|ForEach-Object {[double]::Parse($_.InnerText,[Globalization.CultureInfo]::InvariantCulture)})
$expected=@(.75,.80,.85,.875,.90,.925,.95,.975,1,1.01,1.02,1.03,1.04,1.05,1.06,1.07,1.08,1.09,1.10,1.12,1.13)
if($curve.Count -ne $expected.Count){throw 'Success curve length changed'}
for($i=0;$i -lt $expected.Count;$i++){if($curve[$i] -ne $expected[$i]){throw "Success curve changed at level $i"}}
if($success.minValue -cne '0' -or $success.maxValue -cne '1'){throw 'Success stat bounds changed'}
$manipulation=$success.SelectSingleNode('capacityFactors/li[capacity="Manipulation"]')
$sight=$success.SelectSingleNode('capacityFactors/li[capacity="Sight"]')
if($manipulation.weight -cne '0.3' -or $manipulation.SelectNodes('max').Count -ne 0 -or $sight.weight -cne '0.2' -or $sight.max -cne '1'){throw 'Success capacity rules changed'}
if($docs[$specs[3][0]].SelectSingleNode($specs[3][1]).SelectSingleNode('statBases/WorkToBuild').InnerText -cne '0'){throw 'Instant example changed'}
$record=[ordered]@{
 evidence_id='RW17-CONSTRUCTION-FAILURE-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash
 reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile)
 manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile);rules=$records;boundedChecks=$bounded;packagedDefs=$defs
 successCurveLevels0To20=$curve
 limits=@('Static derived C# and packaged XML are not original source or runtime gameplay proof.','Matching retained REA metadata is reused for artifact identity only.','No native game, browser, preview, GUI input or screenshot capture was run.','The ordinary Frame finishing/failure chain is covered, not every specialized building, DLC or mod override.','RNG endpoint and float behavior prevent treating the ideal continuous probability derivation as bit-exact runtime frequency.','Original leavings placement can warn and break; static evidence does not establish a persistent retry container or universal lossless dropping.','Private deterministic RNG, voxel layer/support checks and a pending material-drop state are Web adaptations, not native mechanisms.','This evidence fixes the observed native values; provisional Web balance values and actual implementation/verification belong in the gameplay report.')
 collectorSha256=Hash $PSCommandPath
}
$json=($record|ConvertTo-Json -Depth 18).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static projection differs'};"Checked construction-failure: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) packaged Def projections"}
else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));'Collected construction-failure static mechanisms'}
