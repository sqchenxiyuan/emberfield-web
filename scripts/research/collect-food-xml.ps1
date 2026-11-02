param(
  [Parameter(Mandatory=$true)][string]$GameRoot,
  [string]$Output=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/food-xml.json')
)
$ErrorActionPreference='Stop'
$assemblyHash=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assemblyHash -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3') { throw 'Review changed game version before updating food evidence.' }
$selections=@(
  @('recipes','Data/Core/Defs/RecipeDefs/Recipes_Meals.xml',"/Defs/RecipeDef[@Name='CookMealBase' or defName='CookMealSimple' or defName='CookMealSimpleBulk']",@('fixedIngredientFilter','defaultIngredientFilter','workSkill','workAmount','workSpeedStat','workTableSpeedStat','allowMixingIngredients','ingredientValueGetterClass','ingredients','products','requiredGiverWorkType')),
  @('raw_food','Data/Core/Defs/ThingDefs_Items/Items_Resource_RawPlant.xml',"/Defs/ThingDef[@Name='PlantFoodRawBase' or defName='RawRice' or defName='RawPotatoes' or defName='RawCorn']",@('statBases','ingestible','comps')),
  @('meals','Data/Core/Defs/ThingDefs_Items/Items_Food.xml',"/Defs/ThingDef[@Name='MealBaseIngredientless' or @Name='MealCookedIngredientless' or @Name='MealCooked' or defName='MealSimple']",@('statBases','ingestible','comps','stackLimit')),
  @('human','Data/Core/Defs/ThingDefs_Races/Races_Humanlike.xml',"/Defs/ThingDef[defName='Human']",@('statBases','race')),
  @('pawn_base','Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml',"/Defs/ThingDef[@Name='BasePawn']",@('statBases','race')),
  @('adult','Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml',"/Defs/LifeStageDef[defName='HumanlikeAdult']",@('bodySizeFactor','foodMaxFactor','hungerRateFactor')),
  @('nutrition_capacity','Data/Core/Defs/Stats/Stats_Pawns_General.xml',"/Defs/StatDef[defName='MaxNutrition']",@('defaultBaseValue','minValue','parts'))
)
$records=[Collections.Generic.List[object]]::new()
foreach($selection in $selections) {
  $path=Join-Path $GameRoot $selection[1]
  [xml]$doc=Get-Content -Raw -LiteralPath $path
  $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  foreach($node in $doc.SelectNodes($selection[2])) {
    $def=$node.SelectSingleNode('defName');$key=if($def){$def.InnerText}else{$node.GetAttribute('Name')}
    $xpath=if($def){'/Defs/'+$node.LocalName+"[defName='$key']"}else{'/Defs/'+$node.LocalName+"[@Name='$key']"}
    $fields=[Collections.Generic.List[object]]::new()
    foreach($leaf in $node.SelectNodes('.//*[not(*)]')) {
      $parts=[Collections.Generic.List[string]]::new();$cursor=$leaf
      while($cursor -ne $node) {
        $tag=$cursor.LocalName;$siblings=@($cursor.ParentNode.ChildNodes | Where-Object {$_.NodeType -eq 'Element' -and $_.LocalName -eq $tag})
        $segment=$tag;if($siblings.Count -gt 1){$segment+='['+([Array]::IndexOf($siblings,$cursor)+1)+']'}
        $parts.Insert(0,$segment);$cursor=$cursor.ParentNode
      }
      if($parts[0] -notin $selection[3]){continue}
      $rel=$parts -join '/'
      if($rel -match '(?i)graphic|sound|renderTree|blood|nameCategory|description|label'){continue}
      $attrs=[ordered]@{};foreach($attr in $leaf.Attributes){$attrs[$attr.Name]=$attr.Value}
      $fields.Add([ordered]@{xpath=$xpath+'/'+$rel;value=$leaf.InnerText;attributes=$attrs})
    }
    $records.Add([ordered]@{group=$selection[0];id=$key;parent_name=$node.GetAttribute('ParentName');source=[ordered]@{path=$selection[1];xpath=$xpath;sha256=$hash};fields=@($fields.ToArray())})
  }
}
$result=[ordered]@{
  evidence_id='RW17-FOOD-XML';version_text=(Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim();assembly_sha256=$assemblyHash;
  kind='Selected direct declarations, not an effective Def database';
  limitations=@('No mod, patch or enabled DLC evaluation. ParentName retained, not automatically resolved.','Adult hunger/capacity defaults are class defaults; absent direct XML fields are not zero.','Crop declarations reuse generation-xml.json.');
  records=@($records.ToArray())
}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),(($result|ConvertTo-Json -Depth 18) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
Write-Output "Recorded $($records.Count) food XML declarations."
