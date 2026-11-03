# Re-extract selected types as data. Retained REA IDs below describe the original hash-matched observation.
param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld', [string[]]$Types = @(
 'RimWorld.JobGiver_Mate', 'RimWorld.JobDriver_Mate', 'Verse.Hediff_Pregnant',
 'Verse.Pawn_AgeTracker', 'RimWorld.LifeStageDef', 'Verse.RaceProperties',
 'RimWorld.Pawn_TrainingTracker', 'RimWorld.TrainableUtility', 'Verse.AnimalPenUtility',
 'RimWorld.Need_Food', 'RimWorld.JobGiver_GetFood', 'RimWorld.FoodUtility',
 'RimWorld.PawnUtility', 'Verse.AI.ThinkNode_ChancePerHour_Mate',
 'RimWorld.StatWorker_MinimumHandlingSkill', 'RimWorld.FoodTypeFlags',
 'Verse.Pawn', 'Verse.PawnGenerator', 'RimWorld.HungerLevelUtility'
))
$ErrorActionPreference = 'Stop'
$taskGame = $GameRoot
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$output=Join-Path $root '.local-research/husbandry-reproduction'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$assembly = Join-Path $taskGame 'Assembly-CSharp.dll'
$engine = (Resolve-Path (Join-Path $PSScriptRoot '../../../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll')).Path
$assemblyHash = (Get-FileHash -LiteralPath $assembly -Algorithm SHA256).Hash.ToLowerInvariant()
$engineHash = (Get-FileHash -LiteralPath $engine -Algorithm SHA256).Hash.ToLowerInvariant()
if ($assemblyHash -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3') { throw 'Assembly identity changed' }
if ($engineHash -ne '587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78') { throw 'Decompiler identity changed' }
Add-Type -LiteralPath $engine
$settings = [ICSharpCode.Decompiler.DecompilerSettings]::new()
$settings.ThrowOnAssemblyResolveErrors = $false
$decompiler = [ICSharpCode.Decompiler.CSharp.CSharpDecompiler]::new($assembly, $settings)
$utf8 = [Text.UTF8Encoding]::new($false)
$records = @()
foreach ($name in $Types) {
  $content = $decompiler.DecompileTypeAsString([ICSharpCode.Decompiler.TypeSystem.FullTypeName]::new($name)).Replace("`r`n", "`n")
  if ([string]::IsNullOrWhiteSpace($content)) { throw "Empty type $name" }
  $path = Join-Path $output ($name + '.cs')
  [IO.File]::WriteAllText($path, $content, $utf8)
  $records += [ordered]@{ type=$name; file=($name + '.cs'); sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant(); lines=($content -split "`n").Count }
  Write-Output "$name : $($records[-1].lines) lines"
}
$xmlPaths = @('ThingDefs_Races/Races_Animal_Hares.xml','ThingDefs_Races/Races_Animal_PigGroup.xml',
 'ThingDefs_Races/Races_Animal_Base.xml','Misc/LifeStageDefs/LifeStages.xml','TrainableDefs/Trainables.xml',
 'ThinkTreeDefs/Animal.xml','HediffDefs/Hediffs_Global_Needs.xml','HediffDefs/Hediffs_Global_Misc.xml')
$xml = @()
foreach ($relative in $xmlPaths) {
  $source = Join-Path $taskGame ('Data/Core/Defs/' + $relative)
  $destination = Join-Path $output ([IO.Path]::GetFileName($source))
  Copy-Item -LiteralPath $source -Destination $destination
  $xml += [ordered]@{ source=$source; file=[IO.Path]::GetFileName($destination); sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$manifest = [ordered]@{
 evidence_id='RW17-HUSBANDRY-REPRODUCTION'; version=(Get-Content -LiteralPath (Join-Path $taskGame 'Version.txt') -Raw).Trim()
 source=$assembly; source_sha256=$assemblyHash; engine='ICSharpCode.Decompiler'; engine_sha256=$engineHash
 engine_version=[ICSharpCode.Decompiler.CSharp.CSharpDecompiler].Assembly.GetName().Version.ToString()
 rea_artifact_evidence='ev_002f7c6a8e7e5c16296ff1beb7f5dc6ac1cc486e52a65155a913c3753871a42b'
 rea_summary_evidence='ev_107c63f87f74870b8dc7c9c2205fec8ed587133e8dc9701a85c5682d8aa43cea'
 mvid='8e962ecc-7ac7-42d2-8f3b-1b16cd24d2cd'
 kind='Static derived reconstruction; not original source; no target execution'
 limitations=@('Unresolved dependencies tolerated by ILSpy', 'No runtime or effective modded Def database validation', 'Line ranges bind only to recorded derived hashes')
 types=$records; xml=$xml
}
[IO.File]::WriteAllText((Join-Path $output 'manifest.json'), ($manifest | ConvertTo-Json -Depth 8) + "`n", $utf8)
