param([Parameter(Mandatory=$true)][string]$SavePath)
# Offline original XML only. Medical scope is retained to check inherited state.
$ErrorActionPreference='Stop'
$r=& (Join-Path $PSScriptRoot 'read-medicine-runtime-save.ps1') -SavePath $SavePath | ConvertFrom-Json -AsHashtable
$s=[xml](Get-Content -Raw -LiteralPath $SavePath)
$map=$s.SelectSingleNode('//thing[id="Human958"]').ParentNode.ParentNode
$r['storyteller_raw']=$s.SelectSingleNode('/savegame/game/storyteller').OuterXml
$r['story_watcher_raw']=$s.SelectSingleNode('/savegame/game/storyWatcher').OuterXml
$r['history_recorders_raw']=$s.SelectSingleNode('/savegame/game/history/autoRecorderGroups').OuterXml
$r['history_recorders']=@($s.SelectNodes('/savegame/game/history/autoRecorderGroups/li/recorders/li')|ForEach-Object {
 $record=$_;$node=$record.SelectSingleNode('./records|./recordsDeflate');$bytes=[Convert]::FromBase64String($node.InnerText)
 if($node.Name -eq 'recordsDeflate'){
  $inputStream=[IO.MemoryStream]::new($bytes,$false);$outputStream=[IO.MemoryStream]::new()
  $inflate=[IO.Compression.DeflateStream]::new($inputStream,[IO.Compression.CompressionMode]::Decompress)
  try{$inflate.CopyTo($outputStream);$bytes=$outputStream.ToArray()}finally{$inflate.Dispose();$inputStream.Dispose();$outputStream.Dispose()}
 }
 if($bytes.Length%4 -ne 0){throw 'Historical float data length is not a multiple of four.'}
 [ordered]@{def=[string]$record.def;encoding=$node.Name;values=@(for($i=0;$i -lt $bytes.Length;$i+=4){[double][BitConverter]::ToSingle($bytes,$i)});raw=$record.OuterXml}
})
$r['map_story_state_raw']=$map.SelectSingleNode('./storyState').OuterXml
$r['map_info_raw']=$map.SelectSingleNode('./info').OuterXml
$r['map_zone_manager_raw']=$map.SelectSingleNode('./zoneManager').OuterXml
$r['tracked_entities']=@($map.SelectNodes('.//*[id and (def="Silver" or def="Gold" or def="Steel" or def="WoodLog" or def="Wall" or def="Door" or def="Stool" or def="Bed" or def="Table1x2c" or def="MinifiedThing")]') | ForEach-Object {
 [ordered]@{id=[string]$_.id;def=[string]$_.def;pos=[string]$_.pos;faction=[string]$_.faction;owner=[string]$_.SelectSingleNode('ancestor::*[def="Human"][1]/id').InnerText;parent=$_.ParentNode.Name;owner_container_raw=$_.SelectSingleNode('ancestor::*[self::carryTracker or self::inventory or self::equipment or self::apparel][1]').OuterXml;raw=$_.OuterXml}
} | Sort-Object {$_.id})
$r['scope']='Read-only original XML. Retains medicine-reader scope plus storyteller, story watcher, history recorder bytes, map identity/story state, and selected asset entities including carried/inventory containers. No runtime wealth cache, derived price, random outcome or inferred defaults are inserted.'
$r | ConvertTo-Json -Depth 45
