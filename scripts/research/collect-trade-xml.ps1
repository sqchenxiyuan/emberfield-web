param([Parameter(Mandatory=$true)][string]$GameRoot,[string]$Output=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/trade-xml.json'))
$ErrorActionPreference='Stop'
$assembly=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Review changed assembly before updating trade evidence.'}
# Index Core declarations, then close every selected ParentName chain. This is
# not RimWorld's patch/loading engine and intentionally preserves MayRequire.
$seeds=[ordered]@{
 ThingDef=@('WoodLog','Steel','BlocksGranite','ChunkGranite','Cloth','ComponentIndustrial','MealSurvivalPack','RawRice','RawPotatoes','RawCorn','MealSimple','MedicineHerbal','MedicineIndustrial','Silver','MeleeWeapon_Club','MeleeWeapon_Knife','MeleeWeapon_LongSword','Bow_Short','Gun_Revolver','Gun_MachinePistol','Gun_BoltActionRifle','Apparel_Tuque','Apparel_Parka','Apparel_Duster','Apparel_BasicShirt','Apparel_Pants','Apparel_SimpleHelmet','Apparel_PlateArmor')
 PawnKindDef=@('Town_Trader','Villager','Town_Guard','Grenadier_Destructive','Mercenary_Slasher','Mercenary_Gunner','Mercenary_Elite','Muffalo','Dromedary','Alpaca','Elephant')
 StatDef=@('MarketValue','WorkToMake','WorkToBuild','SellPriceFactor','TradePriceImprovement','NegotiationAbility')
 TraderKindDef=@('Caravan_Outlander_BulkGoods','Caravan_Outlander_CombatSupplier')
 ThingCategoryDef=@('FoodRaw','Textiles','Drugs','BuildingsFurniture','WeaponsMelee','ResourcesRaw','StoneBlocks','Chunks','FoodMeals','Medicine','Apparel','WeaponsRanged')
 StorytellerDef=@('Cassandra','Phoebe','Randy')
 DifficultyDef=@('Peaceful','Easy','Medium','Rough','Hard','Extreme')
 FactionDef=@('OutlanderCivil')
 IncidentDef=@('TraderCaravanArrival')
 ThingSetMakerDef=@('TraderStock')
}
$paths=[ordered]@{
 ThingDef=@('thingClass','category','techLevel','tradeability','tradeNeverStack','tradeNeverGenerateStacked','genericMarketSellable','stackLimit','smallVolume','useHitPoints','healthAffectsPrice','startingHpRange','statBases','costList','costStuffCount','stuffCategories','stuffProps/volumePerUnit','thingCategories','tradeTags','weaponTags','apparel/tags','comps')
 PawnKindDef=@('race','combatPower','trader','weaponMoney','weaponTags','weaponStuffOverride','itemQuality','gearHealthRange','apparelMoney','apparelTags','biocodeWeaponChance','maxPerGroup','factionLeader','requiredWorkTags','forceNormalGearQuality','forceWeaponQuality','minApparelQuality','maxApparelQuality','specificApparelRequirements','factionHostileOnKill','factionHostileOnDeath')
 StatDef=@('workerClass','defaultBaseValue','minValue','maxValue','parts','roundToFiveOver','roundValue','skillNeedFactors','capacityFactors')
 TraderKindDef=@('orbital','tradeCurrency','commonality','category','hideThingsNotWillingToTrade','stockGenerators')
 ThingCategoryDef=@('parent')
 StorytellerDef=@('comps')
 DifficultyDef=@('tradePriceFactorLoss')
 FactionDef=@('maxPawnCostPerTotalPointsCurve','caravanTraderKinds','pawnGroupMakers','humanlikeFaction','techLevel','permanentEnemy','canMakeRandomly')
 IncidentDef=@('category','workerClass','baseChance','targetTags','minRefireDays','requireColonistsPresent')
 ThingSetMakerDef=@('root')
}
$byDef=@{};$byName=@{}
foreach($file in Get-ChildItem -LiteralPath (Join-Path $GameRoot 'Data/Core/Defs') -Recurse -Filter '*.xml' -File){
 [xml]$doc=Get-Content -Raw -LiteralPath $file.FullName
 foreach($node in $doc.SelectNodes('/Defs/*')){
  if(!$seeds.Contains($node.LocalName)){continue}
  $entry=@{node=$node;file=$file.FullName}
  $dn=if($node.GetAttribute('Abstract') -ieq 'true'){$null}else{$node.SelectSingleNode('defName')};if($dn){$key=$node.LocalName+':'+$dn.InnerText;if(!$byDef.ContainsKey($key)){$byDef[$key]=[Collections.Generic.List[object]]::new()};$byDef[$key].Add($entry)}
  $nm=$node.GetAttribute('Name');if($nm){$key=$node.LocalName+':'+$nm;if(!$byName.ContainsKey($key)){$byName[$key]=[Collections.Generic.List[object]]::new()};$byName[$key].Add($entry)}
 }
}
$selected=[Collections.Generic.List[object]]::new();$seen=@{}
function Add-Entry($entry){
 $node=$entry.node;$dn=if($node.GetAttribute('Abstract') -ieq 'true'){$null}else{$node.SelectSingleNode('defName')};$name=if($dn){$dn.InnerText}else{$node.GetAttribute('Name')};$key=$node.LocalName+':'+$name
 if($seen.ContainsKey($key)){return};$seen[$key]=$true;$selected.Add($entry)
 if($node.LocalName -eq 'ThingCategoryDef'){$catParent=$node.SelectSingleNode('parent');if($catParent){$ck='ThingCategoryDef:'+$catParent.InnerText;if(!$byDef.ContainsKey($ck) -or $byDef[$ck].Count -ne 1){throw "Missing category parent $ck"};Add-Entry $byDef[$ck][0]}}
 if($node.LocalName -eq 'ThingDef'){foreach($cat in $node.SelectNodes('thingCategories/li')){$ck='ThingCategoryDef:'+$cat.InnerText;if(!$byDef.ContainsKey($ck) -or $byDef[$ck].Count -ne 1){throw "Missing item category $ck"};Add-Entry $byDef[$ck][0]}}
 $pn=$node.GetAttribute('ParentName');if($pn){$pk=$node.LocalName+':'+$pn;if(!$byName.ContainsKey($pk) -or $byName[$pk].Count -ne 1){throw "Ambiguous or missing parent $pk"};Add-Entry $byName[$pk][0]}
}
foreach($type in $seeds.Keys){foreach($name in $seeds[$type]){$key=$type+':'+$name;if(!$byDef.ContainsKey($key) -or $byDef[$key].Count -ne 1){throw "Ambiguous or missing seed $key"};Add-Entry $byDef[$key][0]}}
function Relative-XPath($leaf,$root){$p=[Collections.Generic.List[string]]::new();$c=$leaf;while($c -ne $root){$tag=$c.LocalName;$ss=@($c.ParentNode.ChildNodes|Where-Object{$_.NodeType -eq 'Element' -and $_.LocalName -eq $tag});$s=$tag;if($ss.Count -gt 1){$s+='['+([Array]::IndexOf($ss,$c)+1)+']'};$p.Insert(0,$s);$c=$c.ParentNode};return $p -join '/'}
$records=[Collections.Generic.List[object]]::new();$fileCache=@{}
foreach($entry in $selected){
 $node=$entry.node;$file=$entry.file
 if(!$fileCache.ContainsKey($file)){$fileCache[$file]=@{lines=@(Get-Content -LiteralPath $file);sha=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}}
 $rawLines=$fileCache[$file].lines;$dn=if($node.GetAttribute('Abstract') -ieq 'true'){$null}else{$node.SelectSingleNode('defName')};$name=if($dn){$dn.InnerText}else{$node.GetAttribute('Name')};$xp='/Defs/'+$node.LocalName+$(if($dn){"[defName='$name']"}else{"[@Name='$name']"})
 $leaves=[Collections.Generic.List[object]]::new();$attrs=[Collections.Generic.List[object]]::new();$absent=[Collections.Generic.List[string]]::new()
 foreach($selector in $paths[$node.LocalName]){$chosen=$node.SelectNodes($selector);if(!$chosen.Count){$absent.Add($selector);continue};foreach($top in $chosen){foreach($child in (@($top)+@($top.SelectNodes('.//*')))){$rel=Relative-XPath $child $node;if($rel -match '/(label|description|texPath|shaderType|graphicClass)$'){continue};if($child.Attributes.Count){$a=[ordered]@{};foreach($item in $child.Attributes){$a[$item.Name]=$item.Value};$attrs.Add([ordered]@{xpath=$xp+'/'+$rel;attributes=$a})};if(!$child.SelectNodes('*').Count){$leaves.Add([ordered]@{xpath=$xp+'/'+$rel;value=$child.InnerText})}}}}
 $pattern=if($dn){'<defName>\s*'+[regex]::Escape($name)+'\s*</defName>'}else{'<'+$node.LocalName+'\b[^>]*\bName="'+[regex]::Escape($name)+'"'}
 $matches=@(for($i=0;$i -lt $rawLines.Count;$i++){if($rawLines[$i] -match $pattern){$i}});if($matches.Count -gt 1 -and $dn){$matches=@($matches|Where-Object{$a=$_;while($a -gt 0 -and $rawLines[$a] -notmatch '^\s*<[A-Z]\w*Def(?:\s|>)'){$a--};$rawLines[$a] -match ('^\s*<'+$node.LocalName+'(?:\s|>)') -and $rawLines[$a] -notmatch 'Abstract="[Tt]rue"'})};if($matches.Count -ne 1){throw "Ambiguous XML line anchor $xp"}
 $first=[int]$matches[0];while($first -gt 0 -and $rawLines[$first] -notmatch ('^\s*<'+$node.LocalName+'(?:\s|>)')){$first--};$last=$first;while($last -lt $rawLines.Count -and $rawLines[$last] -notmatch ('</'+$node.LocalName+'\s*>')){$last++};if($last -ge $rawLines.Count){throw "Missing closing XML $xp"}
 $records.Add([ordered]@{id=$node.LocalName+'_'+$name;type=$node.LocalName;def_name=$name;parent_name=$node.GetAttribute('ParentName');name_attribute=$node.GetAttribute('Name');source=[ordered]@{path=[IO.Path]::GetRelativePath($GameRoot,$file).Replace('\','/');xpath=$xp;sha256=$fileCache[$file].sha;line_start=$first+1;line_end=$last+1};selected_paths=$paths[$node.LocalName];absent_paths=@($absent.ToArray());fields=@($leaves.ToArray());node_attributes=@($attrs.ToArray())})
}
$result=[ordered]@{evidence_id='RW17-TRADE-XML';version_text=(Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim();assembly_sha256=$assembly;kind='Selected direct Core declarations with every ParentName chain closed';limitations=@('Not effective mod database or patch engine.','Parent closure is structural; selected fields preserve absent paths and MayRequire.','Runtime generated corpse/frame definitions are separately reconstructed from source.');seeds=$seeds;records=@($records.ToArray())}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),(($result|ConvertTo-Json -Depth 40) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false));Write-Output "Recorded $($records.Count) selected trade XML records with closed parent chains."
