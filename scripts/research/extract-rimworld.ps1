param(
    [Parameter(Mandatory = $true)][string]$GameRoot,
    [Parameter(Mandatory = $true)][string]$DecompilerPath,
    [string]$Group,
    [string[]]$Types,
    [switch]$ListTypes,
    [string]$TypePattern = '.',
    [string]$ExpectedSha256 = 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',
    [string]$ExpectedDecompilerSha256 = '587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'
)
# Only the analysis library is loaded. The game assembly is read as PE/CIL data.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$assembly = Join-Path $GameRoot 'Assembly-CSharp.dll'
$actualHash = (Get-FileHash -LiteralPath $assembly -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $ExpectedSha256) { throw "Source changed: $actualHash. Review version and update evidence before using another hash." }
$engineHash = (Get-FileHash -LiteralPath $DecompilerPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($engineHash -ne $ExpectedDecompilerSha256) { throw "Decompiler changed: $engineHash. Review tool version and regenerate locations deliberately." }
Add-Type -LiteralPath $DecompilerPath
$settings = [ICSharpCode.Decompiler.DecompilerSettings]::new()
$settings.ThrowOnAssemblyResolveErrors = $false
$decompiler = [ICSharpCode.Decompiler.CSharp.CSharpDecompiler]::new($assembly, $settings)
if ($ListTypes) {
    $decompiler.TypeSystem.MainModule.TypeDefinitions | ForEach-Object { $_.FullName } | Where-Object { $_ -match $TypePattern }
    return
}
if ($Group -notmatch '^[a-z][a-z0-9-]+$') { throw 'Group must use lowercase ASCII letters, digits and hyphens.' }
$research = Join-Path $project 'docs/research/rimworld'
$selectionPath = Join-Path $research "evidence/$Group-types.json"
if (-not $Types) { $Types = @(Get-Content -LiteralPath $selectionPath -Raw | ConvertFrom-Json) }
if (-not $Types.Count) { throw 'No types selected.' }
$output = Join-Path $project ".local-research/$Group"
New-Item -ItemType Directory -Path $output -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $research 'evidence') -Force | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
$records = @()
foreach ($name in $Types) {
    $content = $decompiler.DecompileTypeAsString([ICSharpCode.Decompiler.TypeSystem.FullTypeName]::new($name))
    if ([string]::IsNullOrWhiteSpace($content)) { throw "No reconstructed type: $name" }
    # Canonical line endings make recorded locations and hashes portable.
    $content = $content.Replace("`r`n", "`n")
    $filename = $name + '.cs'
    $path = Join-Path $output $filename
    [IO.File]::WriteAllText($path, $content, $utf8)
    $records += [ordered]@{
        type = $name; local_file = ".local-research/$Group/$filename"
        sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        lines = ($content -split "`n").Count
    }
    Write-Output "$name : $($records[-1].lines) lines"
}
[IO.File]::WriteAllText($selectionPath, (ConvertTo-Json -InputObject @($Types) -Depth 3) + "`n", $utf8)
$manifest = [ordered]@{
    evidence_id = "RW17-$($Group.ToUpperInvariant())"
    version_text = (Get-Content -LiteralPath (Join-Path $GameRoot 'Version.txt') -Raw).Trim()
    source = 'Assembly-CSharp.dll'; source_sha256 = $actualHash
    engine = 'ICSharpCode.Decompiler'; engine_version = [ICSharpCode.Decompiler.CSharp.CSharpDecompiler].Assembly.GetName().Version.ToString()
    engine_sha256 = $engineHash
    kind = 'Static derived reconstruction; not original source; target code not loaded or executed'
    line_endings = 'LF'; encoding = 'UTF-8 without BOM'
    limitations = @('Unresolved dependencies are tolerated by ILSpy.', 'No runtime, enabled-mod, or effective Def database validation.', 'Line locations apply only to the recorded derived hashes.')
    types = $records
}
[IO.File]::WriteAllText((Join-Path $research "evidence/$Group-manifest.json"), ($manifest | ConvertTo-Json -Depth 8) + "`n", $utf8)
