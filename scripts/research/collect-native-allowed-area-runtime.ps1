param([switch]$Check)
# Replays retained evidence only. Never launches or inputs into the game; never edits saves.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtimeRelative='.local-research/runtime/allowed-area-20261104'
$profileRelative='.local-research/runtime/profile-allowed-area-20261104'
$runtime=Join-Path $root $runtimeRelative;$profile=Join-Path $root $profileRelative
$output=Join-Path $root 'docs/research/rimworld/evidence/allowed-area-native-runtime.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function BytesHash([byte[]]$b){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($b)).ToLowerInvariant()}
function TextHash([string]$s){BytesHash ([Text.Encoding]::UTF8.GetBytes($s))}
function ReadXml([string]$file){$doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null;$settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$r=[Xml.XmlReader]::Create($file,$settings);try{$doc.Load($r)}finally{$r.Dispose()};return ,$doc}
function Field($node,[string]$path){if($node){$child=$node.SelectSingleNode($path);if($child){$child.InnerText}else{$null}}else{$null}}
function One($doc,[string]$xpath){$a=@($doc.SelectNodes($xpath));if($a.Count -ne 1){throw "Expected one $xpath, got $($a.Count)"};return ,$a[0]}
function Area($node){
 $packed=[Convert]::FromBase64String((Field $node 'innerGrid/arrDeflate'))
 $src=[IO.MemoryStream]::new($packed,$false);$inflate=[IO.Compression.DeflateStream]::new($src,[IO.Compression.CompressionMode]::Decompress);$dst=[IO.MemoryStream]::new()
 try{$inflate.CopyTo($dst);$b=$dst.ToArray()}finally{$inflate.Dispose();$src.Dispose();$dst.Dispose()}
 if($b.Length -ne 7813 -or (Field $node 'innerGrid/mapSizeX') -ne '250' -or (Field $node 'innerGrid/mapSizeZ') -ne '250'){throw 'Unexpected bool grid shape'}
 $cells=@(for($i=0;$i -lt 62500;$i++){if($b[[int][Math]::Floor($i/8)] -band (1 -shl ($i%8))){'('+($i%250)+', 0, '+[int][Math]::Floor($i/250)+')'}})
 if($cells.Count -ne [int](Field $node 'innerGrid/trueCount')){throw 'Area population differs from packed bool grid'}
 [ordered]@{id=Field $node 'ID';label=Field $node 'label';color=Field $node 'color';cellCount=$cells.Count;cells=$cells;packedSha256=BytesHash $b;xmlSha256=TextHash $node.OuterXml}
}
$launchFile=Join-Path $runtime 'launch-record.json';$exitFile=Join-Path $runtime 'exit-record.json'
$launch=Get-Content $launchFile -Raw|ConvertFrom-Json;$exitRecord=Get-Content $exitFile -Raw|ConvertFrom-Json
if($launch.pid -ne 31408 -or !$launch.existingRimWorldAbsentBeforeLaunch -or $exitRecord.targetPid -ne 31408 -or $exitRecord.stillRunning -or @($exitRecord.processes).Count){throw 'Expected isolated launch and confirmed exit'}
if([IO.Path]::GetFullPath($launch.profile) -ne [IO.Path]::GetFullPath($profile)){throw 'Wrong profile'}
if((Hash $launch.baseline) -ne $launch.baselineSha256 -or (Hash $launch.copiedBaseline) -ne $launch.baselineSha256 -or $launch.baselineSha256 -ne 'ab629e9b0d24252991f47d2c57149ad29c8152db24b1c004b5659a74862620cd'){throw 'Baseline changed'}
if((Hash 'F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll') -ne $launch.assemblySha256){throw 'Game assembly changed'}
$stages=@(foreach($n in 1..6){
 $rel="$profileRelative/Saves/New Arrivals$n.rws";$file=Join-Path $root $rel;$doc=ReadXml $file
 if((Field $doc '//meta/gameVersion') -ne '1.7.4980 rev60' -or (@($doc.SelectNodes('//meta/modIds/li')|ForEach-Object InnerText) -join ';') -ne 'ludeon.rimworld;ludeon.rimworld.odyssey'){throw 'Version/mods changed'}
 $pawn=One $doc '//thing[id="Human958"]';$area=Area (One $doc '//areaManager/areas/li[@Class="Area_Allowed" and label="ResearchYard"]');$wall=$doc.SelectSingleNode('//thing[id="Wall77942"]')
 [ordered]@{stage=$n;file=$rel;sha256=Hash $file;tick=[int](Field $doc '//tickManager/ticksGame');area=$area;pawn=[ordered]@{id='Human958';position=Field $pawn 'pos';positionAllowed=($area.cells -contains (Field $pawn 'pos'));drafted=Field $pawn 'drafter/drafted';assignment=Field $pawn 'playerSettings/allowedAreas/values/li';job=Field $pawn 'jobs/curJob/def';targetA=Field $pawn 'jobs/curJob/targetA';jobXml=$pawn.jobs.curJob.OuterXml;jobXmlSha256=TextHash $pawn.jobs.curJob.OuterXml;driverXml=$pawn.jobs.curDriver.OuterXml;driverXmlSha256=TextHash $pawn.jobs.curDriver.OuterXml;workLeft=Field $pawn 'jobs/curDriver/workLeft';equipmentXml=$pawn.equipment.OuterXml};wall=if($wall){[ordered]@{id='Wall77942';position=Field $wall 'pos';positionAllowed=($area.cells -contains (Field $wall 'pos'));xml=$wall.OuterXml;xmlSha256=TextHash $wall.OuterXml}}else{$null};woodAtFormerWall=@(foreach($w in $doc.SelectNodes('//thing[def="WoodLog" and pos="(109, 0, 126)"]')){[ordered]@{id=Field $w 'id';count=Field $w 'stackCount';xml=$w.OuterXml;xmlSha256=TextHash $w.OuterXml}})}
})
if(($stages.tick -join ';') -ne '80255;81041;81420;81571;81572;86506' -or ($stages.area.cellCount -join ';') -ne '16;16;16;17;17;17'){throw 'Stage sequence changed'}
if($stages[0].pawn.positionAllowed -or !$stages[1].pawn.positionAllowed -or $stages[2].pawn.positionAllowed -or $stages[3].pawn.positionAllowed -or $stages[4].pawn.positionAllowed -or !$stages[5].pawn.positionAllowed){throw 'Observed area/position relation changed'}
foreach($s in $stages){if($s.pawn.assignment -ne 'Area_5_Named_ResearchYard' -or $s.pawn.drafted -eq 'True'){throw 'Expected undrafted assigned pawn'}}
if(!$stages[2].pawn.equipmentXml.Contains('<def>WoodLog</def>') -or $stages[2].pawn.job -ne 'Goto'){throw 'Outside equip/return evidence changed'}
foreach($i in @(3,4)){if(!$stages[$i].wall.positionAllowed -or $stages[$i].pawn.job -ne 'Deconstruct' -or $stages[$i].pawn.targetA -ne 'Thing_Wall77942' -or $stages[$i].pawn.workLeft -ne '72.6975098'){throw 'Outside adjacent work evidence changed'}}
if($stages[3].area.packedSha256 -ne $stages[4].area.packedSha256 -or $stages[3].pawn.jobXmlSha256 -ne $stages[4].pawn.jobXmlSha256 -or $stages[3].pawn.position -ne $stages[4].pawn.position){throw 'Native load did not preserve area, job or position'}
# The native save after reload advances one tick. Inspect and retain the exact
# driver delta instead of requiring equality or ignoring all timer differences.
$driverBefore=[Xml.XmlDocument]::new();$driverBefore.XmlResolver=$null;$driverBefore.LoadXml($stages[3].pawn.driverXml)
$driverAfter=[Xml.XmlDocument]::new();$driverAfter.XmlResolver=$null;$driverAfter.LoadXml($stages[4].pawn.driverXml)
foreach($d in @($driverBefore,$driverAfter)){if($d.DocumentElement.GetAttribute('Class') -ne 'JobDriver_Deconstruct' -or (Field $d 'curDriver/curToilIndex') -ne '1' -or (Field $d 'curDriver/startTick') -ne '81420' -or (Field $d 'curDriver/totalNeededWork') -ne '94.5'){throw 'Unexpected restored driver identity or work total'}}
if((Field $driverBefore 'curDriver/ticksLeftThisToil') -ne '-24' -or (Field $driverAfter 'curDriver/ticksLeftThisToil') -ne '-25'){throw 'Unexpected native driver timer delta'}
$driverAfter.SelectSingleNode('curDriver/ticksLeftThisToil').InnerText='-24'
if($driverBefore.OuterXml -cne $driverAfter.OuterXml){throw 'Unexpected native driver change beyond the observed one-tick timer delta'}
$reloadComparison=[ordered]@{beforeStage=4;afterStage=5;tickDelta=1;areaBytesEqual=$true;jobXmlEqual=$true;positionEqual=$true;driverXmlEqual=$false;driverChanges=@([ordered]@{path='curDriver/ticksLeftThisToil';before='-24';after='-25'});allOtherDriverXmlEqual=$true}
if($stages[5].wall -or $stages[5].pawn.job -ne 'Wait_Wander'){throw 'Post-load completion changed'}
$actions=@(Get-ChildItem $runtime -Filter '*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 $f=$_;$action=Get-Content $f.FullName -Raw|ConvertFrom-Json;$captureFile=$f.FullName.Replace('.actions.jsonl','.jsonl');$capture=Get-Content $captureFile -Raw|ConvertFrom-Json;$imageFile=$f.FullName.Replace('.actions.jsonl','')
 if($action.pid -ne 31408 -or $capture.pid -ne 31408 -or $capture.width -ne 2560 -or $capture.height -ne 1440 -or [IO.Path]::GetFullPath($action.profile) -ne [IO.Path]::GetFullPath($profile)){throw 'Action/capture target mismatch'}
 [ordered]@{ordinal=[int]$f.Name.Substring(0,3);file="$runtimeRelative/$($f.Name)";sha256=Hash $f.FullName;action=$action;captureSha256=Hash $captureFile;imageSha256=Hash $imageFile}
})
if($actions.Count -ne 81 -or ($actions.ordinal -join ';') -ne (1..81 -join ';')){throw 'Completed action sequence changed'}
Add-Type -AssemblyName System.Drawing
$cropDir=Join-Path $root 'docs/research/rimworld/evidence/allowed-area-runtime';if(!$Check){New-Item -ItemType Directory $cropDir -Force|Out-Null}
$specs=@(
 @{name='011-renamed';rect=@(1000,515,560,410)},@{name='016-assigned-yard';rect=@(0,1180,1020,220)},
 @{name='034-wall-work-menu';rect=@(1300,830,380,120)},@{name='038-equip-pulse';rect=@(0,1210,440,190)},
 @{name='054-add-wall-cell';rect=@(1150,570,600,380)},@{name='056-single-cell-work-allowed';rect=@(1300,830,380,120)},
 @{name='058-deconstruct-pulse';rect=@(0,1210,440,190)},@{name='066-load-dialog-actual';rect=@(970,370,620,450)},
 @{name='077-post-load-run';rect=@(1170,810,350,115)}
)
$screens=@(foreach($spec in $specs){$src=Join-Path $runtime ($spec.name+'.png');$dest=Join-Path $cropDir ($spec.name+'.png');$r=$spec.rect;$bmp=[Drawing.Bitmap]::new($src)
 try{$crop=$bmp.Clone([Drawing.Rectangle]::new($r[0],$r[1],$r[2],$r[3]),$bmp.PixelFormat);try{$stream=[IO.MemoryStream]::new();$crop.Save($stream,[Drawing.Imaging.ImageFormat]::Png);$bytes=$stream.ToArray();$stream.Dispose()}finally{$crop.Dispose()}}finally{$bmp.Dispose()}
 $hash=BytesHash $bytes;if($Check){if((Hash $dest) -ne $hash){throw 'Crop differs'}}else{[IO.File]::WriteAllBytes($dest,$bytes)}
 [ordered]@{source="$runtimeRelative/$($spec.name).png";sourceSha256=Hash $src;crop=$r;file="docs/research/rimworld/evidence/allowed-area-runtime/$($spec.name).png";sha256=$hash}
})
$record=[ordered]@{evidence_id='RW17-ALLOWED-AREA-RUNTIME';version='1.7.4980 rev60';assemblySha256=$launch.assemblySha256;enabledMods=@('ludeon.rimworld','ludeon.rimworld.odyssey');kind='Ordinary native UI actions, read-only native save projections and packed-area decoding';preparation='One isolated profile copied unchanged from earlier developer-prepared colony; this trial added no developer terrain/items or injected code and edited no save XML. Existing developer toolbar was visible. User saves and other preview processes untouched.';launch=$launch;launchSha256=Hash $launchFile;exit=$exitRecord;exitSha256=Hash $exitFile;stages=$stages;reloadComparison=$reloadComparison;screens=$screens;actions=$actions;limits=@('Not screen-only: matched derived code and read-only save XML are used.','Empty-area behavior, deletion, drafted/mental exceptions, bed/food filtering and all other work types remain static-only in this trial.','046 drag did not add the intended wall patch;049 still rejected.054 single-click added precisely one wall cell.','033 did not display a menu;034 is the actual outside-area rejection screenshot.','072 pulse occurred under the menu and075 did not save;077 is actual post-load completion. Menu closure allowed additional running time; no pulse-duration/TPS inference is made.','Native reload advances saved tick81571 to81572. Area bytes and curJob XML remain equal; curDriver differs only in ticksLeftThisToil (-24 to -25), with workLeft and totalNeededWork unchanged. This is not whole-save or whole-driver byte equality.','083 was not attempted.082 Quit closed the owned window before trailing capture; only81 completed input/capture receipts exist.');collectorSha256=Hash $PSCommandPath;inputScriptSha256=Hash (Join-Path $PSScriptRoot 'allowed-area-runtime-input.ps1')}
$json=($record|ConvertTo-Json -Depth 24).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($output) -cne $json){throw 'Native retained projection differs'};'Checked native allowed-area save, UI, reload and exit evidence'}else{[IO.File]::WriteAllText($output,$json,[Text.UTF8Encoding]::new($false));'Collected native allowed-area evidence'}
