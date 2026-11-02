param([Parameter(Mandatory = $true)][string]$GameRoot)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$resolvedGame = (Resolve-Path -LiteralPath $GameRoot).Path.TrimEnd('\','/')
$assemblyHash = (Get-FileHash -LiteralPath (Join-Path $resolvedGame 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
$evidence = Join-Path $project 'docs/research/rimworld/evidence'
$docs = @{}
$hashes = @{}
$references = 0
foreach ($group in @('work','combat','environment','economy')) {
    $manifest = Get-Content -LiteralPath (Join-Path $evidence "$group-manifest.json") -Raw | ConvertFrom-Json
    if ($manifest.source_sha256 -ne $assemblyHash) { throw "Assembly hash mismatch for $group" }
    $claims = Get-Content -LiteralPath (Join-Path $evidence "$group-claims.json") -Raw | ConvertFrom-Json
    foreach ($claim in $claims) {
        foreach ($source in $claim.sources) {
            if (-not $source.path) { continue }
            $path = [IO.Path]::GetFullPath((Join-Path $resolvedGame $source.path))
            if (-not $path.StartsWith($resolvedGame + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Out-of-root source: $path" }
            if (-not $docs.ContainsKey($path)) {
                $settings = [Xml.XmlReaderSettings]::new()
                $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
                $settings.XmlResolver = $null
                $reader = [Xml.XmlReader]::Create($path, $settings)
                $doc = [Xml.XmlDocument]::new()
                $doc.XmlResolver = $null
                try { $doc.Load($reader) } finally { $reader.Dispose() }
                $docs[$path] = $doc
                $hashes[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
            }
            if ($hashes[$path] -ne $source.sha256) { throw "XML hash changed in $($claim.id): $path" }
            if ($docs[$path].SelectNodes($source.xpath).Count -eq 0) { throw "Empty XPath in $($claim.id)" }
            $references++
        }
    }
}
& node (Join-Path $PSScriptRoot 'verify-research.mjs') --local
if ($LASTEXITCODE -ne 0) { throw 'Derived evidence or arithmetic verification failed.' }
& (Join-Path $PSScriptRoot 'extract-xml-values.ps1') -GameRoot $resolvedGame -Group economy -Verify
Write-Output "Verified assembly identity and $references XML references across $($docs.Count) files. No original-game code executed."
