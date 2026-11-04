# 155 服装政策、自动换装与强制穿戴

本轮追踪的是一条完整玩法链：**玩家设置共用政策 → 居民检查已有衣物 → 从真实库存选择更合适的衣物 → 走到目标并耗时换装 → 旧衣留下并重新进入搬运循环 → 手动指定的衣物受到自动任务保护**。先把政策、行动、物品守恒和存档接起来，数值作为可核对的参考，后续再调 Web 节奏。

目标为本机 **RimWorld 1.7.4980 rev60**。`Assembly-CSharp.dll` SHA256：`eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。本轮没有启动或操作原版、浏览器、预览、GUI，也没有截图。下述结论来自安装包静态重建和 Core XML，不代表本轮已做交互对照。

[类型清单](evidence/apparel-policies-manifest.json)保留 34 个派生类型及哈希；[机制投影](evidence/apparel-policies-mechanisms.json)保留 106 个字面锚点、12 个限定方法检查、17 个 XML 投影和 7 种衣物的完整已选 Core 父链。REA 复用[同一程序集的托管元数据](evidence/production-bills-rea-managed.json)，具体方法由固定版本 ILSpy 离线重建。派生 C# 全文和游戏文件不发布。

## 政策是共享过滤器，强制穿戴是具体物品的例外

| 载体 | 职责 | 存档方式 |
|---|---|---|
| `ApparelPolicy : Policy` | id、可改名 label、`ThingFilter` | 政策与 filter 深度保存 |
| `OutfitDatabase` | 所有政策、默认政策、建立和删除 | 保存政策列表 |
| `Pawn_OutfitTracker` | 某居民选择的共用政策 | 保存政策引用 `curOutfit` |
| `OutfitForcedHandler` | 该居民手动强制穿戴的具体衣物 | 保存衣物引用列表 `forcedAps` |
| `Pawn_ApparelTracker` | 实际穿在身上的衣物与锁定状态 | 与政策引用分离 |

类名仍有 Outfit，但 `CurrentApparelPolicy` 指向的是共享政策。两名居民选择同一政策后，修改该政策的允许衣物或耐久范围，会改变两者后续判断；不是给每人复制一份过滤器。

默认政策是列表第一个条目。设置默认通过交换列表位置实现；没有当前政策的居民在 getter 中取得当时默认政策，已有有效指派不会因此统一改成新默认。新政策最初允许 Apparel 类别；新 ID 是当前已有最大 ID 加一，并非全局永不复用的序号。

删除时先检查所有地图、商队和旅行运输中的活 Pawn；有人仍使用该政策就拒绝，提示使用者。随后才清理其它世界/临时 Pawn 的引用并移除政策。删除政策不会销毁衣物。

## 初始政策与 Web 已有七种衣物的对应

原版基础初始政策为 Anything、Worker、Soldier、Nudist。Ideology 额外加入 Slave，Odyssey 额外加入 Spacefarer。Worker/Soldier 不是一段“偏好多少防御”的评分配置，而是根据 `defaultOutfitTags` 与 utility 类别形成允许集合。Nudist 也不是空集合：有 Nudist 标签，或既不覆盖 Torso 也不覆盖 Legs 的衣物可以允许。

| Web 衣物对应 Core Def | 定义上的初始标签 | 定义 `scoreOffset` |
|---|---|---:|
| Tuque 无边帽 | Worker、Soldier | 0 |
| Parka 防寒派克大衣 | Worker、Soldier | 0 |
| Duster 防尘长外套 | Worker | 0 |
| BasicShirt T恤 | Worker、Soldier、Spacefarer | 0 |
| Pants 长裤 | Worker、Soldier、Spacefarer | 0 |
| SimpleHelmet 简易头盔 | Soldier | 0 |
| PlateArmor 板甲 | Soldier | 0 |

零偏移来自完整选定 Core 父链都没有 `apparel/scoreOffset` 节点，以及 `ApparelProperties.scoreOffset` 未初始化 float 的默认值。它不代表所有组件的 `GetSpecialApparelScoreOffset()` 也必为零；后者是单独遍历组件求和。Tuque 和 SimpleHelmet 都可满足基础 Nudist 的不覆盖躯干/腿部规则。

Anything 保留 ThingFilter 的默认允许状态，包含“允许尸体污染衣物”；其它基础预设明确关闭 `AllowDeadmansApparel`。若 Web 暂无污染状态，不应画出已经生效的污染筛选开关。

## 过滤范围和评分是两个不同阶段

`ThingFilter.Allows(Thing)`先检查允许的 ThingDef，再检查具体物品状态：

1. 耐久用 `HP / MaxHP`，先经 `GenMath.RoundedHundredth`，即 `Mathf.Round(f × 100) / 100`，再 clamp 到 0～1。范围通过 `min − 0.00001 ≤ f ≤ max + 0.00001` 判断。
2. 品质使用 Awful～Legendary 的含端点范围。只有参与品质筛选并有品质的对象才适用。
3. 逐个被禁用的 special filter 判断，例如 `WornByCorpse` 对应尸体污染。

默认耐久范围是 0～1，默认品质范围为全部品质。耐久门槛负责“可不可以穿”，耐久评分负责“允许的几件中哪件更值得换”；不能用一个阈值代替两者。本轮程序集证明了 `Mathf.Round` 调用，未重建 Unity 的舍入内部实现；涉及二进制浮点正中点的测试应注明 Web 所采用的舍入约定。

## 自动换装不是每一帧扫描所有衣服

`Humanlike.xml` 把 `JobGiver_OptimizeApparel` 放在殖民者正常任务树中，并标记 `ChangingApparel`。同一分支里，返回活动区、寻安全温度、紧急工作、饥饿取食等节点在它前面。它不能脱离正常任务优先级每 tick 强行中断抢救或吃饭。

普通模式下，当前 tick 小于 `nextApparelOptimizeTick` 就不扫描。无法找到候选衣物，或候选列表为空时，下一次设为当前 tick 加 `Rand.Range(6000, 9000)`；60 TPS 下约 100～150 秒，折合 60,000 ticks 游戏日的约 0.10～0.15 日。这里不是所有成功换装后都固定等待同样时间。找到卸衣或穿衣工作时直接返回任务。

居民切换到不同政策时，`Pawn_OutfitTracker` 调用 `Notify_OutfitChanged`，把期限设成当前 tick，表示下一次正常求任务时可以重查，**不是 setter 当场把衣服换掉**。共享 filter 的编辑方法、`ApparelPolicy` 类和 `ClearForced.Reset` 没有直接重置该期限；这是限定方法内的证据，不是“全程序绝不存在其它通知”的结论。Web 在编辑政策、清除 forced 后主动触发重查可作为明确的可用性改编。

## 先卸不合规旧衣，再找更好衣物

`TryGiveJob` 的普通顺序是：

1. 排除无服装政策追踪器、非玩家阵营、禁止穿衣的 mutant、quest lodger，并检查扫描期限。Ideology 重染色工作有更早入口。
2. 从已穿列表末尾开始找 policy 禁止的衣物；只有允许自动卸下、且没有 locked 才发 `RemoveApparel`。自动卸衣设置 `haulDroppedApparel=true`。
3. 再扫描地图和支持的 haul-source 服装。**候选必须 `IsInAnyStorage()`**。散落荒野的衣服即便很强，也不会因此自动穿上；应先纳入储存，手动强制穿戴则走另一入口。
4. 排除 policy 不允许、禁止、燃烧、性别不符、不同生物编码、没有可穿身体部位、年龄阶段不符、不可预留或不可达的物品。
5. 对合格候选比较收益，选中后发真实 `Wear` 任务。

禁止判断并非只读取红叉：`IsForbidden(pawn)`也会检查物品 `PositionHeld` 的活动区限制。正常尊重禁止规则的居民不会把活动区外衣物当普通自动目标；征召、精神状态及 Host 等有原版例外。空活动区的原版检查另有 `TrueCount > 0` 条件，不能推断“空区等于困在原地”。

可达检查使用 `CanReserveAndReach` 与 `NormalMaxDanger`；如果衣物位于 `IApparelSource`，会检查 source 是否启用，并以 source 为访问目标。目标合法与执行时真正预留是两次不同检查，可避免多个居民同时抢走同一件衣服。

真空是原版的特殊保命例外：在真空 biome、当前位置真空程度 ≥ .5 时，带正向 VacuumResistance 的已穿衣物可能不因 policy 过滤被脱下。本轮 Web 没有相应环境，不应把这一例外泛化成“任何温度危险都覆盖政策”。

## 评分更像局部替换收益，不是整套装备求最优

普通衣物先计算原始分数：

```text
base = 0.1 + definition.scoreOffset + ArmorSharp + ArmorBlunt
raw = base × hpCurve(HP / MaxHP) + componentSpecialOffset
if NeededWarmth == Warm:
    raw *= coldInsulationCurve(Insulation_Cold)
```

两条曲线在点之间线性插值、点范围之外保持端点值：

| 曲线 | 采样点 |
|---|---|
| 耐久评分倍率 | `(0,0), (.20,.20), (.22,.30), (.50,.30), (.52,1)` |
| 需要暖衣时的冷绝缘倍率 | `(0,1), (30,8)` |

因此 50% 和 52% 耐久附近存在显著偏好变化，耐久超过 52% 不会继续得到更高倍率。这与玩家设置“最低 51%”之类的过滤行为相互补充，但不是同一个机制。品质通常先影响衣物有效护甲/绝缘属性，再由这些属性进入评分，不是这里直接统一“品质等级乘一个奖励”。

之后还有尸体污染、是否厌恶/偏爱人皮、性别、奴隶/机械师衣物、身份服装要求与贵族最低品质等分支。例如可受到污染衣物负面想法者会先减 .5，再把剩余正分乘 .1；角色必须衣物可乘 25，允许的相关衣物可乘 10。本轮主线七种普通衣物无需假装已经具备这些 DLC 和思想规则。

比较一件候选衣物时：

```text
gain = raw(candidate)
for each worn item that conflicts by layer and body-part groups:
    if forced or locked: reject automatic replacement
    gain -= raw(worn item)
if no worn items conflict: gain *= 10
require gain >= 0.05
```

冲突检查来自 `ApparelUtility.CanWearTogether`：先看是否共享穿戴层，再看实际身体部位组是否干涉。板甲之类可能同时替换多件旧衣，必须减去所有冲突者。没有冲突时 ×10 会优先补上空缺；这不是枚举所有完整衣橱组合的全局求解器。比较最佳分数使用 `<`，相同收益的后列候选可以覆盖前列候选；Web 使用固定 ID 破平局可提高复现性，但应写作差异。

原版还排除远程投射物武器使用者的 ShieldBelt，以及不支持暴力者不该使用的特定衣物。普通评分方法未直接引用 ArmorHeat、MarketValue、MoveSpeed 或 InsulationHeat；组件附加分仍可能包含额外语义，不能把限定方法的 token 缺失扩大成全系统结论。

## 需要暖衣读的是季节均温，不是刚走进冷库的室温

自动任务调用 `CalculateNeededWarmth(pawn, tile, 当前 Twelfth)`；其中读取 `AverageTemperatureAtTileForTwelfth`，与种族 Def 的抽象 `ComfyTemperatureMin` 比较。**暖、凉两边都使用最低舒适温，不是上界使用最高舒适温**。

| 原版判定 | 普通 Human Core 结果 |
|---|---|
| 平均温 < `ComfyTemperatureMin − 4` | 16 − 4 = **12℃ 以下**为 Warm |
| 平均温 > `ComfyTemperatureMin + 4` | 16 + 4 = **20℃ 以上**为 Cool |
| 其它，包括正好两个边界 | Any |

自动原始评分只在 Warm 时增加冷绝缘倍率；没有与 Cool 配对的普通热绝缘奖励，也没有“越暖天气越嫌弃厚衣服”的对称扣分。不能把自己设计的冷热舒适优化说成原版算法。Web 使用现有季节均温保持机制方向，但缩短日历、确定性周期或不同季节长度仍是 Web 模拟约定。

## 穿衣、卸衣、forced 与 locked 的实际交互

`JobDriver_Wear` 先预留目标衣物或 source，再实际走到接触点/交互点。换装总时间是新衣 `EquipDelay × 60 ticks` 加所有冲突旧衣的同类脱衣耗时，进度条期间会尝试把冲突旧衣落到当前格。新衣在完成阶段加入 apparel 容器，具体 item 身份保留，不合并成无身份数量。

原版 `unequipBuffer` 在 `TryUnequipSomething` 中不会扣除刚完成旧衣的时长，因此“总时长包含全部旧衣”不等于“旧衣的逐件卸下时间一定严格串行相加”。Web 若用清晰的逐件累计阶段，应明确为执行细节改编。

执行中会因目标消失、变为禁止、目标着火等失败；已有实际落地的旧衣不会因任务取消自动恢复到身上。`duration` 和 `unequipBuffer` 有存档字段。已生成 Wear 的该段 driver 没有再次调用 policy.filter，Web 若在政策改变后取消旧目标，是主动保持政策一致性的设计选择。

手动菜单“强制穿戴”不要求库存成员、不读当前 policy，也不把原来的 forced 衣物当绝对禁止替换；但仍检查路径、着火、身体条件以及 **locked 冲突**。接受命令会解除目标物品禁止，`TryTakeOrderedJob` 把任务设为 `playerForced=true`。只有 Wear 完成后才把新衣记入 forced 列表。

因此：

- **forced** 意味着自动系统不能卸下/替换这件衣物；不是免疫磨损、销毁或明确的人工换装。
- **locked** 是另一套约束，人工换装菜单也会检查它，不能用同一个布尔值替代。
- “清除强制”只清 override，不脱衣、不造新衣；后续自动政策重新决定去留。
- 衣物实际移除时 `Notify_ApparelRemoved` 清掉该衣物 forced 引用，防止保护已经不在身上的物品。

独立 `RemoveApparel` 先等脱衣时间，再校验该衣物仍穿着并落地。自动政策移除会继续尝试寻找更好储存格、预留、搬起并搬入；没有合适库存时 job 可结束为 incompletable，但已经脱下的衣物仍在地上。若 Web 把后续搬运交给通用搬运工，这是调度简化，不是允许物品凭空进入库存。

## Web 实现应保留的边界

本里程碑应能通过正常命令完成：创建/编辑共享政策，给多名居民分配，真实储存衣物的自动选择与穿戴，耐久不合规衣物耗时卸下，手动 forced 保护及解除，同一件物品在地面/工作/穿戴状态间守恒，抢占、政策变动、死亡、销毁和存读档时没有重复身份或悬空引用。

固定而确定性的扫描间隔、政策编辑后立即允许重查、同收益固定 ID 选择、保存 Web 已有手动服装语义的旧档迁移，都可以是合理改编，但不应归入原版事实。旧档默认手动、新世界默认自动也属于兼容设计，不能从原版政策数据库推导出来。

本轮静态证据没有证明完整支持 DLC 角色服饰、真空、biocoding、污染与人皮思想、机械师/奴隶限制、专用服装 source，以及完整原版人体和任务系统。玩法应先围绕当前已实现的层级/部位图、物品与服装系统闭合，后续再沿明确边界扩展。

独立重建与检查命令：

```powershell
pwsh -File scripts/research/extract-apparel-policies.ps1
pwsh -File scripts/research/collect-apparel-policies-evidence.ps1
pwsh -File scripts/research/extract-apparel-policies.ps1 -Check
pwsh -File scripts/research/collect-apparel-policies-evidence.ps1 -Check
```

检查重新读取程序集或已选 XML、重新核对派生文本与投影；没有执行目标 DLL。`-Check` 成功只证明记录和当前静态材料一致，不替代原版交互验证或 Web 行为测试。
