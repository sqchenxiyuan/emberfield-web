param([Parameter(Mandatory=$true)][string]$GameRoot,[string]$Output=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/biomes-xml.json'))
$ErrorActionPreference='Stop'
$assembly=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Review changed game version before updating biome evidence.'}
$biome=@('workerClass','plantDensity','animalDensity','wildPlantRegrowDays','wildPlantsCareAboutLocalFertility','terrainsByFertility','terrainPatchMakers','wildPlants','noGravel','gravelTerrain')
$terrain=@('fertility','pathCost','affordances','supportsRock','tags','natural')
$plant=@('plant','statBases','category','thingClass')
$selections=@(
 @('biome','Data/Core/Defs/BiomeDefs/Biomes_Temperate.xml',"/Defs/BiomeDef[defName='TemperateForest']",$biome),
 @('biome','Data/Core/Defs/BiomeDefs/Biomes_Cold.xml',"/Defs/BiomeDef[defName='BorealForest' or defName='Tundra']",$biome),
 @('biome','Data/Core/Defs/BiomeDefs/Biomes_WarmArid.xml',"/Defs/BiomeDef[defName='Desert']",$biome),
 @('terrain','Data/Core/Defs/TerrainDefs/Terrain_Natural.xml',"/Defs/TerrainDef[@Name='NaturalTerrainBase' or defName='Soil' or defName='SoilRich' or defName='Gravel' or defName='Sand' or defName='SoftSand']",$terrain),
 @('plant','Data/Core/Defs/ThingDefs_Plants/Plants_Bases.xml',"/Defs/ThingDef[@Name='PlantBaseNonEdible' or @Name='PlantBase' or @Name='TreeBase' or @Name='DeciduousTreeBase']",$plant),
 @('plant','Data/Core/Defs/ThingDefs_Plants/Plants_Wild_Temperate.xml',"/Defs/ThingDef[defName='Plant_TreeOak' or defName='Plant_TreePoplar' or defName='Plant_TreePine']",$plant),
 @('plant','Data/Core/Defs/ThingDefs_Plants/Plants_Wild_Arid.xml',"/Defs/ThingDef[defName='Plant_SaguaroCactus' or defName='Plant_PincushionCactus']",$plant)
)
function Relative-XPath($leaf,$root){$parts=[Collections.Generic.List[string]]::new();$cursor=$leaf;while($cursor -ne $root){$tag=$cursor.LocalName;$siblings=@($cursor.ParentNode.ChildNodes|Where-Object{$_.NodeType -eq 'Element' -and $_.LocalName -eq $tag});$segment=$tag;if($siblings.Count -gt 1){$segment+='['+([Array]::IndexOf($siblings,$cursor)+1)+']'};$parts.Insert(0,$segment);$cursor=$cursor.ParentNode};return ($parts -join '/')}
$records=[Collections.Generic.List[object]]::new()
foreach($s in $selections){$file=Join-Path $GameRoot $s[1];[xml]$doc=Get-Content -Raw -LiteralPath $file;$sha=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();$nodes=$doc.SelectNodes($s[2]);if($nodes.Count -eq 0){throw "No nodes: $($s[2])"}
 foreach($node in $nodes){$def=$node.SelectSingleNode('defName');$name=if($def){$def.InnerText}else{$node.GetAttribute('Name')};$xp='/Defs/'+$node.LocalName+$(if($def){"[defName='$name']"}else{"[@Name='$name']"});$leaves=[Collections.Generic.List[object]]::new();$contexts=[Collections.Generic.List[object]]::new()
  foreach($child in $node.SelectNodes('.//*')){$rel=Relative-XPath $child $node;$first=($rel -split '/')[0] -replace '\[\d+\]$','';if($first -notin $s[3] -or $rel -match '(?i)graphic|sound|effect|thought|description|label|texPath|visualSize|topWind|maxMesh'){continue};if($child.Attributes.Count -gt 0){$attrs=[ordered]@{};foreach($a in $child.Attributes){$attrs[$a.Name]=$a.Value};$contexts.Add([ordered]@{xpath=$xp+'/'+$rel;attributes=$attrs})};if($child.SelectNodes('*').Count -eq 0){$leaves.Add([ordered]@{xpath=$xp+'/'+$rel;value=$child.InnerText})}}
  $absent=@($s[3]|Where-Object{$null -eq $node.SelectSingleNode($_)});$records.Add([ordered]@{group=$s[0];id=$node.LocalName+'_'+$name;def_name=$name;parent_name=$node.GetAttribute('ParentName');source=[ordered]@{path=$s[1];xpath=$xp;sha256=$sha};selected_roots=$s[3];absent_roots=$absent;fields=@($leaves.ToArray());node_attributes=@($contexts.ToArray())})
 }
}
$result=[ordered]@{evidence_id='RW17-BIOMES-XML';version_text=(Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim();assembly_sha256=$assembly;kind='Selected direct declarations with complete selected parent chains; supplements unchanged generation records';limitations=@('No enabled DLC/mod patch database evaluation.','MayRequire retained; Core-only weights exclude gated entries.','Selected fields are checked against prior generation XML when their source paths overlap; original files remain authoritative.','Absence applies only to selected roots; visual and audio children are omitted.');prior_generation_records=@('TemperateForest','Soil','SoilRich','Gravel','Sand','SoftSand','PlantBaseNonEdible','PlantBase','TreeBase','DeciduousTreeBase','Plant_TreeOak','Plant_TreePoplar');records=@($records.ToArray())}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),(($result|ConvertTo-Json -Depth 20) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false));Write-Output "Recorded $($records.Count) selected biome/terrain/plant XML nodes."
