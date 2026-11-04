param([switch]$Check)
# Read-only replay of completed native observations. No game launch/input or save/config edits.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtimeRelative='.local-research/runtime/unfinished-production-20261104'
$profileRelative='.local-research/runtime/profile-unfinished-production-20261104'
$runtime=Join-Path $root $runtimeRelative;$profile=Join-Path $root $profileRelative
$evidence=Join-Path $root 'docs/research/rimworld/evidence'
$output=Join-Path $evidence 'native-unfinished-production-runtime.json'
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
function BoolDefault($node,[string]$path){(Field $node $path) -eq 'True'}
$launchFile=Join-Path $runtime 'launch-record.json';$exitFile=Join-Path $runtime 'exit-record.json'
$launch=Get-Content -LiteralPath $launchFile -Raw|ConvertFrom-Json
$exitRecord=Get-Content -LiteralPath $exitFile -Raw|ConvertFrom-Json
if($exitRecord.targetExists -or $exitRecord.targetPid -ne $launch.pid -or $launch.pid -ne 30744 -or @($exitRecord.remainingRimWorldPids).Count -ne 0){throw 'Missing confirmed native process exit'}
if([IO.Path]::GetFullPath($launch.profile) -ne [IO.Path]::GetFullPath($profile)){throw 'Unexpected isolated profile'}
if([IO.Path]::GetFullPath($launch.copiedBaseline) -ne [IO.Path]::GetFullPath((Join-Path $profile 'Saves/UnfinishedProductionBaseline.rws'))){throw 'Unexpected baseline copy'}
if((Hash $launch.baseline) -ne $launch.baselineSha256 -or (Hash $launch.copiedBaseline) -ne $launch.baselineSha256 -or $launch.baselineSha256 -ne '6323d1c9c32c5330a7dcb011a36726f689c139642d43d7480641061b4c0d81a2'){throw 'Prepared baseline changed'}
$assembly=Hash 'F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll'
if($assembly -ne $launch.assemblySha256 -or $assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Native artifact changed'}
$configFile=Join-Path $profile 'Config/ModsConfig.xml';$config=ReadXml $configFile
$expectedMods=@('ludeon.rimworld','ludeon.rimworld.odyssey')
$mods=@($config.SelectNodes('/ModsConfigData/activeMods/li')|ForEach-Object InnerText)
if(($mods -join ';') -ne ($expectedMods -join ';')){throw 'Unexpected enabled mods'}
$prefsFile=Join-Path $profile 'Config/Prefs.xml';$prefs=ReadXml $prefsFile
if((Field $prefs '//devMode') -ne 'True'){throw 'Expected inherited dev-enabled profile'}
$derived=@(foreach($pair in @(@('weapons','Verse.UnfinishedThing'),@('production-bills','RimWorld.Bill_ProductionWithUft'),@('food','Verse.AI.JobDriver_DoBill'),@('food','RimWorld.Bill'))){
 $manifestName=$pair[0]+'-manifest.json';$m=Get-Content (Join-Path $evidence $manifestName) -Raw|ConvertFrom-Json
 if($m.source_sha256 -ne $assembly){throw 'Derived source identity mismatch'}
 $entries=@($m.types|Where-Object type -eq $pair[1]);if($entries.Count -ne 1){throw 'Missing derived type'};$entry=$entries[0]
 if((Hash (Join-Path $root $entry.local_file)) -ne $entry.sha256){throw "Derived file mismatch: $($pair[1])"}
 [ordered]@{manifest=$manifestName;manifestSha256=Hash (Join-Path $evidence $manifestName);type=$entry.type;file=$entry.local_file;sha256=$entry.sha256}
})
$labels=@('baseline-active-wooden-club','suspended-bill-retained-uft','new-job-resumes-same-uft','deleted-bill-retained-unbound-uft','loaded-deleted-bill-save-and-resaved')
$stages=@(foreach($n in 0..4){
 $saveName=if($n -eq 0){'UnfinishedProductionBaseline.rws'}else{"New Arrivals$n.rws"}
 $relative="$profileRelative/Saves/$saveName";$file=Join-Path $root $relative;$doc=ReadXml $file
 if((Field $doc '//meta/gameVersion') -ne '1.7.4980 rev60'){throw 'Save version changed'}
 if((@($doc.SelectNodes('//meta/modIds/li')|ForEach-Object InnerText) -join ';') -ne ($expectedMods -join ';')){throw 'Save mods changed'}
 $table=One $doc '//thing[id="CraftingSpot78052"]';$stack=One $table 'billStack'
 if((Field $table 'pos') -ne '(108, 0, 130)' -or (Field $table 'map') -ne '0' -or (Field $table 'def') -ne 'CraftingSpot'){throw 'Crafting spot identity changed'}
 $bills=@(foreach($node in $stack.SelectNodes('bills/li')){
  [ordered]@{loadId=IntDefault $node 'loadID' 0;class=$node.GetAttribute('Class');recipe=Field $node 'recipe'
   suspended=BoolDefault $node 'suspended';suspendedFieldAbsent=($null -eq (Field $node 'suspended'));repeatMode=Field $node 'repeatMode';repeatCount=IntDefault $node 'repeatCount' 0
   boundUft=Field $node 'boundUft';pawnRestriction=Field $node 'pawnRestriction';xml=$node.OuterXml}
 })
 $u=One $doc '//thing[id="UnfinishedWeapon78056"]';$ingredients=One $u 'ingredients'
 $uft=[ordered]@{class=$u.GetAttribute('Class');id=Field $u 'id';def=Field $u 'def';map=Field $u 'map';position=Field $u 'pos';health=Field $u 'health';stuff=Field $u 'stuff'
  spawnedTick=Field $u 'spawnedTick';creator=Field $u 'creator';creatorName=Field $u 'creatorName';bill=Field $u 'bill';recipe=Field $u 'recipe';workLeft=Field $u 'workLeft'
  ingredients=@(foreach($i in $ingredients.SelectNodes('li')){[ordered]@{class=$i.GetAttribute('Class');id=Field $i 'id';def=Field $i 'def';count=IntDefault $i 'stackCount' 1;health=Field $i 'health';despawnedTick=Field $i 'despawnedTick';xml=$i.OuterXml}})
  ingredientsXml=$ingredients.OuterXml;xml=$u.OuterXml;xmlSha256=TextHash $u.OuterXml}
 $pawn=One $doc '//thing[id="Human961"]';$jobs=One $pawn 'jobs'
 $job=[ordered]@{def=Field $jobs 'curJob/def';loadId=Field $jobs 'curJob/loadID';bill=Field $jobs 'curJob/bill';targetA=Field $jobs 'curJob/targetA';targetB=Field $jobs 'curJob/targetB';startTick=Field $jobs 'curJob/startTick'
  playerForced=BoolDefault $jobs 'curJob/playerForced';workLeft=Field $jobs 'curDriver/workLeft';billStartTick=Field $jobs 'curDriver/billStartTick';ticksSpentDoingRecipeWork=Field $jobs 'curDriver/ticksSpentDoingRecipeWork';xml=$jobs.OuterXml}
 [ordered]@{stage=$n;label=$labels[$n];file=$relative;sha256=Hash $file;tick=[int](Field $doc '//tickManager/ticksGame')
  tableId='CraftingSpot78052';tablePosition=Field $table 'pos';bills=$bills;billStackXml=$stack.OuterXml;billStackXmlSha256=TextHash $stack.OuterXml
  uft=$uft;pawnId='Human961';craftingLevel=IntDefault $pawn 'skills/skills/li[def="Crafting"]/level' 0;job=$job}
})
if(($stages.tick -join ';') -ne '79302;79315;79406;79419;79420'){throw 'Stage ticks changed'}
foreach($s in $stages){
 $u=$s.uft
 if($s.craftingLevel -ne 3 -or $u.class -ne 'UnfinishedThing' -or $u.def -ne 'UnfinishedWeapon' -or $u.map -ne '0' -or $u.position -ne '(108, 0, 130)' -or $u.health -ne '32' -or $u.stuff -ne 'WoodLog' -or $u.creator -ne 'Thing_Human961' -or $u.creatorName -ne 'Squint' -or $u.recipe -ne 'Make_MeleeWeapon_Club'){throw 'UFT or author identity changed'}
 if($u.ingredients.Count -ne 1 -or $u.ingredients[0].id -ne 'WoodLog78055' -or $u.ingredients[0].count -ne 40 -or $u.ingredients[0].def -ne 'WoodLog' -or $u.ingredientsXml -cne $stages[0].uft.ingredientsXml){throw 'Original encapsulated ingredients changed'}
}
foreach($n in 0..2){
 $s=$stages[$n]
 if($s.bills.Count -ne 1 -or $s.bills[0].loadId -ne 2 -or $s.bills[0].class -ne 'Bill_ProductionWithUft' -or $s.bills[0].recipe -ne 'Make_MeleeWeapon_Club' -or $s.bills[0].repeatCount -ne 1 -or $s.bills[0].repeatMode -ne 'RepeatCount' -or $s.bills[0].boundUft -ne 'Thing_UnfinishedWeapon78056' -or $s.uft.bill -ne 'Bill_Make_MeleeWeapon_Club_2'){throw 'Original bill or binding changed'}
}
if($stages[0].bills[0].suspended -or !$stages[1].bills[0].suspended -or $stages[2].bills[0].suspended){throw 'Suspend/resume sequence changed'}
if($stages[0].uft.xml -cne $stages[1].uft.xml -or $stages[0].uft.workLeft -ne '471.596252'){throw 'Suspension did not preserve original UFT exactly'}
if($stages[1].job.def -ne 'HaulToCell' -or $stages[1].job.loadId -ne '62948' -or $stages[1].job.startTick -ne '79304'){throw 'Suspension job observation changed'}
foreach($n in @(0,2)){
 $s=$stages[$n]
 if($s.job.def -ne 'DoBill' -or !$s.job.playerForced -or $s.job.bill -ne 'Bill_Make_MeleeWeapon_Club_2' -or $s.job.targetB -ne 'Thing_UnfinishedWeapon78056' -or $s.job.workLeft -ne $s.uft.workLeft){throw 'Active UFT/job progress mismatch'}
}
if($stages[0].job.loadId -ne '59462' -or $stages[0].job.ticksSpentDoingRecipeWork -ne '921' -or $stages[2].job.loadId -ne '62954' -or $stages[2].job.startTick -ne '79315' -or $stages[2].job.billStartTick -ne '79370' -or $stages[2].job.ticksSpentDoingRecipeWork -ne '36' -or $stages[2].uft.workLeft -ne '457.196106' -or $stages[2].uft.spawnedTick -ne '79370'){throw 'Same-entity resumed-work observation changed'}
foreach($n in 3..4){
 $s=$stages[$n]
 if($s.bills.Count -ne 0 -or $s.uft.bill -ne 'null' -or $s.uft.workLeft -ne '457.196106' -or $s.job.def -ne 'HaulToCell' -or $s.job.loadId -ne '71314' -or $s.job.startTick -ne '79407'){throw 'Deleted bill/UFT persistence changed'}
}
if($stages[3].uft.xml -cne $stages[4].uft.xml -or $stages[3].billStackXml -cne $stages[4].billStackXml){throw 'UFT or empty bill stack changed across actual reload'}
Add-Type -AssemblyName System.Drawing
$cropDir=Join-Path $evidence 'unfinished-production-runtime'
if(!$Check){[void](New-Item -ItemType Directory -Path $cropDir -Force)}
$specs=@(
 @{name='005-select-spot';rect=@(0,1235,610,175)},@{name='008-suspended';rect=@(0,725,430,490)},
 @{name='014-uft-retained';rect=@(0,1235,610,175)},@{name='019-resume-menu';rect=@(1300,735,430,110)},
 @{name='021-resumed-work';rect=@(0,1210,432,200)},@{name='026-uft-resumed';rect=@(0,1235,610,175)},
 @{name='029-bill-deleted';rect=@(0,725,430,490)},@{name='036-load-dialog';rect=@(970,370,620,700)}
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
 [ordered]@{source="$runtimeRelative/$name.png";sourceSha256=Hash $source;sourceDimensions=@(2560,1440);crop=$r;file="docs/research/rimworld/evidence/unfinished-production-runtime/$name.png";sha256=$digest
  presentation='Unscaled bounded crop; account labels and unrelated desktop notifications excluded.'
  caveat=if($name -eq '005-select-spot'){'Filename records intended click; actual selection is the UFT. Next click006 selects the crafting spot.'}else{$null}}
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
if($actions.Count -ne 42 -or ($actions.ordinal -join ';') -ne (1..42 -join ';')){throw 'Recorded action sequence changed'}
$pulses=@($actions|Where-Object {$_.action.action -eq 'pulse'})
if(($pulses.ordinal -join ';') -ne '9;21;30' -or ($pulses.action.duration_ms -join ';') -ne '150;1500;150' -or $actions[19].action.action -ne 'click' -or $actions[36].action.action -ne 'click'){throw 'Pulse/resume/load receipts changed'}
$report=[ordered]@{
 id='RW17-UNFINISHED-PRODUCTION-RUNTIME';sourceSha256=$assembly;version='1.7.4980 rev60';enabledMods=$mods
 kind='Observed native UI plus original save XML, retained input/capture receipts and bounded screenshots; matched static evidence interprets fields.'
 preparation='Chapter43 weapons-crafting save copied unchanged to isolated Core + Odyssey profile. Historical chapter43 crafting spot/wood production used ordinary UI with God mode off; colony inherited earlier dev preparation. Dev mode remains enabled. Current trial uses only ordinary suspend/resume/prioritize/delete/time/save/load/quit UI; no spawning, injection or XML edits.'
 scope='One unfinished wooden club, original author Squint and one crafting spot; baseline plus4 fresh saves. Read-only save XML informs observation, so not screen-only.'
 observations=@(
  'Suspending bill2 and pulsing150ms ends prior DoBill59462; save1 has HaulToCell62948 while entire UFT XML equals baseline, including workLeft471.596252 and WoodLog78055x40.'
  'Unsuspend and actual Prioritize crafting command start new playerForced DoBill62954. After1500ms, same UFT78056 and ingredients persist with workLeft457.196106; new driver work ticks36. spawnedTick79370 reflects re-placement, not a new entity.'
  'Deleting bill2 and pulsing150ms leaves empty billStack and the same UFT with bill=null, workLeft457.196106 and unchanged ingredient list; worker changes to HaulToCell71314.'
  'Ordinary Load save3 then Save save4 preserves entire UFT OuterXml and empty billStack OuterXml exactly. World tick advances79419 to79420; job driver XML differs, so no whole-world equality claim.'
 )
 limits=@(
  'Both active production observations are playerForced; this is not a full autonomous scheduling or complete-item production test.'
  'No runtime cancellation/refund, combat/fire/deterioration destruction, alternate author, bound-worker invalidation, cross-table rebind or policy-filter branch comparison; those remain static mechanisms or Web adaptations.'
  'Three bounded simulation pulses are150/1500/150ms; this is not a TPS benchmark. Actual saved world ticks govern comparisons.'
  'No full compressedThingMapDeflate decode or absent-object claims from unmatched raw XML. Named UFT and its deeply stored ingredients are inspected directly.'
  'The actual save/load roundtrip covers deleted-bill unbound UFT; the resumed active-job state is saved/inspected but not loaded in this trial.'
  'The043 Quit click executed before trailing foreground-guarded capture failed; no043 image/action receipt is fabricated. Later fresh CIM confirms PID30744 absent and no remaining RimWorld process.'
  'Full screenshots/saves stay ignored. Public crops exclude account labels and unrelated desktop notifications. Windows native REA capture was not used; actual input/capture uses guarded ordinary Win32 helpers.'
 )
 launch=$launch;launchReceiptSha256=Hash $launchFile;exit=$exitRecord;exitReceiptSha256=Hash $exitFile
 profileConfig=[ordered]@{modsFile="$profileRelative/Config/ModsConfig.xml";modsSha256=Hash $configFile;prefsFile="$profileRelative/Config/Prefs.xml";prefsSha256=Hash $prefsFile;devMode=Field $prefs '//devMode'}
 staticEvidence=[ordered]@{file='unfinished-production-evidence.json';sha256=Hash (Join-Path $evidence 'unfinished-production-evidence.json');relevantClaims=@('UFT02','UFT04','UFT05','UFT09','UFT14')}
 defaultInterpretation=[ordered]@{bill='Missing suspended field is false. repeatCount serialization default0 differs from constructor default1; observed value is explicitly1.';uft='workLeft is explicit at every stage; ingredients serialize deeply, and null bill is explicit after deletion.'}
 roundtrip=[ordered]@{loadedSaveStage=3;resavedStage=4;loadActionOrdinal=37;uftXmlExactlyEqual=($stages[3].uft.xml -ceq $stages[4].uft.xml);billStackXmlExactlyEqual=($stages[3].billStackXml -ceq $stages[4].billStackXml);tickDelta=($stages[4].tick-$stages[3].tick);jobXmlExactlyEqual=($stages[3].job.xml -ceq $stages[4].job.xml)}
 derived=$derived;stages=$stages;screenshots=$screens;actions=$actions
}
$json=(LF ($report|ConvertTo-Json -Depth 40))+[char]10
if($Check){if((LF ([IO.File]::ReadAllText($output))) -cne $json){throw 'Retained native unfinished-production record changed'}}
else{[IO.File]::WriteAllText($output,$json,[Text.UTF8Encoding]::new($false))}
"Verified baseline plus4 native saves, $($screens.Count) crops, $($actions.Count) receipts and exact UFT/bill-stack save/load roundtrip."
