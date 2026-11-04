param([switch]$Check)
# Read-only replay of a completed native UI experiment. Never launches/input-edits the game or saves.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtimeRelative='.local-research/runtime/production-output-20261104'
$profileRelative='.local-research/runtime/profile-production-output-20261104'
$runtime=Join-Path $root $runtimeRelative;$profile=Join-Path $root $profileRelative
$evidence=Join-Path $root 'docs/research/rimworld/evidence'
$output=Join-Path $evidence 'native-production-output-runtime.json'
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
$launchFile=Join-Path $runtime 'launch-record.json';$exitFile=Join-Path $runtime 'exit-record.json'
$launch=Get-Content -LiteralPath $launchFile -Raw|ConvertFrom-Json
$exitRecord=Get-Content -LiteralPath $exitFile -Raw|ConvertFrom-Json
if($exitRecord.stillRunning -or $exitRecord.targetPid -ne $launch.pid -or $launch.pid -ne 18100 -or @($exitRecord.processes).Count -ne 0){throw 'Missing confirmed native process exit'}
if(!$launch.existingRimWorldAbsentBeforeLaunch -or [IO.Path]::GetFullPath($launch.profile) -ne [IO.Path]::GetFullPath($profile)){throw 'Unexpected isolated launch'}
if([IO.Path]::GetFullPath($launch.copiedBaseline) -ne [IO.Path]::GetFullPath((Join-Path $profile 'Saves/ProductionOutputBaseline.rws'))){throw 'Unexpected baseline copy'}
if((Hash $launch.baseline) -ne $launch.baselineSha256 -or (Hash $launch.copiedBaseline) -ne $launch.baselineSha256 -or $launch.baselineSha256 -ne '40f642539f3036f525f75496d20ff425dfcbe1cf94ec6a7636e405492d716afa'){throw 'Prepared baseline changed'}
$assembly=Hash 'F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll'
if($assembly -ne $launch.assemblySha256 -or $assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Native artifact changed'}
$configFile=Join-Path $profile 'Config/ModsConfig.xml';$config=ReadXml $configFile
$expectedMods=@('ludeon.rimworld','ludeon.rimworld.odyssey')
$mods=@($config.SelectNodes('/ModsConfigData/activeMods/li')|ForEach-Object InnerText)
if(($mods -join ';') -ne ($expectedMods -join ';')){throw 'Unexpected enabled mods'}
$prefsFile=Join-Path $profile 'Config/Prefs.xml';$prefs=ReadXml $prefsFile
if((Field $prefs '//devMode') -ne 'True'){throw 'Expected inherited dev-enabled profile'}
$labels=@('copied-active-UFT-baseline','haul-disabled-new-output-zone-common-baseline','best-completed-carrying','loaded-carrying-save-and-resaved','best-delivered','reloaded-common-baseline-then-drop-completed','specific-setting-on-completed-bill','specified-zone-deleted')
$stages=@(foreach($n in 0..7){
 $saveName=if($n -eq 0){'ProductionOutputBaseline.rws'}else{"New Arrivals$n.rws"}
 $relative="$profileRelative/Saves/$saveName";$file=Join-Path $root $relative;$doc=ReadXml $file
 if((Field $doc '//meta/gameVersion') -ne '1.7.4980 rev60'){throw 'Save version changed'}
 if((@($doc.SelectNodes('//meta/modIds/li')|ForEach-Object InnerText) -join ';') -ne ($expectedMods -join ';')){throw 'Save mods changed'}
 $table=One $doc '//thing[id="CraftingSpot78052"]';$stack=One $table 'billStack';$b=One $stack 'bills/li'
 if((Field $table 'pos') -ne '(108, 0, 130)' -or (Field $table 'map') -ne '0' -or (Field $table 'def') -ne 'CraftingSpot'){throw 'Crafting spot identity changed'}
 $bill=[ordered]@{loadId=IntDefault $b 'loadID' 0;class=$b.GetAttribute('Class');recipe=Field $b 'recipe';repeatMode=Field $b 'repeatMode'
  repeatCount=IntDefault $b 'repeatCount' 0;repeatCountFieldAbsent=($null -eq (Field $b 'repeatCount'));storeMode=Field $b 'storeMode'
  storeGroup=Field $b 'storeGroup';includeGroup=Field $b 'includeGroup';boundUft=Field $b 'boundUft';xml=$b.OuterXml}
 $u=$doc.SelectSingleNode('//thing[id="UnfinishedWeapon78056"]')
 $uft=if($u){[ordered]@{id=Field $u 'id';workLeft=Field $u 'workLeft';ingredientsXml=$u.ingredients.OuterXml;xml=$u.OuterXml}}else{$null}
 $pawn=One $doc '//thing[id="Human961"]';$jobs=One $pawn 'jobs';$carry=One $pawn 'carryTracker';$work=One $pawn 'workSettings'
 $job=[ordered]@{def=Field $jobs 'curJob/def';loadId=Field $jobs 'curJob/loadID';bill=Field $jobs 'curJob/bill';targetA=Field $jobs 'curJob/targetA';targetB=Field $jobs 'curJob/targetB'
  count=IntDefault $jobs 'curJob/count' 0;startTick=Field $jobs 'curJob/startTick';playerForced=((Field $jobs 'curJob/playerForced') -eq 'True');workGiverDef=Field $jobs 'curJob/workGiverDef'
  haulMode=Field $jobs 'curJob/haulMode';opportunisticDuplicates=((Field $jobs 'curJob/haulOpportunisticDuplicates') -eq 'True')
  driverClass=$jobs.curDriver.GetAttribute('Class');driverToil=Field $jobs 'curDriver/curToilIndex';jobXml=$jobs.curJob.OuterXml;driverXml=$jobs.curDriver.OuterXml}
 $zones=@(foreach($z in $doc.SelectNodes('//zoneManager/allZones/li[@Class="Zone_Stockpile"]')){
  $allowed=@($z.SelectNodes('settings/filter/allowedDefs/li')|ForEach-Object InnerText)
  [ordered]@{id=IntDefault $z 'ID' -1;label=Field $z 'label';cells=@($z.SelectNodes('cells/li')|ForEach-Object InnerText);priority=Field $z 'settings/priority'
   woodAllowedLiteral=($allowed -contains 'WoodLog');clubAllowedLiteral=($allowed -contains 'MeleeWeapon_Club');filterXmlSha256=TextHash $z.settings.filter.OuterXml}
 })
 [ordered]@{stage=$n;label=$labels[$n];file=$relative;sha256=Hash $file;tick=[int](Field $doc '//tickManager/ticksGame');bill=$bill;billStackXml=$stack.OuterXml
  uftNamedRawNode=$uft;pawnId='Human961';pawnPosition=Field $pawn 'pos';workPriorities=@($work.SelectNodes('priorities/vals/li')|ForEach-Object {[int]$_.InnerText});workSettingsXml=$work.OuterXml
  job=$job;carry=@(foreach($i in $carry.SelectNodes('innerContainer/innerList/li')){Item $i});carryXml=$carry.OuterXml
  spawnedClubs=@(foreach($i in $doc.SelectNodes('//thing[def="MeleeWeapon_Club"]')){Item $i});stockpileZones=$zones}
})
if(($stages.tick -join ';') -ne '79406;80254;80643;80644;81502;80970;80970;80970'){throw 'Stage ticks changed'}
foreach($s in $stages){
 $b=$s.bill
 if($b.loadId -ne 2 -or $b.class -ne 'Bill_ProductionWithUft' -or $b.recipe -ne 'Make_MeleeWeapon_Club' -or $b.repeatMode -ne 'RepeatCount' -or $b.includeGroup -ne 'null'){throw 'Bill identity/count-scope changed'}
 if($s.stage -gt 0 -and ($s.workPriorities -join ';') -ne '3;3;0;3;3;0;0;0;0;0;0;3;0;0;3;0;3;0;3;0;0'){throw 'Observed work-setting values changed'}
 if($s.stage -le 1){if($b.repeatCount -ne 1 -or $b.boundUft -ne 'Thing_UnfinishedWeapon78056'){throw 'Baseline UFT/bill changed'}}
 else{if($b.repeatCount -ne 0 -or !$b.repeatCountFieldAbsent -or $b.boundUft -ne 'null'){throw 'Completion default/binding changed'}}
 $expectedMode=if($s.stage -le 4){'BestStockpile'}elseif($s.stage -eq 6){'SpecificStockpile'}else{'DropOnFloor'}
 if($b.storeMode -ne $expectedMode -or $b.storeGroup -ne $(if($s.stage -eq 6){'Zone_3'}else{'null'})){throw 'Output policy sequence changed'}
 $zone3=@($s.stockpileZones|Where-Object id -eq 3)
 if($s.stage -in 1..6){if($zone3.Count -ne 1 -or !$zone3[0].clubAllowedLiteral -or $zone3[0].priority -ne 'Normal' -or ($zone3[0].cells -join ';') -ne '(126, 0, 134);(126, 0, 133);(127, 0, 133);(127, 0, 134)'){throw 'Prepared destination changed'}}
 elseif($zone3.Count){throw 'Destination should not be registered in this stage'}
}
if($stages[0].uftNamedRawNode.workLeft -ne '457.196106' -or $stages[1].uftNamedRawNode.workLeft -ne '117.834442' -or $stages[0].uftNamedRawNode.ingredientsXml -cne $stages[1].uftNamedRawNode.ingredientsXml){throw 'Prepared common work item changed'}
$changedWorkSlots=@(0..($stages[0].workPriorities.Count-1)|Where-Object {$stages[0].workPriorities[$_] -ne $stages[1].workPriorities[$_]})
if(($changedWorkSlots -join ';') -ne '17' -or $stages[0].workPriorities[17] -ne 3 -or $stages[1].workPriorities[17] -ne 0){throw 'Work-toggle projection changed'}
foreach($n in @(2,3)){
 $s=$stages[$n];$j=$s.job
 if($j.def -ne 'HaulToCell' -or $j.loadId -ne '71537' -or $j.bill -ne 'null' -or $j.targetA -ne 'Thing_MeleeWeapon_Club149571' -or $j.targetB -ne '(126, 0, 134)' -or $j.count -ne 4 -or $j.startTick -ne '80550' -or $j.playerForced -or $j.workGiverDef -or $j.haulMode -ne 'ToCellStorage'){throw 'Actual delivery job changed'}
 if($s.carry.Count -ne 1 -or $s.carry[0].id -ne 'MeleeWeapon_Club149571' -or $s.carry[0].count -ne 1 -or $s.carry[0].stuff -ne 'WoodLog'){throw 'Actual carried product changed'}
}
if($stages[2].carryXml -cne $stages[3].carryXml -or $stages[2].job.jobXml -cne $stages[3].job.jobXml -or $stages[2].billStackXml -cne $stages[3].billStackXml){throw 'Carrying roundtrip identity changed'}
if($stages[4].carry.Count -ne 0 -or $stages[4].spawnedClubs.Count -ne 1 -or $stages[4].spawnedClubs[0].id -ne 'MeleeWeapon_Club149571' -or $stages[4].spawnedClubs[0].position -ne '(126, 0, 134)'){throw 'Best delivery changed'}
foreach($n in 5..7){$s=$stages[$n];if($s.carry.Count -ne 0 -or $s.spawnedClubs.Count -ne 1 -or $s.spawnedClubs[0].id -ne 'MeleeWeapon_Club185324' -or $s.spawnedClubs[0].position -ne '(108, 0, 129)' -or $s.spawnedClubs[0].count -ne 1){throw 'Drop product or later paused policy edits changed'}}
Add-Type -AssemblyName System.Drawing
$cropDir=Join-Path $evidence 'production-output-runtime'
if(!$Check){[void](New-Item -ItemType Directory -Path $cropDir -Force)}
$specs=@(
 @{name='007-haul-disabled';rect=@(0,1160,1075,245)},@{name='025-best-carrying';rect=@(0,1210,432,200)},
 @{name='035-carrying-restored';rect=@(0,1210,432,200)},@{name='042-delivered-product';rect=@(0,1235,520,175)},
 @{name='053-output-options-held';rect=@(880,385,800,670)},@{name='056-drop-completed';rect=@(0,725,430,490)},
 @{name='063-specific-selected';rect=@(880,385,800,670)},@{name='073-details-after-delete';rect=@(880,385,800,670)}
)
$screens=@(foreach($spec in $specs){
 $name=$spec.name;$r=$spec.rect;$source=Join-Path $runtime "$name.png";$destination=Join-Path $cropDir "$name.png"
 $bitmap=[Drawing.Bitmap]::new($source)
 try{
  if($bitmap.Width -ne 2560 -or $bitmap.Height -ne 1440){throw 'Unexpected screenshot dimensions'}
  $crop=$bitmap.Clone([Drawing.Rectangle]::new($r[0],$r[1],$r[2],$r[3]),$bitmap.PixelFormat)
  try{$stream=[IO.MemoryStream]::new();$crop.Save($stream,[Drawing.Imaging.ImageFormat]::Png);$bytes=$stream.ToArray();$stream.Dispose()}finally{$crop.Dispose()}
 }finally{$bitmap.Dispose()}
 $digest=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
 if($Check){if((Hash $destination) -ne $digest){throw "Crop mismatch: $name"}}else{[IO.File]::WriteAllBytes($destination,$bytes)}
 [ordered]@{source="$runtimeRelative/$name.png";sourceSha256=Hash $source;sourceDimensions=@(2560,1440);crop=$r;file="docs/research/rimworld/evidence/production-output-runtime/$name.png";sha256=$digest;presentation='Unscaled bounded crop; account labels and unrelated desktop notifications excluded.'}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter '*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 $receiptFile=$_;$action=Get-Content -LiteralPath $receiptFile.FullName -Raw|ConvertFrom-Json
 if($action.pid -ne $launch.pid -or [IO.Path]::GetFullPath($action.profile) -ne [IO.Path]::GetFullPath($profile)){throw 'Wrong action process/profile'}
 $captureFile=$receiptFile.FullName.Replace('.actions.jsonl','.jsonl');$capture=Get-Content -LiteralPath $captureFile -Raw|ConvertFrom-Json
 if($capture.pid -ne $launch.pid -or $capture.process -ne 'RimWorld' -or $capture.width -ne 2560 -or $capture.height -ne 1440){throw 'Capture target mismatch'}
 $imageFile=$receiptFile.FullName.Replace('.actions.jsonl','')
 if([IO.Path]::GetFullPath($capture.image) -ne $imageFile -or [IO.Path]::GetFullPath($action.image) -ne $imageFile){throw 'Receipt image mismatch'}
 [ordered]@{ordinal=[int]$receiptFile.Name.Substring(0,3);file="$runtimeRelative/$($receiptFile.Name)";sha256=Hash $receiptFile.FullName;action=$action
  captureReceipt="$runtimeRelative/$([IO.Path]::GetFileName($captureFile))";captureReceiptSha256=Hash $captureFile;sourceImageSha256=Hash $imageFile}
})
if($actions.Count -ne 77 -or ($actions.ordinal -join ';') -ne (1..77 -join ';')){throw 'Recorded action sequence changed'}
$pulses=@($actions|Where-Object {$_.action.action -in @('pulse','pulseclick')})
if(($pulses.ordinal -join ';') -ne '14;19;20;23;24;39;41;56'){throw 'Pulse receipts changed'}
foreach($n in @(34,47,54,63,70)){if($actions[$n-1].action.action -ne 'click'){throw 'Required ordinary UI action changed'}}
$report=[ordered]@{
 id='RW17-PRODUCTION-OUTPUT-RUNTIME';sourceSha256=$assembly;version='1.7.4980 rev60';enabledMods=$mods
 kind='Observed native UI plus original save XML, retained input/capture receipts and bounded screenshots; matched static evidence interprets fields.'
 preparation='v41 actual resumed wooden-club save2 copied unchanged into one isolated Core + Odyssey profile. Earlier chapter43 crafting used ordinary UI with God mode off; colony inherited older dev preparation. Dev mode remains enabled. This trial only used ordinary work-toggle, zone creation/deletion, bill setting, time, save/load and quit UI; no spawning/injection/save-XML edits.'
 scope='One original UFT and maker, Best and Drop branches from the same prepared save1. Specific is only settings serialization and destination-deletion validation after completion, not a third production. Read-only save XML informs observation, so not screen-only.'
 observations=@(
  'Ordinary Work UI disables Squint Haul; save1 preserves UFT78056 and its material list, workLeft117.834442, and adds four-cell Normal zone3 allowing clubs. The observed serialized priority value at zero-based slot17 changes3 to0; mapping is corroborated by the Haul-column screenshot, not assumed to be a universal Def index.'
  'Best completes iteration while product is still carried: save2 tick80643 has repeatCount0 (omitted serialization default), boundUft=null, HaulToCell71537 toward(126,0,134), actual Club149571x1. Job.count4 is planned capacity, not four produced clubs. Haul remains disabled.'
  'Ordinary Load save2 then Save save3: tick80643->80644, full carryTracker XML, current Job XML and billStack XML exactly equal. Driver XML advances; no whole-world equality claim.'
  'After further ordinary time, save4 has the same Club149571x1 spawned at(126,0,134), one of zone3 cells, and empty carry tracker. UI shows Wooden club there.'
  'Ordinary Load save1 and switch DropOnFloor before finishing: save5 tick80970 has repeatCount0, no carry, and Club185324x1 at(108,0,129), the original worker interaction cell near the crafting spot.'
  'While paused after Drop completion, set Specific to zone3 and save6: storeGroup=Zone_3, includeGroup=null. Delete zone3 through its ordinary Delete command; reopened bill shows DropOnFloor and save7 records storeGroup=null. Both saves tick80970; no new production occurred.'
 )
 limits=@(
  'Best and Drop are two branches of the same one-item baseline, not multi-colonist scheduling or multiple-product/capacity/failure coverage. Initial DoBill is inherited playerForced; the completed HaulToCell has no playerForced/workGiverDef and no bill reference.'
  'No native full/filter/reach failure, destination deletion during transit, interruption/cargo-drop, packed-shelf group, or at-place partial-placement trial. These remain static evidence or explicitly documented Web adaptations.'
  'Filename019-near-finish/020-finish-best did not establish completion;022 still displayed unfinished work. Filename039-delivered is an ineffective pulse while the menu was open;041 is the actual delivery pulse. Full original receipts retain these attempts.'
  'All eight bounded pulses are action intent, not measured simulation durations or a TPS benchmark. Saved ticks and actual object/job fields govern results. Menu closure and pointer parking affect ordinary UI interactions.'
  'No full compressedThingMapDeflate decode and no universal object-absence claim from missing raw named nodes. Positive product/carry/bill evidence identifies observed completion.'
  'Quit078 executed before trailing foreground-guarded capture failed; no078 image/action receipt is fabricated. Fresh CIM12:21:37.4855671Z confirms PID18100 absent and no remaining RimWorld processes.'
  'Full screenshots and saves stay ignored. Public crops exclude account labels and unrelated desktop notifications. Windows native REA capture was not used; actual UI used guarded Win32 input/capture.'
 )
 launch=$launch;launchReceiptSha256=Hash $launchFile;exit=$exitRecord;exitReceiptSha256=Hash $exitFile
 profileConfig=[ordered]@{modsFile="$profileRelative/Config/ModsConfig.xml";modsSha256=Hash $configFile;prefsFile="$profileRelative/Config/Prefs.xml";prefsSha256=Hash $prefsFile;devMode=Field $prefs '//devMode'}
 staticEvidence=[ordered]@{file='production-output-evidence.json';sha256=Hash (Join-Path $evidence 'production-output-evidence.json');relevantClaims=@('OUT01','OUT02','OUT03','OUT05','OUT10','OUT13','OUT15','OUT16')}
 defaultInterpretation='Bill_Production.ExposeData serializes repeatCount with default0; omitted repeatCount after completion means0, despite constructor default1.'
 workToggle=[ordered]@{changedZeroBasedSlots=$changedWorkSlots;before=$stages[0].workPriorities[17];after=$stages[1].workPriorities[17];uiReceipt=7;scope='This observed profile sequence only; not a portable WorkTypeDef ordinal map.'}
 roundtrip=[ordered]@{loadedSaveStage=2;resavedStage=3;loadActionOrdinal=34;carryTrackerXmlExactlyEqual=($stages[2].carryXml -ceq $stages[3].carryXml);currentJobXmlExactlyEqual=($stages[2].job.jobXml -ceq $stages[3].job.jobXml);billStackXmlExactlyEqual=($stages[2].billStackXml -ceq $stages[3].billStackXml);driverXmlExactlyEqual=($stages[2].job.driverXml -ceq $stages[3].job.driverXml);tickDelta=($stages[3].tick-$stages[2].tick)}
 dropComparison=[ordered]@{commonPreparedStage=1;loadActionOrdinal=47;setDropActionOrdinal=54;resultStage=5}
 specificValidation=[ordered]@{setActionOrdinal=63;setStage=6;deleteZoneActionOrdinal=70;resultStage=7;runtimeProductionCovered=$false}
 stages=$stages;screenshots=$screens;actions=$actions
}
$json=(LF ($report|ConvertTo-Json -Depth 40))+[char]10
if($Check){if((LF ([IO.File]::ReadAllText($output))) -cne $json){throw 'Retained native production-output record changed'}}
else{[IO.File]::WriteAllText($output,$json,[Text.UTF8Encoding]::new($false))}
"Verified baseline plus7 native saves, $($screens.Count) crops, $($actions.Count) receipts and actual carrying save/load roundtrip."
