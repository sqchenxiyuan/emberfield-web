param([Parameter(Mandatory=$true)][string]$GameRoot,[string]$Output=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/skills-xml.json'))
$ErrorActionPreference='Stop'
$assembly=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Review changed assembly before updating skill evidence.'}
$stat=@('defaultBaseValue','minValue','maxValue','neverDisabled','noSkillOffset','skillNeedFactors','skillNeedOffsets','capacityFactors','capacityOffsets','statFactors','postProcessStatFactors','postProcessCurve','parts')
$build=@('constructionSkillPrerequisite','researchPrerequisites','statBases/WorkToBuild','costStuffCount','stuffCategories')
$plant=@('plant/sowMinSkill','plant/sowResearchPrerequisites','plant/harvestFailable','plant/harvestedThingDef')
$recipe=@('recipeMaker/workSkill','recipeMaker/workSkillLearnPerTick','recipeMaker/workSpeedStat','recipeMaker/unfinishedThingDef','recipeMaker/skillRequirements','recipeMaker/researchPrerequisite','recipeMaker/researchPrerequisites')
$selections=@(
 @('skill','SkillDefs/Skills.xml',"/Defs/SkillDef[defName='Mining' or defName='Construction' or defName='Plants' or defName='Cooking' or defName='Crafting' or defName='Medicine' or defName='Melee']",@('skillLabel','disablingWorkTags','neverDisabledBasedOnWorkTypes')),
 @('stat','Stats/Stats_Pawns_WorkGeneral.xml',"/Defs/StatDef[defName='WorkSpeedGlobal' or defName='MiningSpeed' or defName='MiningYield' or defName='PlantWorkSpeed' or defName='PlantHarvestYield' or defName='ConstructionSpeed' or defName='ConstructSuccessChance']",$stat),
 @('stat','Stats/Stats_Pawns_WorkRecipes.xml',"/Defs/StatDef[defName='GeneralLaborSpeed' or defName='CookSpeed' or defName='FoodPoisonChance']",$stat),
 @('stat','Stats/Stats_Pawns_WorkMedical.xml',"/Defs/StatDef[defName='MedicalTendSpeed' or defName='MedicalTendQuality']",$stat),
 @('stat','Stats/Stats_Pawns_Combat.xml',"/Defs/StatDef[defName='MeleeHitChance' or defName='MeleeDodgeChance']",$stat),
 @('stat','Stats/Stats_Pawns_General.xml',"/Defs/StatDef[defName='GlobalLearningFactor']",$stat),
 @('stat','Stats/Stats_Basics_Special.xml',"/Defs/StatDef[defName='ConstructionSpeedFactor']",$stat),
 @('build','ThingDefs_Buildings/Buildings_Base.xml',"/Defs/ThingDef[@Name='BuildingBase']",$build),
 @('build','ThingDefs_Buildings/Buildings_Production.xml',"/Defs/ThingDef[@Name='BenchBase' or defName='CraftingSpot' or defName='TableStonecutter' or defName='HandTailoringBench' or defName='ElectricTailoringBench' or defName='FueledSmithy' or defName='ElectricSmithy' or defName='FueledStove' or defName='ElectricStove']",$build),
 @('build','ThingDefs_Buildings/Buildings_Power.xml',"/Defs/ThingDef[defName='PowerConduit' or defName='WoodFiredGenerator' or defName='SolarGenerator' or defName='Battery']",$build),
 @('build','ThingDefs_Buildings/Buildings_Temperature.xml',"/Defs/ThingDef[defName='Campfire' or defName='Heater' or defName='Cooler']",$build),
 @('build','ThingDefs_Buildings/Buildings_Structure.xml',"/Defs/ThingDef[@Name='DoorBase' or defName='Door' or defName='Wall']",$build),
 @('build','ThingDefs_Buildings/Buildings_Furniture.xml',"/Defs/ThingDef[@Name='FurnitureBase' or @Name='BedBase' or @Name='BedWithQualityBase' or @Name='ArtableBedBase' or @Name='SansComfortBedBase' or @Name='BasicBedBase' or defName='Bed']",$build),
 @('terrain','TerrainDefs/Terrain_Floors.xml',"/Defs/TerrainDef[@Name='FloorBase' or defName='WoodPlankFloor']",$build),
 @('terrain','TerrainDefs/Terrain_Floors_StoneTile.xml',"/Defs/TerrainDef[@Name='TileStoneBase' or defName='TileGranite']",$build),
 @('stuff','ThingDefs_Items/Items_Resource_Stuff.xml',"/Defs/ThingDef[defName='WoodLog' or defName='Steel' or defName='Cloth']",@('statBases/ConstructionSpeedFactor','stuffProps/statFactors/WorkToBuild','stuffProps/statOffsets/WorkToBuild','stuffProps/statFactors/WorkToMake')),
 @('stuff','ThingDefs_Misc/Various_Stone.xml',"/Defs/ThingDef[@Name='StoneBlocksBase' or defName='BlocksGranite']",@('statBases/ConstructionSpeedFactor','stuffProps/statFactors/WorkToBuild','stuffProps/statOffsets/WorkToBuild')),
 @('plant','ThingDefs_Plants/Plants_Bases.xml',"/Defs/ThingDef[@Name='PlantBaseNonEdible' or @Name='PlantBase' or @Name='TreeBase' or @Name='DeciduousTreeBase']",$plant),
 @('plant','ThingDefs_Plants/Plants_Cultivated_Farm.xml',"/Defs/ThingDef[defName='Plant_Cotton' or defName='Plant_Rice' or defName='Plant_Potato' or defName='Plant_Corn']",$plant),
 @('plant','ThingDefs_Plants/Plants_Wild_Temperate.xml',"/Defs/ThingDef[defName='Plant_TreeOak' or defName='Plant_TreePine' or defName='Plant_TreeBirch']",$plant),
 @('recipe','ThingDefs_Misc/Apparel_Various.xml',"/Defs/ThingDef[@Name='ApparelBase' or @Name='ApparelMakeableBase' or defName='Apparel_BasicShirt' or defName='Apparel_Pants' or defName='Apparel_Parka' or defName='Apparel_Duster']",$recipe),
 @('recipe','ThingDefs_Misc/Apparel_Headgear.xml',"/Defs/ThingDef[@Name='HatMakeableBase' or defName='Apparel_Tuque']",$recipe),
 @('recipe','ThingDefs_Misc/Weapons/BaseWeapons.xml',"/Defs/ThingDef[@Name='BaseWeapon' or @Name='BaseMeleeWeapon' or @Name='BaseMeleeWeapon_Blunt' or @Name='BaseMeleeWeapon_Sharp' or @Name='BaseMeleeWeapon_Sharp_Quality']",$recipe),
 @('recipe','ThingDefs_Misc/Weapons/MeleeNeolithic.xml',"/Defs/ThingDef[defName='MeleeWeapon_Club' or defName='MeleeWeapon_Knife']",$recipe),
 @('recipe','ThingDefs_Misc/Weapons/MeleeMedieval.xml',"/Defs/ThingDef[defName='MeleeWeapon_LongSword']",$recipe),
 @('recipe','RecipeDefs/Recipes_Production.xml',"/Defs/RecipeDef[@Name='MakeStoneBlocksBase']",@('workSkill','workSkillLearnFactor','workSpeedStat','unfinishedThingDef')),
 @('recipe','RecipeDefs/Recipes_Meals.xml',"/Defs/RecipeDef[@Name='CookMealBase' or defName='CookMealSimple']",@('workSkill','workSkillLearnFactor','workSpeedStat','unfinishedThingDef','skillRequirements'))
)
function Relative-XPath($leaf,$root){$parts=[Collections.Generic.List[string]]::new();$cursor=$leaf;while($cursor -ne $root){$tag=$cursor.LocalName;$siblings=@($cursor.ParentNode.ChildNodes|Where-Object{$_.NodeType -eq 'Element' -and $_.LocalName -eq $tag});$segment=$tag;if($siblings.Count -gt 1){$segment+='['+([Array]::IndexOf($siblings,$cursor)+1)+']'};$parts.Insert(0,$segment);$cursor=$cursor.ParentNode};return ($parts -join '/')}
$records=[Collections.Generic.List[object]]::new()
foreach($s in $selections){
 $relative='Data/Core/Defs/'+$s[1];$file=Join-Path $GameRoot $relative;[xml]$doc=Get-Content -Raw -LiteralPath $file;$sha=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();$nodes=$doc.SelectNodes($s[2]);if(!$nodes.Count){throw "No nodes: $($s[2])"}
 foreach($node in $nodes){
  $def=$node.SelectSingleNode('defName');$name=if($def){$def.InnerText}else{$node.GetAttribute('Name')};$xp='/Defs/'+$node.LocalName+$(if($def){"[defName='$name']"}else{"[@Name='$name']"});$leaves=[Collections.Generic.List[object]]::new();$attrs=[Collections.Generic.List[object]]::new();$absent=[Collections.Generic.List[string]]::new()
  foreach($selector in $s[3]){$chosen=$node.SelectNodes($selector);if(!$chosen.Count){$absent.Add($selector);continue};foreach($top in $chosen){$scan=@($top)+@($top.SelectNodes('.//*'));foreach($child in $scan){$rel=Relative-XPath $child $node;if($child.Attributes.Count){$a=[ordered]@{};foreach($item in $child.Attributes){$a[$item.Name]=$item.Value};$attrs.Add([ordered]@{xpath=$xp+'/'+$rel;attributes=$a})};if(!$child.SelectNodes('*').Count){$leaves.Add([ordered]@{xpath=$xp+'/'+$rel;value=$child.InnerText})}}}}
  $records.Add([ordered]@{group=$s[0];id=$node.LocalName+'_'+$name;def_name=$name;parent_name=$node.GetAttribute('ParentName');source=[ordered]@{path=$relative;xpath=$xp;sha256=$sha};selected_paths=$s[3];absent_paths=@($absent.ToArray());fields=@($leaves.ToArray());node_attributes=@($attrs.ToArray())})
 }
}
$result=[ordered]@{evidence_id='RW17-SKILLS-XML';version_text=(Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim();assembly_sha256=$assembly;kind='Selected skills, work stats, recipe XP and skill gates';limitations=@('Direct declarations and reviewed selected inheritance chains, not enabled-mod effective Defs.','No native game execution or project equivalence.');records=@($records.ToArray())}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),(($result|ConvertTo-Json -Depth 24) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
Write-Output "Recorded $($records.Count) selected skill XML records."
