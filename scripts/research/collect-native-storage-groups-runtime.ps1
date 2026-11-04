param([switch]$Check)
# Replays existing native UI receipts, original saves and bounded screenshot crops.
# Does not launch RimWorld, send input, edit saves or rerun gameplay.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtimeRelative='.local-research/runtime/storage-groups-20261104'
$profileRelative='.local-research/runtime/profile-storage-groups-20261104'
$runtime=Join-Path $root $runtimeRelative
$profile=Join-Path $root $profileRelative
$evidence=Join-Path $root 'docs/research/rimworld/evidence'
$output=Join-Path $evidence 'native-storage-groups-runtime.json'
function Hash([string]$file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
function ReadXml([string]$file){
 $doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null
 $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit
 $reader=[Xml.XmlReader]::Create($file,$settings)
 try{$doc.Load($reader)}finally{$reader.Dispose()}
 return ,$doc
}
function Field($node,[string]$path){if($null -eq $node){return $null};$child=$node.SelectSingleNode($path);if($child){$child.InnerText}else{$null}}
function ExactlyOne($doc,[string]$xpath){$nodes=@($doc.SelectNodes($xpath));if($nodes.Count -ne 1){throw "Expected one XML match: $xpath, found $($nodes.Count)"};return ,$nodes[0]}
function StorageProjection($node){
 if($null -eq $node){return $null}
 $defs=@($node.SelectNodes('filter/allowedDefs/li')|ForEach-Object InnerText)
 [ordered]@{
  priority=Field $node 'priority';allowedDefsCount=$defs.Count
  # Large pre-link default lists stay in the hashed original save. Small experimental filters are complete.
  allowedDefs=if($defs.Count -le 10){$defs}else{$null}
  allowedDefsOmitted=($defs.Count -gt 10);allowsWoodLog=($defs -contains 'WoodLog')
  allowedDefsSha256=TextHash ($defs -join "`n");settingsXmlSha256=TextHash $node.OuterXml
  disallowedSpecialFilters=@($node.SelectNodes('filter/disallowedSpecialFilters/li')|ForEach-Object InnerText)
  allowedHitPointsPercents=Field $node 'filter/allowedHitPointsPercents'
  allowedQualityLevels=Field $node 'filter/allowedQualityLevels'
 }
}
function ThingProjection($doc,[string]$id){
 $node=ExactlyOne $doc "//id[text()='$id']/parent::*"
 [ordered]@{
  id=$id;class=$node.GetAttribute('Class');def=Field $node 'def';parentElement=$node.ParentNode.LocalName
  position=Field $node 'pos';map=Field $node 'map';storageGroup=Field $node 'storageGroup'
  localSettings=StorageProjection $node.SelectSingleNode('settings')
  identityProjection=@($node.SelectNodes('def|id|map|pos|rot|stuff|stuffToUse|health|spawnedTick|despawnedTick|storageGroup|label')|ForEach-Object OuterXml)
  fullThingXmlSha256=TextHash $node.OuterXml
 }
}
$launchFile=Join-Path $runtime 'launch-record.json';$exitFile=Join-Path $runtime 'exit-record.json'
$launch=Get-Content -LiteralPath $launchFile -Raw|ConvertFrom-Json
$exitRecord=Get-Content -LiteralPath $exitFile -Raw|ConvertFrom-Json
if($exitRecord.targetExists -or $exitRecord.targetPid -ne $launch.pid -or $launch.pid -ne 30400){throw 'Missing confirmed native process exit'}
if([IO.Path]::GetFullPath($launch.profile) -ne [IO.Path]::GetFullPath($profile)){throw 'Unexpected isolated profile'}
if((Hash $launch.baseline) -ne $launch.baselineSha256){throw 'Prepared baseline changed'}
$assembly=Hash 'F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll'
if($assembly -ne $launch.assemblySha256 -or $assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Native artifact changed'}
$configFile=Join-Path $profile 'Config/ModsConfig.xml';$config=ReadXml $configFile
$expectedMods=@('ludeon.rimworld','ludeon.rimworld.odyssey')
$mods=@($config.SelectNodes('/ModsConfigData/activeMods/li')|ForEach-Object InnerText)
if(($mods -join ';') -ne ($expectedMods -join ';')){throw 'Unexpected enabled mods'}
$prefsFile=Join-Path $profile 'Config/Prefs.xml';$prefs=ReadXml $prefsFile
if((Field $prefs '//devMode') -ne 'True'){throw 'Expected inherited dev-enabled profile'}
$derived=@(foreach($pair in @(
 @('storage-groups','RimWorld.StorageGroupUtility'),@('storage-groups','Verse.StorageGroupManager'),
 @('shelf-storage','RimWorld.StorageGroup'),@('shelf-storage','RimWorld.Blueprint_Storage'),
 @('logistics','RimWorld.Building_Storage'),@('furniture-reinstall','RimWorld.MinifyUtility'),
 @('furniture-reinstall','RimWorld.Blueprint_Install'),@('storyteller','RimWorld.Frame')
)){
 $manifestName=$pair[0]+'-manifest.json';$m=Get-Content (Join-Path $evidence $manifestName) -Raw|ConvertFrom-Json
 if($m.source_sha256 -ne $assembly){throw 'Derived source identity mismatch'}
 $entries=@($m.types|Where-Object type -eq $pair[1]);if($entries.Count -ne 1){throw 'Missing derived type'};$entry=$entries[0]
 if((Hash (Join-Path $root $entry.local_file)) -ne $entry.sha256){throw "Derived file mismatch: $($pair[1])"}
 [ordered]@{manifest=$manifestName;manifestSha256=Hash (Join-Path $evidence $manifestName);type=$entry.type;file=$entry.local_file;sha256=$entry.sha256}
})
$labels=@('linked-blueprint','built-linked-shelf','packed-linked-shelf','reinstalled-after-shared-edit','unlinked-and-group-dissolved')
$stages=@(foreach($n in 1..5){
 $relative="$profileRelative/Saves/New Arrivals$n.rws";$file=Join-Path $root $relative;$doc=ReadXml $file
 if((Field $doc '//meta/gameVersion') -ne '1.7.4980 rev60'){throw 'Save version changed'}
 if((@($doc.SelectNodes('//meta/modIds/li')|ForEach-Object InnerText) -join ';') -ne ($expectedMods -join ';')){throw 'Save mod identity changed'}
 $manager=ExactlyOne $doc '//storageGroups';$groupNodes=@($manager.SelectNodes('groups/li'))
 $groupRecords=@(foreach($group in $groupNodes){
  $loadIdText=Field $group 'loadID'
  [ordered]@{loadId=if($null -eq $loadIdText){0}else{[int]$loadIdText};loadIdFieldAbsent=($null -eq $loadIdText)
   label=Field $group 'label';map=Field $group 'map';members=@($group.SelectNodes('members/li')|ForEach-Object InnerText)
   settings=StorageProjection $group.SelectSingleNode('settings')}
 })
 $source=ThingProjection $doc 'ShelfSmall328366'
 $targetId=if($n -eq 1){'Blueprint_ShelfSmall399889'}else{'ShelfSmall399893'}
 $target=ThingProjection $doc $targetId
 $wrapperNodes=@($doc.SelectNodes('//id[text()="MinifiedThing399903"]/parent::*'))
 $wrapper=$null
 if($n -eq 3){
  if($wrapperNodes.Count -ne 1){throw 'Packed wrapper missing'}
  $wrapper=ThingProjection $doc 'MinifiedThing399903'
  $inner=ExactlyOne $wrapperNodes[0] 'innerContainer/innerList/li[id="ShelfSmall399893"]'
  if($inner.GetAttribute('Class') -ne 'Building_Storage' -or $target.parentElement -ne 'innerList' -or $null -ne $target.map){throw 'Packed building identity/location changed'}
 }elseif($wrapperNodes.Count -ne 0){throw 'Unexpected wrapper outside packed stage'}
 if($source.position -ne '(115, 0, 130)' -or $source.map -ne '0'){throw 'Original shelf moved unexpectedly'}
 $expectedPosition=if($n -le 3){'(118, 0, 130)'}else{'(121, 0, 130)'}
 if($target.position -ne $expectedPosition){throw 'Target shelf position differs'}
 if($n -ne 3 -and ($target.parentElement -ne 'things' -or $target.map -ne '0')){throw 'Target not spawned in expected map'}
 if($n -eq 1 -and $target.class -ne 'Blueprint_Storage'){throw 'Expected storage blueprint'}
 if($n -gt 1 -and $target.class -ne 'Building_Storage'){throw 'Expected finished storage building'}
 if($n -gt 1 -and @($doc.SelectNodes('//id[text()="Blueprint_ShelfSmall399889"]')).Count -ne 0){throw 'Old blueprint still present after building'}
 if($n -le 4){
  if($groupRecords.Count -ne 1){throw 'Expected one linked group'};$g=$groupRecords[0]
  $expectedMembers=@('Thing_ShelfSmall328366',"Thing_$targetId")
  if(($g.members -join ';') -ne ($expectedMembers -join ';') -or $g.loadId -ne 0 -or $g.label -ne 'Group 1' -or $g.map -ne 'Map_0'){throw 'Group identity/members changed'}
  $expectedPriority=if($n -le 3){'Critical'}else{'Low'}
  if($g.settings.priority -ne $expectedPriority -or ($g.settings.allowedDefs -join ';') -ne 'WoodLog'){throw 'Group settings changed'}
  if($source.storageGroup -ne 'StorageGroup_0' -or $target.storageGroup -ne 'StorageGroup_0'){throw 'Membership reference changed'}
 }else{
  if($groupRecords.Count -ne 0){throw 'Group not dissolved after unlink'}
  foreach($member in @($source,$target)){
   if($member.storageGroup -ne 'null' -or $member.localSettings.priority -ne 'Low' -or ($member.localSettings.allowedDefs -join ';') -ne 'WoodLog'){throw 'Unlinked shelf did not retain shared settings'}
  }
 }
 if($n -eq 4 -and $target.localSettings.priority -ne 'Critical'){throw 'Unexpected local/effective-settings observation'}
 [ordered]@{stage=$n;label=$labels[$n-1];file=$relative;sha256=Hash $file
  tick=[int](Field $doc '//tickManager/ticksGame');groups=$groupRecords;storageGroupsXml=$manager.OuterXml
  sourceShelf=$source;targetShelf=$target;wrapper=$wrapper
  effectiveSettingsSource=if($n -le 4){'StorageGroup_0 (interpreted via hash-matched GetStoreSettings path)'}else{'Each independent shelf local settings'}
 }
})
for($i=1;$i -lt $stages.Count;$i++){if($stages[$i].tick -lt $stages[$i-1].tick){throw 'Native stages run backwards'}}
Add-Type -AssemblyName System.Drawing
$cropDir=Join-Path $evidence 'storage-groups-runtime'
if(!$Check){[void](New-Item -ItemType Directory -Path $cropDir -Force)}
$screenNames=@('024-blueprint-shared','040-built-inspect','047-packed','055-low-while-packed','061-reinstalled-settings','068-unlinked')
$screens=@(foreach($name in $screenNames){
 $source=Join-Path $runtime "$name.png";$destination=Join-Path $cropDir "$name.png"
 $bitmap=[Drawing.Bitmap]::new($source)
 try{
  if($bitmap.Width -ne 2560 -or $bitmap.Height -ne 1440){throw 'Unexpected source screenshot dimensions'}
  # The right-hand desktop/Steam notification area is outside this crop, including screenshot 068.
  $crop=$bitmap.Clone([Drawing.Rectangle]::new(0,715,1760,690),$bitmap.PixelFormat)
  try{$stream=[IO.MemoryStream]::new();$crop.Save($stream,[Drawing.Imaging.ImageFormat]::Png);$bytes=$stream.ToArray();$stream.Dispose()}
  finally{$crop.Dispose()}
 }finally{$bitmap.Dispose()}
 $digest=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
 if($Check){if((Hash $destination) -ne $digest){throw "Crop mismatch: $name"}}else{[IO.File]::WriteAllBytes($destination,$bytes)}
 [ordered]@{source="$runtimeRelative/$name.png";sourceSha256=Hash $source;sourceDimensions=@(2560,1440)
  crop=@(0,715,1760,690);file="docs/research/rimworld/evidence/storage-groups-runtime/$name.png";sha256=$digest
  presentation='Unscaled rectangular crop of lower-left storage UI and shelf area; right-hand notification region excluded.'}
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
  captureReceipt="$runtimeRelative/$([IO.Path]::GetFileName($captureFile))";captureReceiptSha256=Hash $captureFile
  sourceImageSha256=Hash $imageFile}
})
if($actions.Count -ne 74){throw 'Native action record count changed'}
$report=[ordered]@{
 id='RW17-STORAGE-GROUPS-RUNTIME';sourceSha256=$assembly;version='1.7.4980 rev60';enabledMods=$mods
 kind='Observed native UI sequence with original save XML, retained receipts and cropped screenshots; static sources only interpret effective-setting lookup.'
 preparation='Unmodified navigation-experiment save copied to an isolated Core + Odyssey profile. Inherits earlier developer-prepared scenario and enabled dev mode. This storage-group trial used ordinary game UI for linking, storage edits, construction, uninstall, reinstall, unlink and saves.'
 scope='One existing small shelf plus one ordinary new-build small shelf. Five original saves show blueprint/building replacement, same-building packing/reinstall and two-member unlink. Screen captures and read-only XML/coordinates informed control; not screen-only.'
 observations=@(
  'Stage1: existing shelf and new storage blueprint reference StorageGroup_0; shared Critical priority and WoodLog-only filter.'
  'Stage2: completed ShelfSmall399893 replaces Blueprint_ShelfSmall399889 in the same two-member group.'
  'Stage3: MinifiedThing399903 contains the same ShelfSmall399893; both original building IDs remain group members.'
  'Between stages3 and4, screenshot055 shows Low priority selected through the installed shelf while the other is packed; no separate save at that exact intermediate edit.'
  'Stage4: the same ShelfSmall399893 is installed at (121,0,130), still linked to Low/WoodLog. Its local priority remains Critical, proving local and group records differ; native UI061 displays effective Low.'
  'Stage5: unlink removes the group and clears both references; each shelf independently retains Low/WoodLog.'
 )
 limits=@(
  'No cross-map transport, manual group rename, three-member migration, destruction, failed construction, blueprint unlink, incompatible-tag or stockpile linking trial.'
  'The intermediate Frame was not separately saved or captured; successful blueprint-to-finished-building membership replacement is observed.'
  'Saves are read-only snapshots. This record does not include a game reload of these newly saved group stages.'
  'The packed-time Low edit is supported by screenshot/action sequence and later save, not an extra packed-after-edit save.'
  'Effective settings are interpreted using matched static GetStoreSettings sources and corroborated by the visible native storage UI; local settings alone are not effective settings while linked.'
  'Group loadID0 is omitted in the raw group XML; interpretation of omitted field as0 uses the recorded Scribe default, corroborated by StorageGroup_0 member references.'
  'Large pre-link default allowedDef lists are omitted from public projections; their count/hash and the unchanged original-save hash are retained.'
  'Exit click had no post-exit image because the focus guard rejected capture; retained fresh CIM exit receipt confirms PID30400 no longer existed.'
  'Original full-screen image068 contains an unrelated right-hand notification; public output contains only crops excluding that region.'
 )
 launch=$launch;launchReceiptSha256=Hash $launchFile;exit=$exitRecord;exitReceiptSha256=Hash $exitFile
 profileConfig=[ordered]@{modsFile="$profileRelative/Config/ModsConfig.xml";modsSha256=Hash $configFile;prefsFile="$profileRelative/Config/Prefs.xml";prefsSha256=Hash $prefsFile;devMode=Field $prefs '//devMode'}
 staticEvidence=[ordered]@{file='storage-groups-evidence.json';sha256=Hash (Join-Path $evidence 'storage-groups-evidence.json');relevantClaims=@('SG03','SG05','SG08','SG11','SG12')}
 derived=$derived;stages=$stages;screenshots=$screens;actions=$actions
}
$json=($report|ConvertTo-Json -Depth 40).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($output).Replace("`r`n","`n") -cne $json){throw 'Collected native storage-group record changed'}}
else{[IO.File]::WriteAllText($output,$json,[Text.UTF8Encoding]::new($false))}
"Verified $($stages.Count) native saves, $($screens.Count) crops, $($actions.Count) action records, $($derived.Count) derived types."
