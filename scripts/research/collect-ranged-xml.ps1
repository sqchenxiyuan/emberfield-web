param([Parameter(Mandatory=$true)][string]$GameRoot,[string]$Output=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/ranged-xml.json'))
$ErrorActionPreference='Stop'
$assembly=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Review changed assembly before updating ranged evidence.'}
$weapon=@('thingClass','category','equipmentType','useHitPoints','statBases','costList','costStuffCount','stuffCategories','recipeMaker','comps','tools','verbs','techLevel','damageMultipliers')
$projectile=@('thingClass','category','tickerType','useHitPoints','projectile')
$stat=@('defaultBaseValue','minValue','maxValue','workerClass','parts','statFactors','skillNeedFactors','skillNeedOffsets','capacityFactors','capacityOffsets','postProcessCurve','postProcessStatFactors','noSkillOffset','finalizeEquippedStatOffset','roundValue','roundToFiveOver')
$building=@('thingClass','category','statBases','costList','costStuffCount','stuffCategories','size','researchPrerequisites','constructionSkillPrerequisite','hasInteractionCell','interactionCellOffset','building','comps','fillPercent','passability','pathCost','pathCostIgnoreRepeat','damageMultipliers','useHitPoints')
$plant=@('category','fillPercent','passability','pathCost','statBases/MaxHitPoints','damageMultipliers')
$selections=@(
 @('weapon','Data/Core/Defs/ThingDefs_Misc/Weapons/BaseWeapons.xml',"/Defs/ThingDef[@Name='BaseWeapon' or @Name='BaseGun' or @Name='BaseGunWithQuality' or @Name='BaseMakeableGun' or @Name='BaseHumanMakeableGun']",$weapon),
 @('weapon','Data/Core/Defs/ThingDefs_Misc/Weapons/RangedNeolithic.xml',"/Defs/ThingDef[@Name='BaseWeaponNeolithic' or defName='Bow_Short']",$weapon),
 @('weapon','Data/Core/Defs/ThingDefs_Misc/Weapons/RangedIndustrial.xml',"/Defs/ThingDef[defName='Gun_Revolver' or defName='Gun_Autopistol' or defName='Gun_MachinePistol']",$weapon),
 @('projectile','Data/Core/Defs/ThingDefs_Misc/Weapons/BaseWeapons.xml',"/Defs/ThingDef[@Name='BaseBullet']",$projectile),
 @('projectile','Data/Core/Defs/ThingDefs_Misc/Weapons/RangedNeolithic.xml',"/Defs/ThingDef[@Name='BaseProjectileNeolithic' or defName='Arrow_Short']",$projectile),
 @('projectile','Data/Core/Defs/ThingDefs_Misc/Weapons/RangedIndustrial.xml',"/Defs/ThingDef[defName='Bullet_Revolver' or defName='Bullet_Autopistol' or defName='Bullet_MachinePistol']",$projectile),
 @('stat','Data/Core/Defs/Stats/Stats_Weapons_Ranged.xml','/Defs/StatDef',$stat),
 @('stat','Data/Core/Defs/Stats/Stats_Pawns_Combat.xml',"/Defs/StatDef[defName='ShootingAccuracyPawn' or @Name='ShootingAccuracyFactorBase' or starts-with(defName,'ShootingAccuracyFactor_') or defName='AimingDelayFactor' or defName='RangedCooldownFactor']",$stat),
 @('stat','Data/Core/Defs/Stats/Stats_Weapons_Melee.xml',"/Defs/StatDef[defName='MeleeWeapon_DamageMultiplier']",$stat),
 @('stat','Data/Core/Defs/Stats/Stats_Basics_General.xml',"/Defs/StatDef[defName='MaxHitPoints' or defName='WorkToMake']",$stat),
 @('stat','Data/Core/Defs/Stats/Stats_Building_Special.xml',"/Defs/StatDef[defName='WorkToBuild' or defName='WorkTableWorkSpeedFactor']",$stat),
 @('stat','Data/Core/Defs/Stats/Stats_Pawns_WorkRecipes.xml',"/Defs/StatDef[defName='GeneralLaborSpeed']",$stat),
 @('research','Data/Core/Defs/ResearchProjectDefs/ResearchProjects_2_Electricity.xml',"/Defs/ResearchProjectDef[defName='Machining' or defName='Gunsmithing' or defName='BlowbackOperation']",@('baseCost','techLevel','prerequisites','requiredResearchBuilding','requiredResearchFacilities')),
 @('bench','Data/Core/Defs/ThingDefs_Buildings/Buildings_Production.xml',"/Defs/ThingDef[@Name='BenchBase' or defName='TableMachining' or defName='CraftingSpot' or defName='ElectricSmithy' or defName='FueledSmithy']",$building),
 @('building-parent','Data/Core/Defs/ThingDefs_Buildings/Buildings_Base.xml',"/Defs/ThingDef[@Name='BuildingBase']",$building),
 @('cover','Data/Core/Defs/ThingDefs_Buildings/Buildings_Security.xml',"/Defs/ThingDef[defName='Sandbags' or defName='Barricade']",$building),
 @('cover','Data/Core/Defs/ThingDefs_Buildings/Buildings_Structure.xml',"/Defs/ThingDef[defName='Wall']",$building),
 @('plant','Data/Core/Defs/ThingDefs_Plants/Plants_Bases.xml',"/Defs/ThingDef[@Name='PlantBaseNonEdible' or @Name='PlantBase' or @Name='TreeBase' or @Name='DeciduousTreeBase']",$plant),
 @('plant','Data/Core/Defs/ThingDefs_Plants/Plants_Wild_Temperate.xml',"/Defs/ThingDef[defName='Plant_TreeOak' or defName='Plant_TreePine' or defName='Plant_TreePoplar']",$plant),
 @('plant','Data/Core/Defs/ThingDefs_Plants/Plants_Wild_Arid.xml',"/Defs/ThingDef[defName='Plant_SaguaroCactus']",$plant),
 @('weather','Data/Core/Defs/WeatherDefs/Weathers.xml','/Defs/WeatherDef',@('accuracyMultiplier')),
 @('damage','Data/Core/Defs/DamageDefs/Damages_RangedWeapon.xml',"/Defs/DamageDef[defName='Bullet' or defName='Arrow']",@('workerClass','hediff','hediffSkin','hediffSolid','harmAllLayersUntilOutside','overkillPctToDestroyPart','isRanged','armorCategory','harmsHealth','externalViolence','defaultArmorPenetration','defaultStoppingPower','buildingDamageFactor','buildingDamageFactorPassable','buildingDamageFactorImpassable','scaleDamageToBuildingsBasedOnFlammability','plantDamageFactor','corpseDamageFactor')),
 @('stuff','Data/Core/Defs/ThingDefs_Items/Items_Resource_Stuff.xml',"/Defs/ThingDef[defName='WoodLog' or defName='Cloth' or defName='Steel']",@('stuffProps/categories','stuffProps/statFactors','stuffProps/statOffsets','stuffProps/statFactorsQuality','stuffProps/statOffsetsQuality','damageMultipliers')),
 @('injury','Data/Core/Defs/HediffDefs/Hediffs_Local_Injuries.xml',"/Defs/HediffDef[@Name='InjuryBase' or defName='Gunshot' or defName='Cut' or defName='Crack']",@('hediffClass','injuryProps','comps','tendable')),
 @('maneuver','Data/Core/Defs/Maneuvers/Maneuvers.xml',"/Defs/ManeuverDef[defName='Smash' or defName='Poke']",@('requiredCapacity','verb'))
)
function Relative-XPath($leaf,$root){$parts=[Collections.Generic.List[string]]::new();$cursor=$leaf;while($cursor -ne $root){$tag=$cursor.LocalName;$siblings=@($cursor.ParentNode.ChildNodes|Where-Object{$_.NodeType -eq 'Element' -and $_.LocalName -eq $tag});$segment=$tag;if($siblings.Count -gt 1){$segment+='['+([Array]::IndexOf($siblings,$cursor)+1)+']'};$parts.Insert(0,$segment);$cursor=$cursor.ParentNode};return ($parts -join '/')}
$records=[Collections.Generic.List[object]]::new()
foreach($s in $selections){$file=Join-Path $GameRoot $s[1];[xml]$doc=Get-Content -Raw -LiteralPath $file;$sha=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();$nodes=$doc.SelectNodes($s[2]);if(!$nodes.Count){throw "No nodes: $($s[2])"}
 foreach($node in $nodes){$def=$node.SelectSingleNode('defName');$name=if($def){$def.InnerText}else{$node.GetAttribute('Name')};$xp='/Defs/'+$node.LocalName+$(if($def){"[defName='$name']"}else{"[@Name='$name']"});$leaves=[Collections.Generic.List[object]]::new();$attrs=[Collections.Generic.List[object]]::new();$absent=[Collections.Generic.List[string]]::new()
  foreach($selector in $s[3]){$chosen=$node.SelectNodes($selector);if(!$chosen.Count){$absent.Add($selector);continue};foreach($top in $chosen){$scan=@($top)+@($top.SelectNodes('.//*'));foreach($child in $scan){$rel=Relative-XPath $child $node;if($rel -match '/(label|description)$' -and $rel -notmatch '^tools/'){continue};if($child.Attributes.Count){$a=[ordered]@{};foreach($item in $child.Attributes){$a[$item.Name]=$item.Value};$attrs.Add([ordered]@{xpath=$xp+'/'+$rel;attributes=$a})};if(!$child.SelectNodes('*').Count){$leaves.Add([ordered]@{xpath=$xp+'/'+$rel;value=$child.InnerText})}}}}
  $records.Add([ordered]@{group=$s[0];id=$node.LocalName+'_'+$name;def_name=$name;parent_name=$node.GetAttribute('ParentName');name_attribute=$node.GetAttribute('Name');source=[ordered]@{path=$s[1];xpath=$xp;sha256=$sha};selected_paths=$s[3];absent_paths=@($absent.ToArray());fields=@($leaves.ToArray());node_attributes=@($attrs.ToArray())})
 }
}
$result=[ordered]@{evidence_id='RW17-RANGED-XML';version_text=(Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim();assembly_sha256=$assembly;kind='Selected direct Core ranged weapons, projectile, accuracy, weather, cover, research and bench declarations';limitations=@('Reviewed selected inheritance chains; not the enabled-mod effective database.','Source omissions are retained, not silently interpreted as effective values.','Static extraction does not execute original gameplay or project implementation.');records=@($records.ToArray())}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),(($result|ConvertTo-Json -Depth 36) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false));Write-Output "Recorded $($records.Count) selected ranged XML records."
