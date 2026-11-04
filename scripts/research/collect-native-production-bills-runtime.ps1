param([switch]$Check)
# Read-only replay of recorded native UI evidence. Never launches the game or edits saves.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtimeRelative='.local-research/runtime/production-bills-20261104'
$profileRelative='.local-research/runtime/profile-production-bills-20261104'
$runtime=Join-Path $root $runtimeRelative
$profile=Join-Path $root $profileRelative
$evidence=Join-Path $root 'docs/research/rimworld/evidence'
$output=Join-Path $evidence 'native-production-bills-runtime.json'
function Hash([string]$file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
function LF([string]$s){$s.Replace(([string][char]13+[char]10),[string][char]10)}
function ReadXml([string]$file){
 $doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null
 $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit
 $reader=[Xml.XmlReader]::Create($file,$settings)
 try{$doc.Load($reader)}finally{$reader.Dispose()}
 return ,$doc
}
function Field($node,[string]$path){if($null -eq $node){return $null};$child=$node.SelectSingleNode($path);if($child){$child.InnerText}else{$null}}
function ExactlyOne($doc,[string]$xpath){$nodes=@($doc.SelectNodes($xpath));if($nodes.Count -ne 1){throw "Expected one XML match: $xpath, found $($nodes.Count)"};return ,$nodes[0]}
function IntDefault($node,[string]$path,[int]$default){$value=Field $node $path;if($null -eq $value){$default}else{[int]$value}}
function BoolDefault($node,[string]$path){(Field $node $path) -eq 'True'}
function ThingProjection($node){
 if($null -eq $node){return $null}
 [ordered]@{id=Field $node 'id';class=$node.GetAttribute('Class');def=Field $node 'def';parentElement=$node.ParentNode.LocalName
  position=Field $node 'pos';map=Field $node 'map';stackCount=IntDefault $node 'stackCount' 1
  stackCountFieldAbsent=($null -eq (Field $node 'stackCount'));spawnedTick=Field $node 'spawnedTick';xmlSha256=TextHash $node.OuterXml}
}
$launchFile=Join-Path $runtime 'launch-record.json';$exitFile=Join-Path $runtime 'exit-record.json'
$launch=Get-Content -LiteralPath $launchFile -Raw|ConvertFrom-Json
$exitRecord=Get-Content -LiteralPath $exitFile -Raw|ConvertFrom-Json
if($exitRecord.targetExists -or $exitRecord.targetPid -ne $launch.pid -or $launch.pid -ne 24752 -or @($exitRecord.remainingRimWorldPids).Count -ne 0){throw 'Missing confirmed native process exit'}
if([IO.Path]::GetFullPath($launch.profile) -ne [IO.Path]::GetFullPath($profile)){throw 'Unexpected isolated profile'}
if([IO.Path]::GetFullPath($launch.copiedBaseline) -ne [IO.Path]::GetFullPath((Join-Path $profile 'Saves/ProductionBillsBaseline.rws'))){throw 'Unexpected baseline copy'}
if((Hash $launch.baseline) -ne $launch.baselineSha256 -or (Hash $launch.copiedBaseline) -ne $launch.baselineSha256 -or $launch.baselineSha256 -ne '41c9cbbac0909b8804450eaca7a2c8d32cd023f6348676a4af02d027edc17233'){throw 'Prepared baseline changed'}
$assembly=Hash 'F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll'
if($assembly -ne $launch.assemblySha256 -or $assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Native artifact changed'}
$configFile=Join-Path $profile 'Config/ModsConfig.xml';$config=ReadXml $configFile
$expectedMods=@('ludeon.rimworld','ludeon.rimworld.odyssey')
$mods=@($config.SelectNodes('/ModsConfigData/activeMods/li')|ForEach-Object InnerText)
if(($mods -join ';') -ne ($expectedMods -join ';')){throw 'Unexpected enabled mods'}
$prefsFile=Join-Path $profile 'Config/Prefs.xml';$prefs=ReadXml $prefsFile
if((Field $prefs '//devMode') -ne 'True'){throw 'Expected inherited dev-enabled profile'}
$derived=@(foreach($pair in @(@('food','RimWorld.Bill'),@('stonecutting','RimWorld.Bill_Production'),@('production-bills','RimWorld.BillStack'))){
 $manifestName=$pair[0]+'-manifest.json';$m=Get-Content (Join-Path $evidence $manifestName) -Raw|ConvertFrom-Json
 if($m.source_sha256 -ne $assembly){throw 'Derived source identity mismatch'}
 $entries=@($m.types|Where-Object type -eq $pair[1]);if($entries.Count -ne 1){throw 'Missing derived type'};$entry=$entries[0]
 if((Hash (Join-Path $root $entry.local_file)) -ne $entry.sha256){throw "Derived file mismatch: $($pair[1])"}
 [ordered]@{manifest=$manifestName;manifestSha256=Hash (Join-Path $evidence $manifestName);type=$entry.type;file=$entry.local_file;sha256=$entry.sha256}
})
$labels=@('baseline-active-work','manual-suspension','unsuspended-prioritized-intermediate-haul','completed-and-queue-reordered')
$stages=@(foreach($n in 0..3){
 $saveName=if($n -eq 0){'ProductionBillsBaseline.rws'}else{"New Arrivals$n.rws"}
 $relative="$profileRelative/Saves/$saveName";$file=Join-Path $root $relative;$doc=ReadXml $file
 if((Field $doc '//meta/gameVersion') -ne '1.7.4980 rev60'){throw 'Save version changed'}
 if((@($doc.SelectNodes('//meta/modIds/li')|ForEach-Object InnerText) -join ';') -ne ($expectedMods -join ';')){throw 'Save mod identity changed'}
 $table=ExactlyOne $doc '//thing[id="TableStonecutter42144"]'
 $stack=ExactlyOne $table 'billStack'
 $bills=@(foreach($node in $stack.SelectNodes('bills/li')){
  [ordered]@{loadId=IntDefault $node 'loadID' 0;loadIdFieldAbsent=($null -eq (Field $node 'loadID'))
   class=$node.GetAttribute('Class');recipe=Field $node 'recipe';repeatMode=Field $node 'repeatMode'
   repeatCount=IntDefault $node 'repeatCount' 0;repeatCountFieldAbsent=($null -eq (Field $node 'repeatCount'))
   suspended=BoolDefault $node 'suspended';suspendedFieldAbsent=($null -eq (Field $node 'suspended'))
   paused=BoolDefault $node 'paused';pausedFieldAbsent=($null -eq (Field $node 'paused'))
   pauseWhenSatisfied=BoolDefault $node 'pauseWhenSatisfied';pauseWhenSatisfiedFieldAbsent=($null -eq (Field $node 'pauseWhenSatisfied'))
   targetCount=Field $node 'targetCount';unpauseWhenYouHave=Field $node 'unpauseWhenYouHave'
   storeMode=Field $node 'storeMode';storeGroup=Field $node 'storeGroup';includeGroup=Field $node 'includeGroup'
   allowedIngredients=@($node.SelectNodes('ingredientFilter/allowedDefs/li')|ForEach-Object InnerText);xml=$node.OuterXml}
 })
 if((Field $table 'pos') -ne '(113, 0, 138)' -or (Field $table 'map') -ne '0'){throw 'Table identity/location differs'}
 if(@($bills|Where-Object recipe -ne 'Make_StoneBlocksGranite').Count -ne 0){throw 'Unexpected recipe'}
 $pawn=ExactlyOne $doc '//thing[id="Human961"]';$jobs=ExactlyOne $pawn 'jobs'
 $job=[ordered]@{def=Field $jobs 'curJob/def';loadId=Field $jobs 'curJob/loadID';bill=Field $jobs 'curJob/bill'
  targetA=Field $jobs 'curJob/targetA';targetB=Field $jobs 'curJob/targetB';startTick=Field $jobs 'curJob/startTick'
  playerForced=BoolDefault $jobs 'curJob/playerForced';workGiverDef=Field $jobs 'curJob/workGiverDef'
  workLeft=Field $jobs 'curDriver/workLeft';ticksSpentDoingRecipeWork=Field $jobs 'curDriver/ticksSpentDoingRecipeWork';xml=$jobs.OuterXml}
 $outputNodes=@($doc.SelectNodes('//thing[id="BlocksGranite77898"]'));if($outputNodes.Count -gt 1){throw 'Duplicate output ID'}
 $inputNodes=@($doc.SelectNodes('//id[text()="ChunkGranite42145"]/parent::*'));if($inputNodes.Count -gt 1){throw 'Duplicate input ID'}
 $zones=@(foreach($zone in $doc.SelectNodes('//zoneManager/allZones/li[@Class="Zone_Stockpile"]')){
  [ordered]@{id=Field $zone 'ID';cells=@($zone.SelectNodes('cells/li')|ForEach-Object InnerText)
   allowedDefs=@($zone.SelectNodes('settings/filter/allowedDefs/li')|ForEach-Object InnerText);xmlSha256=TextHash $zone.OuterXml}
 })
 [ordered]@{stage=$n;label=$labels[$n];file=$relative;sha256=Hash $file;tick=[int](Field $doc '//tickManager/ticksGame')
  table=ThingProjection $table;bills=$bills;billStackXmlSha256=TextHash $stack.OuterXml;pawnId='Human961';job=$job
  explicitInputMatches=$inputNodes.Count;input=if($inputNodes.Count){ThingProjection $inputNodes[0]}else{$null}
  explicitOutputMatches=$outputNodes.Count;output=if($outputNodes.Count){ThingProjection $outputNodes[0]}else{$null};stockpiles=$zones
  explicitXmlCaveat='Zero explicit matches alone do not establish global absence: compressedThingMapDeflate is not decoded by this collector.'}
})
if(($stages.tick -join ';') -ne '47518;47541;47569;51573'){throw 'Native stage ticks changed'}
if($stages[0].job.def -ne 'DoBill' -or $stages[0].job.bill -ne 'Bill_Make_StoneBlocksGranite_0' -or $stages[0].job.workLeft -ne '1195.07764'){throw 'Baseline active-work evidence changed'}
foreach($n in 0..2){if($stages[$n].bills.Count -ne 1 -or $stages[$n].bills[0].loadId -ne 0 -or $stages[$n].bills[0].repeatCount -ne 1){throw 'Pre-completion bill identity/count differs'}}
if(!$stages[1].bills[0].suspended -or $stages[1].job.def -ne 'HaulToCell' -or $stages[1].job.targetA -ne 'Thing_WoodLog42139' -or $stages[1].job.startTick -ne '47520'){throw 'Manual suspension observation changed'}
if($stages[2].bills[0].suspended -or $stages[2].job.def -ne 'HaulToCell' -or $stages[2].job.targetA -ne 'Thing_ChunkGranite42145' -or !$stages[2].job.playerForced -or $stages[2].job.workGiverDef -ne 'DoBillsStonecut'){throw 'Intermediate prioritized haul differs'}
$final=$stages[3]
if(($final.bills.loadId -join ';') -ne '2;0;1' -or ($final.bills.repeatMode -join ';') -ne 'TargetCount;RepeatCount;Forever'){throw 'Final queue identity/order differs'}
if($final.bills[1].repeatCount -ne 0 -or !$final.bills[1].repeatCountFieldAbsent -or $final.output.stackCount -ne 20 -or $final.output.position -ne '(113, 0, 137)' -or $final.output.spawnedTick -ne '50208'){throw 'Completion evidence changed'}
if($final.bills[0].targetCount -ne '10' -or $final.bills[0].unpauseWhenYouHave -ne '5' -or !$final.bills[0].pauseWhenSatisfied){throw 'Hysteresis configuration changed'}
if($final.stockpiles.Count -ne 1 -or ($final.stockpiles[0].allowedDefs -join ';') -ne 'WoodLog' -or ($final.stockpiles[0].cells -join ';') -ne '(105, 0, 129)'){throw 'Storage setup changed'}
Add-Type -AssemblyName System.Drawing
$cropDir=Join-Path $evidence 'production-bills-runtime'
if(!$Check){[void](New-Item -ItemType Directory -Path $cropDir -Force)}
$specs=@(
 @{name='008-bill-active';rect=@(0,725,430,490)},@{name='009-suspended';rect=@(0,725,430,490)},
 @{name='035-completion';rect=@(100,0,620,65)},@{name='037-complete-bill';rect=@(0,725,430,490)},
 @{name='040-mode-menu';rect=@(0,725,650,490)},@{name='047-target-hysteresis';rect=@(875,385,810,680)},
 @{name='048-close-details';rect=@(0,725,430,490)},@{name='049-reorder-once';rect=@(0,725,430,490)},
 @{name='050-reorder-top';rect=@(0,725,430,490)}
)
$screens=@(foreach($spec in $specs){
 $name=$spec.name;$r=$spec.rect;$source=Join-Path $runtime "$name.png";$destination=Join-Path $cropDir "$name.png"
 $bitmap=[Drawing.Bitmap]::new($source)
 try{
  if($bitmap.Width -ne 2560 -or $bitmap.Height -ne 1440){throw 'Unexpected source screenshot dimensions'}
  $crop=$bitmap.Clone([Drawing.Rectangle]::new($r[0],$r[1],$r[2],$r[3]),$bitmap.PixelFormat)
  try{$stream=[IO.MemoryStream]::new();$crop.Save($stream,[Drawing.Imaging.ImageFormat]::Png);$bytes=$stream.ToArray();$stream.Dispose()}
  finally{$crop.Dispose()}
 }finally{$bitmap.Dispose()}
 $digest=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
 if($Check){if((Hash $destination) -ne $digest){throw "Crop mismatch: $name"}}else{[IO.File]::WriteAllBytes($destination,$bytes)}
 [ordered]@{source="$runtimeRelative/$name.png";sourceSha256=Hash $source;sourceDimensions=@(2560,1440)
  crop=$r;file="docs/research/rimworld/evidence/production-bills-runtime/$name.png";sha256=$digest
  presentation='Unscaled rectangular crop of bill UI or completion message; unrelated desktop notifications and menu account labels excluded.'}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter '*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 $receiptFile=$_;$action=Get-Content -LiteralPath $receiptFile.FullName -Raw|ConvertFrom-Json
 if($action.pid -ne $launch.pid -or [IO.Path]::GetFullPath($action.profile) -ne [IO.Path]::GetFullPath($profile)){throw 'Action receipt belongs to another process/profile'}
 $captureFile=$receiptFile.FullName.Replace('.actions.jsonl','.jsonl')
 $capture=Get-Content -LiteralPath $captureFile -Raw|ConvertFrom-Json
 if($capture.pid -ne $launch.pid -or $capture.process -ne 'RimWorld' -or $capture.width -ne 2560 -or $capture.height -ne 1440){throw 'Capture receipt target mismatch'}
 $imageFile=$receiptFile.FullName.Replace('.actions.jsonl','')
 if([IO.Path]::GetFullPath($capture.image) -ne $imageFile -or [IO.Path]::GetFullPath($action.image) -ne $imageFile){throw 'Receipt image mismatch'}
 [ordered]@{file="$runtimeRelative/$($receiptFile.Name)";sha256=Hash $receiptFile.FullName;action=$action
  captureReceipt="$runtimeRelative/$([IO.Path]::GetFileName($captureFile))";captureReceiptSha256=Hash $captureFile;sourceImageSha256=Hash $imageFile
  observationCaveat=if($receiptFile.Name -match '^03[01]-'){'Pulse attempt occurred while menu was open; not evidence of gameplay progression.'}elseif($receiptFile.Name -match '^(025|029)-'){'Filename mentions restarted work, but observed state/save is intermediate chunk hauling, not active recipe work.'}else{$null}}
})
if($actions.Count -ne 54){throw 'Native action record count changed'}
$report=[ordered]@{
 id='RW17-PRODUCTION-BILLS-RUNTIME';sourceSha256=$assembly;version='1.7.4980 rev60';enabledMods=$mods
 kind='Observed native UI sequence with original save XML, retained receipts and cropped screenshots; matched static sources interpret omitted serialization defaults.'
 preparation='Unmodified stonecutting-working.rws copied into an isolated Core + Odyssey profile. Historical lab used dev/God placement for the wooden table and granite chunk and restored Squint needs (chapter25). Dev mode remained enabled, but this trial used ordinary bill, prioritize, time-control, save and quit UI; no spawn, injection or save edits.'
 scope='One wooden stonecutting table and one granite-block recipe; baseline load plus three fresh UI saves. Read-only original save XML and screenshots informed control; not screen-only.'
 observations=@(
  'Baseline tick47518: Squint is actively executing DoBill for Bill0, workLeft1195.07764 and repeatCount1.'
  'After manual suspension, save1 tick47541 retains repeatCount1 and suspended=true; Squint changed to wood hauling starting tick47520. Suspension interrupted the work stage without spending an iteration.'
  'After unsuspend and ordinary Prioritize cutting stone blocks, save2 tick47569 is player-forced chunk hauling from DoBillsStonecut. It does not establish resumed/reset recipe progress.'
  'Later screenshot035 reports Bill complete. Save3 contains BlocksGranite77898 with20 units, spawnedTick50208, and original Bill0 remains in the list at repeatCount0.'
  'Two additional same-recipe bills coexist. Native UI exposes all three repeat modes, and save3 order is Bill2 TargetCount, Bill0 RepeatCount0, Bill1 Forever after two up-arrow clicks.'
  'Target bill configuration serializes target10, pauseWhenSatisfied=true and unpauseWhenYouHave5. No actual stock-triggered pause/resume cycle was tested.'
  'Screenshots045-050 show target0/10 while the20 newly produced blocks lie at (113,0,137); saved stockpile accepts only WoodLog at a different cell. This limited case corroborates that arbitrary ground products are not counted by the current default setup.'
 )
 limits=@(
  'No runtime UFT creation/deletion/cancellation, ingredient-return, active-job reorder/preemption or ingredient-haul suspension experiment.'
  'Hysteresis settings were configured and saved, not driven through target and resume thresholds; no automatic paused-state transition is claimed.'
  'No exhaustive ground/storage/carried/equipped/custom-counter matrix, in-flight target overshoot or zero-target boundary test.'
  'Only the copied baseline was loaded; the three newly saved stages were not loaded again. Serialization evidence is not a complete save/load roundtrip.'
  'The second save captures intermediate hauling, not workLeft. It cannot establish preservation or reset of production progress after suspension.'
  'Pulse attempts030/031 happened with the menu open; they are retained as attempted actions, not successful gameplay progression. Wall-clock pulse duration is not a TPS benchmark.'
  'Missing explicit XML objects do not prove global absence because compressedThingMapDeflate was not decoded.'
  'Bill loadID0, repeatCount0 and absent false booleans use matched Scribe defaults; constructor repeatCount1 is not the serialization default. Native0x display corroborates completed count0.'
  'Raw screenshots may contain unrelated desktop notifications or menu account names; only bounded, reviewed bill/message crops are public.'
  'Normal Quit to OS clicked after the final save; process exited before the trailing screenshot, causing its foreground guard to reject capture. There is no055 action/image receipt; a fresh CIM exit record confirms no remaining RimWorld process.'
 )
 launch=$launch;launchReceiptSha256=Hash $launchFile;exit=$exitRecord;exitReceiptSha256=Hash $exitFile
 profileConfig=[ordered]@{modsFile="$profileRelative/Config/ModsConfig.xml";modsSha256=Hash $configFile;prefsFile="$profileRelative/Config/Prefs.xml";prefsSha256=Hash $prefsFile;devMode=Field $prefs '//devMode'}
 staticEvidence=[ordered]@{file='production-bills-evidence.json';sha256=Hash (Join-Path $evidence 'production-bills-evidence.json');relevantClaims=@('PB01','PB02','PB04','PB05','PB07','PB09','PB19')}
 defaultInterpretation=[ordered]@{bill='food/RimWorld.Bill: loadID0 and suspended=false';production='stonecutting/RimWorld.Bill_Production: repeatCount0, paused=false, pauseWhenSatisfied=false; field absence is explicit in every projected bill'}
 derived=$derived;stages=$stages;screenshots=$screens;actions=$actions
}
$json=(LF ($report|ConvertTo-Json -Depth 40))+[char]10
if($Check){if((LF ([IO.File]::ReadAllText($output))) -cne $json){throw 'Collected native production-bills record changed'}}
else{[IO.File]::WriteAllText($output,$json,[Text.UTF8Encoding]::new($false))}
"Verified baseline plus 3 native saves, $($screens.Count) crops, $($actions.Count) action records and $($derived.Count) default-interpretation source types."
