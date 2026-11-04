param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Reads PE identity, existing static reconstructions and Core XML. Never loads game code.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$base=Join-Path $root 'docs/research/rimworld/evidence'
$dllHash='eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'
$engineHash='587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'
function Digest([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextDigest([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
if((Digest (Join-Path $GameRoot 'Assembly-CSharp.dll')) -ne $dllHash){throw 'Game assembly changed'}
$engine=(Resolve-Path (Join-Path $root '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll')).Path
if((Digest $engine) -ne $engineHash){throw 'Decompiler changed'}
$groups=[Collections.Generic.HashSet[string]]::new()
function Source([string]$group,[string]$type,[int]$start,[int]$end){
 $m=Get-Content (Join-Path $base "$group-manifest.json") -Raw|ConvertFrom-Json
 if($m.source_sha256 -ne $dllHash -or $m.engine_sha256 -ne $engineHash){throw "Mismatched provenance: $group"}
 $entries=@($m.types|Where-Object type -eq $type);if($entries.Count -ne 1){throw "Unknown type: $group/$type"};$t=$entries[0]
 $file=Join-Path $root $t.local_file
 if((Digest $file) -ne $t.sha256){throw "Changed source: $file"}
 $lines=[IO.File]::ReadAllText($file).Split("`n")
 if($lines.Length -ne $t.lines -or $start -lt 1 -or $end -lt $start -or $end -gt $t.lines){throw "Invalid source range: $group/$type"}
 [void]$groups.Add($group)
 [ordered]@{group=$group;type=$type;file=$t.local_file;sha256=$t.sha256;lines=@($start,$end);excerpt_sha256=(TextDigest ($lines[($start-1)..($end-1)] -join "`n"))}
}
function Xml([string]$id,[string]$relative,[string]$xpath){
 $file=Join-Path $GameRoot $relative;[xml]$doc=[IO.File]::ReadAllText($file)
 $nodes=@($doc.SelectNodes($xpath));if(!$nodes.Count){throw "Empty XML selection $id"}
 $projected=@(foreach($node in $nodes){
  $copy=$node.CloneNode($true)
  # Preserve the complete selected gameplay parent chain, omit art/audio and descriptive prose.
  foreach($remove in @($copy.SelectNodes('.//comment() | ./label | ./description | ./graphicData | ./uiIconPath | ./soundImpactDefault | ./repairEffect | ./filthLeaving | ./castEdgeShadows | ./staticSunShadowHeight | ./uiIconScale'))){[void]$remove.ParentNode.RemoveChild($remove)}
  $copy.OuterXml
 })
 [ordered]@{id=$id;file=$relative;source_sha256=(Digest $file);xpath=$xpath;projection='Selected complete gameplay inheritance nodes; descriptions, art and sound omitted; MayRequire is retained, not evaluated';nodes=$projected;nodes_sha256=(TextDigest ($projected -join "`n"))}
}
$xml=@(
 (Xml 'SX01' 'Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml' '/Defs/ThingDef[@Name="FurnitureBase" or @Name="ShelfBase" or @Name="StorageShelfBase" or defName="Shelf" or defName="ShelfSmall"]'),
 (Xml 'SX02' 'Data/Core/Defs/ThingDefs_Buildings/Buildings_Base.xml' '/Defs/ThingDef[@Name="BuildingBase"]'),
 (Xml 'SX03' 'Data/Core/Defs/ThingCategoryDefs/ThingCategories.xml' '/Defs/ThingCategoryDef[defName="Buildings" or defName="BuildingsFurniture" or defName="Corpses" or defName="Chunks" or defName="Plants"]'),
 (Xml 'SX04' 'Data/Core/Defs/Misc/SpecialThingFilterDefs/SpecialThingFilters.xml' '/Defs/SpecialThingFilterDef[defName="AllowLargeCorpses"]'),
 (Xml 'SX05' 'Data/Core/Defs/ThingDefs_Items/Items_Unfinished.xml' '/Defs/ThingDef[defName="MinifiedThing"]'),
 (Xml 'SX06' 'Data/Core/Defs/Stats/Stats_Basics_General.xml' '/Defs/StatDef[defName="DeteriorationRate"]')
)
$all=@{};foreach($entry in $xml){foreach($nodeText in $entry.nodes){[xml]$d=$nodeText;$node=$d.DocumentElement;if($node.LocalName -eq 'ThingDef'){$key=if($node.defName){[string]$node.defName}else{$node.GetAttribute('Name')};$all[$key]=$node}}}
$shelves=@(foreach($name in @('Shelf','ShelfSmall')){
 $chain=@();$current=$name
 while($current){if(!$all.ContainsKey($current)){throw "Missing parent $current"};$chain+=$current;$current=$all[$current].GetAttribute('ParentName')}
 $fields=[ordered]@{}
 foreach($path in @('thingClass','category','size','passability','pathCost','surfaceType','canOverlapZones','minifiedDef','costStuffCount','statBases/MaxHitPoints','statBases/WorkToBuild','building/maxItemsInCell','building/preventDeteriorationOnTop','building/ignoreStoredThingsBeauty','building/defaultStorageSettings/priority','researchPrerequisites/li','thingCategories/li')){
  foreach($owner in $chain){$n=$all[$owner].SelectSingleNode($path);if($n){$fields[$path]=[ordered]@{value=$n.InnerText;origin=$owner};break}}
 }
 $quality=@(foreach($owner in $chain){$all[$owner].SelectNodes('./comps/li[@Class="CompProperties_Quality"]')}).Count -gt 0
 [ordered]@{def=$name;chain=$chain;fields=$fields;quality_component_in_selected_chain=$quality}
})
$claims=@(
 [ordered]@{id='SH01';finding='Shelf and ShelfSmall inherit StorageShelfBase -> ShelfBase -> FurnitureBase -> BuildingBase. Size2x1/1x1; each cell3 stacks, total6/3. PathCost50, PassThroughOnly, Item surface, no zone overlap. Minifiable; ComplexFurniture. This chain has no CompProperties_Quality. Cost20/10, Work500/250, HP100/50 are base Def values, not evaluated stuff-adjusted stats.';xml=@('SX01','SX02');sources=@((Source 'logistics' 'RimWorld.Building_Storage' 82 100),(Source 'energy' 'Verse.ThingDef' 19 29))},
 [ordered]@{id='SH02';finding='PassThroughOnly is traversable but not GenGrid.Standable/StandableBy. PathGrid rejects Impassable and takes the largest relevant object pathCost;50 is not an entire travel-time formula. Ordinary haul pickup and delivery use ClosestTouch, so walking into the shelf is unnecessary.';xml=@('SX01');sources=@((Source 'shelf-storage' 'Verse.GenGrid' 144 175),(Source 'shelf-storage' 'Verse.AI.PathGrid' 120 156),(Source 'work' 'Verse.AI.JobDriver_HaulToCell' 112 141),(Source 'work' 'Verse.AI.Toils_Haul' 254 262))},
 [ordered]@{id='SH03';finding='Shelf inventory is spawned map-grid items gathered by SlotGroup.HeldThings, not a nested ThingOwner container. Capacity counts Item objects, not units; an ordinary cell allows1, shelf occupied cells3. Same-def free units plus unused stack slots determine GetItemStackSpaceLeftFor.';xml=@('SX01');sources=@((Source 'shelf-storage' 'RimWorld.SlotGroup' 18 58),(Source 'logistics' 'Verse.GridsUtility' 267 318),(Source 'energy' 'Verse.Building' 62 62))},
 [ordered]@{id='SH04';finding='Mutable storage filter AND fixed parent filter must both accept. Fixed Root excludes Chunks, Plants, Buildings and non-ever-storable defs; Biotech Wastepack is conditionally excluded. ThingFilter checks the inner minified building, so BuildingsFurniture -> Buildings excludes packed furniture too. EverStorable alone does not override fixed restrictions.';xml=@('SX01','SX03','SX05');sources=@((Source 'logistics' 'RimWorld.Building_Storage' 102 121),(Source 'preservation' 'RimWorld.StorageSettings' 97 129),(Source 'preservation' 'Verse.ThingFilter' 396 405),(Source 'preservation' 'Verse.ThingFilter' 483 491),(Source 'preservation' 'Verse.ThingFilter' 874 911),(Source 'energy' 'Verse.ThingDef' 1394 1411))},
 [ordered]@{id='SH05';finding='Large corpse instance matching is InnerPawn.BodySize>=0.75. CanEverMatch/AlwaysMatches use life-stage bodySizeFactor prefilters; those are not substitutes for the actual corpse check. Default shelf categories omit Corpses, but small corpses can be enabled subject to other filters. Weapons and apparel are in the default categories.';xml=@('SX01','SX04');sources=@((Source 'shelf-storage' 'RimWorld.SpecialThingFilterWorker_CorpsesLarge' 5 50),(Source 'preservation' 'Verse.ThingFilter' 874 905))},
 [ordered]@{id='SH06';finding='Default shelf priority is Preferred. Native enums are Unstored,Low,Normal,Preferred,Important,Critical. Automatic better-storage search requires strictly greater priority and stops descending below a found tier; equal-priority shelves do not automatically pull goods merely for being closer. Linked storage reads group settings.';xml=@('SX01');sources=@((Source 'shelf-storage' 'RimWorld.StoragePriority' 3 11),(Source 'preservation' 'RimWorld.StoreUtility' 173 205),(Source 'logistics' 'RimWorld.Building_Storage' 102 109))},
 [ordered]@{id='SH07';finding='A full3-stack shelf cell can still receive compatible partial-stack units. NoStorageBlockersIn permits an unfinished compatible stack even at stack-count capacity, but checks blockers; the capacity helper by ThingDef is only an estimate, not full CanStackWith. With stackLimit75 as an arithmetic example,70 units plus two incompatible stacks permit5 compatible units and no new stack.';xml=@('SX01');sources=@((Source 'preservation' 'RimWorld.StoreUtility' 117 141),(Source 'logistics' 'Verse.GridsUtility' 300 318))},
 [ordered]@{id='SH08';finding='Haul count may aggregate free units across the slot/storage group and is constrained by carrying capacity. Delivery can partially place and route the remaining carried batch to another store cell. This does not make shelf capacity a carrying-capacity bonus.';xml=@();sources=@((Source 'work' 'Verse.AI.HaulAIUtility' 141 179),(Source 'work' 'Verse.AI.Toils_Haul' 34 78),(Source 'work' 'Verse.AI.Toils_Haul' 320 366))},
 [ordered]@{id='SH09';finding='The same-cell edifice preventDeteriorationOnTop flag combines with DeteriorationRate StatPart_EnvironmentalEffects protectedByEdificeFactor0. Shelf protection does not depend on being indoors or roofed. It concerns environmental deterioration, not every damage source.';xml=@('SX01','SX06');sources=@((Source 'weather' 'RimWorld.SteadyEnvironmentEffects' 197 205),(Source 'weapons' 'RimWorld.StatPart_EnvironmentalEffects' 15 44))},
 [ordered]@{id='SH10';finding='CompRottable advances RotProgress from actual parent.AmbientTemperature and elapsed ticks. The shelf protection flag is absent from this rot path; warm shelf food still spoils and a cold room still matters.';xml=@();sources=@((Source 'preservation' 'RimWorld.CompRottable' 94 119))},
 [ordered]@{id='SH11';finding='Ordinary uninstall designation/work does not require the shelf to be empty. FinishedRemoving calls Uninstall -> MakeMinified -> DeSpawn. Building.DeSpawn checks occupied cells after capacity reduction and attempts Near placement of excess item stacks. Only the same original building becomes InnerThing; contents are not carried in the wrapper.';xml=@('SX01','SX02');sources=@((Source 'furniture-reinstall' 'RimWorld.Designator_Uninstall' 79 114),(Source 'skills' 'RimWorld.JobDriver_RemoveBuilding' 35 78),(Source 'furniture-reinstall' 'RimWorld.JobDriver_Uninstall' 7 19),(Source 'furniture-reinstall' 'RimWorld.MinifyUtility' 8 31),(Source 'furniture-reinstall' 'RimWorld.MinifyUtility' 49 67),(Source 'energy' 'Verse.Building' 274 299),(Source 'logistics' 'RimWorld.Building_Storage' 165 169))},
 [ordered]@{id='SH12';finding='Near placement searches progressively and can fail. Building.DeSpawn and MinifyUtility.Uninstall do not check their TryPlaceThing return values or stage an all-or-nothing rollback. Therefore static evidence does not prove guaranteed safe placement on completely blocked/full maps; Web atomic waiting would be an explicit adaptation.';xml=@();sources=@((Source 'logistics' 'Verse.GenPlace' 33 89),(Source 'logistics' 'Verse.GenPlace' 129 188),(Source 'energy' 'Verse.Building' 274 299),(Source 'furniture-reinstall' 'RimWorld.MinifyUtility' 49 67))},
 [ordered]@{id='SH13';finding='Reinstall extracts the original InnerThing, clears the wrapper then spawns the same building at the new position/rotation. Storage settings live on Building_Storage and are saved with it. Existing loose shelf goods do not follow. Storage-group references are retained on ordinary despawn; cross-map SpawnSetup detaches and copies group settings.';xml=@('SX01');sources=@((Source 'furniture-reinstall' 'RimWorld.Blueprint_Install' 99 117),(Source 'furniture-reinstall-extra' 'RimWorld.Blueprint' 45 82),(Source 'logistics' 'RimWorld.Building_Storage' 142 169),(Source 'logistics' 'RimWorld.Building_Storage' 182 190))},
 [ordered]@{id='SH14';finding='New storage blueprints already have configurable storage settings, defaulted from the future building; conversion to a construction frame copies those settings and its storage group. These are new-build settings, separate from reinstalling an existing configured shelf.';xml=@('SX01');sources=@((Source 'shelf-storage' 'RimWorld.Blueprint_Storage' 42 68),(Source 'shelf-storage' 'RimWorld.Blueprint_Storage' 92 99))}
)
$reaFile=Join-Path $base 'shelf-storage-rea-managed.json';$rea=Get-Content $reaFile -Raw|ConvertFrom-Json
if($rea.subject.digest.sha256 -ne $dllHash -or $rea.normalized_result.summary.module.mvid -ne '8e962ecc-7ac7-42d2-8f3b-1b16cd24d2cd'){throw 'REA identity mismatch'}
$e=[ordered]@{evidence_id='RW17-SHELF-STORAGE';version_text=(Get-Content (Join-Path $GameRoot 'Version.txt') -Raw).Trim();source_sha256=$dllHash;engine_sha256=$engineHash;kind='Static derived reconstruction and original Core XML; target not executed';rea=[ordered]@{file='shelf-storage-rea-managed.json';sha256=(Digest $reaFile);evidence_id=$rea.evidence_id;parent_evidence_id=$rea.normalized_result.parent_evidence_id;mvid=$rea.normalized_result.summary.module.mvid};manifests=@($groups|Sort-Object);shelves=$shelves;xml=$xml;claims=$claims;limitations=@('Derived C# is not original source; unresolved dependencies were tolerated by ILSpy.','Core XML nodes are not an effective patched Def database; MayRequire remains conditional.','No game execution, runtime shelf experiment or capacity/decay calibration performed by this collector.','Completely blocked Near placement, exact placement order and loaded-save recovery are not runtime-verified.','PathCost and base material/work/HP are not full evaluated stat or travel-time formulas.')}
$text=($e|ConvertTo-Json -Depth 30).Replace("`r`n","`n")+"`n"
$output=Join-Path $base 'shelf-storage-evidence.json'
if($Check){if([IO.File]::ReadAllText($output) -cne $text){throw 'Retained shelf evidence differs from the current local static sources'};"Shelf source/XML replay verified: $($claims.Count) claims"}
else{[IO.File]::WriteAllText($output,$text,[Text.UTF8Encoding]::new($false));"Collected $($claims.Count) shelf claims and $($xml.Count) XML selections"}
