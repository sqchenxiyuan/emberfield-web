param([Parameter(Mandatory=$true)][string]$SavePath)
# Offline original XML; selected trade goods and trader containers, no inferred prices.
$ErrorActionPreference='Stop'
$r=& (Join-Path $PSScriptRoot 'read-storyteller-runtime-save.ps1') -SavePath $SavePath | ConvertFrom-Json -AsHashtable
$s=[xml](Get-Content -Raw -LiteralPath $SavePath)
$map=$s.SelectSingleNode('//thing[id="Human958"]').ParentNode.ParentNode
$r['trade_pawns']=@($map.SelectNodes('./things/thing[healthTracker]')|ForEach-Object {
 [ordered]@{id=[string]$_.id;def=[string]$_.def;name=$_.name.OuterXml;faction=[string]$_.faction;pos=[string]$_.pos;trader=$_.trader.OuterXml;inventory=$_.inventory.OuterXml;carry=$_.carryTracker.OuterXml;equipment=$_.equipment.OuterXml;apparel=$_.apparel.OuterXml;guest=$_.guest.OuterXml;skills=$_.skills.OuterXml}
}|Sort-Object {$_.id})
$r['trade_items']=@($map.SelectNodes('.//*[id and (def="Silver" or def="Gold" or def="Steel" or def="WoodLog" or def="MedicineHerbal" or def="MedicineIndustrial" or def="MedicineUltratech" or def="MealSurvivalPack" or def="Gun_BoltActionRifle" or def="Pemmican" or def="Plasteel" or def="Neutroamine" or def="PsychiteTea" or def="ComponentIndustrial" or def="WakeUp" or def="PsychicAnimalPulser" or def="PsychicSoothePulser" or def="Apparel_PsychicInsanityLance")]')|ForEach-Object{
 [ordered]@{id=[string]$_.id;def=[string]$_.def;pos=[string]$_.pos;faction=[string]$_.faction;owner=[string]$_.SelectSingleNode('ancestor::*[healthTracker][1]/id').InnerText;parent=$_.ParentNode.Name;raw=$_.OuterXml}
}|Sort-Object {$_.id})
$r['lords_raw']=$map.lordManager.OuterXml
$r['scope']='Read-only original XML: inherited medicine/storyteller fields plus current map pawns trader, inventory and other containers, selected goods, and lord manager. UI proposals and prices are not saved or inferred. Unknown or absent fields remain raw/absent.'
$r|ConvertTo-Json -Depth 45
