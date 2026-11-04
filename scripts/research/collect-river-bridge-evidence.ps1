param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Read-only bounded replay of existing matched derived sources and Core XML.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$base=Join-Path $root 'docs/research/rimworld/evidence'
$dllHash='eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'
$engineHash='587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'
function Digest([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextDigest([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
function LF([string]$s){$s.Replace(([string][char]13+[char]10),[string][char]10)}
if((Digest (Join-Path $GameRoot 'Assembly-CSharp.dll')) -ne $dllHash){throw 'Game assembly changed'}
if((Digest (Join-Path $root '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll')) -ne $engineHash){throw 'Decompiler changed'}
$groups=[Collections.Generic.HashSet[string]]::new()
function Source([string]$group,[string]$type,[int]$start,[int]$end){
 $m=Get-Content (Join-Path $base "$group-manifest.json") -Raw|ConvertFrom-Json
 if($m.source_sha256 -ne $dllHash -or $m.engine_sha256 -ne $engineHash){throw "Mismatched provenance: $group"}
 $entries=@($m.types|Where-Object type -eq $type)
 if($entries.Count -ne 1){throw "Unknown type: $group/$type"}
 $t=$entries[0];$file=Join-Path $root $t.local_file
 if((Digest $file) -ne $t.sha256){throw "Changed source: $file"}
 $lines=[IO.File]::ReadAllText($file).Split([char]10)
 if($lines.Length -ne $t.lines -or $start -lt 1 -or $end -lt $start -or $end -gt $t.lines){throw "Invalid source range: $group/$type"}
 [void]$groups.Add($group)
 [ordered]@{group=$group;type=$type;file=$t.local_file;sha256=$t.sha256;lines=@($start,$end);excerpt_sha256=(TextDigest ($lines[($start-1)..($end-1)] -join [char]10))}
}
$xmlPaths=@('Data/Core/Defs/TerrainDefs/Terrain_Water.xml','Data/Core/Defs/TerrainDefs/Terrain_Foundation.xml','Data/Odyssey/Defs/TerrainDefs/Terrain_Foundation.xml','Data/Core/Defs/Misc/TerrainAffordanceDefs/TerrainAffordances.xml','Data/Core/Defs/ThingDefs_Items/Items_Resource_Stuff.xml')
$xmlRecords=@(foreach($relative in $xmlPaths){$f=Join-Path $GameRoot $relative;[xml]$d=[IO.File]::ReadAllText($f);[ordered]@{file=$relative;sha256=Digest $f;nodes=@(foreach($n in $d.SelectNodes('/Defs/*')){[ordered]@{defName=[string]$n.defName;name=$n.GetAttribute('Name');parent=$n.GetAttribute('ParentName');node_sha256=TextDigest $n.OuterXml}})}})
$buildingFiles=@(Get-ChildItem (Join-Path $GameRoot 'Data/Core/Defs/ThingDefs_Buildings') -Filter '*.xml' | Sort-Object Name)
$named=@{};$defs=@{};$files=@{}
foreach($file in $buildingFiles){[xml]$d=[IO.File]::ReadAllText($file.FullName);foreach($n in $d.SelectNodes('/Defs/ThingDef')){if($n.GetAttribute('Name')){$named[$n.GetAttribute('Name')]=$n};if($n.defName){$defs[[string]$n.defName]=$n};$files[$n]=$file}}
function Inherited($n,[string]$field){for($i=0;$i -lt 20 -and $n;$i++){$v=$n.SelectSingleNode($field);if($v){return $v.InnerText};$parent=$n.GetAttribute('ParentName');$n=if($parent){$named[$parent]}else{$null}};return $null}
$buildingNames=@('Bed','DiningChair','Table1x2c','Shelf','ShelfSmall','HorseshoesPin','Heater','Sandbags','HandTailoringBench','SimpleResearchBench','WoodFiredGenerator','SolarGenerator','Battery','Cooler','ElectricSmithy','FueledSmithy','TableMachining','FueledStove','ElectricStove','TableStonecutter','Wall','Door','Fence','FenceGate')
$buildingSupport=@(foreach($name in $buildingNames){$n=$defs[$name];if(!$n){throw "Missing building $name"};[ordered]@{defName=$name;terrainAffordanceNeeded=Inherited $n 'terrainAffordanceNeeded';useStuffTerrainAffordance=((Inherited $n 'useStuffTerrainAffordance') -eq 'true');node_sha256=TextDigest $n.OuterXml}})
$claims=@(
 [ordered]@{id='RIV01';finding='World rivers derive a drainage graph from coast/elevation costs, accumulate rainfall flow, apply evaporation and tier/branch rules. Local River mutator bends/widens graphs with noise and replaces terrain; this is not proof of a general volumetric fluid solver.';sources=@((Source 'generation' 'RimWorld.Planet.WorldGenStep_Rivers' 39 202),(Source 'generation' 'RimWorld.TileMutatorWorker_River' 14 181),(Source 'generation' 'RimWorld.TileMutatorWorker_River' 269 287),(Source 'generation' 'RimWorld.MapGenUtility' 71 98))},
 [ordered]@{id='RIV02';finding='Local DeepMovingWater resolves by default to WaterMovingChestDeep, which is walkable and Bridgeable. WaterDeep/WaterOceanDeep are distinct impassable unchangeable terrains without Bridgeable; WaterDeep has a flying exception. Shallow water pathCost30, chest-deep42; perceived drafted18/undrafted180 offsets affect route choice, not a direct speed multiplier.';sources=@((Source 'weather' 'Verse.AI.PathGrid' 120 190),(Source 'work' 'Verse.AI.Pawn_PathFollower' 730 775),(Source 'generation' 'RimWorld.MapGenUtility' 71 98))},
 [ordered]@{id='RIV03';finding='1.7 foundationGrid is separate from topGrid and underGrid. SetTerrain dispatches foundations to SetFoundation, preserving preexisting top terrain. RemoveFoundation clears foundation and exposes previous terrain; RemoveTopLayer dispatches appropriately.';sources=@((Source 'stonecutting' 'Verse.TerrainGrid' 60 106),(Source 'stonecutting' 'Verse.TerrainGrid' 193 214),(Source 'stonecutting' 'Verse.TerrainGrid' 280 374))},
 [ordered]@{id='RIV04';finding='GetAffordances uses foundation affordances when present. Construction validates occupied cells against required terrain support. Stuff changes required support only when useStuffTerrainAffordance is enabled; stone furniture is not universally Heavy. A floor placed over a wooden bridge does not upgrade its Light support.';sources=@((Source 'logistics' 'Verse.GridsUtility' 126 134),(Source 'skills' 'RimWorld.GenConstruct' 197 230),(Source 'preservation' 'Verse.ThingUtility' 190 199))},
 [ordered]@{id='RIV05';finding='Ordinary RemoveFoundation validates bounds/fog/removability and blocking edifices/buildings/blueprints/frames. Work may remove overlay floor first and reserves Floor layer. Removal uses ConstructionSpeed and calls RemoveFoundation; it is distinct from foundation destruction.';sources=@((Source 'river-bridge' 'RimWorld.Designator_RemoveFoundation' 1 55),(Source 'river-bridge' 'RimWorld.WorkGiver_ConstructRemoveFoundation' 1 109),(Source 'river-bridge' 'RimWorld.JobDriver_RemoveFoundation' 1 27))},
 [ordered]@{id='RIV06';finding='Terrain changes update pathing and invalidate unsupported blueprints/frames/plants/filth; destruction can kill supported buildings when destroyBuildingsOnDestroyed. This is not a blanket deletion of every loose item on water.';sources=@((Source 'stonecutting' 'Verse.TerrainGrid' 502 565),(Source 'stonecutting' 'Verse.TerrainGrid' 641 668))},
 [ordered]@{id='RIV07';finding='Stockpile zoning rejects Impassable terrain and incompatible occupants, not all water. Ordinary shallow-water zones are allowed. Near placement delegates to CanSpawnAt requiring a walkable position; Direct placement is a different path.';sources=@((Source 'river-bridge' 'RimWorld.Designator_ZoneAddStockpile' 42 58),(Source 'river-bridge' 'RimWorld.Designator_ZoneAdd' 70 150),(Source 'logistics' 'Verse.GenSpawn' 471 520),(Source 'logistics' 'Verse.GenPlace' 215 260))},
 [ordered]@{id='RIV08';finding='Water extraDeteriorationFactor3 is combined with environmental exposure offsets for eligible spawned items. Unroofed rain then multiplies and protective edifices can modify it. This is not universal water damage every tick.';sources=@((Source 'weapons' 'RimWorld.StatPart_EnvironmentalEffects' 15 44),(Source 'weather' 'RimWorld.SteadyEnvironmentEffects' 270 330))},
 [ordered]@{id='RIV09';finding='Foundation terrain serialization uses its separate short-hash grid. Saved foundation, top and under bytes can be compared without pretending that an observed ushort is a portable definition identity.';sources=@((Source 'stonecutting' 'Verse.TerrainGrid' 670 720))}
)
$reaFile=Join-Path $base 'production-bills-rea-managed.json';$rea=Get-Content $reaFile -Raw|ConvertFrom-Json
if($rea.subject.digest.sha256 -ne $dllHash){throw 'REA identity mismatch'}
$record=[ordered]@{evidence_id='RW17-RIVER-BRIDGE-STATIC';version_text=(Get-Content (Join-Path $GameRoot 'Version.txt') -Raw).Trim();source_sha256=$dllHash;engine_sha256=$engineHash;kind='Matched static derived reconstruction and bounded shipped XML; separate native runtime record';rea=[ordered]@{file='production-bills-rea-managed.json';sha256=Digest $reaFile};manifests=@(foreach($g in @($groups|Sort-Object)){[ordered]@{file="$g-manifest.json";sha256=Digest (Join-Path $base "$g-manifest.json")}});xml=$xmlRecords;buildingXmlFiles=@(foreach($f in $buildingFiles){[ordered]@{file="Data/Core/Defs/ThingDefs_Buildings/$($f.Name)";sha256=Digest $f.FullName}});buildingSupport=$buildingSupport;claims=$claims;limits=@('Derived C# is not original source or runtime proof.','Building projection resolves scalar ParentName fields in shipped Core building XML only, not the full patched mod database.','HeavyBridge belongs to Odyssey; numbers are recorded provenance, not Web balance requirements.','Ordinary removal blocker uses buildDef.terrainAffordanceNeeded directly; do not silently substitute material-aware construction rules.','Actual native scope is documented separately in 128; support matrix, heavy bridge, flooding and erosion are not native-tested here.')}
$out=Join-Path $base 'river-bridge-evidence.json';$json=(LF ($record|ConvertTo-Json -Depth 40))+[char]10
if($Check){if((LF ([IO.File]::ReadAllText($out))) -cne $json){throw 'River evidence replay mismatch'}}else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false))}
"River evidence verified: $($claims.Count) claims, $($buildingSupport.Count) building support entries."
