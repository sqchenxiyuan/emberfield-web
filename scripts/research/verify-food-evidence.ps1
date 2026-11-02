param([Parameter(Mandatory=$true)][string]$GameRoot)
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$evidence=Join-Path $project 'docs/research/rimworld/evidence'
function Read-Json($name){Get-Content -Raw -LiteralPath (Join-Path $evidence $name)|ConvertFrom-Json}
function Require($ok,$message){if(!$ok){throw $message}}
$script:analyticAssertions=0
function Near($actual,$expected,$label){$script:analyticAssertions++;Require ([Math]::Abs([double]$actual-[double]$expected) -lt 0.000001) "$label : $actual != $expected"}
function Same($actual,$expected,$label){$script:analyticAssertions++;Require ($actual -eq $expected) "$label : $actual != $expected"}
function Clamp01([double]$v){[Math]::Max([double]0,[Math]::Min([double]1,$v))}
$manifests=@{food=(Read-Json 'food-manifest.json');generation=(Read-Json 'generation-manifest.json')}
$snapshots=@{food=(Read-Json 'food-xml.json');generation=(Read-Json 'generation-xml.json')}
$claims=Read-Json 'food-claims.json';$cases=Read-Json 'food-cases.json'
$originalHash=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
foreach($g in @('food','generation')){
  Require ($originalHash -eq $manifests[$g].source_sha256 -and $originalHash -eq $snapshots[$g].assembly_sha256) "Assembly binding mismatch: $g"
}
$typeIndex=@{};$recordIndex=@{};$checkedTypes=@{};$checkedRecords=@{};$xmlDocs=@{};$xmlHashes=@{};$codeRefs=0;$xmlRefs=0;$leafCount=0
foreach($g in @('food','generation')){
  foreach($t in $manifests[$g].types){$typeIndex[$g+':'+$t.type]=$t}
  foreach($r in $snapshots[$g].records){$recordIndex[$g+':'+$r.id]=$r}
}
$wantedTypeKeys=@($manifests.food.types|ForEach-Object{'food:'+$_.type})+@($claims.sources|Where-Object{$_.type}|ForEach-Object{$_.group+':'+$_.type})
foreach($key in @($wantedTypeKeys|Select-Object -Unique)){
  $t=$typeIndex[$key];Require ($null -ne $t) "Missing type: $key"
  $path=Join-Path $project $t.local_file
  Require ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -eq $t.sha256) "Derived hash mismatch: $key"
  Require (((Get-Content -Raw -LiteralPath $path) -split "`n").Count -eq $t.lines) "Line count mismatch: $key"
  $checkedTypes[$key]=$true
}
$wantedRecordKeys=@($snapshots.food.records|ForEach-Object{'food:'+$_.id})+@($claims.sources|Where-Object{$_.xml_record}|ForEach-Object{$_.group+':'+$_.xml_record})
foreach($key in @($wantedRecordKeys|Select-Object -Unique)){
  $r=$recordIndex[$key];Require ($null -ne $r) "Missing XML record: $key"
  $s=$r.source
  if(!$xmlDocs.ContainsKey($s.path)){
    $path=Join-Path $GameRoot $s.path
    $xmlDocs[$s.path]=[xml](Get-Content -Raw -LiteralPath $path)
    $xmlHashes[$s.path]=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  Require ($xmlHashes[$s.path] -eq $s.sha256) "XML hash mismatch: $($s.path)"
  $doc=$xmlDocs[$s.path];$root=$doc.SelectSingleNode($s.xpath)
  Require ($null -ne $root) "Missing XML node: $key"
  Require ($root.GetAttribute('ParentName') -eq $r.parent_name) "XML parent mismatch: $key"
  foreach($field in $r.fields){
    $node=$doc.SelectSingleNode($field.xpath)
    Require ($null -ne $node -and $node.InnerText -eq $field.value) "XML value mismatch: $($field.xpath)"
    foreach($attr in $field.attributes.PSObject.Properties){Require ($node.GetAttribute($attr.Name) -eq $attr.Value) "XML attribute mismatch: $($field.xpath)"}
    $leafCount++
  }
  $checkedRecords[$key]=$true
}
foreach($claim in $claims){foreach($s in $claim.sources){
  if($s.type){
    $t=$typeIndex[$s.group+':'+$s.type]
    Require ($null -ne $t -and $s.line_start -ge 1 -and $s.line_start -le $s.line_end -and $s.line_end -le $t.lines) "Bad source range: $($claim.id)"
    $codeRefs++
  }elseif($s.xml_record){Require $checkedRecords[$s.group+':'+$s.xml_record] "Bad XML reference: $($claim.id)";$xmlRefs++}
  else{throw "Unknown source in $($claim.id)"}
}}
foreach($case in $cases){foreach($id in $case.claims){Require ($id -in $claims.id) "Unknown case claim: $id"}}
Require ($cases.Count -eq 9) 'Update analytic validator for changed case count'
# Analytic reference examples only. This never loads or executes the game assembly.
$i=$cases[0].inputs;$e=$cases[0].expected
for($a=0;$a -lt $i.sensitivities.Count;$a++){for($b=0;$b -lt $i.fertility.Count;$b++){Near ($i.fertility[$b]*$i.sensitivities[$a]+1-$i.sensitivities[$a]) $e.fertilityFactors[$a][$b] "F01 fertility $a/$b"}}
for($a=0;$a -lt $i.light.Count;$a++){Near (Clamp01 (($i.light[$a]-.51)/.49)) $e.lightFactors[$a] "F01 light $a"}
for($a=0;$a -lt $i.temperature.Count;$a++){$t=$i.temperature[$a];$factor=if($t -lt 6){Clamp01 ($t/6)}elseif($t -gt 42){Clamp01 ((58-$t)/16)}else{1};Near $factor $e.temperatureFactors[$a] "F01 temperature $a"}
$i=$cases[1].inputs;$e=$cases[1].expected
for($a=0;$a -lt $i.growDays.Count;$a++){$days=$i.growDays[$a]*$i.referenceGrowth/($i.activeDayFraction*$i.factor);Near $days $e.calendarDays[$a] "F02 days $a";Near ($days*10) $e.currentMinutes[$a] "F02 minutes $a"}
$i=$cases[2].inputs;$e=$cases[2].expected;$left=[double]$i.requiredNutrition;$count=0
for($a=0;$a -lt $i.availableStacks.Count;$a++){$taken=[Math]::Min([Math]::Ceiling($left/$i.rawNutrition),$i.availableStacks[$a]);Near $taken $e.selected[$a] "F03 stack $a";$count+=$taken;$left-=$taken*$i.rawNutrition}
Near $count $e.rawCount 'F03 raw count';Near ($count*$i.rawNutrition) $e.inputNutrition 'F03 input';Near $i.mealNutrition $e.outputNutrition 'F03 output';Near ($i.mealNutrition/$i.requiredNutrition) $e.ratio 'F03 ratio'
$i=$cases[3].inputs;$e=$cases[3].expected;$ticks=$i.work/($i.workerRate*$i.tableRate)
Near $ticks $e.originalTicks 'F04 original ticks';Near ($ticks/$i.originalTPS) $e.originalSeconds 'F04 seconds';Near ($ticks*$i.currentTPS/$i.originalTPS) $e.currentTicksPreserveSeconds 'F04 preserve seconds';Near ($ticks*$i.currentDay/$i.originalDay) $e.currentTicksPreserveDay 'F04 preserve day';Near ($ticks/$i.currentTPS) $e.currentSecondsKeepWork 'F04 unchanged work'
$i=$cases[4].inputs;$e=$cases[4].expected
for($a=0;$a -lt $i.foodLevels.Count;$a++){
  $v=$i.foodLevels[$a];$cat=if($v -le 0){'Starving'}elseif($v -lt $i.wantEat*.4){'UrgentlyHungry'}elseif($v -lt $i.wantEat*.8){'Hungry'}else{'Fed'}
  $m=switch($cat){Fed{1} Hungry{.5} UrgentlyHungry{.25} Starving{0}}
  Same ($v -lt $i.wantEat) $e.wantEat[$a] "F05 want $a";Same $cat $e.categories[$a] "F05 category $a";Near $m $e.multipliers[$a] "F05 multiplier $a";Near ($m*$i.basePerDay) $e.perDay[$a] "F05 daily $a"
}
$i=$cases[5].inputs;$e=$cases[5].expected
for($a=0;$a -lt $i.levels.Count;$a++){$taken=[Math]::Max(1,[Math]::Min($i.maxNumToIngest,[Math]::Ceiling(($i.maxNutrition-$i.levels[$a])/$i.mealNutrition)));$raw=$i.levels[$a]+$taken*$i.mealNutrition;$after=[Math]::Min($raw,$i.maxNutrition);Near $taken $e.itemsTaken[$a] "F06 taken $a";Near $after $e.after[$a] "F06 after $a";Near ($raw-$after) $e.overflow[$a] "F06 overflow $a"}
$i=$cases[6].inputs;$e=$cases[6].expected
Near ($i.originalDay/$i.originalTPS) $e.originalSecondsPerDay 'F07 original day';Near ($i.currentDay/$i.currentTPS) $e.currentSecondsPerDay 'F07 current day';Near ($i.originalDay/$i.currentDay) $e.dayRateMultiplier 'F07 multiplier';Near ($i.hungerPerDay/$i.originalDay) $e.originalHungerPerTick 'F07 original hunger';Near ($i.hungerPerDay/$i.currentDay) $e.currentHungerPerTick 'F07 current hunger';Near (1/($i.originalDay*$i.growDays)) $e.originalGrowthPerActiveTick 'F07 original growth';Near (1/($i.currentDay*$i.growDays)) $e.currentGrowthPerActiveTick 'F07 current growth'
$i=$cases[7].inputs;$e=$cases[7].expected;$person=$i.hungerPerDay/($i.maxNutrition-$i.nearEatThreshold);$colony=$person*$i.colonists
Near ($i.hungerPerDay/$i.mealNutrition) $e.idealMealsPerPersonDay 'F08 ideal';Near $person $e.nearThresholdMealsPerPersonDay 'F08 actual limiting cycle';Near $colony $e.colonyMealsPerDay 'F08 colony';Near ($i.startMeals/$colony) $e.stockDaysAtSteadyRate 'F08 stock';Near ($colony*$i.rawPerMeal) $e.colonyRawPerDay 'F08 raw demand'
$i=$cases[8].inputs;$e=$cases[8].expected
for($a=0;$a -lt $i.amplitudes.Count;$a++){
  $sum=0.0
  for($k=0;$k -lt $i.samples;$k++){
    $hour=($k+.5)*24/$i.samples
    $light=if($hour -lt $i.sunriseHour -or $hour -gt $i.sunsetHour){0}else{[Math]::Min([double]1,$i.amplitudes[$a]*[Math]::Sin([Math]::PI*($hour-$i.sunriseHour)/($i.sunsetHour-$i.sunriseHour)))}
    $sum+=(Clamp01 (($light-.51)/.49))/$i.samples
  }
  $days=$i.growDays/$sum
  Near $sum $e.dailyAverageGrowthFactors[$a] "F09 daily factor $a";Near $days $e.idealRiceDays[$a] "F09 rice days $a";Near ([Math]::Ceiling($i.colonyRawPerDay/($i.harvestYield/$days))) $e.minimumRiceTiles[$a] "F09 land $a"
}
$result=[ordered]@{evidence_id='RW17-FOOD-VALIDATION';validated_utc=[DateTime]::UtcNow.ToString('o');original_sha256=$originalHash;food_types=$manifests.food.types.Count;reused_generation_types=$checkedTypes.Count-$manifests.food.types.Count;claims=$claims.Count;code_references=$codeRefs;xml_references=$xmlRefs;xml_files=$xmlDocs.Count;xml_records=$checkedRecords.Count;xml_leaves=$leafCount;analytic_cases_checked=$cases.Count;analytic_assertions=$script:analyticAssertions;status='PASS';limitation='Checks provenance, source ranges, selected XML declarations and independent analytic examples. No game execution or active Def database; not implementation equivalence.'}
$json=($result|ConvertTo-Json -Depth 6) -replace "`r`n","`n"
[IO.File]::WriteAllText((Join-Path $evidence 'food-validation.json'),$json+"`n",[Text.UTF8Encoding]::new($false))
Write-Output $json
