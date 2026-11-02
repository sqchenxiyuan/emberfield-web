param([Parameter(Mandatory=$true)][string]$GameRoot,[string]$Output=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/energy-xml.json'))
$ErrorActionPreference='Stop'
$assembly=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Review changed game version before updating energy evidence.'}
$selections=@(
 @('base','Data/Core/Defs/ThingDefs_Buildings/Buildings_Base.xml',"/Defs/ThingDef[@Name='BuildingBase']",@('size','tickerType','rotatable','passability','comps')),
 @('power','Data/Core/Defs/ThingDefs_Buildings/Buildings_Power.xml',"/Defs/ThingDef[defName='PowerConduit' or defName='WoodFiredGenerator' or defName='SolarGenerator' or defName='Battery']",@('thingClass','size','tickerType','rotatable','passability','statBases','costList','comps','building','researchPrerequisites','constructionSkillPrerequisite')),
 @('thermal','Data/Core/Defs/ThingDefs_Buildings/Buildings_Temperature.xml',"/Defs/ThingDef[defName='Heater' or defName='Cooler' or defName='Vent']",@('thingClass','size','tickerType','rotatable','passability','statBases','costList','comps','building','researchPrerequisites','constructionSkillPrerequisite')),
 @('weather','Data/Core/Defs/WeatherDefs/Weathers.xml',"/Defs/WeatherDef[defName='Clear' or defName='Rain' or defName='Fog' or defName='SnowHard']",@('maxGlow')),
 @('work','Data/Core/Defs/WorkGiverDefs/WorkGivers.xml',"/Defs/WorkGiverDef[defName='Refuel']",@('giverClass','workType','priorityInType','requiredCapacities')),
 @('job','Data/Core/Defs/JobDefs/Jobs_Misc.xml',"/Defs/JobDef[defName='Refuel']",@('driverClass','checkOverrideOnExpire','casualInterruptible','playerInterruptible','alwaysShowWeapon'))
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
  $fields=[Collections.Generic.List[object]]::new();$contexts=[Collections.Generic.List[object]]::new()
  foreach($child in $node.SelectNodes('.//*')){
   $rel=Relative-XPath $child $node;$first=($rel -split '/')[0] -replace '\[\d+\]$',''
   if($first -notin $s[3] -or $rel -match '(?i)graphic|sound|glowColor|commandTexture|commandLabel|commandDesc|description|label|texPath'){continue}
   if($child.Attributes.Count -gt 0){$attrs=[ordered]@{};foreach($a in $child.Attributes){$attrs[$a.Name]=$a.Value};$contexts.Add([ordered]@{xpath=$xp+'/'+$rel;attributes=$attrs})}
   if($child.SelectNodes('*').Count -eq 0){$fields.Add([ordered]@{xpath=$xp+'/'+$rel;value=$child.InnerText})}
  }
  $absent=@($s[3]|Where-Object{$null -eq $node.SelectSingleNode($_)})
  $records.Add([ordered]@{group=$s[0];id=$node.LocalName+'_'+$name;def_name=$name;parent_name=$node.GetAttribute('ParentName');source=[ordered]@{path=$s[1];xpath=$xp;sha256=$sha};selected_roots=$s[3];absent_roots=$absent;fields=@($fields.ToArray());node_attributes=@($contexts.ToArray())})
 }
}
$result=[ordered]@{evidence_id='RW17-ENERGY-XML';version_text=(Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim();assembly_sha256=$assembly;kind='Selected direct declarations with component class attributes and explicit selected-root absence';limitations=@('No enabled DLC/mod patch database evaluation. ParentName preserved; missing direct field is not zero.','Weather maxGlow absence is paired with WeatherDef class default; not a runtime weather/solar measurement.');records=@($records.ToArray())}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),(($result|ConvertTo-Json -Depth 20) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
Write-Output "Recorded $($records.Count) energy XML declarations."
