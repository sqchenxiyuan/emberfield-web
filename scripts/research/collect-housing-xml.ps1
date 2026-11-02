param(
  [Parameter(Mandatory=$true)][string]$GameRoot,
  [string]$Output=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/housing-xml.json')
)
$ErrorActionPreference='Stop'
$assemblyHash=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assemblyHash -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Review changed game version before updating housing evidence.'}
$selections=@(
  @('base','Data/Core/Defs/ThingDefs_Buildings/Buildings_Base.xml',"/Defs/ThingDef[@Name='BuildingBase']",@('passability','rotatable','category','size')),
  @('bed','Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml',"/Defs/ThingDef[@Name='FurnitureBase' or @Name='BedBase' or @Name='BedWithQualityBase' or @Name='ArtableBedBase' or @Name='SansComfortBedBase' or @Name='BasicBedBase' or defName='Bed' or defName='Bedroll']",@('thingClass','passability','pathCost','fillPercent','rotatable','defaultPlacingRot','size','costStuffCount','statBases','comps','building')),
  @('door','Data/Core/Defs/ThingDefs_Buildings/Buildings_Structure.xml',"/Defs/ThingDef[@Name='DoorBase' or defName='Door']",@('thingClass','rotatable','fillPercent','holdsRoof','blockLight','size','costStuffCount','statBases','building')),
  @('building_stat','Data/Core/Defs/Stats/Stats_Building_Special.xml',"/Defs/StatDef[defName='DoorOpenSpeed' or defName='BedRestEffectiveness']",@('defaultBaseValue','minValue','maxValue','valueIfMissing','parts')),
  @('comfort_stat','Data/Core/Defs/Stats/Stats_Basics_General.xml',"/Defs/StatDef[defName='Comfort']",@('defaultBaseValue','minValue','maxValue','parts')),
  @('pawn_stat','Data/Core/Defs/Stats/Stats_Pawns_General.xml',"/Defs/StatDef[defName='RestRateMultiplier' or defName='RestFallRateFactor']",@('defaultBaseValue','minValue','maxValue','parts')),
  @('need','Data/Core/Defs/NeedDefs/Needs.xml',"/Defs/NeedDef[defName='Comfort' or defName='Rest']",@('needClass','seekerRisePerHour','seekerFallPerHour','freezeWhileSleeping','freezeWhileUnconscious','major','onlyIfCausedByHediff')),
  @('timetable','Data/Core/Defs/Misc/TimeAssignmentDefs/TimeAssignments.xml',"/Defs/TimeAssignmentDef",@('allowRest','allowJoy')),
  @('material','Data/Core/Defs/ThingDefs_Items/Items_Resource_Stuff.xml',"/Defs/ThingDef[defName='WoodLog' or defName='Steel']",@('stuffProps')),
  @('stone','Data/Core/Defs/ThingDefs_Misc/Various_Stone.xml',"/Defs/ThingDef[@Name='StoneBlocksBase']",@('stuffProps'))
)
$records=[Collections.Generic.List[object]]::new()
foreach($selection in $selections){
  $path=Join-Path $GameRoot $selection[1]
  [xml]$doc=Get-Content -Raw -LiteralPath $path
  $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  $nodes=$doc.SelectNodes($selection[2]);if($nodes.Count -eq 0){throw "No selected nodes: $($selection[1])"}
  foreach($node in $nodes){
    $def=$node.SelectSingleNode('defName');$key=if($def){$def.InnerText}else{$node.GetAttribute('Name')}
    $xpath=if($def){'/Defs/'+$node.LocalName+"[defName='$key']"}else{'/Defs/'+$node.LocalName+"[@Name='$key']"}
    $fields=[Collections.Generic.List[object]]::new()
    foreach($leaf in $node.SelectNodes('.//*[not(*)]')){
      $parts=[Collections.Generic.List[string]]::new();$cursor=$leaf
      while($cursor -ne $node){
        $tag=$cursor.LocalName;$siblings=@($cursor.ParentNode.ChildNodes|Where-Object{$_.NodeType -eq 'Element' -and $_.LocalName -eq $tag})
        $segment=$tag;if($siblings.Count -gt 1){$segment+='['+([Array]::IndexOf($siblings,$cursor)+1)+']'}
        $parts.Insert(0,$segment);$cursor=$cursor.ParentNode
      }
      if($parts[0] -notin $selection[3]){continue}
      $rel=$parts -join '/'
      if($rel -match '(?i)graphic|sound|color|appearance|description|label|texPath'){continue}
      $attrs=[ordered]@{};foreach($attr in $leaf.Attributes){$attrs[$attr.Name]=$attr.Value}
      $fields.Add([ordered]@{xpath=$xpath+'/'+$rel;value=$leaf.InnerText;attributes=$attrs})
    }
    # Record IDs include the Def class to distinguish NeedDef.Comfort and StatDef.Comfort.
    $records.Add([ordered]@{group=$selection[0];id=$node.LocalName+'_'+$key;def_name=$key;parent_name=$node.GetAttribute('ParentName');source=[ordered]@{path=$selection[1];xpath=$xpath;sha256=$hash};fields=@($fields.ToArray())})
  }
}
$result=[ordered]@{
  evidence_id='RW17-HOUSING-XML';version_text=(Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim();assembly_sha256=$assemblyHash;
  kind='Selected direct declarations, not an effective Def database';
  limitations=@('ParentName retained. No mod, patch or enabled DLC evaluation.','Absent fields use inheritance or class defaults; absence is not zero.','Original maps are two-dimensional; voxel door height and multi-floor room geometry are custom.');records=@($records.ToArray())
}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),(($result|ConvertTo-Json -Depth 18) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
Write-Output "Recorded $($records.Count) housing XML declarations."
