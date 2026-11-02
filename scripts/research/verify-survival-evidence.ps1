param([Parameter(Mandatory=$true)][string]$GameRoot)
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$evidence=Join-Path $project 'docs/research/rimworld/evidence'
function Require($ok,$message){if(!$ok){throw $message}}
# Validate all metadata paths before opening originals; no game assembly is loaded.
$nodeOutput=& node (Join-Path $PSScriptRoot 'verify-survival-evidence.mjs') --local
if($LASTEXITCODE -ne 0){throw 'Survival portable/local verification failed.'}
$analytic=($nodeOutput -join "`n")|ConvertFrom-Json
Require ($analytic.status -eq 'pass') 'Survival verifier did not pass'
$snapshot=Get-Content -Raw -LiteralPath (Join-Path $evidence 'survival-xml.json')|ConvertFrom-Json
$sourceHash=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
Require ($sourceHash -eq 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3' -and $sourceHash -eq $snapshot.assembly_sha256) 'Original assembly mismatch'
Require ((Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim() -eq $snapshot.version_text) 'Original version mismatch'
$docs=@{};$hashes=@{};$leaves=0;$attributeNodes=0;$absence=0
foreach($r in $snapshot.records){$s=$r.source
 if(!$docs.ContainsKey($s.path)){$file=Join-Path $GameRoot $s.path;$docs[$s.path]=[xml](Get-Content -Raw -LiteralPath $file);$hashes[$s.path]=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
 Require ($hashes[$s.path] -eq $s.sha256) "Original XML hash mismatch: $($s.path)"
 $doc=$docs[$s.path];$root=$doc.SelectSingleNode($s.xpath);Require ($null -ne $root) "Missing original node: $($r.id)";Require ($root.GetAttribute('ParentName') -eq $r.parent_name) "Changed parent: $($r.id)"
 foreach($p in $r.selected_paths){$missing=$null -eq $root.SelectSingleNode($p);Require ($missing -eq ($p -in $r.absent_paths)) "Changed selected path presence: $($r.id)/$p";if($missing){$absence++}}
 foreach($f in $r.fields){$node=$doc.SelectSingleNode($f.xpath);Require ($null -ne $node -and $node.InnerText -eq $f.value) "Changed XML value: $($f.xpath)";$leaves++}
 foreach($a in $r.node_attributes){$node=$doc.SelectSingleNode($a.xpath);Require ($null -ne $node -and $node.Attributes.Count -eq @($a.attributes.PSObject.Properties).Count) "Changed attributes: $($a.xpath)";foreach($attr in $a.attributes.PSObject.Properties){Require ($node.GetAttribute($attr.Name) -eq $attr.Value) "Changed attribute: $($a.xpath)/@$($attr.Name)"};$attributeNodes++}
}
$result=[ordered]@{evidence_id='RW17-SURVIVAL-VALIDATION';validated_utc=[DateTime]::UtcNow.ToString('o');status='PASS';version_text=$snapshot.version_text;original_sha256=$sourceHash;original_xml_files=$docs.Count;xml_record_selections=$snapshot.records.Count;original_xml_leaves=$leaves;original_xml_attribute_nodes=$attributeNodes;original_xml_absence_checks=$absence;portable_and_derived=$analytic;original_game_executed_by_verifier=$false;limitation='Original source/version, selected direct XML leaves, attributes, absence and parent metadata, derived hashes and independent math/branches are checked. No enabled-mod Def database, native gameplay, complete medicine/body/apparel model or project implementation equivalence.'}
$json=($result|ConvertTo-Json -Depth 8) -replace "`r`n","`n";[IO.File]::WriteAllText((Join-Path $evidence 'survival-validation.json'),$json+"`n",[Text.UTF8Encoding]::new($false));Write-Output $json
