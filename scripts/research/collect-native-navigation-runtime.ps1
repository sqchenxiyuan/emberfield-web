param([switch]$Check)
# Read-only source collection: native UI actions and original saves are retained locally.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime/navigation-20261104'
$profile=Join-Path $root '.local-research/runtime/profile-navigation-20261104'
$output=Join-Path $root 'docs/research/rimworld/evidence/native-navigation-runtime.json'
function Hash([string]$file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function ReadXml([string]$file){
  $doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null
  $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit
  $reader=[Xml.XmlReader]::Create($file,$settings)
  try{$doc.Load($reader)}finally{$reader.Dispose()}
  return ,$doc
}
function Field($node,[string]$path){$child=$node.SelectSingleNode($path);if($child){$child.InnerText}else{$null}}
$launch=Get-Content -LiteralPath (Join-Path $runtime 'launch-record.json') -Raw|ConvertFrom-Json
$exit=Get-Content -LiteralPath (Join-Path $runtime 'exit-record.json') -Raw|ConvertFrom-Json
if($exit.targetExists -or $exit.targetPid -ne $launch.pid){throw 'Missing confirmed native process exit'}
$assembly=Hash 'F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll'
if($assembly -ne $launch.assemblySha256){throw 'Native artifact changed'}
$manifest=Get-Content -LiteralPath (Join-Path $root 'docs/research/rimworld/evidence/work-manifest.json') -Raw|ConvertFrom-Json
if($assembly -ne $manifest.source_sha256){throw 'Derived source identity mismatch'}
$derived=@(foreach($type in @('Verse.PathFinder','Verse.PathFinderJob','Verse.AI.PathGrid','Verse.AI.Pawn_PathFollower')){
  $entry=$manifest.types|Where-Object type -eq $type
  if(!$entry -or (Hash (Join-Path $root $entry.local_file)) -ne $entry.sha256){throw "Derived file mismatch: $type"}
  $entry
})
$stages=@(foreach($n in 1..3){
  $file=Join-Path $profile "Saves/New Arrivals$n.rws";$doc=ReadXml $file
  $pawn=$doc.SelectSingleNode('//thing[id="Human961"]');$shelf=$doc.SelectSingleNode('//thing[id="ShelfSmall328366"]')
  $projection=@($pawn.SelectNodes('id|pos|drafter|pather|jobs/curJob')|ForEach-Object {$_.OuterXml})
  [ordered]@{file=".local-research/runtime/profile-navigation-20261104/Saves/New Arrivals$n.rws";sha256=Hash $file;
    tick=[int](Field $doc '//tickManager/ticksGame');pawnId=Field $pawn 'id';position=Field $pawn 'pos';
    target=Field $pawn 'jobs/curJob/targetA';nextCell=Field $pawn 'pather/nextCell';drafted=Field $pawn 'drafter/drafted';
    shelfId=Field $shelf 'id';shelfPosition=Field $shelf 'pos';projection=$projection}
})
if(($stages.position -join ';') -ne '(114, 0, 130);(115, 0, 131);(116, 0, 130)'){throw 'Unexpected observed route'}
if($stages[1].target -ne '(116, 0, 130)' -or $stages[1].nextCell -ne '(116, 0, 130)'){throw 'Mid-route goal differs'}
Add-Type -AssemblyName System.Drawing
$cropDir=Join-Path $root 'docs/research/rimworld/evidence/navigation-runtime'
if(!$Check){New-Item -ItemType Directory -Path $cropDir -Force|Out-Null}
$screens=@(foreach($name in @('009-west-arrival','016-detour','021-east-arrival')){
  $source=Join-Path $runtime "$name.png";$destination=Join-Path $cropDir "$name.png"
  $bitmap=[Drawing.Bitmap]::new($source)
  try{$crop=$bitmap.Clone([Drawing.Rectangle]::new(1015,650,210,200),$bitmap.PixelFormat)
    try{$stream=[IO.MemoryStream]::new();$crop.Save($stream,[Drawing.Imaging.ImageFormat]::Png);$bytes=$stream.ToArray();$stream.Dispose()}
    finally{$crop.Dispose()}
  }finally{$bitmap.Dispose()}
  $digest=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
  if($Check){if((Hash $destination) -ne $digest){throw 'Crop mismatch'}}else{[IO.File]::WriteAllBytes($destination,$bytes)}
  [ordered]@{source=".local-research/runtime/navigation-20261104/$name.png";sourceSha256=Hash $source;
    crop=@(1015,650,210,200);file="docs/research/rimworld/evidence/navigation-runtime/$name.png";sha256=$digest}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter '*.actions.jsonl'|Sort-Object Name|ForEach-Object{
  [ordered]@{file=".local-research/runtime/navigation-20261104/$($_.Name)";sha256=Hash $_.FullName;action=(Get-Content -LiteralPath $_.FullName -Raw|ConvertFrom-Json)}
})
$report=[ordered]@{id='RW17-NAVIGATION-RUNTIME';sourceSha256=$assembly;version='1.7.4980 rev60';
  preparation='Unmodified shelf experiment save, copied to an isolated Core + Odyssey profile. Inherits earlier developer preparation and enabled dev mode; this trial uses only ordinary UI actions.';
  scope='One drafted pawn, one stocked small shelf, one west-to-east route. Screen captures and read-only XML. Camera coordinates also informed clicks; not screen-only control.';
  limits=@('Does not prove optimal elapsed time or every intermediate tick.','Native diagonal 2D movement differs from Web cardinal multi-level edges.','No native door, snow, animal or congestion trial in this record.','Exit click sent, but post-exit screenshot was rejected by focus guard; fresh process query confirms exit.');
  launch=$launch;exit=$exit;derived=$derived;stages=$stages;screenshots=$screens;actions=$actions}
$json=($report|ConvertTo-Json -Depth 40).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($output).Replace("`r`n","`n") -cne $json){throw 'Collected record changed'}}
else{[IO.File]::WriteAllText($output,$json,[Text.UTF8Encoding]::new($false))}
Write-Output "Verified $($stages.Count) native saves, $($screens.Count) crops, $($actions.Count) action records, $($derived.Count) derived types."
