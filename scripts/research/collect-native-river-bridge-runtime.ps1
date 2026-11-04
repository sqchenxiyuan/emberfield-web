param([switch]$Check)
# Read-only replay of a completed native UI experiment. Never launches/input-edits the game or saves.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtimeRelative='.local-research/runtime/river-bridge-20261104'
$profileRelative='.local-research/runtime/profile-river-bridge-20261104'
$runtime=Join-Path $root $runtimeRelative;$profile=Join-Path $root $profileRelative
$evidence=Join-Path $root 'docs/research/rimworld/evidence'
$output=Join-Path $evidence 'river-bridge-native-runtime.json'
function Hash([string]$file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
function LF([string]$s){$s.Replace(([string][char]13+[char]10),[string][char]10)}
function ReadXml([string]$file){
 $doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null
 $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit
 $reader=[Xml.XmlReader]::Create($file,$settings)
 try{$doc.Load($reader)}finally{$reader.Dispose()};return ,$doc
}
function Field($node,[string]$path){if($null -eq $node){return $null};$child=$node.SelectSingleNode($path);if($child){$child.InnerText}else{$null}}
function One($doc,[string]$xpath){$nodes=@($doc.SelectNodes($xpath));if($nodes.Count -ne 1){throw "Expected one XML match: $xpath, found $($nodes.Count)"};return ,$nodes[0]}
function IntDefault($node,[string]$path,[int]$default){$v=Field $node $path;if($null -eq $v){$default}else{[int]$v}}
function Item($node){
 [ordered]@{class=$node.GetAttribute('Class');id=Field $node 'id';def=Field $node 'def';count=IntDefault $node 'stackCount' 1
  position=Field $node 'pos';health=Field $node 'health';stuff=Field $node 'stuff';xml=$node.OuterXml;xmlSha256=TextHash $node.OuterXml}
}
function BytesHash([byte[]]$bytes){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()}
function Grid($doc,[string]$label){
 $n=One $doc "//maps/li/terrainGrid/${label}Deflate";$bytes=[Convert]::FromBase64String(($n.InnerText -replace '\s',''))
 $inputStream=[IO.MemoryStream]::new($bytes,$false);$inflate=[IO.Compression.DeflateStream]::new($inputStream,[IO.Compression.CompressionMode]::Decompress);$outputStream=[IO.MemoryStream]::new()
 try{$inflate.CopyTo($outputStream);$decoded=$outputStream.ToArray()}finally{$inflate.Dispose();$inputStream.Dispose();$outputStream.Dispose()}
 if($decoded.Length -ne 125000){throw 'Expected 250x250 ushort grid'}
 [pscustomobject]@{bytes=$decoded;record=[ordered]@{label=$label;decodedBytes=$decoded.Length;decodedSha256=BytesHash $decoded;nodeSha256=TextHash $n.OuterXml}}
}
function At([byte[]]$b,[int]$x,[int]$z){$i=2*($x+$z*250);[int]$b[$i] -bor ([int]$b[$i+1] -shl 8)}
$launchFile=Join-Path $runtime 'launch-record.json';$exitFile=Join-Path $runtime 'exit-record.json'
$launch=Get-Content $launchFile -Raw|ConvertFrom-Json;$exitRecord=Get-Content $exitFile -Raw|ConvertFrom-Json
if($exitRecord.stillRunning -or $exitRecord.targetPid -ne 32188 -or $launch.pid -ne 32188 -or @($exitRecord.processes).Count){throw 'Confirmed native exit missing'}
if(!$launch.existingRimWorldAbsentBeforeLaunch -or [IO.Path]::GetFullPath($launch.profile) -ne [IO.Path]::GetFullPath($profile)){throw 'Unexpected isolated launch'}
if((Hash $launch.baseline) -ne $launch.baselineSha256 -or (Hash $launch.copiedBaseline) -ne $launch.baselineSha256 -or $launch.baselineSha256 -ne 'ab629e9b0d24252991f47d2c57149ad29c8152db24b1c004b5659a74862620cd'){throw 'Baseline changed'}
$assembly=Hash 'F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll'
if($assembly -ne $launch.assemblySha256 -or $assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Assembly changed'}
$configFile=Join-Path $profile 'Config/ModsConfig.xml';$config=ReadXml $configFile
$mods=@($config.SelectNodes('/ModsConfigData/activeMods/li')|ForEach-Object InnerText)
if(($mods -join ';') -ne 'ludeon.rimworld;ludeon.rimworld.odyssey'){throw 'Mods changed'}
$labels=@('copied-prior-prepared-colony','developer-water-patches-no-bridge','ordinary-bridge-completed','pawn-on-shallow-and-stockpile-created','ordinary-bridge-removed-refund-on-water')
$stages=@(foreach($n in 0..4){
 $saveName=if($n -eq 0){'RiverBridgeBaseline.rws'}else{"New Arrivals$n.rws"};$relative="$profileRelative/Saves/$saveName";$file=Join-Path $root $relative;$doc=ReadXml $file
 if((Field $doc '//meta/gameVersion') -ne '1.7.4980 rev60' -or (@($doc.SelectNodes('//meta/modIds/li')|ForEach-Object InnerText) -join ';') -ne ($mods -join ';')){throw 'Save version/mods changed'}
 $top=Grid $doc 'topGrid';$under=Grid $doc 'underGrid';$foundation=Grid $doc 'foundationGrid';$pawn=One $doc '//thing[id="Human958"]'
 $occupied=@(for($i=0;$i -lt 62500;$i++){if($foundation.bytes[2*$i] -or $foundation.bytes[2*$i+1]){[ordered]@{x=$i%250;z=[int][Math]::Floor($i/250);value=At $foundation.bytes ($i%250) ([int][Math]::Floor($i/250))}}})
 $zone=$doc.SelectSingleNode('//zoneManager/allZones/li[@Class="Zone_Stockpile" and ID="4"]')
 [ordered]@{stage=$n;label=$labels[$n];file=$relative;sha256=Hash $file;tick=[int](Field $doc '//tickManager/ticksGame');gridDimensions=@(250,250);grids=@($top.record,$under.record,$foundation.record);foundationCells=$occupied
  bridgeCell=[ordered]@{position='(117, 0, 139)';top=At $top.bytes 117 139;under=At $under.bytes 117 139;foundation=At $foundation.bytes 117 139}
  pawn=[ordered]@{id='Human958';position=Field $pawn 'pos';cellTop=At $top.bytes 118 138;drafted=Field $pawn 'drafter/drafted';job=Field $pawn 'jobs/curJob/def';targetA=Field $pawn 'jobs/curJob/targetA';jobXmlSha256=TextHash $pawn.jobs.curJob.OuterXml}
  zone4=if($zone){[ordered]@{label=Field $zone 'label';xmlSha256=TextHash $zone.OuterXml;cells=@(foreach($c in $zone.SelectNodes('cells/li')){$xyz=$c.InnerText.Trim('(',')').Split(',')|ForEach-Object {[int]$_};[ordered]@{position=$c.InnerText;top=At $top.bytes $xyz[0] $xyz[2];foundation=At $foundation.bytes $xyz[0] $xyz[2]}})}}else{$null}
  woodAtBridge=@(foreach($w in $doc.SelectNodes('//thing[def="WoodLog" and pos="(117, 0, 139)"]')){Item $w})}
})
if(($stages.tick -join ';') -ne '80254;80255;84585;85370;85982'){throw 'Ticks changed'}
if(($stages.bridgeCell.foundation -join ';') -ne '0;0;6727;6727;0'){throw 'Bridge foundation sequence changed'}
foreach($n in 1..4){if($stages[$n].bridgeCell.top -ne 26324 -or $stages[$n].bridgeCell.under -ne 0){throw 'Underlying water changed'};foreach($g in @('topGrid','underGrid')){if(($stages[$n].grids|Where-Object label -eq $g).decodedSha256 -ne ($stages[1].grids|Where-Object label -eq $g).decodedSha256){throw 'Whole underlying terrain grid changed'}}}
if($stages[2].foundationCells.Count -ne 1 -or $stages[3].foundationCells.Count -ne 1 -or $stages[4].foundationCells.Count -ne 0){throw 'Unexpected foundation coverage'}
if($stages[3].pawn.position -ne '(118, 0, 138)' -or $stages[3].pawn.cellTop -ne 26324 -or $stages[3].pawn.targetA -ne '(126, 0, 141)'){throw 'Pawn shallow/deep-click boundary changed'}
foreach($n in @(3,4)){if($stages[$n].zone4.cells.Count -ne 8 -or @($stages[$n].zone4.cells|Where-Object top -ne 26324).Count){throw 'Shallow stockpile changed'}}
if($stages[4].woodAtBridge.Count -ne 1 -or $stages[4].woodAtBridge[0].id -ne 'WoodLog185345' -or $stages[4].woodAtBridge[0].count -ne 6 -or $stages[4].woodAtBridge[0].health -ne '150'){throw 'Removal refund changed'}
Add-Type -AssemblyName System.Drawing
$cropDir=Join-Path $evidence 'river-bridge-runtime';if(!$Check){[void](New-Item -ItemType Directory -Path $cropDir -Force)}
$specs=@(
 @{name='026-deep-bridge-click';rect=@(0,0,850,90)},@{name='031-prioritize-bridge';rect=@(1400,550,550,230)},
 @{name='033-building-pulse';rect=@(0,0,1050,170)},@{name='036-building-third-pulse';rect=@(1400,550,600,270)},
 @{name='051-pawn-in-shallow';rect=@(1280,140,650,400)},@{name='056-shallow-stockpile-created';rect=@(1280,140,650,400)},
 @{name='070-removal-menu';rect=@(1280,140,650,400)},@{name='073-refund-in-water';rect=@(1280,140,650,400)},
 @{name='073-refund-in-water';outputName='073-refund-inspection';rect=@(0,1210,480,200)}
)
$screens=@(foreach($spec in $specs){$name=$spec.name;$outName=if($spec.outputName){$spec.outputName}else{$name};$r=$spec.rect;$source=Join-Path $runtime "$name.png";$destination=Join-Path $cropDir "$outName.png"
 $bitmap=[Drawing.Bitmap]::new($source);try{if($bitmap.Width -ne 2560 -or $bitmap.Height -ne 1440){throw 'Dimensions changed'};$crop=$bitmap.Clone([Drawing.Rectangle]::new($r[0],$r[1],$r[2],$r[3]),$bitmap.PixelFormat);try{$stream=[IO.MemoryStream]::new();$crop.Save($stream,[Drawing.Imaging.ImageFormat]::Png);$bytes=$stream.ToArray();$stream.Dispose()}finally{$crop.Dispose()}}finally{$bitmap.Dispose()}
 $digest=BytesHash $bytes;if($Check){if((Hash $destination) -ne $digest){throw "Crop mismatch $outName"}}else{[IO.File]::WriteAllBytes($destination,$bytes)}
 [ordered]@{source="$runtimeRelative/$name.png";sourceSha256=Hash $source;crop=$r;file="docs/research/rimworld/evidence/river-bridge-runtime/$outName.png";sha256=$digest;presentation='Unscaled bounded crop, excludes unrelated account/notification text.'}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter '*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 $receiptFile=$_;$action=Get-Content $receiptFile.FullName -Raw|ConvertFrom-Json
 if($action.pid -ne 32188 -or [IO.Path]::GetFullPath($action.profile) -ne [IO.Path]::GetFullPath($profile)){throw 'Wrong action target'}
 $captureFile=$receiptFile.FullName.Replace('.actions.jsonl','.jsonl');$capture=Get-Content $captureFile -Raw|ConvertFrom-Json;$imageFile=$receiptFile.FullName.Replace('.actions.jsonl','')
 if($capture.pid -ne 32188 -or $capture.width -ne 2560 -or $capture.height -ne 1440 -or [IO.Path]::GetFullPath($capture.image) -ne $imageFile -or [IO.Path]::GetFullPath($action.image) -ne $imageFile){throw 'Wrong capture target'}
 [ordered]@{ordinal=[int]$receiptFile.Name.Substring(0,3);file="$runtimeRelative/$($receiptFile.Name)";sha256=Hash $receiptFile.FullName;action=$action;captureSha256=Hash $captureFile;sourceImageSha256=Hash $imageFile}
})
if($actions.Count -ne 78 -or ($actions.ordinal -join ';') -ne (1..78 -join ';')){throw 'Action sequence changed'}
$record=[ordered]@{evidence_id='RW17-RIVER-BRIDGE-RUNTIME';version='1.7.4980 rev60';sourceSha256=$assembly;enabledMods=$mods;kind='Native UI, untouched native saves, read-only ushort terrain decoding, retained action/capture receipts and focused crops'
 preparation='Single isolated profile; baseline copied unchanged from earlier developer-prepared colony. This trial used visible developer Set terrain (rect) for shallow-moving/deep patches. God mode stayed off; no injected code, spawned test materials, save XML edits, or user-save writes. Subsequent bridge, stockpile, walk, removal and save operations use ordinary UI.'
 observations=@('Deep Water ordinary Bridge tool rejected missing Bridgeable (026).','Ordinary shallow bridge construction completed after hauling and one visible botch (033); not a clean 12-wood expenditure trial.','Save2 has exactly one foundation at117,139; save1..4 top and under decoded grids are identical.','Drafted Prophet stands at118,138 on prepared shallow water in save3; new zone4 spans eight shallow-base cells, one covered by bridge.','Undrafting immediately assigned removal work; right-click showed Already removing foundation (070). Ordinary bounded time completed removal; save4 foundation grid is empty and WoodLog185345x6 health150 is spawned on exposed shallow cell117,139.')
 limits=@('Not screen-only: saved XML and matched derived code inform evidence.','Water patches were developer-prepared; this does not validate natural river generation, elevation or water flow.','052-deep-walk-rejected is a misleading filename: right-click queued Goto to nearby walkable126,141, not an explicit rejection. No deep traversal proof claimed.','046-wall-options was interrupted by pointer edge scrolling; no wall/material-support or heavy-bridge runtime matrix was completed.','Set-terrain rectangle required two clicks; initial drag and IME/menu attempts are preserved.','No native post-build load-roundtrip, flowing-item transport, rain deterioration, flooding, erosion, or destruction-collapse trial.','Pulse durations are requested wall time, not TPS or construction-speed measurements. Saved ticks are authoritative.','Quit079 executed before trailing capture failed because window had closed. No079 screenshot/receipt fabricated; fresh CIM confirms target gone and no RimWorld processes.')
 launch=$launch;launchReceiptSha256=Hash $launchFile;exit=$exitRecord;exitReceiptSha256=Hash $exitFile;modsConfigSha256=Hash $configFile
 staticEvidence=[ordered]@{file='river-bridge-evidence.json';sha256=Hash (Join-Path $evidence 'river-bridge-evidence.json')}
 decoderProvenance=[ordered]@{file='exploration-runtime/decode-manifest.json';sha256=Hash (Join-Path $evidence 'exploration-runtime/decode-manifest.json');format='raw Deflate, little-endian ushort, x+z*250; identities26324/6727 anchored to visible prep/bridge and same-cell changes, not portable global hashes'}
 stages=$stages;screenshots=$screens;actions=$actions}
$json=(LF ($record|ConvertTo-Json -Depth 40))+[char]10
if($Check){if((LF ([IO.File]::ReadAllText($output))) -cne $json){throw 'Native river record mismatch'}}else{[IO.File]::WriteAllText($output,$json,[Text.UTF8Encoding]::new($false))}
"Native river evidence verified: baseline +4 saves, $($screens.Count) crops, $($actions.Count) receipts; ordinary bridge build/removal, shallow stockpile and refund."
