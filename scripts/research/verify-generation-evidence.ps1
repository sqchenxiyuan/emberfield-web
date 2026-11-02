param([Parameter(Mandatory=$true)][string]$GameRoot)
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$evidence=Join-Path $project 'docs/research/rimworld/evidence'
function Read-Json($name) { Get-Content -Raw -LiteralPath (Join-Path $evidence $name) | ConvertFrom-Json }
function Require($condition,$message) { if(!$condition) { throw $message } }
function Near($actual,$expected,$label) { Require ([Math]::Abs([double]$actual-[double]$expected) -lt 0.000001) "$label : $actual != $expected" }
function Clamp01([double]$value) { [Math]::Min([double]1,[Math]::Max([double]0,$value)) }
$manifest=Read-Json 'generation-manifest.json'
$claims=Read-Json 'generation-claims.json'
$snapshot=Read-Json 'generation-xml.json'
$cases=Read-Json 'generation-cases.json'
$originalHash=(Get-FileHash -LiteralPath (Join-Path $GameRoot $manifest.source) -Algorithm SHA256).Hash.ToLowerInvariant()
Require ($originalHash -eq $manifest.source_sha256) 'Original assembly hash differs'
Require ($originalHash -eq $snapshot.assembly_sha256) 'XML snapshot assembly binding differs'
$types=@{};$xmlHashes=@{};$xmlDocs=@{};$codeRefs=0;$xmlRefs=0;$leafCount=0
foreach($t in $manifest.types) {
  $path=Join-Path $project $t.local_file
  $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  Require ($hash -eq $t.sha256) "Derived hash mismatch: $($t.type)"
  $lineCount=((Get-Content -Raw -LiteralPath $path) -split "`n").Count
  Require ($lineCount -eq $t.lines) "Derived line count mismatch: $($t.type)"
  $types[$t.type]=$t
}
foreach($r in $snapshot.records) {
  $s=$r.source
  if(!$xmlHashes.ContainsKey($s.path)) {
    $path=Join-Path $GameRoot $s.path
    $xmlHashes[$s.path]=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    $xmlDocs[$s.path]=[xml](Get-Content -Raw -LiteralPath $path)
  }
  Require ($xmlHashes[$s.path] -eq $s.sha256) "XML hash mismatch: $($s.path)"
  $doc=$xmlDocs[$s.path]
  Require ($null -ne $doc.SelectSingleNode($s.xpath)) "Missing root XPath: $($s.xpath)"
  foreach($field in $r.fields) {
    $node=$doc.SelectSingleNode($field.xpath)
    Require ($null -ne $node -and $node.InnerText -eq $field.value) "XML field mismatch: $($field.xpath)"
    foreach($attr in $field.attributes.PSObject.Properties) {
      Require ($node.GetAttribute($attr.Name) -eq $attr.Value) "XML attribute mismatch: $($field.xpath)"
    }
    $leafCount++
  }
}
foreach($claim in $claims) {
  foreach($s in $claim.sources) {
    if($s.type) {
      $t=$types[$s.type]
      Require ($null -ne $t -and $s.line_start -ge 1 -and $s.line_end -le $t.lines -and $s.line_start -le $s.line_end) "Invalid code range: $($claim.id)"
      $codeRefs++
    } elseif($s.path) {
      Require ($xmlHashes[$s.path] -eq $s.sha256 -and $null -ne $xmlDocs[$s.path].SelectSingleNode($s.xpath)) "Invalid XML ref: $($claim.id)"
      $xmlRefs++
    } else { throw "Unrecognized source: $($claim.id)" }
  }
}
foreach($case in $cases) { foreach($id in $case.claims) { Require ($id -in $claims.id) "Unknown claim in case: $id" } }
Require ($cases.Count -eq 8) 'Review the case validator when changing the case list'
# These verify the documented analytic examples, not a call to the game or a noise/RNG port.
$i=$cases[0].inputs;$e=$cases[0].expected
Near ([Math]::Abs($i.latitude)/90) 0.5 'G01 latitude control point'
$reduction=(Clamp01 (($i.elevation-250)/4750))*40
Near $reduction $e.elevationReduction 'G01 altitude reduction'; Near (7-$reduction+$i.noiseOffset) $e.temperature 'G01 temperature'
$i=$cases[1].inputs;$e=$cases[1].expected
for($n=0;$n -lt $i.rates.Count;$n++) {
  $div=[Math]::Round(10000/($i.rates[$n]*$i.nomadicFactor))
  Near $div $e.cellDivisors[$n] "G02 divisor $n"
  Near ([Math]::Round([Math]::Round($i.mapSizeX*$i.mapSizeX/$div)*$i.placementFactor)) $e.attemptCounts[$n] "G02 count $n"
}
$i=$cases[2].inputs;$e=$cases[2].expected
for($n=0;$n -lt $i.cells.Count;$n++) {
  $cell=$i.cells[$n]
  $terrain=if($cell.e -gt .55 -and $cell.e -lt .61){'Gravel'}elseif($cell.e -ge .61){'naturalStone'}elseif($cell.f -le .87){'Soil'}else{'SoilRich'}
  Require ($terrain -eq $e.terrain[$n]) "G03 terrain $n"
  Require (($cell.e -gt .7 -and $i.caves -le 0) -eq $e.spawnsRock[$n]) "G03 rock $n"
}
$i=$cases[3].inputs;$e=$cases[3].expected;$sum=0.0
foreach($property in $i.weights.PSObject.Properties){$sum+=$property.Value}
Near $sum $e.totalWeight 'G04 weights'; Near ($i.weights.steel/$sum) $e.steelProbability 'G04 steel'; Near ($i.weights.components/$sum) $e.componentProbability 'G04 components'; Near ($i.weights.gold/$sum) $e.goldProbability 'G04 gold'
$i=$cases[4].inputs;$e=$cases[4].expected;$q=0.0
foreach($slice in $i.mining){$q+=($slice.effectiveDamage/$i.maxHP)*$slice.yieldStat}
$base=[Math]::Round($i.baseYield*$i.mineYieldFactor);$pre=$base*$q;$floor=[Math]::Floor($pre);$fraction=$pre-$floor
Near $q $e.yieldPct 'G05 contributions'; Near $base $e.effectiveBase 'G05 difficulty'; Near $pre $e.preRoundYield 'G05 yield'; Near (1-$fraction) $e.outputDistribution.'30' 'G05 lower'; Near $fraction $e.outputDistribution.'31' 'G05 upper'; Near $pre $e.expectedYield 'G05 expectation'
$i=$cases[5].inputs;$e=$cases[5].expected
for($n=0;$n -lt $i.fertilities.Count;$n++) { Near ($i.fertilities[$n]*$i.riceSensitivity+1-$i.riceSensitivity) $e.riceFertilityFactors[$n] "G06 rice $n"; Near ($i.fertilities[$n]*$i.potatoSensitivity+1-$i.potatoSensitivity) $e.potatoFertilityFactors[$n] "G06 potato $n" }
Near ($i.riceGrowDays/$i.activeDayFraction) $e.riceIdealCalendarDaysOnSoil 'G06 calendar idealization'
$i=$cases[6].inputs;$e=$cases[6].expected
$gf=.5+.5*(Clamp01 (($i.growth-$i.minGrowth)/(1-$i.minGrowth)));$hf=.5+.5*$i.hpFraction;$pre=$i.baseYield*$gf*$hf*$i.cropYieldFactor
$pFail=1-$i.harvestStat;$fraction=$pre-[Math]::Floor($pre)
Near $gf $e.growthFactor 'G07 growth'; Near $hf $e.hpFactor 'G07 hp'; Near $pre $e.preRoundYield 'G07 yield'; Near $pFail $e.failProbability 'G07 failure'
Near $pFail $e.outputDistribution.'0' 'G07 zero'; Near ((1-$pFail)*(1-$fraction)) $e.outputDistribution.'3' 'G07 three'; Near ((1-$pFail)*$fraction) $e.outputDistribution.'4' 'G07 four'; Near ($pre*(1-$pFail)) $e.expectedYield 'G07 expectation'
$i=$cases[7].inputs;$e=$cases[7].expected
for($n=0;$n -lt $i.fertilities.Count;$n++){Near ([Math]::Min([double]($i.biomePlantDensity*$i.plantDensityFactor*[Math]::Pow($i.fertilities[$n],2)),[double]1)) $e.desiredPlantsPerCell[$n] "G08 plants $n"}
Near ($i.area*$i.desiredAnimalDensity/10000) $e.desiredAnimalWeight 'G08 animal weight'
$result=[ordered]@{
  evidence_id='RW17-GENERATION-VALIDATION';validated_utc=[DateTime]::UtcNow.ToString('o');
  original_sha256=$originalHash;types=$manifest.types.Count;claims=$claims.Count;code_references=$codeRefs;
  xml_references=$xmlRefs;xml_files=$xmlHashes.Count;xml_records=$snapshot.records.Count;xml_leaves=$leafCount;
  analytic_cases_checked=$cases.Count;status='PASS';
  limitation='Verifies provenance, source locations, selected XML values and analytic examples; does not execute RimWorld or prove semantic equivalence.'
}
$json=($result|ConvertTo-Json -Depth 5) -replace "`r`n","`n"
[IO.File]::WriteAllText((Join-Path $evidence 'generation-validation.json'),$json+"`n",[Text.UTF8Encoding]::new($false))
Write-Output $json
