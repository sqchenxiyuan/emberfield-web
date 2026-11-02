param([Parameter(Mandatory=$true)][string]$GameRoot)
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$evidence=Join-Path $project 'docs/research/rimworld/evidence'
function Require($ok,$message){if(!$ok){throw $message}}
$snapshot=Get-Content -Raw -LiteralPath (Join-Path $evidence 'housing-xml.json')|ConvertFrom-Json
$originalHash=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
Require ($originalHash -eq $snapshot.assembly_sha256 -and $originalHash -eq 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3') 'Original assembly identity mismatch'
Require ((Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim() -eq $snapshot.version_text) 'Original version mismatch'
$docs=@{};$hashes=@{};$leaves=0
foreach($r in $snapshot.records){
  $s=$r.source
  if(!$docs.ContainsKey($s.path)){
    $path=Join-Path $GameRoot $s.path
    $docs[$s.path]=[xml](Get-Content -Raw -LiteralPath $path)
    $hashes[$s.path]=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  Require ($hashes[$s.path] -eq $s.sha256) "Original XML hash mismatch: $($s.path)"
  $doc=$docs[$s.path];$root=$doc.SelectSingleNode($s.xpath)
  Require ($null -ne $root) "Missing XML declaration: $($r.id)"
  Require ($root.GetAttribute('ParentName') -eq $r.parent_name) "Changed XML parent: $($r.id)"
  foreach($field in $r.fields){
    $node=$doc.SelectSingleNode($field.xpath)
    Require ($null -ne $node -and $node.InnerText -eq $field.value) "Changed XML field: $($field.xpath)"
    Require ($node.Attributes.Count -eq @($field.attributes.PSObject.Properties).Count) "Changed XML attribute count: $($field.xpath)"
    foreach($a in $field.attributes.PSObject.Properties){Require ($node.GetAttribute($a.Name) -eq $a.Value) "Changed XML attribute: $($field.xpath)/@$($a.Name)"}
    $leaves++
  }
}
$nodeJson=& node (Join-Path $PSScriptRoot 'verify-housing-evidence.mjs') --local
if($LASTEXITCODE -ne 0){throw 'Housing portable/local validation failed.'}
$analytic=($nodeJson -join "`n")|ConvertFrom-Json
Require ($analytic.status -eq 'pass') 'Analytic verifier did not report pass'
$result=[ordered]@{
  evidence_id='RW17-HOUSING-VALIDATION';validated_utc=[DateTime]::UtcNow.ToString('o');status='PASS';
  original_sha256=$originalHash;version_text=$snapshot.version_text;original_xml_files=$docs.Count;
  original_xml_records=$snapshot.records.Count;original_xml_leaves=$leaves;portable_and_derived=$analytic;
  original_game_executed=$false;
  limitation='Original assembly/XML identity, selected original XML values, derived hashes, source ranges and independent arithmetic only. No active Def loading, game execution, implementation equivalence or3D geometry validation.'
}
$json=($result|ConvertTo-Json -Depth 8) -replace "`r`n","`n"
[IO.File]::WriteAllText((Join-Path $evidence 'housing-validation.json'),$json+"`n",[Text.UTF8Encoding]::new($false))
Write-Output $json
