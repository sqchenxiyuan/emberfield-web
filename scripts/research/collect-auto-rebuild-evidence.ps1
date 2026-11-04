param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Read-only source/Defs replay. Never launches a game, browser, preview or GUI input.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/auto-rebuild-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/auto-rebuild-manifest.json'
$reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static identity mismatch'}
$sources=@{}
foreach($m in $manifest.types){$file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)}
$rules=@(
 @('RimWorld.PlaySettings','public bool autoRebuild;','The field is initialized to the C# bool default false.'),
 @('RimWorld.PlaySettings','Scribe_Values.Look(ref autoRebuild, "autoRebuild", defaultValue: false)','Saved setting, missing-key default false.'),
 @('RimWorld.PlaySettings','row.ToggleableIcon(ref autoRebuild, TexButton.AutoRebuild','The map control toggles this setting directly.'),
 @('Verse.Game','public PlaySettings playSettings = new PlaySettings();','New Game owns one PlaySettings object; this is not a separate per-building option.'),
 @('Verse.Game','Scribe_Deep.Look(ref playSettings, "playSettings")','PlaySettings is nested in the game save.'),
 @('Verse.ThingUtility','Find.PlaySettings.autoRebuild && mode == DestroyMode.KillFinalize','Building/frame gate: enabled, kill finalization, player faction, blueprint, finished research, anchor Home cell and legal placement.'),
 @('Verse.ThingUtility','GenConstruct.PlaceBlueprintForBuild(buildingDef, thing.Position, map, thing.Rotation, Faction.OfPlayer, thing.Stuff, thing.StyleSourcePrecept, thing.StyleDef)','The new ordinary build blueprint carries definition, anchor, rotation, material and style arguments.'),
 @('Verse.Thing','Destroy(DestroyMode.KillFinalize)','Ordinary Thing.Kill requests kill finalization.'),
 @('Verse.Building','if (spawned && ThingUtility.CheckAutoRebuildOnDestroyed(this, mode, map, def)','Building.Destroy captures spawned/map before base destruction and invokes the rebuild helper afterward.'),
 @('Verse.Building','blueprint_Storage.SetStorageGroup(building_Storage.storageGroup)','Storage buildings pass their existing group to the new storage blueprint.'),
 @('Verse.Building','blueprint_Storage.settings.CopyFrom(building_Storage.settings)','Storage buildings copy their individual storage settings after blueprint creation.'),
 @('Verse.Thing','DeSpawn(mode)','Destruction removes the old thing before the Building rebuild check.'),
 @('Verse.Thing','RemoveAllReservationsAndDesignationsOnThis()','The destroyed thing loses reservations and designations.'),
 @('Verse.ThingWithComps','comps[i].PostDestroy(mode, mapHeld)','Component destruction hooks run as part of base destruction; specialized components are a scope boundary.'),
 @('RimWorld.JobDriver_Deconstruct','Target.Destroy(DestroyMode.Deconstruct)','Player deconstruction is not KillFinalize, so the ordinary auto-rebuild gate rejects it.'),
 @('RimWorld.JobDriver_Uninstall','Building.Uninstall()','Uninstall takes the minification path rather than killing the building.'),
 @('RimWorld.MinifyUtility','thing.DeSpawnOrDeselect(destroyMode)','Minification despawns the original thing; default mode is Vanish.'),
 @('RimWorld.MinifyUtility','minifiedThing.InnerThing = thing','Uninstall carries the original object inside a wrapper; it is not a fresh replacement building.'),
 @('Verse.BuildableDef','public bool BuildableByPlayer => designationCategory != null','Ordinary generated build-blueprint eligibility follows a non-null designation category.'),
 @('RimWorld.ThingDefGenerator_Buildings','if (def.BuildableByPlayer)','The generator creates ordinary blueprint/frame definitions for player-buildable ThingDefs.'),
 @('RimWorld.ThingDefGenerator_Buildings','if (def.Minifiable)','Install blueprint eligibility is separate from ordinary build blueprint eligibility.'),
 @('RimWorld.ThingDefGenerator_Buildings','def.blueprintDef = thingDef','Ordinary generated blueprint definition is assigned to the source definition.'),
 @('RimWorld.ThingDefGenerator_Buildings','thingDef.thingClass = def.building.blueprintClass','Building Def selects the specialized build blueprint class, including storage blueprints.'),
 @('Verse.BuildableDef','if (!researchPrerequisites[i].IsFinished)','All listed research prerequisites must be completed for IsResearchFinished.'),
 @('RimWorld.GenConstruct','if (item.InNoBuildEdgeArea(map) && !godMode && !ignoreEdgeArea)','Auto-rebuild uses ordinary placement checks, including bounds and map-edge rules.'),
 @('RimWorld.GenConstruct','if (center.Fogged(map))','Placement rejects undiscovered anchor cells.'),
 @('RimWorld.GenConstruct','return new AcceptanceReport("IdenticalBlueprintExists".Translate())','Existing identical blueprints prevent duplicate placement.'),
 @('RimWorld.GenConstruct','if (!CanBuildOnTerrain(entDef, center, map, rot, thingToIgnore, stuffDef))','Placement requires terrain support and material-aware affordances.'),
 @('RimWorld.GenConstruct','AcceptanceReport result2 = NotBlockingAnyInteractionCells','Placement checks interaction-cell access.'),
 @('RimWorld.GenConstruct','AcceptanceReport result3 = entDef.PlaceWorkers[l].AllowsPlacing','Definition-specific PlaceWorkers retain their placement vetoes.'),
 @('RimWorld.GenConstruct','Blueprint_Build blueprint_Build = (Blueprint_Build)ThingMaker.MakeThing(sourceDef.blueprintDef)','Rebuild creates a fresh ordinary blueprint, not an installed copy of the lost object.'),
 @('RimWorld.Blueprint_Build','return def.entityDefToBuild.CostListAdjusted(stuffToUse)','Replacement uses the normal material bill for the definition and selected stuff.'),
 @('RimWorld.Blueprint_Build','Frame frame = (Frame)ThingMaker.MakeThing(def.entityDefToBuild.frameDef, stuffToUse)','Blueprint completion creates a fresh construction frame.'),
 @('RimWorld.Blueprint_Storage','frame.storageSettings.CopyFrom(GetStoreSettings())','Storage-blueprint transition copies effective settings to the frame.'),
 @('RimWorld.Blueprint_Storage','this.SetStorageGroup(null, removeIfEmpty: false)','Storage-blueprint transition transfers group membership without deleting an empty group during the handoff.'),
 @('RimWorld.StorageSettings','Priority = other.Priority','Storage settings preserve priority.'),
 @('RimWorld.StorageSettings','filter.CopyAllowancesFrom(other.filter)','Storage settings preserve the filter allowances.'),
 @('RimWorld.Frame','storageGroupMember.ThingStoreSettings.CopyFrom(storageSettings)','The completed storage building receives frame settings and group membership.'),
 @('RimWorld.Frame','thing = ThingMaker.MakeThing(thingDef2, Stuff)','Finishing creates a new building instance from its definition and material.'),
 @('RimWorld.Frame','QualityCategory q = QualityUtility.GenerateQualityCreatedByPawn(worker, SkillDefOf.Construction)','Replacement quality is generated from the current builder, not copied from the destroyed object.'),
 @('RimWorld.Building_WorkTable','billStack = new BillStack(this)','A fresh ordinary worktable owns a fresh BillStack.'),
 @('RimWorld.Building_Bed','RemoveAllOwners(mode == DestroyMode.KillFinalize)','Killed beds explicitly remove their owners while despawning.'),
 @('RimWorld.Building_Bed','pawn.ownership.UnclaimBed()','Owner removal clears the pawn bed claim.'),
 @('RimWorld.Building_Bed','Medical = false','Despawning non-replacement beds resets medical status; completed replacements use new-object defaults and spawn rules.'),
 @('RimWorld.Frame','ThingUtility.CheckAutoRebuildOnDestroyed(this, mode, map, def.entityDefToBuild)','Killed spawned construction frames also use the helper with the intended final definition.'),
 @('RimWorld.Blueprint','public abstract class Blueprint : ThingWithComps','An empty blueprint is not a Building or Frame and does not inherit their rebuild hooks.'),
 @('RimWorld.Frame','Destroy(DestroyMode.FailConstruction)','Construction failure uses a separate failure branch.'),
 @('RimWorld.Frame','blueprint_Build = (Blueprint_Build)ThingMaker.MakeThing(def.entityDefToBuild.blueprintDef)','FailConstruction recreates a blueprint independently of the auto-rebuild helper.'),
 @('Verse.TerrainDef','public bool autoRebuildable;','Terrain auto-rebuild requires a separate opt-in field whose default is false.'),
 @('Verse.ThingUtility','Find.PlaySettings.autoRebuild && terrainDef.autoRebuildable','Terrain requires enabled setting, terrain opt-in, blueprint, research, Home cell and legal placement; terrain has no faction field.'),
 @('Verse.TerrainGrid','if (terrainDef != null && terrainDef.Flammable())','Terrain burning prioritizes a flammable foundation before top terrain.'),
 @('Verse.TerrainGrid','SetTerrain(c, terrain.burnedDef)','Ordinary burned terrain may be replaced by its configured burned variant.'),
 @('Verse.TerrainGrid','ThingUtility.CheckAutoRebuildTerrainOnDestroyed(terrainDef, c, map)','Terrain and foundation destruction each invoke the terrain rebuild helper after removal.'),
 @('Verse.TerrainGrid','c.GetFirstBuilding(map)?.Kill()','A destroyed foundation/terrain with destroyBuildingsOnDestroyed can kill the overlying building before its own rebuild attempt.'),
 @('RimWorld.ThingDefGenerator_Buildings','thingDef.SetStatBaseValue(StatDefOf.MaxHitPoints, (float)def.BaseMaxHitPoints * 0.25f)','An ordinary building frame starts from one quarter of the target building base maximum hit points.'),
 @('RimWorld.ThingDefGenerator_Buildings','thingDef.SetStatBaseValue(StatDefOf.Flammability, def.BaseFlammability)','Ordinary building frames inherit target base flammability; they do not all share one fixed value.'),
 @('RimWorld.ThingDefGenerator_Buildings','thingDef.size = def.size','Ordinary building-frame and blueprint generated dimensions come from the target building.'),
 @('RimWorld.ThingDefGenerator_Buildings','thingDef.stuffCategories = def.stuffCategories','Ordinary player-buildable building frames preserve material-category support.'),
 @('RimWorld.StatWorker','num *= req.StuffDef.stuffProps.statFactors.GetStatFactorFromList(stat)','Normal computed stats still apply material factors.'),
 @('RimWorld.StatWorker','num += req.StuffDef.stuffProps.statOffsets.GetStatOffsetFromList(stat)','Normal computed stats still apply material offsets.'),
 @('RimWorld.ThingDefGenerator_Buildings','useHitPoints = false','Base blueprints do not use hit points; terrain-frame generation also explicitly disables hit points.'),
 @('RimWorld.ThingDefGenerator_Buildings','thingDef.category = ThingCategory.Ethereal','Terrain frames are generated as Ethereal rather than ordinary damageable building frames.'),
 @('RimWorld.Fire','List<Thing> list = Map.thingGrid.ThingsListAt(Position)','Ground fire enumerates things occupying the fire cell.'),
 @('RimWorld.Fire','float statValue = thing.GetStatValue(StatDefOf.Flammability)','Ground fire selects flammable occupants by their computed stat.'),
 @('Verse.ThingGrid','CellRect cellRect = t.OccupiedRect()','Multi-cell things are registered over their rotated occupied rectangle, not just their anchor.')
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
 BoundedAbsence 'Verse.ThingUtility' 'public static Blueprint_Build CheckAutoRebuildOnDestroyed' 'public static void CheckAutoRebuildTerrainOnDestroyed' @('BillStack','billStack','OwnersForReading','CompQuality','glowerColorOverride','HitPoints','allowRebuild') 'The ordinary rebuild helper transfers only its explicit blueprint arguments; it does not clone bills, owners, quality, lamp overrides or hit points.'
 BoundedAbsence 'Verse.Building' 'public override void Destroy' 'public override void SetFaction' @('billStack','OwnersForReading','CompQuality','glowerColorOverride','.label =') 'The generic Building destroy hook adds only the explicit storage group/settings transfer; no individual storage label copy.'
 BoundedAbsence 'RimWorld.GenConstruct' 'public static Blueprint_Build PlaceBlueprintForBuild' 'public static Blueprint_Install PlaceBlueprintForInstall' @('resourceCounter','CanGetResources','BillStack','OwnersForReading','CompQuality') 'Blueprint creation does not require currently available resources and does not restore old specialized state.'
 BoundedAbsence 'RimWorld.Blueprint' 'public abstract class Blueprint' '' @('CheckAutoRebuild') 'The ordinary empty Blueprint base does not invoke auto-rebuild.'
 BoundedAbsence 'RimWorld.Blueprint_Build' 'public class Blueprint_Build' '' @('CheckAutoRebuild') 'The ordinary Blueprint_Build does not invoke auto-rebuild.'
 BoundedAbsence 'RimWorld.Building_WorkTable' 'public class Building_WorkTable' '' @('override void Destroy','CheckAutoRebuild','CopyFrom') 'The reviewed generic worktable does not override destruction to restore bills on a replacement.'
 BoundedAbsence 'RimWorld.Frame' 'public void FailConstruction' 'protected override void DrawAt' @('autoRebuild','CheckAutoRebuild','areaManager.Home','IsResearchFinished') 'The separate construction-failure blueprint branch does not use auto-rebuild settings or Home/research gates.'
 BoundedAbsence 'Verse.TerrainGrid' 'public void RemoveTopLayer' 'public void SetFoundation' @('CheckAutoRebuild') 'Direct layer removal is distinct from the destruction notification path.'
 BoundedAbsence 'Verse.TerrainGrid' 'public void RemoveFoundation' 'public void SetTempTerrain' @('CheckAutoRebuild') 'Direct foundation removal itself does not invoke auto-rebuild.'
 BoundedAbsence 'RimWorld.MinifyUtility' 'public static MinifiedThing MakeMinified' 'public static Thing TryMakeMinified' @('.Kill(','CheckAutoRebuild') 'Minification does not kill and recreate the original object.'
 BoundedAbsence 'RimWorld.ThingDefGenerator_Buildings' 'private static ThingDef BaseBlueprintDef' 'private static ThingDef BaseFrameDef' @('Flammability','stuffCategories') 'Base blueprints have no flammability or material stat override; the packaged Flammability stat default is zero.'
 BoundedAbsence 'RimWorld.ThingDefGenerator_Buildings' 'private static ThingDef NewBlueprintDef_Thing' 'private static ThingDef NewFrameDef_Thing' @('StatDefOf.Flammability','stuffCategories') 'Ordinary building-blueprint generation does not copy the target flammability or material categories.'
 BoundedAbsence 'RimWorld.ThingDefGenerator_Buildings' 'private static ThingDef NewFrameDef_Terrain' '' @('StatDefOf.Flammability','stuffCategories') 'Terrain-frame generation does not copy the final terrain flammability or building material categories.'
)
$specs=@(
 @('Data/Core/Defs/TerrainDefs/Terrain_Foundation.xml','/Defs/TerrainDef[@Name="BridgeBase"]',@('autoRebuildable','isFoundation','bridge','designationCategory','destroyBuildingsOnDestroyed'),'Core bridge base explicitly opts in to terrain auto-rebuild.'),
 @('Data/Core/Defs/TerrainDefs/Terrain_Foundation.xml','/Defs/TerrainDef[defName="Bridge"]',@('defName','autoRebuildable','statBases/Flammability'),'Bridge inherits BridgeBase; no local autoRebuildable override.'),
 @('Data/Core/Defs/TerrainDefs/Terrain_Floors.xml','/Defs/TerrainDef[@Name="FloorBase"]',@('autoRebuildable','designationCategory'),'FloorBase has a build category but does not enable autoRebuildable.'),
 @('Data/Core/Defs/TerrainDefs/Terrain_Floors.xml','/Defs/TerrainDef[defName="WoodPlankFloor"]',@('defName','autoRebuildable','burnedDef'),'WoodPlankFloor inherits FloorBase, with no terrain rebuild opt-in; burning has a separate burned variant.'),
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Structure.xml','/Defs/ThingDef[defName="Wall"]',@('defName','designationCategory','thingClass','leaveResourcesWhenKilled'),'Wall has a normal build category; material salvage is a separate Def rule.'),
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml','/Defs/ThingDef[@Name="FurnitureBase"]',@('designationCategory','minifiedDef'),'Furniture build and minification support are separate properties.'),
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml','/Defs/ThingDef[@Name="ShelfBase"]',@('building/blueprintClass','researchPrerequisites'),'ShelfBase chooses Blueprint_Storage and requires ComplexFurniture.'),
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml','/Defs/ThingDef[@Name="StorageShelfBase"]',@('thingClass','building/storageGroupTag'),'StorageShelfBase uses Building_Storage and a Shelf group tag.'),
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml','/Defs/ThingDef[defName="Shelf"]',@('defName','size'),'Shelf inherits the storage-specific chain; these are packaged declarations, not a live resolved Def database.'),
 @('Data/Core/Languages/English/Keyed/Misc_Gameplay.xml','/LanguageData/AutoRebuildButton',@('.'),'The shipped English tooltip describes destroyed structures inside the home area.'),
 @('Data/Core/Defs/Stats/Stats_Basics_General.xml','/Defs/StatDef[defName="Flammability"]',@('defName','defaultBaseValue','minValue','maxValue'),'The packaged Flammability stat defaults to zero when a generated blueprint/terrain-frame Def does not override it.')
)
$docs=@{}
$defs=@(foreach($spec in $specs){
 $file=Join-Path $GameRoot $spec[0]
 if(!$docs.ContainsKey($spec[0])){$doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null;$doc.Load($file);$docs[$spec[0]]=$doc}
 $nodes=@($docs[$spec[0]].SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected Def node count: $($spec[1])"}
 $node=$nodes[0];$fields=@(foreach($xpath in $spec[2]){$values=@($node.SelectNodes($xpath));[ordered]@{xpath=$xpath;count=$values.Count;xml=@($values|ForEach-Object OuterXml)}})
 [ordered]@{file=$spec[0];sha256=Hash $file;xpath=$spec[1];nameAttribute=$node.GetAttribute('Name');parentName=$node.GetAttribute('ParentName');fields=$fields;interpretation=$spec[3]}
})
function RequireDefValue([int]$index,[string]$field,[string]$expected){$node=$docs[$specs[$index][0]].SelectSingleNode($specs[$index][1]);$n=$node.SelectSingleNode($field);$actual=if($null -eq $n){$null}else{$n.InnerText};if($actual -cne $expected){throw "Changed Def fact $index $field"}}
RequireDefValue 0 'autoRebuildable' 'true'
RequireDefValue 0 'isFoundation' 'true'
RequireDefValue 10 'defaultBaseValue' '0'
foreach($index in @(1,2,3)){if($docs[$specs[$index][0]].SelectSingleNode($specs[$index][1]).SelectNodes('autoRebuildable').Count -ne 0){throw 'Unexpected terrain auto-rebuild override'}}
if($defs[1].parentName -ne 'BridgeBase' -or $defs[3].parentName -ne 'FloorBase'){throw 'Terrain inheritance changed'}
$record=[ordered]@{
 evidence_id='RW17-AUTO-REBUILD-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash
 reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile)
 manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile);rules=$records;boundedChecks=$bounded;packagedDefs=$defs
 limits=@('Static derived C# and packaged XML are not original source or runtime gameplay proof.','Retained matching REA metadata is reused for artifact identity only.','No native game, browser, preview, GUI input or screenshot capture was run in this milestone.','Generic Building, Frame, storage, worktable and bed chains are reviewed; every specialized building subclass, component hook, DLC/mod patch and historical save compatibility branch are not exhaustively audited.','Def inheritance assertions concern the listed packaged declarations only, not a live loaded Def database.','Three-dimensional wall identity, z-layer Home and support rules are Web adaptation concerns; the native map is not a multilayer voxel world.','Construction failure is a separate blueprint-retry mechanism, not evidence that auto-rebuild is enabled.','Ordinary empty blueprints have no reviewed auto-rebuild hook; specialized blueprint classes and mods can differ.')
 collectorSha256=Hash $PSCommandPath
}
$json=($record|ConvertTo-Json -Depth 18).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static projection differs'};"Checked auto-rebuild: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) packaged Def projections"}
else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));'Collected auto-rebuild static mechanisms'}
