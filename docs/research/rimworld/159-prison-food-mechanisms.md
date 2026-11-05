# 159 囚犯供餐、牢房食物与床边喂食

本轮研究的目标是让囚犯饮食成为真实的物品流程：**狱卒找到食物 → 预留实际份额 → 搬到牢房并落地 → 囚犯自行拿起吃下去**。卧床且需要照顾的囚犯则走另一条床边喂食流程。供餐、落地、自吃、喂食不能合并成一个直接增加饱食度的动作。

静态目标仍为本机 **RimWorld 1.7.4980 rev60**。`Assembly-CSharp.dll` SHA256：`eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。本轮没有启动或交互原版、浏览器、preview、GUI，也没有截图。文中结论是安装包静态重建，不是原版交互测试。

[类型清单](evidence/prison-food-manifest.json)保留 30 个派生类型；[机制投影](evidence/prison-food-mechanisms.json)记录 103 个锚点、17 个限定方法检查、12 个 XML 投影。17 个类型与[上一轮饮食政策证据](evidence/food-policies-manifest.json)哈希相同。REA 身份仍锚定[同一程序集的托管记录](evidence/production-bills-rea-managed.json)。完整派生 C#、DLL 和游戏资源保持本地，不进入发布内容。

## 两种狱卒任务和一个囚犯任务

| 入口 | 目标 | 实际行为 | 谁获得营养 |
|---|---|---|---|
| `WorkGiver_Warden_DeliverFood` → `JobDriver_FoodDeliver` | 通常可自行吃饭的囚犯 | 取食、搬到牢房目标格、落地 | 送到地上时无人获得营养 |
| `WorkGiver_Warden_Feed` → `JobDriver_FoodFeedPatient` | 在床且倒地/应医疗休息的囚犯 | 取食、走到床边、耗时喂食、实际消费 | 被喂的囚犯 |
| 囚犯任务树 → `JobGiver_GetFood` → `JobDriver_Ingest` | 囚犯自己的饥饿需求 | 在可取范围找到食物、拿起、咀嚼、实际消费 | 囚犯本人 |

Core WorkGiver 定义把床边喂食放在 Warden 类型优先级 80，普通送餐为 70，两者都要求 Manipulation。两种任务的 JobDef 报告文字都可以显示“feeding”，但不能据 UI 字样断言它们都直接喂到嘴里；要继续追踪 driver。

`Humanlike.xml` 的 Prisoner 分支在需求处理前安排医疗休息和衣物任务，再由 `ThinkNode_PrioritySorter` 处理 GetFood、GetRest 等需求，最后有当前房间游走。囚犯不是只有一个“静止等待狱卒”的状态。

## 供餐对象先要是可照管的囚犯

两个 WorkGiver 都先调用 `ShouldTakeCareOfPrisoner`。它要求：

- 确实是 Colony Prisoner，已生成到地图，且 `PrisonerIsSecure` 为真。
- 没有攻击性精神状态，也没有正在组成商队。
- 对狱卒不是 forbidden，狱卒能够在自己的危险限制内抵达并独占预留该囚犯。

`PrisonerIsSecure` 在已释放、没有 HostFaction、攻击性精神状态、离图工作或正在越狱时返回 false。它不是简单的“在 prisoner 数组中就安全”。普通供餐不应继续服务一个已招募成殖民者、已释放离开或正在越狱的旧目标。

普通地面送餐进一步要求囚犯当前格处于 prison cell。原版房间是否为 prison cell 来自实际房间结构和 prisoner bed：`RoomCanBePrisonCell` 要求 ProperRoom 且不是 IsHuge，房间形状重算时再查看包含或相邻的囚犯床。这不是给任意一个格子打“牢房”标签就完成的全部机制。Web 依现有多层房间/门/囚犯床实现自己的对应关系即可，不需要本轮照搬巨大房间阈值。

## 本机版本没有独立的 AllowFood 字段

本机 `Pawn_GuestTracker` 的 `CanBeBroughtFood` 是计算属性：

```text
Execution → false
Release → pawn.Downed
其它 interactionMode → true
```

已检查的 `Pawn_GuestTracker`、`PrisonerInteractionModeDef` 中没有 `allowFood` / `AllowFood` / `getsFood` 字段。`ITab_Pawn_Prisoner` 只继承 `ITab_Pawn_Visitor`，父 tab 的记录范围中也没有相应供餐或 food policy 控件。这个结论限定于本机版本和这些明确检查过的类型，不能推广到其它版本或模组。

Core `MaintainOnly` 的说明是“喂食并照顾基本需求，不进行其它互动”，不是“不做任何护理”。囚犯的饮食政策可通过政策追踪器决定狱卒给他什么食物，详见[157 饮食政策](157-food-policies-mechanisms.md)。

本轮 Web 不增加独立的“允许供餐”开关。饮食政策改为不允许相关食物，或囚犯被释放而不再属于照护对象时，应取消不再有效的供餐任务，同时保留实际食物；不要把已经落在牢房里的食物删除，也不要阻止仍在牢房的囚犯自己吃现成食物。如果后续增加独立开关，应明确记为 Web 管理扩展，不能与“Nothing 饮食政策”、处决模式以及释放状态混为一谈。

## 普通送餐的完整创建顺序

`WorkGiver_Warden_DeliverFood.JobOnThing` 在上述照管条件之后依次检查：

1. `CanBeBroughtFood` 为真，囚犯处于 prison cell，并有 food need。
2. 饱食度严格低于 `PercentageThreshHungry + .02`。
3. `WardenFeedUtility.ShouldBeFed` 为 false；需要床边喂食者不接普通送餐。
4. 调统一 FoodUtility，以 **狱卒为 getter、囚犯为 eater** 找具体食物。
5. 如果选中食物已经在囚犯当前房间，不创建搬运；如果房间现有食物估算足够，也不创建搬运。
6. 按囚犯所需营养决定 `job.count`，以实际食物作为 A、囚犯作为 B，计算囚犯附近的落点作为 C。

该次搜索允许使用狱卒 inventory，禁止借用驮运动物 inventory，不允许尸体，不采收，不尝试先补空的营养膏机；有足够原料且能运作的膏机仍可以成为来源。`calculateWantedStackCount=true` 让候选预留判断按预计吃多少检查。

食物可来自真实地面或实际库存，不要求一定处于 stockpile。拿谁的食物、是否可达、是否被预留和禁止，以 getter 的物理权限判断；食性、政策、营养和思想以 eater 判断。狱卒自己的素食政策不应错误地变成囚犯的饮食政策。

## 现有食物怎么抑制重复供餐

原版不是对目标囚犯单独比较“他附近是否有一顿饭”，而是对其**整个房间**做近似估算。

首先，目标囚犯手中 `carryTracker.CarriedThing` 只要提供大于零的可吃营养，就直接判定已有食物。此处不是遍历他的所有 inventory，更不是只看地图食物总数。

否则遍历 `room.Regions`：

- 对 `FoodSourceNotPlantOrTree` 中的对象，普通可摄入食物要求 preferability > 3 才计入。植物/树不是这项房间粮食库存。
- 普通食物若 `IsNutritionGivingIngestible && prisoner.WillEat(foodSource)`，按单个 Nutrition × stackCount 计入供应。
- 可运作且囚犯有 Manipulation、能到达的营养膏机按 99,999 营养处理，表示此估算中无需再送。
- 遍历同房间所有饥饿囚犯，把低于供餐阈值、且手中没有自己愿吃食物的人的 `NutritionWanted` 加起来，形成总需求。

最终判断为：

```text
房间可用营养 + 0.5 >= 同房间待供餐囚犯的营养缺口总和
```

满足便抑制新送餐。这一 .5 是原版容差，不能当作凭空送了 .5 营养；没有修改任何物品或 hunger。Web 当前营养单位和 hunger 范围不同，应保留“合算房间现有量、避免多名狱卒反复塞饭”的机制，再单独调容差。

这段原版估算有明确的局限：普通食物没有逐项检查 `IngestibleNow`、新鲜度、forbidden、预留或可达；只有膏机分支直接检查路径。因此“房里有一堆实际上吃不到的食物，可能抑制更多供餐”不能从静态代码排除。Web 可以使用实际新鲜度、囚犯路径与未预留数量，减少这类卡死，但应注明是更严格的供餐估算。

另一个重要差异来自政策上下文：房间食物调用的是没有玩家 getter 的 `prisoner.WillEat`。非玩家阵营囚犯自己吃时通常忽略殖民地给他的政策；狱卒送餐选食时则遵守。故“不允许狱卒送肉”和“牢房已有肉会不会被囚犯吃”不是同一个问题。

原版这段没有遍历正在路上的其它 DeliverFood，把它们的 cargo 累加成共享房间的在途供应。独占某一囚犯和按份额锁食物可以防一部分竞争，但不是房间级原子配额。Web 若显式计入在途供应，应标为并发一致性设计，并保证取消任务会释放该份额。

## 囚犯自取食怎样留在牢房语义里

囚犯饥饿使用普通 `JobGiver_GetFood`，自己同时是 getter/eater。在通常应有人代喂且尚未 Starving 时，`GetPriority` 会返回 0，让代喂负责；达到 Starving 会移除这项优先级抑制，但不保证身体已能行动，也不绕过其它物理条件。

同房间取食不仅依赖政策。`SocialProperness` 对标记了 `socialPropernessMatters` 且已 spawn 的对象检查：囚犯只能认为同一个 Room 的食物合乎社会归属；普通非囚犯通常不自动吃 prison cell 里的食物。Core 的 MealBase、PlantFoodRawBase、Milk 都有此标志。未标记的对象、非 spawn 对象或特别调用路径有各自例外，不应把这条描述成对所有物品一概强制。

正常物理门路、禁用状态和可达检查仍独立存在。Web 应防止囚犯走出监牢去全地图仓库吃饭，也应避免普通搬运工立刻把刚送达的牢房口粮当普通散落食物全部搬回库房。后者需要和现有库存/搬运机制接通，不能只通过提高一个送餐频率掩盖循环。

## 落点来自囚犯附近的真实位置搜索

`RCellFinder.SpotToChewStandingNear(prisoner, food)` 委托 `SpotToStandDuringJob`：常规候选先能找到相邻食物摆放处，再通过区域内立足点检查。对有 HostFaction 的囚犯，常规候选要求仍在他的当前房间；非 desperate 阶段排除不良目的地、落物阻挡和 Portal 区域，所有常规阶段排除静态火、陷阱和不可预留目的地。

通用搜索初始距离 4 格，在 30 次尝试里逐步扩大到 8、15 格，交替放宽危险等限制。**最终 fallback 不是同等严格的候选**：它从最初 region 随机取格，extraValidator 检查一个随机格，最终返回还会再取一个随机格。不能把正常候选的全部安全条件宣称为此方法每个返回值的绝对保证。

Web 可以采用确定性、可落物、可达、仍在牢房且无火的落点，失败就等候/取消并保留口粮；这更适合稳定复现，但不是照抄原版随机 fallback。targetC 是任务创建时存下的格子，原版 driver 不会每 tick 重新算一个位置来追着囚犯走。

## 预留、份额、carry 和真实落地

普通送餐的初始 `TryMakePreToilReservations` 只锁囚犯，maxPawns=1；没有同时把整个房间或落点锁住。地面食物通过后续 `ReserveFoodFromStackForIngesting` 按囚犯缺口重算数量，再以 maxPawns=10、实际份额预留 stack。十是支持共享份额的上限，不是“十个人可以各拿整堆”。`ReservationManager` 还核对累积份额、模式冲突和物理交互预留。

实际取用有两个路径：

- 狱卒 inventory：按 min(当前 stackCount, job.count) 转到 carry container，并把 targetA 改为实际 carried 实体。
- 地面食物：走到接触位置，按 min(当前 stackCount, job.count) 调 `TryStartCarry`，再受剩余携带容量限制；拆分来自原 stack，targetA 更新为真实 carried split，旧 stack 的预留按需释放。

原版预留 toil 重算了预留数量，却没有更新 `job.count`；pickup 仍读取原 job.count。这提示我们不要把“创建时算了 count”误当全过程不变的唯一真值。Web 可以用自己的严格份额预留，使源 stack、carry、落地口粮在竞争和取消时一致。

然后狱卒按 targetC 走到目标格，尝试 `TryDropCarriedThing(..., ThingPlaceMode.Direct)`。driver 本身没有检查这次调用的返回值；底层 `ThingOwner.TryDrop` 只有真实放置成功才从容器 Remove，失败食物保留在手中。后续常规 job cleanup 在未指定保留 carry 时会尝试附近落地。没有一段代码允许“找不到落点就删除粮食或直接填满囚犯饥饿”。

carry 容器深度保存，driver 的 inventory/dispenser 路径标志也保存。Web 存档应保留同一物品的来源、数量、腐败与食材信息；尚在搬运的粮食不能同时算已落地食物，恢复任务也不能从源 stack 再取一次。

## 途中变化与床边切换

FoodDeliver 会因囚犯 despawn/null 失败；搬送阶段还检查目标是否被销毁/禁止、狱卒是否仍携带 targetA、目标是否还是 Colony Prisoner、以及 `CanBeBroughtFood` 是否仍为真。原版这段未直接重查当前 hunger、房间总粮、food policy、牢房形状、targetC 所属房间或新出现的床边护理需求。

因此 Web 在房门/房间变化、政策修改、囚犯被释放或招募、病人状态变化时，主动重新验证并取消/改走合适任务，是明确的一致性适配。取消仍须归还未消费的物理食物和预留，不能回滚已经实际发生的落地或摄入。

床边喂食的 `WardenFeedUtility` 要求 Colony Prisoner、在床、允许带食物，且 Downed 或需要医疗休息。它不要求目标必须拥有某个“残废”永久标签。FoodFeedPatient 锁病人和可用食物份额，取物后走到病人身边，按 ×1.5 的进食时长喂食，然后 `FinalizeIngest(Deliveree)` 才真正消费并增加患者营养。

这个 driver 会重新检查 `FoodUtility.ShouldBeFedBySomeone`，因此康复起床等状态变化可以使当前喂食不再有效。它不使用普通地面送餐的“房内粮食足够”抑制；卧床者旁边有米堆，不代表已经有人把食物喂给他。普通医生 FeedPatient WorkGiver 对由狱卒负责的病人通常让路，ColonyMech 是代码中的例外。

## Web 应证明的玩法闭环

验证应分别观察食物在哪、谁在行动、谁获得营养：普通囚犯在粮仓有饭而牢房没饭时等待狱卒；狱卒耗时取饭并走到牢房落地；这一刻 food 不上涨；囚犯之后走到同房间口粮并吃下去才上涨。卧床囚犯要看到狱卒床边耗时喂食；政策改为不允许相关食物，或释放导致不再安排供餐时，不应删除已经送来的口粮。

还需覆盖同房间多人、两名狱卒竞争、厨师/搬运工占用源食物、部分 stack、房间落点满、失去路径、途中招募/释放/政策改变、从普通送餐变成床边需求，以及取起前/途中/落地前的存读档。所有阶段都应守住物品数量、唯一归属和营养仅在实际摄入时结算。

本轮无需为了这些机制改动已有 hunger 消耗或营养数值。原版 .02 阈值偏移、.5 房间容差、优先级和随机搜索半径已留在证据里，后续可以单独调整 Web 节奏。

独立静态复核：

```powershell
pwsh -File scripts/research/extract-prison-food.ps1
pwsh -File scripts/research/collect-prison-food-evidence.ps1
pwsh -File scripts/research/extract-prison-food.ps1 -Check
pwsh -File scripts/research/collect-prison-food-evidence.ps1 -Check
```

`-Check` 重新读取程序集或 XML、比对派生文本和投影。它没有执行目标游戏代码，不替代原版交互测试或 Web 行为测试。
