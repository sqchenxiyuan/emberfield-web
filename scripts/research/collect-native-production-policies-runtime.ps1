param([switch]$Check)
# Read-only replay of already recorded UI actions, screenshots and original saves.
# Never launches RimWorld, sends input or rewrites saves/configuration.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtimeRelative='.local-research/runtime/production-policies-20261104'
$profileRelative='.local-research/runtime/profile-production-policies-20261104'
$runtime=Join-Path $root $runtimeRelative
$profile=Join-Path $root $profileRelative
$evidence=Join-Path $root 'docs/research/rimworld/evidence'
$output=Join-Path $evidence 'native-production-policies-runtime.json'
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
$launchFile=Join-Path $runtime 'launch-record.json';$exitFile=Join-Path $runtime 'exit-record.json'
$launch=Get-Content -LiteralPath $launchFile -Raw|ConvertFrom-Json
$exitRecord=Get-Content -LiteralPath $exitFile -Raw|ConvertFrom-Json
if($exitRecord.targetExists -or $exitRecord.targetPid -ne $launch.pid -or $launch.pid -ne 31584 -or @($exitRecord.remainingRimWorldPids).Count -ne 0){throw 'Missing confirmed native process exit'}
if([IO.Path]::GetFullPath($launch.profile) -ne [IO.Path]::GetFullPath($profile)){throw 'Unexpected isolated profile'}
if([IO.Path]::GetFullPath($launch.copiedBaseline) -ne [IO.Path]::GetFullPath((Join-Path $profile 'Saves/ProductionPoliciesBaseline.rws'))){throw 'Unexpected baseline copy'}
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
$labels=@('baseline-active-work','active-work-with-skill-minimum10','named-worker-and-filtered-finite-radius','empty-filter-unlimited-radius','reloaded-empty-filter-and-saved-again')
$stages=@(foreach($n in 0..4){
 $saveName=if($n -eq 0){'ProductionPoliciesBaseline.rws'}else{"New Arrivals$n.rws"}
 $relative="$profileRelative/Saves/$saveName";$file=Join-Path $root $relative;$doc=ReadXml $file
 if((Field $doc '//meta/gameVersion') -ne '1.7.4980 rev60'){throw 'Save version changed'}
 if((@($doc.SelectNodes('//meta/modIds/li')|ForEach-Object InnerText) -join ';') -ne ($expectedMods -join ';')){throw 'Save mod identity changed'}
 $table=ExactlyOne $doc '//thing[id="TableStonecutter42144"]';$stack=ExactlyOne $table 'billStack'
 if((Field $table 'pos') -ne '(113, 0, 138)' -or (Field $table 'map') -ne '0' -or (Field $table 'def') -ne 'TableStonecutter'){throw 'Table identity/location changed'}
 $bills=@(foreach($node in $stack.SelectNodes('bills/li')){
  $radius=Field $node 'ingredientSearchRadius'
  [ordered]@{loadId=IntDefault $node 'loadID' 0;loadIdFieldAbsent=($null -eq (Field $node 'loadID'));class=$node.GetAttribute('Class');recipe=Field $node 'recipe'
   suspended=BoolDefault $node 'suspended';suspendedFieldAbsent=($null -eq (Field $node 'suspended'));repeatMode=Field $node 'repeatMode';repeatCount=IntDefault $node 'repeatCount' 0
   radiusRaw=$radius;radiusFieldAbsent=($null -eq $radius);radius=if($null -eq $radius){999.0}else{[double]::Parse($radius,[Globalization.CultureInfo]::InvariantCulture)}
   allowedSkillRange=Field $node 'allowedSkillRange';pawnRestriction=Field $node 'pawnRestriction'
   slavesOnly=BoolDefault $node 'slavesOnly';mechsOnly=BoolDefault $node 'mechsOnly';nonMechsOnly=BoolDefault $node 'nonMechsOnly'
   allowedIngredients=@($node.SelectNodes('ingredientFilter/allowedDefs/li')|ForEach-Object InnerText)
   disallowedSpecialFilters=@($node.SelectNodes('ingredientFilter/disallowedSpecialFilters/li')|ForEach-Object InnerText)
   allowedHitPointsPercents=Field $node 'ingredientFilter/allowedHitPointsPercents';allowedQualityLevels=Field $node 'ingredientFilter/allowedQualityLevels';xml=$node.OuterXml}
 })
 $pawn=ExactlyOne $doc '//thing[id="Human961"]';$jobs=ExactlyOne $pawn 'jobs'
 $job=[ordered]@{def=Field $jobs 'curJob/def';loadId=Field $jobs 'curJob/loadID';bill=Field $jobs 'curJob/bill';targetA=Field $jobs 'curJob/targetA';targetB=Field $jobs 'curJob/targetB';startTick=Field $jobs 'curJob/startTick'
  playerForced=BoolDefault $jobs 'curJob/playerForced';workGiverDef=Field $jobs 'curJob/workGiverDef';workLeft=Field $jobs 'curDriver/workLeft';ticksSpentDoingRecipeWork=Field $jobs 'curDriver/ticksSpentDoingRecipeWork';xml=$jobs.OuterXml}
 [ordered]@{stage=$n;label=$labels[$n];file=$relative;sha256=Hash $file;tick=[int](Field $doc '//tickManager/ticksGame')
  tableId='TableStonecutter42144';tablePosition=Field $table 'pos';bills=$bills;billStackXml=$stack.OuterXml;billStackXmlSha256=TextHash $stack.OuterXml
  pawnId='Human961';craftingLevel=IntDefault $pawn 'skills/skills/li[def="Crafting"]/level' 0;job=$job}
})
if(($stages.tick -join ';') -ne '47518;47546;47546;47546;47547'){throw 'Stage ticks changed'}
foreach($stage in $stages){
 if($stage.craftingLevel -ne 3 -or $stage.bills[0].loadId -ne 0 -or $stage.bills[0].recipe -ne 'Make_StoneBlocksGranite'){throw 'Original worker/bill identity changed'}
 foreach($bill in $stage.bills){if($bill.repeatMode -ne 'RepeatCount' -or $bill.repeatCount -ne 1){throw 'Unexpected iteration change'}}
}
foreach($n in 0..1){
 $s=$stages[$n]
 if($s.bills.Count -ne 1 -or $s.bills[0].suspended -or $s.bills[0].pawnRestriction -ne 'null' -or $s.job.def -ne 'DoBill' -or $s.job.loadId -ne '36124' -or $s.job.bill -ne 'Bill_Make_StoneBlocksGranite_0' -or !$s.job.playerForced){throw 'Existing active job continuity changed'}
}
if($stages[0].bills[0].allowedSkillRange -ne '0~20' -or $stages[1].bills[0].allowedSkillRange -ne '10~20' -or $stages[0].job.workLeft -ne '1195.07764' -or $stages[1].job.workLeft -ne '1178.66187' -or $stages[0].job.ticksSpentDoingRecipeWork -ne '666' -or $stages[1].job.ticksSpentDoingRecipeWork -ne '693'){throw 'In-flight skill-policy observation changed'}
foreach($n in 2..4){
 $s=$stages[$n]
 if($s.bills.Count -ne 2 -or ($s.bills.loadId -join ';') -ne '0;1' -or !$s.bills[0].suspended -or $s.bills[0].pawnRestriction -ne 'Thing_Human961' -or $s.bills[0].allowedSkillRange -ne '10~20'){throw 'Named worker with retained range changed'}
 if($s.bills[1].recipe -ne 'Make_StoneBlocksAny' -or $s.bills[1].pawnRestriction -ne 'null' -or $s.bills[1].allowedSkillRange -ne '0~20' -or $s.bills[1].suspended){throw 'Second bill identity/policy changed'}
 if($s.job.def -ne 'HaulToCell' -or $s.job.loadId -ne '38357' -or $s.job.targetA -ne 'Thing_WoodLog42139' -or $s.job.startTick -ne '47546'){throw 'Post-draft nonproduction job changed'}
}
if($stages[2].bills[1].radiusRaw -ne '3.83620691' -or ($stages[2].bills[1].allowedIngredients -join ';') -ne 'ChunkSandstone;ChunkLimestone;ChunkSlate;ChunkMarble;ChunkVacstone'){throw 'Finite float radius/filter observation changed'}
foreach($n in 3..4){if(!$stages[$n].bills[1].radiusFieldAbsent -or $stages[$n].bills[1].radius -ne 999 -or $stages[$n].bills[1].allowedIngredients.Count -ne 0 -or $stages[$n].bills[1].disallowedSpecialFilters.Count -ne 0){throw 'Empty-filter/unlimited persistence changed'}}
if($stages[3].billStackXml -cne $stages[4].billStackXml){throw 'Bill policies/order/identity changed across reload'}
Add-Type -AssemblyName System.Drawing
$cropDir=Join-Path $evidence 'production-policies-runtime'
if(!$Check){[void](New-Item -ItemType Directory -Path $cropDir -Force)}
$specs=@(
 @{name='011-skill-minimum';rect=@(875,385,810,680)},@{name='024-skill-rejection-menu';rect=@(1645,1175,340,100)},
 @{name='033-specific-squint';rect=@(875,385,810,680)},@{name='036-specific-allowed';rect=@(1645,1175,340,100)},
 @{name='046-radius-three';rect=@(875,385,810,680)},@{name='049-radius-rejection';rect=@(1645,1175,340,100)},
 @{name='059-radius-unlimited';rect=@(875,385,810,680)},@{name='062-unlimited-eligible';rect=@(1645,1175,340,100)},
 @{name='067-clear-filter';rect=@(875,385,810,680)},@{name='070-empty-filter-rejection';rect=@(1645,1175,340,100)}
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
 [ordered]@{source="$runtimeRelative/$name.png";sourceSha256=Hash $source;sourceDimensions=@(2560,1440);crop=$r;file="docs/research/rimworld/evidence/production-policies-runtime/$name.png";sha256=$digest
  presentation='Unscaled rectangular crop of bill details or command menu; account labels and unrelated desktop notifications excluded.'
  caveat=if($name -eq '046-radius-three'){'Filename is not a measured value: UI displays4; original save radius is float3.83620691.'}else{$null}}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter '*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 $receiptFile=$_;$action=Get-Content -LiteralPath $receiptFile.FullName -Raw|ConvertFrom-Json
 if($action.pid -ne $launch.pid -or [IO.Path]::GetFullPath($action.profile) -ne [IO.Path]::GetFullPath($profile)){throw 'Action belongs to another process/profile'}
 $captureFile=$receiptFile.FullName.Replace('.actions.jsonl','.jsonl');$capture=Get-Content -LiteralPath $captureFile -Raw|ConvertFrom-Json
 if($capture.pid -ne $launch.pid -or $capture.process -ne 'RimWorld' -or $capture.width -ne 2560 -or $capture.height -ne 1440){throw 'Capture target mismatch'}
 $imageFile=$receiptFile.FullName.Replace('.actions.jsonl','')
 if([IO.Path]::GetFullPath($capture.image) -ne $imageFile -or [IO.Path]::GetFullPath($action.image) -ne $imageFile){throw 'Receipt image mismatch'}
 [ordered]@{ordinal=[int]$receiptFile.Name.Substring(0,3);file="$runtimeRelative/$($receiptFile.Name)";sha256=Hash $receiptFile.FullName;action=$action
  captureReceipt="$runtimeRelative/$([IO.Path]::GetFileName($captureFile))";captureReceiptSha256=Hash $captureFile;sourceImageSha256=Hash $imageFile
  observationCaveat=if($receiptFile.Name -match '^(006|007|022|023|025|026|027|028|043)-'){'Attempted navigation or menu lost after mouse parking; intended UI state is not established by the filename.'}elseif($receiptFile.Name -match '^046-'){'Filename says radius-three, but UI4 and save float3.83620691 are authoritative.'}else{$null}}
})
if($actions.Count -ne 81 -or ($actions.ordinal -join ';') -ne (1..81 -join ';')){throw 'Recorded action sequence changed'}
if(@($actions|Where-Object {$_.action.action -eq 'pulse'}).Count -ne 1 -or $actions[12].action.duration_ms -ne 400 -or $actions[76].action.action -ne 'click'){throw 'Pulse/load receipts changed'}
$report=[ordered]@{
 id='RW17-PRODUCTION-POLICIES-RUNTIME';sourceSha256=$assembly;version='1.7.4980 rev60';enabledMods=$mods
 kind='Observed native UI with original save XML, retained input/capture receipts and bounded screenshots; matched static sources interpret omitted fields.'
 preparation='Unmodified chapter25 dev/God-prepared stonecutting save copied to an isolated Core + Odyssey profile. Historical setup placed wooden stonecutter/granite chunk and restored Squint needs. Dev mode remained enabled; current trial used ordinary bill, draft/undraft, time, save/load and quit UI only, without spawn, injection or XML edits.'
 scope='One stonecutting table, fixed-granite and Any-stone recipes, one active player-forced job, baseline plus four fresh saves. Read-only original save XML informed observation; not screen-only.'
 observations=@(
  'Crafting3 Squint keeps DoBill36124 after Any-worker minimum changes0 to10: workLeft1195.07764 to1178.66187 and work ticks666 to693. The existing player-forced job continued; it was later deliberately cancelled by draft/undraft.'
  'Screenshot024 then rejects a new granite job with Under allowed skill10. Named Squint hides the range UI and makes Prioritize cutting stone blocks available in036; that command was not clicked. Save2 retains named Squint and old10~20 interval.'
  'With original bill suspended and Any-stone bill excluding granite, finite radius3.83620691 (UI4) yields Missing1x stone chunks in049. Changing only radius to Unlimited yields an available priority command in062; both comparisons stayed paused at tick47546.'
  'Keeping Unlimited and clearing all ingredient allowances yields Missing1x stone chunks in070. This corroborates empty nonfixed filter means no allowed input. No newly available command was issued and no far haul was performed.'
  'Save3 persisted named worker, retained skill interval, two ordered bill IDs and empty-filter unlimited-radius second bill. Ordinary UI loaded save3, then saved as save4; full billStack XML is exactly equal. Tick advanced47546 to47547, so this is a bill-policy roundtrip, not a world-byte-equality claim.'
 )
 limits=@(
  'No runtime exact radius boundary, source-container, autonomous-table, UFT or multi-layer experiment; horizontal strict/inclusive differences come from static paths.'
  'Native slider is floating point; screenshot046 filename is misleading, actual UI4/save3.83620691. Web integer3..100/null and strict3D radius are explicit adaptations.'
  'Only the skill interval was changed during active work, whose baseline job was playerForced. Named-worker/filter/radius edits during in-flight work and all autonomous scheduling cases were not runtime-tested.'
  'Named-worker and radius recovery are UI dispatch-availability observations, not completed newly issued production jobs. No recipe hard-skill bypass or exact inclusive min/max experiment.'
  'Readback covers save3 unlimited-radius/empty-filter state only; finite radius was saved and inspected but not reloaded.'
  'No full map compressedThingMapDeflate decoding or absence claims from unmatched XML objects.'
  'Only013 is a successful400ms simulation pulse; later comparisons remain paused until load/save advances1tick. Wall time is not a TPS benchmark.'
  'Failed navigation attempts are retained;006/007,022/023,025-028 and043 do not prove their intended named states.'
  'Ordinary Quit to OS exited before trailing capture passed foreground guard; no082 image/action receipt exists. Fresh CIM exit record confirms no remaining RimWorld process.'
  'Full screenshots/saves remain ignored. Public crops exclude account labels and unrelated desktop notifications.'
 )
 launch=$launch;launchReceiptSha256=Hash $launchFile;exit=$exitRecord;exitReceiptSha256=Hash $exitFile
 profileConfig=[ordered]@{modsFile="$profileRelative/Config/ModsConfig.xml";modsSha256=Hash $configFile;prefsFile="$profileRelative/Config/Prefs.xml";prefsSha256=Hash $prefsFile;devMode=Field $prefs '//devMode'}
 staticEvidence=[ordered]@{file='production-policies-evidence.json';sha256=Hash (Join-Path $evidence 'production-policies-evidence.json');relevantClaims=@('PPL02','PPL07','PPL08','PPL09','PPL11','PPL13')}
 defaultInterpretation=[ordered]@{bill='food/RimWorld.Bill: loadID0, suspended/category false, radius999; missing radius remains explicit';production='stonecutting/RimWorld.Bill_Production: repeatCount serialization default0, not constructor1';filter='Empty allowedDefs is retained as empty, not default-all'}
 roundtrip=[ordered]@{loadedSaveStage=3;resavedStage=4;loadActionOrdinal=77;billStackXmlExactlyEqual=($stages[3].billStackXml -ceq $stages[4].billStackXml);tickDelta=($stages[4].tick-$stages[3].tick);jobXmlExactlyEqual=($stages[3].job.xml -ceq $stages[4].job.xml)}
 derived=$derived;stages=$stages;screenshots=$screens;actions=$actions
}
$json=(LF ($report|ConvertTo-Json -Depth 40))+[char]10
if($Check){if((LF ([IO.File]::ReadAllText($output))) -cne $json){throw 'Retained native production-policies record changed'}}
else{[IO.File]::WriteAllText($output,$json,[Text.UTF8Encoding]::new($false))}
"Verified baseline plus 4 native saves, $($screens.Count) crops, $($actions.Count) receipts and exact bill-policy save/load roundtrip."
