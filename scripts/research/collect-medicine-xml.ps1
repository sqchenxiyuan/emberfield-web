param([Parameter(Mandatory=$true)][string]$GameRoot,[string]$Output=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/medicine-xml.json'))
$ErrorActionPreference='Stop'
$assembly=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Review changed assembly before updating medicine evidence.'}
$item=@('thingClass','category','stackLimit','healthAffectsPrice','statBases','tickerType','comps','costList','recipeMaker','ingestible','techLevel')
$plant=@('thingClass','category','statBases','plant','comps','pathCost')
$stat=@('defaultBaseValue','minValue','maxValue','parts','statFactors','skillNeedFactors','capacityFactors','postProcessCurve','postProcessStatFactors','workerClass')
$hediff=@('hediffClass','initialSeverity','lethalSeverity','tendable','isInfection','comps','stages','keepOnBodyPartRestoration','visible','injuryProps')
$bed=@('statBases','building/bed_defaultMedical','comps')
$selections=@(
 @('medicine','Data/Core/Defs/ThingDefs_Items/Items_Resource_Base.xml',"/Defs/ThingDef[@Name='ResourceBase']",$item),
 @('medicine','Data/Core/Defs/ThingDefs_Items/Items_Resource_Manufactured.xml',"/Defs/ThingDef[@Name='MedicineBase' or defName='MedicineHerbal' or defName='MedicineIndustrial' or defName='MedicineUltratech']",$item),
 @('plant','Data/Core/Defs/ThingDefs_Plants/Plants_Bases.xml',"/Defs/ThingDef[@Name='PlantBaseNonEdible' or @Name='PlantBase']",$plant),
 @('plant','Data/Core/Defs/ThingDefs_Plants/Plants_Cultivated_Farm.xml',"/Defs/ThingDef[@Name='HealrootBase' or defName='Plant_Healroot']",$plant),
 @('plant','Data/Core/Defs/ThingDefs_Plants/Plants_Wild_General.xml',"/Defs/ThingDef[defName='Plant_HealrootWild']",$plant),
 @('disease','Data/Core/Defs/HediffDefs/Hediffs_Local_Infections.xml',"/Defs/HediffDef[@Name='InfectionBase' or defName='WoundInfection']",$hediff),
 @('injury','Data/Core/Defs/HediffDefs/Hediffs_Local_Injuries.xml',"/Defs/HediffDef[@Name='InjuryBase' or defName='Cut' or defName='Stab' or defName='Gunshot' or defName='Bite' or defName='Crush' or defName='Bruise' or defName='Crack']",$hediff),
 @('stat','Data/Core/Defs/Stats/Stats_Pawns_WorkMedical.xml',"/Defs/StatDef[defName='MedicalTendSpeed' or defName='MedicalTendQuality']",$stat),
 @('stat','Data/Core/Defs/Stats/Stats_Pawns_General.xml',"/Defs/StatDef[defName='ImmunityGainSpeed']",$stat),
 @('stat','Data/Core/Defs/Stats/Stats_Basics_Special.xml',"/Defs/StatDef[defName='MedicalPotency' or defName='MedicalQualityMax']",$stat),
 @('stat','Data/Core/Defs/Stats/Stats_Basics_General.xml',"/Defs/StatDef[defName='Cleanliness']",$stat),
 @('stat','Data/Core/Defs/Stats/Stats_Building_Special.xml',"/Defs/StatDef[defName='MedicalTendQualityOffset' or defName='ImmunityGainSpeedFactor']",$stat),
 @('room','Data/Core/Defs/Rooms/RoomStats.xml',"/Defs/RoomStatDef[defName='Cleanliness' or defName='InfectionChanceFactor']",@('workerClass','roomlessScore','inputStat','curve','updatePriority')),
 @('bed','Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml',"/Defs/ThingDef[@Name='FurnitureBase' or @Name='BedBase' or @Name='BedWithQualityBase' or @Name='ArtableBedBase' or @Name='SansComfortBedBase' or @Name='BasicBedBase' or defName='Bed' or defName='HospitalBed']",$bed),
 @('building-parent','Data/Core/Defs/ThingDefs_Buildings/Buildings_Base.xml',"/Defs/ThingDef[@Name='BuildingBase']",$bed),
 @('terrain','Data/Core/Defs/TerrainDefs/Terrain_Natural.xml',"/Defs/TerrainDef[@Name='NaturalTerrainBase' or defName='Soil']",@('statBases')),
 @('terrain','Data/Core/Defs/TerrainDefs/Terrain_Floors.xml',"/Defs/TerrainDef[@Name='FloorBase' or defName='WoodPlankFloor']",@('statBases')),
 @('terrain','Data/Core/Defs/TerrainDefs/Terrain_Floors_StoneTile.xml',"/Defs/TerrainDef[@Name='FlagstoneBase' or defName='FlagstoneGranite']",@('statBases')),
 @('rock','Data/Core/Defs/ThingDefs_Buildings/Buildings_Natural.xml',"/Defs/ThingDef[@Name='BuildingNaturalBase' or @Name='RockBase']",@('building/isNaturalRock','building/isResourceRock','building/naturalTerrain','building/leaveTerrain')),
 @('rock','Data/Core/Defs/ThingDefs_Misc/Various_Stone.xml',"/Defs/ThingDef[defName='Granite' or @Name='UglyRockBase' or @Name='ChunkBase']",@('statBases/Cleanliness','stackLimit','building/isNaturalRock','building/isResourceRock','building/naturalTerrain','building/leaveTerrain'))
)
function Relative-XPath($leaf,$root){$parts=[Collections.Generic.List[string]]::new();$cursor=$leaf;while($cursor -ne $root){$tag=$cursor.LocalName;$siblings=@($cursor.ParentNode.ChildNodes|Where-Object{$_.NodeType -eq 'Element' -and $_.LocalName -eq $tag});$segment=$tag;if($siblings.Count -gt 1){$segment+='['+([Array]::IndexOf($siblings,$cursor)+1)+']'};$parts.Insert(0,$segment);$cursor=$cursor.ParentNode};return ($parts -join '/')}
$records=[Collections.Generic.List[object]]::new()
foreach($s in $selections){$file=Join-Path $GameRoot $s[1];[xml]$doc=Get-Content -Raw -LiteralPath $file;$rawLines=Get-Content -LiteralPath $file;$sha=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();$nodes=$doc.SelectNodes($s[2]);if(!$nodes.Count){throw "No nodes: $($s[2])"}
 foreach($node in $nodes){$def=$node.SelectSingleNode('defName');$name=if($def){$def.InnerText}else{$node.GetAttribute('Name')};$xp='/Defs/'+$node.LocalName+$(if($def){"[defName='$name']"}else{"[@Name='$name']"});$leaves=[Collections.Generic.List[object]]::new();$attrs=[Collections.Generic.List[object]]::new();$absent=[Collections.Generic.List[string]]::new()
  foreach($selector in $s[3]){$chosen=$node.SelectNodes($selector);if(!$chosen.Count){$absent.Add($selector);continue};foreach($top in $chosen){$scan=@($top)+@($top.SelectNodes('.//*'));foreach($child in $scan){$rel=Relative-XPath $child $node;if($rel -match '/(label|description)$'){continue};if($child.Attributes.Count){$a=[ordered]@{};foreach($item in $child.Attributes){$a[$item.Name]=$item.Value};$attrs.Add([ordered]@{xpath=$xp+'/'+$rel;attributes=$a})};if(!$child.SelectNodes('*').Count){$leaves.Add([ordered]@{xpath=$xp+'/'+$rel;value=$child.InnerText})}}}}
  $pattern=if($def){'<defName>\s*'+[regex]::Escape($name)+'\s*</defName>'}else{'<'+$node.LocalName+'\b[^>]*\bName="'+[regex]::Escape($name)+'"'}
  $lineMatches=@(for($i=0;$i -lt $rawLines.Count;$i++){if($rawLines[$i] -match $pattern){$i}})
  if($lineMatches.Count -ne 1){throw "Ambiguous XML line anchor: $xp"}
  $first=[int]$lineMatches[0];while($first -gt 0 -and $rawLines[$first] -notmatch ('^\s*<'+$node.LocalName+'(?:\s|>)')){$first--}
  $last=$first;while($last -lt $rawLines.Count -and $rawLines[$last] -notmatch ('</'+$node.LocalName+'\s*>')){$last++}
  if($last -ge $rawLines.Count){throw "No closing XML line: $xp"}
  $records.Add([ordered]@{group=$s[0];id=$node.LocalName+'_'+$name;def_name=$name;parent_name=$node.GetAttribute('ParentName');name_attribute=$node.GetAttribute('Name');source=[ordered]@{path=$s[1];xpath=$xp;sha256=$sha;line_start=$first+1;line_end=$last+1};selected_paths=$s[3];absent_paths=@($absent.ToArray());fields=@($leaves.ToArray());node_attributes=@($attrs.ToArray())})
 }
}
$result=[ordered]@{evidence_id='RW17-MEDICINE-XML';version_text=(Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim();assembly_sha256=$assembly;kind='Selected direct Core medicine, healroot, wound infection, medical stats, rooms and floor declarations';limitations=@('Selected parent chains, not the effective enabled-mod database.','Absent declarations remain explicit; code defaults are separately cited.','Static extraction does not execute original gameplay or project implementation.');records=@($records.ToArray())}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),(($result|ConvertTo-Json -Depth 36) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false));Write-Output "Recorded $($records.Count) selected medicine XML records."
