param([Parameter(Mandatory=$true)][string]$GameRoot,[Parameter(Mandatory=$true)][string]$DecompilerPath)
$ErrorActionPreference='Stop'
$types=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/preservation-types.json')|ConvertFrom-Json
& (Join-Path $PSScriptRoot 'extract-rimworld.ps1') -GameRoot $GameRoot -DecompilerPath $DecompilerPath -Group preservation -Types $types
# Reuse matching derived files. A clean checkout can reconstruct the five
# referenced types without rewriting the other groups' public manifests.
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$settings=[ICSharpCode.Decompiler.DecompilerSettings]::new()
$settings.ThrowOnAssemblyResolveErrors=$false
$decompiler=[ICSharpCode.Decompiler.CSharp.CSharpDecompiler]::new((Join-Path $GameRoot 'Assembly-CSharp.dll'),$settings)
$references=@(
 @('environment','Verse.GenTemperature'),
 @('energy','Verse.Thing'),@('energy','Verse.TickList'),
 @('food','Verse.GenRecipe'),@('food','Verse.AI.Toils_Recipe')
)
foreach($reference in $references){
 $group=$reference[0];$name=$reference[1]
 $manifest=Get-Content -Raw -LiteralPath (Join-Path $project "docs/research/rimworld/evidence/$group-manifest.json")|ConvertFrom-Json
 if($manifest.source_sha256 -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3' -or $manifest.engine_sha256 -ne '587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'){throw "Unmatched reused identity: $group"}
 $record=@($manifest.types|Where-Object type -eq $name)
 if($record.Count -ne 1 -or $record[0].local_file -ne ".local-research/$group/$name.cs"){throw "Invalid reused type record: $group/$name"}
 $target=Join-Path $project $record[0].local_file
 if((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -eq $record[0].sha256){Write-Output "Reused verified $group/$name";continue}
 $content=$decompiler.DecompileTypeAsString([ICSharpCode.Decompiler.TypeSystem.FullTypeName]::new($name)).Replace("`r`n","`n")
 $bytes=[Text.Encoding]::UTF8.GetBytes($content)
 $actual=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
 if($actual -ne $record[0].sha256 -or ($content -split "`n").Count -ne $record[0].lines){throw "Reconstructed reused type differs: $group/$name"}
 New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force|Out-Null
 [IO.File]::WriteAllBytes($target,$bytes)
 Write-Output "Reconstructed verified $group/$name"
}
