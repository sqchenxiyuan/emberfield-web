param([Parameter(Mandatory=$true)][string]$GameRoot,[string]$Output=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/stonecutting-xml.json'))
$ErrorActionPreference='Stop'
$assembly=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Review changed game version before updating stonecutting evidence.'}
$building=@('thingClass','category','size','costStuffCount','costList','stuffCategories','statBases','hasInteractionCell','interactionCellOffset','surfaceType','building','comps','researchPrerequisites','resourcesFractionWhenDeconstructed','leaveResourcesWhenKilled')
$recipe=@('workAmount','workSpeedStat','workTableSpeedStat','efficiencyStat','workTableEfficiencyStat','workSkill','workSkillLearnFactor','targetCountAdjustment','ingredients','fixedIngredientFilter','defaultIngredientFilter','products','specialProducts','recipeUsers','workerClass','workerCounterClass','unfinishedThingDef','skillRequirements')
$floor=@('statBases','costList','resourcesFractionWhenDeconstructed','researchPrerequisites','constructionSkillPrerequisite')
$selections=@(
 @('material','Data/Core/Defs/ThingDefs_Items/Items_Resource_Base.xml',"/Defs/ThingDef[@Name='ResourceBase']",@('stuffProps','resourceReadoutPriority')),
 @('material','Data/Core/Defs/ThingDefs_Items/Items_Exotic.xml',"/Defs/ThingDef[@Name='ResourceVerbBase']",@('stuffProps','resourceReadoutPriority')),
 @('natural','Data/Core/Defs/ThingDefs_Buildings/Buildings_Natural.xml',"/Defs/ThingDef[@Name='BuildingNaturalBase' or @Name='RockBase']",@('thingClass','statBases','building')),
 @('natural','Data/Core/Defs/ThingDefs_Misc/Various_Stone.xml',"/Defs/ThingDef[@Name='UglyRockBase' or defName='Granite']",@('thingClass','statBases','building')),
 @('material','Data/Core/Defs/ThingDefs_Misc/Various_Stone.xml',"/Defs/ThingDef[@Name='StoneBlocksBase' or defName='BlocksGranite']",@('stuffProps','resourceReadoutPriority')),
 @('material','Data/Core/Defs/ThingDefs_Items/Items_Resource_Stuff.xml',"/Defs/ThingDef[defName='WoodLog']",@('stuffProps')),
 @('bench','Data/Core/Defs/ThingDefs_Buildings/Buildings_Base.xml',"/Defs/ThingDef[@Name='BuildingBase']",$building),
 @('bench','Data/Core/Defs/ThingDefs_Buildings/Buildings_Production.xml',"/Defs/ThingDef[@Name='BenchBase' or defName='TableStonecutter']",$building),
 @('wall','Data/Core/Defs/ThingDefs_Buildings/Buildings_Structure.xml',"/Defs/ThingDef[defName='Wall']",$building),
 @('recipe','Data/Core/Defs/RecipeDefs/Recipes_Production.xml',"/Defs/RecipeDef[@Name='MakeStoneBlocksBase' or defName='Make_StoneBlocksAny']",$recipe),
 @('recipe','Data/Core/Defs/ThingDefs_Misc/Various_Stone.xml',"/Defs/RecipeDef[defName='Make_StoneBlocksGranite']",$recipe),
 @('stat','Data/Core/Defs/Stats/Stats_Pawns_WorkRecipes.xml',"/Defs/StatDef[defName='GeneralLaborSpeed']",@('defaultBaseValue','minValue','statFactors','capacityFactors','skillNeedFactors','parts')),
 @('stat','Data/Core/Defs/Stats/Stats_Building_Special.xml',"/Defs/StatDef[defName='WorkToBuild' or defName='WorkTableWorkSpeedFactor' or defName='WorkTableEfficiencyFactor']",@('defaultBaseValue','minValue','roundToFiveOver','parts')),
 @('work','Data/Core/Defs/WorkGiverDefs/WorkGivers.xml',"/Defs/WorkGiverDef[defName='DoBillsStonecut']",@('giverClass','workType','priorityInType','fixedBillGiverDefs','requiredCapacities')),
 @('floor','Data/Core/Defs/TerrainDefs/Terrain_Floors.xml',"/Defs/TerrainDef[@Name='FloorBase' or defName='WoodPlankFloor']",$floor),
 @('floor','Data/Core/Defs/TerrainDefs/Terrain_Floors_StoneTile.xml',"/Defs/TerrainDef[@Name='TileStoneBase' or defName='TileGranite' or @Name='FlagstoneBase' or defName='FlagstoneGranite']",$floor)
)
function Relative-XPath($leaf,$root){$parts=[Collections.Generic.List[string]]::new();$cursor=$leaf;while($cursor -ne $root){$tag=$cursor.LocalName;$siblings=@($cursor.ParentNode.ChildNodes|Where-Object{$_.NodeType -eq 'Element' -and $_.LocalName -eq $tag});$segment=$tag;if($siblings.Count -gt 1){$segment+='['+([Array]::IndexOf($siblings,$cursor)+1)+']'};$parts.Insert(0,$segment);$cursor=$cursor.ParentNode};return ($parts -join '/')}
$records=[Collections.Generic.List[object]]::new()
foreach($s in $selections){$file=Join-Path $GameRoot $s[1];[xml]$doc=Get-Content -Raw -LiteralPath $file;$sha=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();$nodes=$doc.SelectNodes($s[2]);if($nodes.Count -eq 0){throw "No nodes: $($s[2])"}
 foreach($node in $nodes){$def=$node.SelectSingleNode('defName');$name=if($def){$def.InnerText}else{$node.GetAttribute('Name')};$xp='/Defs/'+$node.LocalName+$(if($def){"[defName='$name']"}else{"[@Name='$name']"});$leaves=[Collections.Generic.List[object]]::new();$contexts=[Collections.Generic.List[object]]::new()
  foreach($child in $node.SelectNodes('.//*')){$rel=Relative-XPath $child $node;$first=($rel -split '/')[0] -replace '\[\d+\]$','';if($first -notin $s[3] -or $rel -match '(?i)graphic|sound|effect|thought|description|label|texPath'){continue};if($child.Attributes.Count -gt 0){$attrs=[ordered]@{};foreach($a in $child.Attributes){$attrs[$a.Name]=$a.Value};$contexts.Add([ordered]@{xpath=$xp+'/'+$rel;attributes=$attrs})};if($child.SelectNodes('*').Count -eq 0){$leaves.Add([ordered]@{xpath=$xp+'/'+$rel;value=$child.InnerText})}}
  $absent=@($s[3]|Where-Object{$null -eq $node.SelectSingleNode($_)});$records.Add([ordered]@{group=$s[0];id=$node.LocalName+'_'+$name;def_name=$name;parent_name=$node.GetAttribute('ParentName');source=[ordered]@{path=$s[1];xpath=$xp;sha256=$sha};selected_roots=$s[3];absent_roots=$absent;fields=@($leaves.ToArray());node_attributes=@($contexts.ToArray())})
 }
}
$reuse=@('ResourceBase','ResourceVerbBase','ChunkBase','ChunkRockBase','StoneBlocksBase','ChunkGranite','BlocksGranite','WoodLog')|ForEach-Object{[ordered]@{group='logistics';id='ThingDef_'+$_}}
$result=[ordered]@{evidence_id='RW17-STONECUTTING-XML';version_text=(Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim();assembly_sha256=$assembly;kind='Selected direct declarations plus references to existing logistics XML records';limitations=@('No enabled DLC/mod patch database evaluation.','Overlapping ThingDef records select different roots and must agree on source identity and ParentName.','Absence is established only for selected roots. Time and 3D adaptations are distinct from original declarations.');reused_records=@($reuse);records=@($records.ToArray())}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),(($result|ConvertTo-Json -Depth 20) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false));Write-Output "Recorded $($records.Count) new stonecutting XML selections, referencing $($reuse.Count) existing logistics records."
