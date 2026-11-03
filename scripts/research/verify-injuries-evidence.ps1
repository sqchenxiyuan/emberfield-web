param([Parameter(Mandatory=$true)][string]$GameRoot,[string]$DecompilerPath=(Join-Path $PSScriptRoot '../../../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'))
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$evidence=Join-Path $project 'docs/research/rimworld/evidence'
$expected=Get-Content -Raw -LiteralPath (Join-Path $evidence 'injuries-xml.json')|ConvertFrom-Json
if((Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected.assembly_sha256){throw 'Installed assembly identity changed'}
if((Get-FileHash -LiteralPath $DecompilerPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne '587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'){throw 'Decompiler identity changed'}
if((Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim() -ne $expected.version_text){throw 'Installed version changed'}
$files=@($expected.records.source|Select-Object path,sha256 -Unique)
foreach($file in $files){if((Get-FileHash -LiteralPath (Join-Path $GameRoot $file.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256){throw "Installed XML changed: $($file.path)"}}
$freshPath=Join-Path $project '.local-research/injuries/xml-recheck.json'
& (Join-Path $PSScriptRoot 'collect-injuries-xml.ps1') -GameRoot $GameRoot -Output $freshPath
$fresh=Get-Content -Raw -LiteralPath $freshPath|ConvertFrom-Json
if(($expected|ConvertTo-Json -Depth 50 -Compress) -cne ($fresh|ConvertTo-Json -Depth 50 -Compress)){throw 'Fresh XML selection differs from reviewed values, parents, absences or attributes'}
$localOutput=& node (Join-Path $PSScriptRoot 'verify-injuries-evidence.mjs') --local
if($LASTEXITCODE -ne 0){throw 'Local injury evidence verification failed'}
$localResult=($localOutput -join "`n")|ConvertFrom-Json
$portableOutput=& node (Join-Path $PSScriptRoot 'verify-injuries-evidence.mjs')
if($LASTEXITCODE -ne 0){throw 'Portable injury evidence verification failed'}
$portableResult=($portableOutput -join "`n")|ConvertFrom-Json
$negativeOutput=& node (Join-Path $PSScriptRoot 'test-injuries-verifier.mjs')
if($LASTEXITCODE -ne 0){throw 'Negative injury verifier tests failed'}
$negativeResult=($negativeOutput -join "`n")|ConvertFrom-Json
$report=[ordered]@{status='pass';checked_at_utc=[DateTime]::UtcNow.ToString('o');original_game_executed=$false;installed_assembly_sha256=$expected.assembly_sha256;installed_xml_files=$files.Count;fresh_xml_matches=$true;local=$localResult;portable=$portableResult;negative=$negativeResult;scope='Static artifact and independent arithmetic verification. No original game code execution or project simulation equivalence.'}
[IO.File]::WriteAllText((Join-Path $evidence 'injuries-validation.json'),(($report|ConvertTo-Json -Depth 30) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
Write-Output "PASS injuries: installed assembly + $($files.Count) XML files, $($localResult.localDerivedFilesVerified) selected derived files, $($localResult.analyticAssertions) analytic assertions, $($negativeResult.rejected) negative checks."
