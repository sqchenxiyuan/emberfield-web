param([Parameter(Mandatory=$true)][string]$GameRoot,[string]$Output=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/weapons-xml.json'))
$ErrorActionPreference='Stop'
$assembly=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Review changed assembly before updating weapon evidence.'}
$weapon=@('thingClass','equipmentType','useHitPoints','stackLimit','tickerType','statBases','costStuffCount','stuffCategories','recipeMaker','comps','tools','canDeteriorateUnspawned')
$bench=@('thingClass','size','interactionCellOffset','hasInteractionCell','useHitPoints','costList','statBases','constructionSkillPrerequisite','researchPrerequisites','comps','building/workTableRoomRole','building/workTableNotInRoomRoleFactor')
$stat=@('defaultBaseValue','minValue','maxValue','parts','statFactors','skillNeedFactors','capacityFactors','postProcessCurve','roundValue','roundToFiveOver')
$selections=@(
 @('weapon','Data/Core/Defs/ThingDefs_Misc/Weapons/MeleeNeolithic.xml',"/Defs/ThingDef[defName='MeleeWeapon_Club' or defName='MeleeWeapon_Knife']",$weapon),
 @('weapon','Data/Core/Defs/ThingDefs_Misc/Weapons/MeleeMedieval.xml',"/Defs/ThingDef[defName='MeleeWeapon_LongSword']",$weapon),
 @('weapon','Data/Core/Defs/ThingDefs_Misc/Weapons/BaseWeapons.xml',"/Defs/ThingDef[@Name='BaseWeapon' or @Name='BaseMeleeWeapon' or @Name='BaseMeleeWeapon_Blunt' or @Name='BaseMeleeWeapon_Sharp' or @Name='BaseMeleeWeapon_Sharp_Quality']",$weapon),
 @('stuff','Data/Core/Defs/ThingDefs_Items/Items_Resource_Stuff.xml',"/Defs/ThingDef[defName='WoodLog' or defName='Steel']",@('statBases/SharpDamageMultiplier','statBases/BluntDamageMultiplier','stuffProps/categories','stuffProps/statFactors','stuffProps/statOffsets','stuffProps/statFactorsQuality','stuffProps/statOffsetsQuality')),
 @('bench','Data/Core/Defs/ThingDefs_Buildings/Buildings_Production.xml',"/Defs/ThingDef[@Name='BenchBase' or defName='CraftingSpot' or defName='FueledSmithy' or defName='ElectricSmithy']",$bench),
 @('research','Data/Core/Defs/ResearchProjectDefs/ResearchProjects_1.xml',"/Defs/ResearchProjectDef[defName='Smithing' or defName='LongBlades']",@('baseCost','techLevel','prerequisites')),
 @('workgiver','Data/Core/Defs/WorkGiverDefs/WorkGivers.xml',"/Defs/WorkGiverDef[defName='DoBillsMakeWeapons' or defName='DoBillsUseCraftingSpot']",@('giverClass','workType','fixedBillGiverDefs','requiredCapacities','priorityInType')),
 @('stat','Data/Core/Defs/Stats/Stats_Weapons_Melee.xml',"/Defs/StatDef[defName='MeleeWeapon_DamageMultiplier' or defName='MeleeWeapon_CooldownMultiplier' or defName='SharpDamageMultiplier' or defName='BluntDamageMultiplier']",$stat),
 @('stat','Data/Core/Defs/Stats/Stats_Basics_General.xml',"/Defs/StatDef[defName='MaxHitPoints' or defName='WorkToMake' or defName='DeteriorationRate']",$stat),
 @('stat','Data/Core/Defs/Stats/Stats_Building_Special.xml',"/Defs/StatDef[defName='WorkTableWorkSpeedFactor']",$stat),
 @('stat','Data/Core/Defs/Stats/Stats_Pawns_WorkRecipes.xml',"/Defs/StatDef[defName='GeneralLaborSpeed']",$stat),
 @('maneuver','Data/Core/Defs/Maneuvers/Maneuvers.xml',"/Defs/ManeuverDef[defName='Poke' or defName='Smash' or defName='Slash' or defName='Stab' or defName='Bite']",@('requiredCapacity','verb')),
 @('damage','Data/Core/Defs/DamageDefs/Damages_MeleeWeapon.xml',"/Defs/DamageDef[defName='Poke' or defName='Blunt']",@('workerClass','hediff','hediffSkin','hediffSolid','armorCategory','stabChanceOfForcedInternal')),
 @('human','Data/Core/Defs/ThingDefs_Races/Races_Humanlike.xml',"/Defs/ThingDef[defName='Human']",@('tools')),
 @('capacity','Data/Core/Defs/PawnCapacityDefs/PawnCapacity.xml',"/Defs/PawnCapacityDef[defName='Manipulation']",@('workerClass','minForCapable','zeroIfCannotBeAwake')),
 @('job','Data/Core/Defs/JobDefs/Jobs_Misc.xml',"/Defs/JobDef[defName='Equip' or defName='DropEquipment']",@('driverClass','casualInterruptible','playerInterruptible','alwaysShowWeapon')),
 @('unfinished','Data/Core/Defs/ThingDefs_Items/Items_Unfinished.xml',"/Defs/ThingDef[@Name='UnfinishedBase' or defName='UnfinishedWeapon']",@('thingClass','statBases','stuffCategories','comps','useHitPoints','stackLimit'))
)
function Relative-XPath($leaf,$root){$parts=[Collections.Generic.List[string]]::new();$cursor=$leaf;while($cursor -ne $root){$tag=$cursor.LocalName;$siblings=@($cursor.ParentNode.ChildNodes|Where-Object{$_.NodeType -eq 'Element' -and $_.LocalName -eq $tag});$segment=$tag;if($siblings.Count -gt 1){$segment+='['+([Array]::IndexOf($siblings,$cursor)+1)+']'};$parts.Insert(0,$segment);$cursor=$cursor.ParentNode};return ($parts -join '/')}
$records=[Collections.Generic.List[object]]::new()
foreach($s in $selections){
 $file=Join-Path $GameRoot $s[1];[xml]$doc=Get-Content -Raw -LiteralPath $file;$sha=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();$nodes=$doc.SelectNodes($s[2]);if(!$nodes.Count){throw "No nodes: $($s[2])"}
 foreach($node in $nodes){
  $def=$node.SelectSingleNode('defName');$name=if($def){$def.InnerText}else{$node.GetAttribute('Name')};$xp='/Defs/'+$node.LocalName+$(if($def){"[defName='$name']"}else{"[@Name='$name']"});$leaves=[Collections.Generic.List[object]]::new();$attrs=[Collections.Generic.List[object]]::new();$absent=[Collections.Generic.List[string]]::new()
  foreach($selector in $s[3]){$chosen=$node.SelectNodes($selector);if(!$chosen.Count){$absent.Add($selector);continue};foreach($top in $chosen){$scan=@($top)+@($top.SelectNodes('.//*'));foreach($child in $scan){$rel=Relative-XPath $child $node;if($child.Attributes.Count){$a=[ordered]@{};foreach($item in $child.Attributes){$a[$item.Name]=$item.Value};$attrs.Add([ordered]@{xpath=$xp+'/'+$rel;attributes=$a})};if(!$child.SelectNodes('*').Count){$leaves.Add([ordered]@{xpath=$xp+'/'+$rel;value=$child.InnerText})}}}}
  $records.Add([ordered]@{group=$s[0];id=$node.LocalName+'_'+$name;def_name=$name;parent_name=$node.GetAttribute('ParentName');source=[ordered]@{path=$s[1];xpath=$xp;sha256=$sha};selected_paths=$s[3];absent_paths=@($absent.ToArray());fields=@($leaves.ToArray());node_attributes=@($attrs.ToArray())})
 }
}
$result=[ordered]@{evidence_id='RW17-WEAPONS-XML';version_text=(Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim();assembly_sha256=$assembly;kind='Selected weapon, recipe, material, bench and equipment declarations';limitations=@('Selected direct declarations and reviewed parent chains; not enabled-mod effective Defs.','No native game execution or project equivalence.');records=@($records.ToArray())}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),(($result|ConvertTo-Json -Depth 24) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
Write-Output "Recorded $($records.Count) selected weapon XML records."
