param([Parameter(Mandatory=$true)][string]$GameRoot,[string]$Output=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/logistics-xml.json'))
$ErrorActionPreference='Stop'
$assembly=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Review changed game version before updating logistics evidence.'}
$fields=@('thingClass','category','stackLimit','smallVolume','statBases','butcherProducts')
$selections=@(
 @('resource','Data/Core/Defs/ThingDefs_Items/Items_Resource_Base.xml',"/Defs/ThingDef[@Name='ResourceBase']",$fields),
 @('resource','Data/Core/Defs/ThingDefs_Items/Items_Exotic.xml',"/Defs/ThingDef[@Name='ResourceVerbBase']",$fields),
 @('resource','Data/Core/Defs/ThingDefs_Items/Items_Resource_Stuff.xml',"/Defs/ThingDef[defName='WoodLog' or defName='Steel']",$fields),
 @('resource','Data/Core/Defs/ThingDefs_Items/Items_Resource_Manufactured.xml',"/Defs/ThingDef[defName='ComponentIndustrial']",$fields),
 @('stone','Data/Core/Defs/ThingDefs_Misc/Various_Stone.xml',"/Defs/ThingDef[@Name='ChunkBase' or @Name='ChunkRockBase' or @Name='StoneBlocksBase' or defName='ChunkGranite' or defName='BlocksGranite']",$fields),
 @('food','Data/Core/Defs/ThingDefs_Items/Items_Resource_RawPlant.xml',"/Defs/ThingDef[@Name='OrganicProductBase' or @Name='PlantFoodRawBase' or defName='RawRice' or defName='RawPotatoes' or defName='RawCorn']",@('stackLimit','smallVolume')),
 @('food','Data/Core/Defs/ThingDefs_Items/Items_Food.xml',"/Defs/ThingDef[@Name='MealBaseIngredientless' or @Name='MealBase' or @Name='MealCookedIngredientless' or @Name='MealCooked' or defName='MealSimple' or defName='MealSurvivalPack']",@('stackLimit','smallVolume')),
 @('capacity','Data/Core/Defs/Stats/Stats_Pawns_General.xml',"/Defs/StatDef[defName='CarryingCapacity']",@('defaultBaseValue','minValue','parts','capacityFactors')),
 @('shelf','Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml',"/Defs/ThingDef[@Name='ShelfBase']",@('building'))
)
function Relative-XPath($leaf,$root){
 $parts=[Collections.Generic.List[string]]::new();$cursor=$leaf
 while($cursor -ne $root){
  $tag=$cursor.LocalName;$siblings=@($cursor.ParentNode.ChildNodes|Where-Object{$_.NodeType -eq 'Element' -and $_.LocalName -eq $tag})
  $segment=$tag;if($siblings.Count -gt 1){$segment+='['+([Array]::IndexOf($siblings,$cursor)+1)+']'}
  $parts.Insert(0,$segment);$cursor=$cursor.ParentNode
 };return ($parts -join '/')
}
$records=[Collections.Generic.List[object]]::new()
foreach($s in $selections){
 $file=Join-Path $GameRoot $s[1];[xml]$doc=Get-Content -Raw -LiteralPath $file
 $sha=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();$nodes=$doc.SelectNodes($s[2])
 if($nodes.Count -eq 0){throw "Selection has no nodes: $($s[2])"}
 foreach($node in $nodes){
  $def=$node.SelectSingleNode('defName');$name=if($def){$def.InnerText}else{$node.GetAttribute('Name')}
  $xp='/Defs/'+$node.LocalName+$(if($def){"[defName='$name']"}else{"[@Name='$name']"})
  $leaves=[Collections.Generic.List[object]]::new();$contexts=[Collections.Generic.List[object]]::new()
  foreach($child in $node.SelectNodes('.//*')){
   $rel=Relative-XPath $child $node;$first=($rel -split '/')[0] -replace '\[\d+\]$',''
   if($first -notin $s[3] -or $rel -match '(?i)graphic|sound|effect|thought|description|label|texPath'){continue}
   if($child.Attributes.Count -gt 0){$attrs=[ordered]@{};foreach($a in $child.Attributes){$attrs[$a.Name]=$a.Value};$contexts.Add([ordered]@{xpath=$xp+'/'+$rel;attributes=$attrs})}
   if($child.SelectNodes('*').Count -eq 0){$leaves.Add([ordered]@{xpath=$xp+'/'+$rel;value=$child.InnerText})}
  }
  $absent=@($s[3]|Where-Object{$null -eq $node.SelectSingleNode($_)})
  $records.Add([ordered]@{group=$s[0];id=$node.LocalName+'_'+$name;def_name=$name;parent_name=$node.GetAttribute('ParentName');source=[ordered]@{path=$s[1];xpath=$xp;sha256=$sha};selected_roots=$s[3];absent_roots=$absent;fields=@($leaves.ToArray());node_attributes=@($contexts.ToArray())})
 }
}
$result=[ordered]@{evidence_id='RW17-LOGISTICS-XML';version_text=(Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim();assembly_sha256=$assembly;kind='Selected direct declarations, attributes and explicit selected-root absence';limitations=@('No enabled DLC/mod patch database evaluation.','Only selected resource parent chains are resolved; ShelfBase is a direct declaration, not a complete furniture inheritance chain.','Food chains previously examined for preservation are reselected here to bind stackLimit and explicit smallVolume absence. Ordinary carry capacity is not caravan inventory mass capacity.');records=@($records.ToArray())}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),(($result|ConvertTo-Json -Depth 20) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
Write-Output "Recorded $($records.Count) logistics XML declarations."
