param([Parameter(Mandatory=$true)][string]$GameRoot,[string]$Output=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/survival-xml.json'))
$ErrorActionPreference='Stop'
$assembly=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Review changed source before updating survival evidence.'}
$hediff=@('lethalSeverity','canApplyDodChanceForCapacityChanges','stages','tendable','initialSeverity','minSeverity','maxSeverity','comps')
$capacity=@('workerClass','minForCapable','minValue','lethalFlesh','zeroIfCannotBeAwake')
$stat=@('defaultBaseValue','minValue','maxValue','parts')
$bed=@('statBases/BedRestEffectiveness','statBases/ImmunityGainSpeedFactor','statBases/MedicalTendQualityOffset','building/bed_healPerDay','building/bed_defaultMedical','building/bed_canBeMedical')
$meal=@('statBases/Nutrition','ingestible/baseIngestTicks','ingestible/maxNumToIngestAtOnce','ingestible/defaultNumToIngestAtOnce')
$selections=@(
 @('hediff','Data/Core/Defs/HediffDefs/Hediffs_Global_Needs.xml',"/Defs/HediffDef[defName='Malnutrition']",$hediff),
 @('hediff','Data/Core/Defs/HediffDefs/Hediffs_Global_Temperature.xml',"/Defs/HediffDef[defName='Hypothermia' or defName='Heatstroke']",$hediff),
 @('giver','Data/Core/Defs/HediffGiverSetDefs/HediffGiverSets.xml',"/Defs/HediffGiverSetDef[defName='OrganicStandard']",@("hediffGivers/li[@Class='HediffGiver_Hypothermia']","hediffGivers/li[@Class='HediffGiver_Heat']")),
 @('human','Data/Core/Defs/ThingDefs_Races/Races_Humanlike.xml',"/Defs/ThingDef[defName='Human']",@('statBases/ComfyTemperatureMin','statBases/ComfyTemperatureMax','race/hediffGiverSets','race/baseHungerRate')),
 @('capacity','Data/Core/Defs/PawnCapacityDefs/PawnCapacity.xml',"/Defs/PawnCapacityDef[defName='Consciousness' or defName='Moving' or defName='Manipulation']",$capacity),
 @('stat','Data/Core/Defs/Stats/Stats_Pawns_General.xml',"/Defs/StatDef[defName='ComfyTemperatureMin' or defName='ComfyTemperatureMax' or defName='BedHungerRateFactor' or defName='PainShockThreshold']",$stat),
 @('insulation','Data/Core/Defs/Stats/Stats_Apparel.xml',"/Defs/StatDef[@Name='InsulationBase' or defName='Insulation_Cold' or defName='Insulation_Heat']",$stat),
 @('bed','Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml',"/Defs/ThingDef[@Name='BedBase' or @Name='SansComfortBedBase' or defName='Bed' or defName='HospitalBed']",$bed),
 @('job','Data/Core/Defs/JobDefs/Jobs_Work.xml',"/Defs/JobDef[defName='Rescue' or defName='FeedPatient']",@('driverClass','casualInterruptible','alwaysShowWeapon','playerInterruptible','checkOverrideOnExpire')),
 @('meal','Data/Core/Defs/ThingDefs_Items/Items_Food.xml',"/Defs/ThingDef[@Name='MealBaseIngredientless' or @Name='MealCookedIngredientless' or @Name='MealCooked' or defName='MealSimple']",$meal)
)
function Relative-XPath($leaf,$root){$parts=[Collections.Generic.List[string]]::new();$cursor=$leaf;while($cursor -ne $root){$tag=$cursor.LocalName;$siblings=@($cursor.ParentNode.ChildNodes|Where-Object{$_.NodeType -eq 'Element' -and $_.LocalName -eq $tag});$segment=$tag;if($siblings.Count -gt 1){$segment+='['+([Array]::IndexOf($siblings,$cursor)+1)+']'};$parts.Insert(0,$segment);$cursor=$cursor.ParentNode};return ($parts -join '/')}
$records=[Collections.Generic.List[object]]::new()
foreach($s in $selections){$file=Join-Path $GameRoot $s[1];[xml]$doc=Get-Content -Raw -LiteralPath $file;$sha=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();$nodes=$doc.SelectNodes($s[2]);if(!$nodes.Count){throw "No nodes: $($s[2])"}
 foreach($node in $nodes){$def=$node.SelectSingleNode('defName');$name=if($def){$def.InnerText}else{$node.GetAttribute('Name')};$xp='/Defs/'+$node.LocalName+$(if($def){"[defName='$name']"}else{"[@Name='$name']"});$leaves=[Collections.Generic.List[object]]::new();$attrs=[Collections.Generic.List[object]]::new();$absent=[Collections.Generic.List[string]]::new()
  foreach($selector in $s[3]){$chosen=$node.SelectNodes($selector);if(!$chosen.Count){$absent.Add($selector);continue};foreach($top in $chosen){$scan=@($top)+@($top.SelectNodes('.//*'));foreach($child in $scan){$rel=Relative-XPath $child $node;if($rel -match '/(label|description)$'){continue};if($child.Attributes.Count){$a=[ordered]@{};foreach($item in $child.Attributes){$a[$item.Name]=$item.Value};$attrs.Add([ordered]@{xpath=$xp+'/'+$rel;attributes=$a})};if(!$child.SelectNodes('*').Count){$leaves.Add([ordered]@{xpath=$xp+'/'+$rel;value=$child.InnerText})}}}}
  $records.Add([ordered]@{group=$s[0];id=$node.LocalName+'_'+$name;def_name=$name;parent_name=$node.GetAttribute('ParentName');source=[ordered]@{path=$s[1];xpath=$xp;sha256=$sha};selected_paths=$s[3];absent_paths=@($absent.ToArray());fields=@($leaves.ToArray());node_attributes=@($attrs.ToArray())})
 }
}
$result=[ordered]@{evidence_id='RW17-SURVIVAL-XML';version_text=(Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim();assembly_sha256=$assembly;kind='Selected direct health, capacity, stats and work-chain declarations; not an effective Def database';limitations=@('Only explicitly selected paths and absences are covered; ParentName is retained, not globally resolved.','Core-only source identity; enabled mods/DLC patches may change effective definitions.','Derived source and independent math do not execute original or project gameplay.');records=@($records.ToArray())}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),(($result|ConvertTo-Json -Depth 20) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false));Write-Output "Recorded $($records.Count) selected survival XML records."
