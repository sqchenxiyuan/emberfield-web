param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Static projection only: original game assembly is never loaded or executed.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/live-animal-trade-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/live-animal-trade-manifest.json'
$reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static identity mismatch'}
$sources=@{}
foreach($m in $manifest.types){$file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)}
$rules=@(
 @('RimWorld.StockGenerator_Animals','int count = countRange.RandomInRange;','Count is sampled once for the whole animal stock, not once per kind.'),
 @('RimWorld.StockGenerator_Animals','if (count > 1 && !createMatingPair.NullOrEmpty())','Pair generation requires at least two available units.'),
 @('RimWorld.StockGenerator_Animals','(PawnUtility.PlayerHasReproductivePair(k) ? 0.5f : 1f) * SelectionChance(k)','Existing player reproductive pairs halve the selected kind weight.'),
 @('RimWorld.StockGenerator_Animals','Gender? fixedGender = Gender.Female;','The first member of the optional pair is female.'),
 @('RimWorld.StockGenerator_Animals','fixedGender = Gender.Male;','The second member of the optional pair is male.'),
 @('RimWorld.StockGenerator_Animals','count -= 2;','The pair consumes two units of the original total.'),
 @('RimWorld.StockGenerator_Animals','List<PawnKindDef> kinds = new List<PawnKindDef>();','Remaining kinds are sampled separately; the pair kind is not preinserted.'),
 @('RimWorld.StockGenerator_Animals','for (int i = 0; i < count; i++)','The remaining total is distributed across selected kinds.'),
 @('RimWorld.StockGenerator_Animals','new CurvePoint(0f, 100f)','Supply selection strongly favors low-wildness kinds.'),
 @('RimWorld.StockGenerator_Animals','statValueAbstract > maxWildness','Wildness bounds gate initial supply.'),
 @('RimWorld.StockGenerator_Animals','SeasonAndOutdoorTemperatureAcceptableFor(tile, kind.race)','Initial stock also checks seasonal and outdoor temperature.'),
 @('RimWorld.StockGenerator_Animals','if (!tradeTagsSell.Any((string x) => kind.race.tradeTags.Contains(x)))','Supply needs a sell-tag match.'),
 @('RimWorld.StockGenerator_Animals','if (!kind.race.tradeability.TraderCanSell())','Supply respects the race tradeability.'),
 @('RimWorld.StockGenerator_Animals','return tradeTagsBuy.Any((string tag) => thingDef.tradeTags != null && thingDef.tradeTags.Contains(tag));','HandlesThingDef accepts the union of sell and buy tags.'),
 @('RimWorld.StockGenerator_Animals','return Tradeability.Buyable;','TradeabilityFor exposes a separate directional classification.'),
 @('RimWorld.TraderKindDef','if (stockGenerators[i].HandlesThingDef(td))','Actual WillTrade uses HandlesThingDef, not directional TradeabilityFor.'),
 @('RimWorld.Tradeable','public virtual bool TraderWillTrade => TradeSession.trader.TraderKind.WillTrade(ThingDef);','Trade row acceptance follows the union-based WillTrade path.'),
 @('RimWorld.TradeUI','if (!trad.TraderWillTrade)','The trading UI disables rows by TraderWillTrade.'),
 @('RimWorld.Tradeable','return -CountHeldBy(Transactor.Colony);','Negative transfer bound uses the colony count.'),
 @('RimWorld.Tradeable','return CountHeldBy(Transactor.Trader);','Positive transfer bound uses trader count.'),
 @('RimWorld.StockGenerator_BuyExpensiveSimple','thingDef.category != ThingCategory.Item','The extra expensive-simple buying generator does not admit live Pawns.'),
 @('Verse.ThingDef','public Tradeability tradeability = Tradeability.All;','Race tradeability defaults to both directions unless overridden.'),
 @('RimWorld.PawnUtility','PawnsFinder.AllMapsCaravansAndTravellingTransporters_Alive_OfPlayerFaction','Existing-pair scan includes all player maps and traveling holders.'),
 @('RimWorld.PawnUtility','pawn.kindDef == pawnKindDef && pawn.ageTracker.CurLifeStage.reproductive','Existing-pair weighting requires matching kind and reproductive life stage.'),
 @('Verse.PawnGenerator','pawn.gender = request.FixedGender.Value;','Fixed pair gender is honored by generation.'),
 @('Verse.PawnGenerator','pawn.ageTracker.AgeBiologicalTicks = (long)(years * 3600000f);','Biological age is independently generated and persisted on the pawn.'),
 @('Verse.PawnGenerator','years = Rand.ByCurve(DefaultAgeGenerationCurve) * pawn.RaceProps.lifeExpectancy;','Ordinary newly generated non-mech animals without a race curve sample default age fraction times life expectancy.'),
 @('Verse.PawnGenerator','new CurvePoint(0.05f, 0f)','Default age fraction begins at five percent of life expectancy.'),
 @('Verse.PawnGenerator','if (!request.AllowedDevelopmentalStages.Has(LifeStageUtility.CalculateDevelopmentalStage(pawn, years)))','Age generation checks developmental stage, not the reproductive flag.'),
 @('RimWorld.LifeStageDef','public DevelopmentalStage developmentalStage = DevelopmentalStage.Adult;','Adult developmental stage is the default even for animal baby definitions without overrides.'),
 @('RimWorld.LifeStageDef','public float marketValueFactor = 1f;','Life-stage market multiplier defaults to one.'),
 @('RimWorld.PawnGroupKindWorker_Trader','pawn.SetFaction(parms.faction);','Pawn wares acquire the caravan faction during group generation.'),
 @('RimWorld.PawnGroupKindWorker_Trader','GetSlavesAndAnimalsFromWares(parms, pawn, wares)','Animal wares enter the actual arrival pawn list.'),
 @('RimWorld.IncidentWorker_TraderCaravanArrival','LordMaker.MakeNewLord(parms.faction, lordJob, map, pawns);','Spawned arrival pawns are assigned to the trading Lord.'),
 @('RimWorld.TraderCaravanUtility','if (p.kindDef.RaceProps.packAnimal && p.inventory.innerContainer.Any)','A pack animal carrying inventory is a Carrier before the general animal branch.'),
 @('RimWorld.TraderCaravanUtility','if (p.RaceProps.Animal)','Other animals are Chattel; empty pack animals can reach this branch.'),
 @('RimWorld.Pawn_TraderTracker','case TraderCaravanRole.Chattel:','Trader stock includes actual Chattel pawns owned by its Lord.'),
 @('RimWorld.Pawn_TraderTracker','yield return p.inventory.innerContainer[j];','A Carrier contributes its inventory, not its own body as an animal offer.'),
 @('RimWorld.TradeUtility','if (!def.tradeability.PlayerCanSell())','Player sale first respects race tradeability.'),
 @('RimWorld.TradeUtility','pawn.RaceProps.Animal && pawn.IsFormingCaravan()','An animal being assembled into a player caravan is excluded.'),
 @('RimWorld.TradeUtility','pawn.HomeFaction == trader.Faction && !pawn.IsSlave && !pawn.IsPrisoner','Same-home-faction ordinary pawns cannot be sold back through this path.'),
 @('RimWorld.TradeUtility','item3.IsAnimal && item3.HostFaction == null && !item3.InMentalState && !item3.Downed','Animal candidates must be spawned player animals without host faction, mental state or downed state.'),
 @('RimWorld.Pawn_TraderTracker','foreach (Pawn item6 in from x in TradeUtility.AllSellableColonyPawns(pawn.Map)','Animal candidates have a distinct branch from Home/storage-bound floor items.'),
 @('RimWorld.Pawn_TraderTracker','where !x.Downed && ReachableForTrade(x)','Animal sale still checks reachability.'),
 @('RimWorld.Pawn_TraderTracker','PathEndMode.Touch, TraverseMode.PassDoors, Danger.Some','Reachability is measured from the trader, with PassDoors and Touch.'),
 @('RimWorld.TradeDeal','!TradeSession.playerNegotiator.IsWorldPawn() && !InSellablePosition(item','On-map trade adds position validation after candidate generation.'),
 @('RimWorld.TradeDeal','if (positionHeld.Fogged(t.MapHeld))','Fogged stock cannot be sold from the colony.'),
 @('RimWorld.TradeDeal','GenRadial.NumCellsInRadius(6.9f)','Nearby same-room selling blockers use a bounded radius.'),
 @('RimWorld.TradeDeal','PreventPlayerSellingThingsNearby(out reason)','Nearby objects can veto a sale.'),
 @('RimWorld.TransferableUtility','pawn.relations?.GetFirstDirectRelationPawn(PawnRelationDefOf.Bond) != null','Bond prevents row stacking in CanStack, not sale itself.'),
 @('RimWorld.TransferableUtility','pawn.health.hediffSet.HasHediff(HediffDefOf.Pregnant, mustBeVisible: true)','Visible pregnancy prevents row stacking in CanStack, not sale itself.'),
 @('RimWorld.TransferableUtility','if (pawn.gender != pawn2.gender)','Row grouping distinguishes sex.'),
 @('RimWorld.TransferableUtility','pawn.ageTracker.CurLifeStageIndex != pawn2.ageTracker.CurLifeStageIndex','Row grouping distinguishes life stage.'),
 @('RimWorld.Tradeable_Pawn','thingsColony.Take(CountToTransferToDestination)','Selling selects existing pawn references from colony offers.'),
 @('RimWorld.Tradeable_Pawn','thingsTrader.Take(CountToTransferToSource)','Buying selects existing pawn references from trader offers.'),
 @('RimWorld.Pawn_TraderTracker','pawn.PreTraded(TradeAction.PlayerBuys, playerNegotiator, this.pawn);','Map caravan buying invokes the existing pawn trade hook.'),
 @('RimWorld.Pawn_TraderTracker','pawn.GetLord()?.Notify_PawnLost(pawn, PawnLostCondition.Undefined);','A bought pawn exits its trader Lord.'),
 @('RimWorld.Pawn_TraderTracker','AddPawnToStock(pawn);','Selling hands the existing pawn to caravan stock ownership.'),
 @('RimWorld.Pawn_TraderTracker','if (!newPawn.Spawned)','Only an unspawned sold pawn needs fallback spawning; normal eligible animals are already spawned.'),
 @('RimWorld.Pawn_TraderTracker','newPawn.SetFaction(pawn.Faction);','Sold animals receive the trader faction.'),
 @('RimWorld.Pawn_TraderTracker','lord.AddPawn(newPawn);','Sold animals join the trader Lord.'),
 @('Verse.Pawn','ownership?.UnclaimAll();','PreTraded removes pawn ownership claims, including beds.'),
 @('Verse.Pawn','DropAndForbidEverything();','Spawned traded pawns drop carried possessions through the general trade hook.'),
 @('Verse.Pawn','SetFaction(Faction.OfPlayer);','Bought animals become player faction through PreTraded.'),
 @('Verse.Pawn','relations.Notify_PawnSold(playerNegotiator);','Selling flesh pawns triggers relationship consequences.'),
 @('Verse.Pawn','Map.designationManager.RemoveAllDesignationsOn(this);','Faction changes remove map designations.'),
 @('Verse.Pawn','health.surgeryBills.Clear();','Faction changes clear pending surgery bills, not the health state.'),
 @('Verse.Pawn','jobs?.StopAll(ifLayingKeepLaying);','Clearing the pawn mind stops obsolete jobs.'),
 @('Verse.Pawn','pather?.StopDead();','Clearing the pawn mind stops its old path.'),
 @('Verse.Pawn','training.Train(TrainableDefOf.Tameness, recruiter, complete: true);','Joining the player completes tameness.'),
 @('Verse.Pawn','roping?.BreakAllRopes();','Faction changes break ropes.'),
 @('RimWorld.Pawn_PlayerSettings','allowedAreas.Clear();','Faction changes clear allowed-area assignments.'),
 @('RimWorld.Pawn_RelationsTracker','pawn.relations.RemoveDirectRelation(mostImportantRelation, potentiallyRelatedPawn);','Selling breaks a bond in the relationship notification when Bond is the relevant relation.'),
 @('RimWorld.LordToil_ExitMapAndEscortCarriers','p.mindState.duty = new PawnDuty(DutyDefOf.Escort, trader, 14f);','Departing Chattel receives escort duties and walks with the group.'),
 @('Verse.Pawn','Scribe_Values.Look(ref gender, "gender", Gender.Male);','Sex is saved on the actual pawn.'),
 @('Verse.Pawn','Scribe_Deep.Look(ref ageTracker, "ageTracker", this);','Age state is saved deeply.'),
 @('Verse.Pawn','Scribe_Deep.Look(ref health, "healthTracker", this);','Health and its pregnancy state belong to saved pawn state.'),
 @('Verse.AI.Group.Lord','Scribe_Collections.Look(ref ownedPawns, "ownedPawns", LookMode.Reference);','Lord membership saves references to the same pawns.'),
 @('RimWorld.CompEggLayer','Scribe_Values.Look(ref eggProgress, "eggProgress", 0f);','Egg production progress is independently saved.'),
 @('Verse.Hediff_Pregnant','new PawnGenerationRequest(mother.kindDef, mother.Faction','Newborn animals inherit the mother faction at birth.'),
 @('Verse.Hediff_Pregnant','mother.GetLord()?.AddPawn(pawn);','On-map birth adds the newborn to the mother Lord.'),
 @('RimWorld.PawnUtility','return GenSpawn.Spawn(pawn, positionOverride ?? motherOrEgg.PositionHeld, motherOrEgg.MapHeld) != null;','On-map offspring spawn at mother or held-egg location.'),
 @('RimWorld.CompEggLayer','compHatcher.hatcheeFaction = parent.Faction;','Fertile eggs capture the layer faction at production time.'),
 @('RimWorld.CompHatcher','new PawnGenerationRequest(Props.hatcherPawn, hatcheeFaction','Hatching uses the egg faction, not the current mother faction.'),
 @('RimWorld.CompHatcher','Scribe_References.Look(ref hatcheeFaction, "hatcheeFaction");','The egg retains its faction reference in saves.'),
 @('RimWorld.CompHatcher','hatcheeFaction = Faction.OfPlayer;','Buying an already laid egg has its own faction update hook.'),
 @('RimWorld.StatWorker_MarketValue','PriceUtility.PawnQualityPriceFactor((Pawn)req.Thing)','Animal market value depends on individual pawn quality.'),
 @('RimWorld.PriceUtility','pawn.health.summaryHealth.SummaryHealthPercent','Health affects the pawn quality multiplier.'),
 @('RimWorld.PriceUtility','forTradePrice: true','Pawn capacity modifiers use trade-specific capacity calculation.'),
 @('RimWorld.PriceUtility','num *= pawn.ageTracker.CurLifeStage.marketValueFactor;','Current life stage affects price.'),
 @('RimWorld.PriceUtility','hediffs[i].def.priceImpact || hediffs[i].def.priceOffset != 0f','Price-impacting hediffs can add explicit offsets.'),
 @('RimWorld.Tradeable','if (ThingDef.IsLeather || ThingDef.IsMeat || ThingDef.IsWool)','Animal-product bonus applies only to these products, excluding live animals and eggs.'),
 @('RimWorld.TradeUtility','thing.MarketValue * 0.6f * priceFactorSell_TraderPriceType','Sell price combines individual value, trader, difficulty and other modifiers.'),
 @('RimWorld.TradeUtility','thing.MarketValue * 1.4f * priceFactorBuy_TraderPriceType','Buy price uses a different global multiplier.'),
 @('RimWorld.Tradeable','pricePlayerSell = pricePlayerBuy;','Cached sell price is capped by the matching buy price.'),
 @('RimWorld.TradeDeal','num += tradeable.CurTotalCurrencyCostForSource;','Currency settlement aggregates animal and item trade rows.'),
 @('RimWorld.TradeShip','TradeUtility.SpawnDropPod(DropCellFinder.TradeDropSpot(Map), Map, thing);','Orbital purchase uses a drop pod rather than map-caravan in-place transfer.'),
 @('RimWorld.Planet.Settlement_TraderTracker','caravan.AddPawn(p, addCarriedPawnToWorldPawnsIfAny: true);','Settlement purchase adds the same pawn to the player world caravan.')
)
$records=@(foreach($rule in $rules){
 $m=@($manifest.types|Where-Object type -eq $rule[0]);if($m.Count -ne 1){throw "Missing rule type $($rule[0])"}
 $lines=$sources[$rule[0]].Split("`n");$hits=@(for($i=0;$i -lt $lines.Length;$i++){if($lines[$i].Contains($rule[1])){[ordered]@{line=$i+1;text=$lines[$i].Trim()}}})
 if(!$hits.Count){throw "Missing anchor $($rule[0]): $($rule[1])"}
 [ordered]@{type=$rule[0];file=$m[0].local_file;sha256=$m[0].sha256;anchor=$rule[1];hits=$hits;interpretation=$rule[2]}
})
function BoundedAbsence([string]$type,[string]$start,[string]$end,[string[]]$tokens,[string]$meaning){
 $s=$sources[$type];$a=$s.IndexOf($start,[StringComparison]::Ordinal);if($a -lt 0){throw "Missing method start $start"}
 $b=if($end){$s.IndexOf($end,$a+$start.Length,[StringComparison]::Ordinal)}else{$s.Length};if($b -le $a){throw 'Missing method end'}
 $body=$s.Substring($a,$b-$a);foreach($token in $tokens){if($body.Contains($token)){throw "Unexpected token $type $token"}}
 [ordered]@{type=$type;start=$start;end=$end;lineStart=$s.Substring(0,$a).Split("`n").Count;lineEnd=$s.Substring(0,$b).Split("`n").Count;sha256=TextHash $body;absent=$tokens;interpretation=$meaning}
}
$bounded=@(
 (BoundedAbsence 'RimWorld.StockGenerator_Animals' 'private bool PawnKindAllowed' 'public void LogAnimalChances' @('tradeTagsBuy') 'Supply selection uses sell tags; buy-only tags do not create stock.'),
 (BoundedAbsence 'RimWorld.TraderKindDef' 'public bool WillTrade' 'public PriceType PriceTypeFor' @('TradeabilityFor') 'WillTrade calls the union-based HandlesThingDef path.'),
 (BoundedAbsence 'RimWorld.Tradeable' 'public override int GetMinimumToTransfer' 'public override AcceptanceReport UnderflowReport' @('TradeabilityFor','PlayerCanSell','TraderCanSell') 'Transfer bounds use held counts without an additional generator directional gate.'),
 (BoundedAbsence 'RimWorld.TradeUI' 'public static void DrawTradeableRow' 'private static void DrawPrice' @('TradeabilityFor') 'The row UI uses TraderWillTrade and inventory bounds.'),
 (BoundedAbsence 'RimWorld.TradeDeal' 'private void AddAllTradeables' 'private void LimitCurrencyCountToFunds' @('TradeabilityFor') 'Reviewed offer, settlement and resolution path has no directional generator query.'),
 (BoundedAbsence 'RimWorld.TradeUtility' 'public static bool PlayerSellableNow' 'public static void SpawnDropPod' @('Pregnant','Bond','Master','CompEggLayer') 'These states are not direct rejection gates in PlayerSellableNow.'),
 (BoundedAbsence 'RimWorld.TradeUtility' 'public static IEnumerable<Pawn> AllSellableColonyPawns' 'public static Thing ThingFromStockToMergeWith' @('Pregnant','Bond','Home[','IsInAnyStorage','AreaRestriction','PenMarker') 'Animal candidate selection has no pregnancy, bond, Home/storage or pen assignment gate.'),
 (BoundedAbsence 'RimWorld.Pawn_TraderTracker' 'foreach (Pawn item6 in from x' 'public void GiveSoldThingToTrader' @('Home[','IsInAnyStorage','IsForbidden') 'The animal branch does not inherit floor-item Home/storage or forbid checks.'),
 (BoundedAbsence 'Verse.Pawn' 'public override void PreTraded' 'public void PreKidnapped' @('GeneratePawn','AgeBiologicalTicks =','health.Reset','CompEggLayer') 'Trading changes ownership/control without explicitly regenerating age, health or egg production.'),
 (BoundedAbsence 'Verse.Pawn' 'public override void SetFaction' '[Obsolete]' @('GeneratePawn','AgeBiologicalTicks =','health.Reset','CompEggLayer') 'Faction change preserves the pawn body and production component while clearing control state.'),
 (BoundedAbsence 'RimWorld.CompHatcher' 'public void Hatch()' 'public override bool AllowStackWith' @('GetLord','AddPawn') 'On-map hatching does not explicitly join the mother trader Lord, unlike live birth.'),
 (BoundedAbsence 'RimWorld.PawnUtility' 'public static bool PlayerHasReproductivePair' 'public static float PlayerAnimalBodySizePerCapita' @('Sterile','GetRoom','PenMarker') 'Pair weighting checks sex and life stage across player-owned pawns, not local breeding access.'),
 (BoundedAbsence 'RimWorld.PriceUtility' 'public static float PawnQualityPriceFactor' '' @('CompEggLayer','AnimalProductsSellImprovement','PawnRelationDefOf.Bond') 'No direct egg progress, animal-product bonus or bond multiplier exists in these pricing helpers.')
)
$raceFields=@('tradeability','tradeTags','statBases/MarketValue','statBases/Wildness','race/packAnimal','race/lifeStageAges','race/lifeExpectancy','race/ageGenerationCurve')
$specs=@(
 @('Data/Core/Defs/TraderKindDefs/TraderKinds_Caravan_Outlander.xml','/Defs/TraderKindDef[defName="Caravan_Outlander_BulkGoods"]',@('stockGenerators'),'Full stock declarations retain other buying generators as well as animal supply.'),
 @('Data/Core/Defs/TraderKindDefs/TraderKinds_Caravan_Outlander.xml','/Defs/TraderKindDef[defName="Caravan_Outlander_Exotic"]',@('stockGenerators'),'Exotic animal supply tags and total counts differ from bulk.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Hares.xml','/Defs/ThingDef[@Name="BaseHare"]',$raceFields,'Hare inherits AnimalCommon only, value fifty and wildness .75.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Hares.xml','/Defs/ThingDef[defName="Hare"]',$raceFields,'Concrete Hare adds no trade override.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_PigGroup.xml','/Defs/ThingDef[defName="Deer"]',$raceFields,'Deer has AnimalCommon only and wildness .75.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_SheepGroup.xml','/Defs/ThingDef[defName="Alpaca"]',$raceFields,'Alpaca is an AnimalFarm species and a pack animal.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_CowGroup.xml','/Defs/ThingDef[defName="Dromedary"]',$raceFields,'Dromedary is an AnimalFarm species and a pack animal.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_ChickenGroup.xml','/Defs/ThingDef[defName="Chicken"]',$raceFields,'Chicken has AnimalFarm and no native fixed age in its race declaration.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml','/Defs/ThingDef[@Name="BasePawn"]',@('category','useHitPoints','tradeability','tradeTags'),'Live pawns do not use the ordinary Thing hitpoint price multiplier.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml','/Defs/ThingDef[@Name="AnimalThingBase"]',@('tradeability','tradeTags','race/ageGenerationCurve'),'Common animal parent adds no directional trade restriction.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml','/Defs/PawnKindDef[@Name="AnimalKindBase"]',@('minGenerationAge','maxGenerationAge','fixedGender'),'Common animal kind adds no reproductive minimum age.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_ChickenGroup.xml','/Defs/PawnKindDef[defName="Chicken"]',@('race','minGenerationAge','maxGenerationAge','fixedGender'),'Chicken kind adds no reproductive minimum age.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalBaby"]',@('marketValueFactor','reproductive','developmentalStage'),'Baby value is .4; reproductive false and developmental Adult are class defaults.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalBabyTiny"]',@('marketValueFactor','reproductive','developmentalStage'),'Chicken tiny baby inherits AnimalBaby value.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalJuvenile"]',@('marketValueFactor','reproductive','developmentalStage'),'Juvenile value is .75, without an Adult developmental override.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalAdult"]',@('marketValueFactor','reproductive','developmentalStage'),'Adult animals are reproductive and use the default value factor one.')
)
$docs=@{}
$defs=@(foreach($spec in $specs){
 $file=Join-Path $GameRoot $spec[0]
 if(!$docs.ContainsKey($spec[0])){$doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null;$doc.Load($file);$docs[$spec[0]]=$doc}
 $nodes=@($docs[$spec[0]].SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected XML node count: $($spec[1])"}
 $node=$nodes[0];$fields=@(foreach($xpath in $spec[2]){$values=@($node.SelectNodes($xpath));[ordered]@{xpath=$xpath;count=$values.Count;xml=@($values|ForEach-Object OuterXml)}})
 [ordered]@{file=$spec[0];sha256=Hash $file;xpath=$spec[1];nameAttribute=$node.GetAttribute('Name');parentName=$node.GetAttribute('ParentName');fields=$fields;interpretation=$spec[3]}
})
$bulk=$docs['Data/Core/Defs/TraderKindDefs/TraderKinds_Caravan_Outlander.xml'].SelectSingleNode('/Defs/TraderKindDef[defName="Caravan_Outlander_BulkGoods"]/stockGenerators/li[@Class="StockGenerator_Animals"]')
$exotic=$docs['Data/Core/Defs/TraderKindDefs/TraderKinds_Caravan_Outlander.xml'].SelectSingleNode('/Defs/TraderKindDef[defName="Caravan_Outlander_Exotic"]/stockGenerators/li[@Class="StockGenerator_Animals"]')
if($bulk.countRange -cne '3~4' -or $bulk.kindCountRange -cne '1' -or $bulk.maxWildness -cne '0.70' -or $exotic.countRange -cne '1~3'){throw 'Trader stock reference changed'}
$record=[ordered]@{
 evidence_id='RW17-LIVE-ANIMAL-TRADE-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash
 reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile)
 manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile);rules=$records;boundedChecks=$bounded;packagedXml=$defs
 nativeReference=[ordered]@{
  stockIsActualPawns=$true;mapCaravanBuyInPlace=$true;mapCaravanSellInPlace=$true;animalsRequireHomeOrStorage=$false
  bulkTotalCount=@(3,4);bulkRemainingKindCount=1;bulkMaxWildness=.7;bulkSupplyTags=@('AnimalFarm');bulkExtraBuyTags=@('AnimalExotic')
  exoticTotalCount=@(1,3);exoticRemainingKindCount=3;exoticSupplyTags=@('AnimalUncommon','AnimalFighter','AnimalFarm','AnimalPet');exoticExtraBuyTags=@('AnimalExotic')
  pairConsumesTotalCount=2;pairKindIndependentOfRemainingKinds=$true;pairFixesSexNotAge=$true;existingPairWeight=.5
  offeredFarmSpeciesInWeb=@('alpaca','dromedary','chicken');unsupportedByTheseAnimalGenerators=@('hare','deer')
  actualRowAcceptance='WillTrade -> HandlesThingDef uses sell OR buy tags; TradeabilityFor is a separate directional descriptor'
  liveAnimalProductBonus=0;animalBabyValueFactor=.4;animalJuvenileValueFactor=.75;animalAdultValueFactor=1
  baseValues=[ordered]@{Hare=50;Deer=250;Alpaca=350;Dromedary=300;Chicken=50}
  globalBuyFactor=1.4;globalSellFactor=.6;liveBirthFaction='mother current faction';liveBirthLord='mother current Lord when spawned'
  fertileEggFaction='captured at egg production; egg trade has its own update hook';onMapHatchExplicitLordJoin=$false
 }
 limits=@('Static derived C# and packaged XML are not original source or runtime gameplay proof.','Existing REA metadata is reused for exact assembly identity only; all listed types are independently re-extracted.','No game, browser, preview, GUI input or screenshot was launched.','Selected Core XML inheritance nodes are not a complete mod-patched effective Def database.','Directional trade classification is distinguished from the reviewed actual UI and transfer path; no claim is made that TradeabilityFor has no callers anywhere.','Mating-pair generation fixes sex but does not itself fix age or establish fertility.','Map-caravan, settlement and orbital transfer are distinct paths.','Preserving state does not mean preserving control assignments, bonds, possessions or pending surgery bills.','Web restrictions on merchant mating or laying, simplified health pricing and deterministic offer seeds are implementation choices.','No game assets, assemblies or complete derived C# is published.')
 collectorSha256=Hash $PSCommandPath
}
$json=($record|ConvertTo-Json -Depth 20).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static live-animal-trade projection differs'};"Checked live-animal-trade: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) packaged XML projections"}
else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));'Collected live-animal-trade static mechanisms'}
