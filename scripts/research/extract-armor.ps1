param([Parameter(Mandatory=$true)][string]$GameRoot,[Parameter(Mandatory=$true)][string]$DecompilerPath)
# Read the game as PE/CIL. Only the analysis library can be loaded, never target code.
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$evidence=Join-Path $project 'docs/research/rimworld/evidence'
$assembly=Join-Path $GameRoot 'Assembly-CSharp.dll'
$assemblySha='eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'
$engineSha='587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'
if((Get-FileHash -LiteralPath $assembly -Algorithm SHA256).Hash.ToLowerInvariant() -ne $assemblySha){throw 'Installed assembly identity changed'}
if((Get-FileHash -LiteralPath $DecompilerPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $engineSha){throw 'Decompiler identity changed'}
if((Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim() -ne '1.7.4980 rev60'){throw 'Installed version changed'}
$claims=Get-Content -Raw -LiteralPath (Join-Path $evidence 'armor-claims.json')|ConvertFrom-Json
$references=@($claims.sources|Where-Object {$_.type}|Select-Object group,type -Unique)
$decompiler=$null
foreach($reference in $references){
 $group=$reference.group;$name=$reference.type
 if($group -notin @('armor','combat','apparel','housing','injuries','food','weapons','anatomy','skills') -or $name -notmatch '^[A-Za-z_][A-Za-z0-9_.]+$'){throw 'Unexpected reused group/type'}
 $manifest=Get-Content -Raw -LiteralPath (Join-Path $evidence "$group-manifest.json")|ConvertFrom-Json
 if($manifest.source_sha256 -ne $assemblySha -or $manifest.engine_sha256 -ne $engineSha -or $manifest.version_text -ne '1.7.4980 rev60'){throw "Unmatched identity: $group"}
 $record=@($manifest.types|Where-Object type -eq $name)
 if($record.Count -ne 1 -or $record[0].local_file -ne ".local-research/$group/$name.cs"){throw "Invalid type: $group/$name"}
 $target=Join-Path $project $record[0].local_file
 if((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -eq $record[0].sha256){Write-Output "Reused verified $group/$name";continue}
 if($null -eq $decompiler){
  Add-Type -LiteralPath $DecompilerPath
  $settings=[ICSharpCode.Decompiler.DecompilerSettings]::new();$settings.ThrowOnAssemblyResolveErrors=$false
  $decompiler=[ICSharpCode.Decompiler.CSharp.CSharpDecompiler]::new($assembly,$settings)
 }
 $content=$decompiler.DecompileTypeAsString([ICSharpCode.Decompiler.TypeSystem.FullTypeName]::new($name)).Replace("`r`n","`n")
 $bytes=[Text.Encoding]::UTF8.GetBytes($content);$actual=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
 if($actual -ne $record[0].sha256 -or ($content -split "`n").Count -ne $record[0].lines){throw "Reconstructed type differs: $group/$name"}
 New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force|Out-Null
 [IO.File]::WriteAllBytes($target,$bytes);Write-Output "Reconstructed verified $group/$name"
}
