param([Parameter(Mandatory=$true)][string]$GameRoot,[string]$Output=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/technology-xml.json'))
$ErrorActionPreference='Stop'
$assembly=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Review changed assembly before updating technology evidence.'}
$project=@('baseCost','techLevel','prerequisites','hiddenPrerequisites','requiredResearchBuilding','requiredResearchFacilities','techprintCount','tags','knowledgeCost','requiresMechanitor','requiredAnalyzed','requireGravEngineInspected')
$stat=@('defaultBaseValue','minValue','maxValue','skillNeedFactors','capacityFactors','statFactors','parts')
$gate=@('researchPrerequisites','constructionSkillPrerequisite')
$bench=$gate+@('thingClass','size','graphicData/drawSize','costStuffCount','costList','stuffCategories','statBases/WorkToBuild','statBases/ResearchSpeedFactor','statBases/MaxHitPoints','building/workTableRoomRole','building/workTableNotInRoomRoleFactor','interactionCellOffset','hasInteractionCell','comps','minifiedDef','terrainAffordanceNeeded','passability','pathCost')
$recipe=@('recipeMaker/researchPrerequisite','recipeMaker/researchPrerequisites','recipeMaker/skillRequirements')
$plant=@('plant/sowResearchPrerequisites','plant/sowMinSkill')
$selections=@(
 @('project','ResearchProjectDefs/ResearchProjects_1.xml',"/Defs/ResearchProjectDef[defName='TreeSowing' or defName='Stonecutting' or defName='ComplexClothing' or defName='Smithing' or defName='LongBlades' or tags/li='ClassicStart' or tags/li='TribalStart']",$project),
 @('project','ResearchProjectDefs/ResearchProjects_2_Electricity.xml',"/Defs/ResearchProjectDef[defName='Electricity' or defName='Batteries' or defName='SolarPanels' or defName='AirConditioning' or defName='MicroelectronicsBasics' or tags/li='ClassicStart' or tags/li='TribalStart']",$project),
 @('project','ResearchProjectDefs/ResearchProjects_3_Microelectronics.xml',"/Defs/ResearchProjectDef[defName='HospitalBed']",$project),
 @('project','ResearchProjectDefs/ResearchProjects_4_MultiAnalyzer.xml',"/Defs/ResearchProjectDef[defName='Fabrication' or defName='MultiAnalyzer']",$project),
 @('stat','Stats/Stats_Pawns_WorkGeneral.xml',"/Defs/StatDef[@Name='IntellectualSkillBase' or defName='ResearchSpeed' or defName='WorkSpeedGlobal']",$stat),
 @('stat','Stats/Stats_Building_Special.xml',"/Defs/StatDef[defName='ResearchSpeedFactor']",$stat),
 @('skill','SkillDefs/Skills.xml',"/Defs/SkillDef[defName='Intellectual']",@('skillLabel','disablingWorkTags','neverDisabledBasedOnWorkTypes')),
 @('work','JobDefs/Jobs_Work.xml',"/Defs/JobDef[defName='Research']",@('driverClass','allowOpportunisticPrefix','checkOverrideOnExpire','expiryInterval')),
 @('work','WorkGiverDefs/WorkGivers.xml',"/Defs/WorkGiverDef[defName='Research']",@('giverClass','workType','priorityInType','requiredCapacities','canBeDoneByMechs')),
 @('work','WorkTypeDefs/WorkTypes.xml',"/Defs/WorkTypeDef[defName='Research']",@('naturalPriority','disabledForSlaves','relevantSkills','workTags')),
 @('room','Rooms/RoomStats.xml',"/Defs/RoomStatDef[defName='ResearchSpeedFactor' or defName='ReadingBonus']",@('workerClass','roomlessScore','inputStat','curve')),
 @('room','Rooms/RoomRoles.xml',"/Defs/RoomRoleDef[defName='Laboratory']",@('workerClass','relatedStats')),
 @('difficulty','Misc/DifficultyDefs/Difficulties.xml','/Defs/DifficultyDef',@('label','researchSpeedFactor')),
 @('faction','FactionDefs/Factions_Player.xml',"/Defs/FactionDef[@Name='PlayerFactionBase' or defName='PlayerColony' or defName='PlayerTribe']",@('techLevel','startingResearchTags','startingTechprintsResearchTags')),
 @('scenario','Scenarios/Scenarios_Classic.xml',"/Defs/ScenarioDef[@Name='ScenarioBase' or defName='Crashlanded' or defName='LostTribe']",@('scenario/playerFaction','scenario/parts/li[@Class="ScenPart_StartingResearch"]')),
 @('bench','ThingDefs_Buildings/Buildings_Base.xml',"/Defs/ThingDef[@Name='BuildingBase']",$bench),
 @('bench','ThingDefs_Buildings/Buildings_Production.xml',"/Defs/ThingDef[@Name='BenchBase' or defName='SimpleResearchBench' or defName='HiTechResearchBench']",$bench),
 @('build','ThingDefs_Buildings/Buildings_Production.xml',"/Defs/ThingDef[defName='TableStonecutter' or defName='HandTailoringBench' or defName='ElectricTailoringBench' or defName='FueledSmithy' or defName='ElectricSmithy' or defName='FueledStove' or defName='ElectricStove']",$gate),
 @('build','ThingDefs_Buildings/Buildings_Power.xml',"/Defs/ThingDef[defName='PowerConduit' or defName='WoodFiredGenerator' or defName='SolarGenerator' or defName='Battery']",$gate),
 @('build','ThingDefs_Buildings/Buildings_Temperature.xml',"/Defs/ThingDef[defName='Heater' or defName='Cooler']",$gate),
 @('plant','ThingDefs_Plants/Plants_Bases.xml',"/Defs/ThingDef[@Name='PlantBaseNonEdible' or @Name='PlantBase' or @Name='TreeBase' or @Name='DeciduousTreeBase']",$plant),
 @('plant','ThingDefs_Plants/Plants_Wild_Temperate.xml',"/Defs/ThingDef[defName='Plant_TreeOak' or defName='Plant_TreePine' or defName='Plant_TreeBirch']",$plant),
 @('recipe','ThingDefs_Misc/Weapons/BaseWeapons.xml',"/Defs/ThingDef[@Name='BaseWeapon' or @Name='BaseMeleeWeapon' or @Name='BaseMeleeWeapon_Sharp' or @Name='BaseMeleeWeapon_Sharp_Quality']",$recipe),
 @('recipe','ThingDefs_Misc/Weapons/MeleeMedieval.xml',"/Defs/ThingDef[defName='MeleeWeapon_LongSword']",$recipe),
 @('recipe','ThingDefs_Misc/Apparel_Various.xml',"/Defs/ThingDef[@Name='ApparelBase' or @Name='ApparelMakeableBase' or defName='Apparel_BasicShirt' or defName='Apparel_Pants' or defName='Apparel_Parka' or defName='Apparel_Duster']",$recipe),
 @('recipe','ThingDefs_Misc/Apparel_Headgear.xml',"/Defs/ThingDef[@Name='HatMakeableBase' or defName='Apparel_Tuque']",$recipe)
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
$result=[ordered]@{evidence_id='RW17-TECHNOLOGY-XML';version_text=(Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim();assembly_sha256=$assembly;kind='Selected research projects, starting tags, research stats, benches and gates';limitations=@('Direct declarations and selected inheritance chains; not enabled-mod effective Defs.','Static collection does not execute the original game or prove project equivalence.');records=@($records.ToArray())}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),(($result|ConvertTo-Json -Depth 24) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
Write-Output "Recorded $($records.Count) selected technology XML records."
