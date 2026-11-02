param(
    [Parameter(Mandatory = $true)][string]$GameRoot,
    [Parameter(Mandatory = $true)][string]$Group,
    [switch]$Verify
)
$ErrorActionPreference = 'Stop'
if ($Group -notmatch '^[a-z][a-z0-9-]+$') { throw 'Invalid group.' }
$evidence = Join-Path $PSScriptRoot "../../docs/research/rimworld/evidence"
$selection = Get-Content -LiteralPath (Join-Path $evidence "$Group-xml-selection.json") -Raw | ConvertFrom-Json
$results = @()
foreach ($item in $selection) {
    $path = Join-Path $GameRoot $item.path
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [Xml.XmlReader]::Create($path, $settings)
    $doc = [Xml.XmlDocument]::new()
    $doc.XmlResolver = $null
    try { $doc.Load($reader) } finally { $reader.Dispose() }
    $nodes = @($doc.SelectNodes($item.xpath))
    if ($nodes.Count -eq 0) { throw "XPath has no matches: $($item.id)" }
    $results += [ordered]@{
        id = $item.id; path = $item.path; xpath = $item.xpath
        sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        values = @($nodes | ForEach-Object { $_.get_InnerText().Trim() })
    }
}
$text = (ConvertTo-Json -InputObject $results -Depth 8).Replace("`r`n", "`n") + "`n"
$destination = Join-Path $evidence "$Group-xml.json"
if ($Verify) {
    $expected = [IO.File]::ReadAllText($destination).Replace("`r`n", "`n")
    if ($text -cne $expected) { throw 'XML source hashes or selected values have changed. Review before refreshing evidence.' }
    Write-Output "Verified $($results.Count) XML selections for $Group."
} else {
    [IO.File]::WriteAllText($destination, $text, [Text.UTF8Encoding]::new($false))
    Write-Output "Captured $($results.Count) declared XML selections for $Group; inheritance and patches are not resolved."
}
