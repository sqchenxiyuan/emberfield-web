# 14 睡眠、床、作息、门与住房

核验日期：2026-11-03。对象：本地 RimWorld **1.7.4980 rev60**。范围为普通成年殖民者的睡眠与住房主链，兼顾项目的 **20 TPS、12000 tick/日** 三维映射。

最重要的设计结论：休息值、舒适度、床位归属、床位预约和房间边界是不同状态。普通床让休息恢复更快，同时让舒适度逐步接近床的舒适上限；安排“睡眠”不会无条件催眠，切回“自由活动”也不会强制起床；门打开后仍然分隔原版房间。

## 证据边界与索引

本章属于 **静态派生代码 + Core XML 直接声明 + 独立解析模型**，没有启动原版、加载生效 Def 数据库或验证运行时行为。本章的实现建议也不表示项目已经具备对应功能。启用 DLC、模组、补丁、健康、种族、设施与其他 stat 修正都可能改变结果。

| 证据 | 内容 |
|---|---|
| [housing-manifest.json](evidence/housing-manifest.json) | 28 个派生类型，原 DLL/ILSpy/各派生文件 SHA256 和行数 |
| [housing-types.json](evidence/housing-types.json) | 可重提取的类型选择 |
| [housing-xml.json](evidence/housing-xml.json) | 10 个 Core XML 文件、25 个直接声明、128 个叶字段；保留 ParentName |
| [housing-claims.json](evidence/housing-claims.json) | HS01–HS22；每项有类型行范围或 XML 记录引用 |
| [housing-cases.json](evidence/housing-cases.json) | H01–H10；141 项解析断言 |
| [housing-validation.json](evidence/housing-validation.json) | 原文件身份、XML 字段和本地派生文件的核验结果 |

原程序集 `Assembly-CSharp.dll` 的 SHA256 为 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。提取器为 ILSpy `11.2.0.10050`，SHA256 `587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78`。完整派生 C# 只在忽略目录 `.local-research/housing/` 中；文档仅记录机制与必要数值。

复用已有证据：`food` 的 `Need`、`LifeStageDef`、`HungerCategory`；`generation` 的 `BuildingProperties`；`work` 的 `Pawn_PathFollower`；`environment` 的 `Room`。本章不再重复提取这些类型。

## 1. 休息需求：消耗与恢复

来源：HS01、HS02；`Need_Rest` 17–61、100–131；`Need` 39–59。

休息值 `R` 通常在 `[0,1]`，显示为 0–100。基础清醒消耗 `1.5833333e-5/原版tick`，约 **0.95/游戏日**。低休息并不沿用相同速度：

| R 区间 | 类别 | 消耗倍率 | 在该档位的瞬时消耗率，按日表达 |
|---|---|---:|---:|
| `R >= .28` | Rested | 1 | .95 |
| `.14 <= R < .28` | Tired | .7 | .665 |
| `.01 <= R < .14` | VeryTired | .3 | .285 |
| `R < .01` | Exhausted | .6 | .57 |

这不是“耗一整日后减少相应数值”的预测；跨过阈值后倍率会改变。清醒分支还乘健康的 `RestFallFactor` 和人物 `RestFallRateFactor`。

原版需求间隔为 150 tick。睡着时每次增加：

```text
ΔR = 0.005714286 × restEffectiveness × RestRateMultiplier
```

清醒时每次减少：

```text
ΔR = 150 × 1.5833333e-5 × categoryFactor
     × health.RestFallFactor × RestFallRateFactor
```

两者是分支，**睡眠恢复时不再同时扣清醒消耗**。躺下动作只有在 `asleep && gainRest` 时才登记恢复；躺在床上不保证正在睡眠。新人物默认休息值随机在 .9–1。

基础恢复 `3.809524e-5/原版tick`，约 **2.2857144/日**，对应普通床从 0 恢复到 1 约 **10.5 游戏小时**。下列时间是连续理想化计算，未含需求离散间隔、走路和中断：

| 休息地点 | 恢复倍率 | R 从 .3 恢复到 1 |
|---|---:|---:|
| 地面，或没有明确 BedRestEffectiveness 的睡眠设施 | .8 | 9.1875 小时 |
| 普通品质、无额外修正的床 | 1 | 7.35 小时 |
| 良好品质、其他倍率 1 的床 | 1.08 | 约 6.806 小时 |
| 普通品质石床，其他倍率 1 | .9 | 约 8.167 小时 |

**地面 .8 来自 `BedRestEffectiveness.valueIfMissing`，不是把床的舒适度 .75 当作恢复倍率。** 来源：HS07，`Toils_LayDown` 93–106。

极度疲劳还有独立的非自愿入睡机制：R 接近 0 时累计 tick，超过 1000 原版 tick 才进入概率计算，基础 MTB 从 .25 日逐级降至 .125、1/12、.0625 日。它仍受入睡许可检查，并非到 0 立即无条件倒地。项目初版可明确暂缓这条支路。来源：HS22。

## 2. 作息、选择睡眠、继续睡眠

来源：HS03–HS07。

默认 24 小时作息：**22:00–06:00 Sleep，06:00–22:00 Anything**。Work 的 `allowRest=false`、`allowJoy=false`；Anything/Joy/Sleep 的相应类默认值允许休息。默认时段不代表每个人一定睡满 8 小时。

### 2.1 选择一个新的普通睡眠任务

`JobGiver_GetRest` 先检查需求存在、最低类别、最大休息比例、可睡 tick、群体任务和 `CanFallAsleep`，再计算优先级：

| 当前安排 | 满足其他条件后的普通休息任务优先级 |
|---|---|
| Anything / Joy | R < .3 时为 8，否则 0 |
| Sleep | 8 |
| Work | 0 |

优先级 8 是 ThinkTree 的选择输入，不是保证立即抢占所有工作。Work 下普通主动睡眠优先级 0，也不等于禁用强制、医疗或非自愿睡眠。

普通 `CanFallAsleep` 要求 **R 严格小于 .75**、没有阻止睡眠的健康状态、最近 400 原版 tick 内没有打扰，且当前 job 允许睡眠打断。生命周期或群体任务可修改阈值；普通自然醒通常是 **R >= 1**。注意不能写成“饥饿者不能入睡”：`LifeStageDef.canSleepWhenStarving` 的默认值是 true；只有生命周期明确禁止时，Starving 才阻止该入睡检查。

选择到床后，还要经过床有效性、可达性、预约和走到床头；无合适床时可找经过校验的地面位置。不得直接把人物当前位置状态改成“睡在任意空床”。

### 2.2 已经睡着后的继续与中断

`Toils_LayDown` 每 211 原版 tick 的散列时点检查其他工作；`ThinkNode_ConditionalMustKeepLyingDown` 为现有睡眠提供继续条件。普通、未倒地、非强制、非医疗休息的简化逻辑为：

```text
休息达到自然醒阈值，或健康状态阻止睡眠 → 醒
受到打扰 → 不再强制保持躺下
Work 且 R >= .2 → 不再强制保持躺下
R > .14 且食物类别 >= UrgentlyHungry，且找得到食物 → 不再强制保持躺下
否则 → 可以继续原躺下任务
```

“不再强制保持躺下”表示允许任务重新选择，不是这里直接执行进食或工作。原版还有儿童喂养、倒地、医疗、强制休息等分支，本章没有简化成普通成人规则。

因此 **06:00 进入 Anything 不会自动叫醒**。一个 R=.5 的普通睡眠者可以继续睡到饱；Work 在 R=.2 时可中断，R=.199 时该规则不触发；急饿中断使用 `R>.14`，等于 .14 不触发。

普通成年人的当前食物阈值映射见 [12-farming-cooking-food.md](12-farming-cooking-food.md)：若 wantEat=.3、容量 1，则 UrgentlyHungry 对应 food<.12。实现 `food<12 && rest>14` 时，应同时有可找到食物的条件；找不到食物仍唤醒会偏离这里的原版继续规则。

## 3. 床的定义、质量、舒适度

来源：HS08–HS11、HS16。

床的继承链为 `BuildingBase → FurnitureBase → BedBase → BedWithQualityBase → ArtableBedBase → SansComfortBedBase → BasicBedBase → Bed`。XML 快照保存各层直接声明，不冒充已经求值的完整 Def 数据库。

| 项目 | 普通单人床的选择性基准 |
|---|---|
| 占地 | 1×2，旋转后 2×1 |
| 睡眠人数 | 1；`SleepingSlotsCount = 未旋转 size.x` |
| 通行 | PassThroughOnly；继承 pathCost=42 |
| BedRestEffectiveness | 1 |
| Comfort | .75，来自 BasicBedBase |
| 材料量 | 45 单位 stuff |
| WorkToBuild 基值 | 800 |

原版床的头部格、脚部格由旋转后的占地矩形计算。床占两格不等于能睡两人；双人床的未旋转宽度为 2 才产生两个床位。

质量按顺序 Awful / Poor / Normal / Good / Excellent / Masterwork / Legendary：

| 属性 | 品质乘数 |
|---|---|
| RestEffectiveness | .86 / .92 / 1 / 1.08 / 1.14 / 1.25 / 1.6 |
| Comfort | .76 / .88 / 1 / 1.12 / 1.24 / 1.45 / 1.7 |

`StatPart_Quality` 还存在 MaxGain 上限，选择的两项 stat 没有自定义低上限；默认上限非常大，对本表常见数值不构成约束。石材的 BedRestEffectiveness 另乘 .9。床头柜、梳妆台及 DLC 设施可继续修正，但本章未复核其完整叠加规则，初版不应隐式加入这些收益。

舒适度是一条独立需求：最近 15 原版 tick 内使用物件时，目标值为 `clamp01(物件 Comfort)`；否则目标是 0。需求每次更新以 **.60/游戏小时上升、.04/游戏小时下降**，接近目标而不越过。普通床能使它逐步趋向 .75；.75×1.45 的大师床物件 Comfort 可大于 1，但需求目标仍截到 1。

舒适度档位界限是 .1 / .6 / .7 / .8 / .9。睡眠中的 GUI 箭头可能显示 0，但 Comfort 没有 `freezeWhileSleeping` 覆盖，不能据此把睡眠期间舒适度冻结。完整情绪收益、卧室质量、多人宿舍和睡在室外的 thought 数值需另审，不能把 Comfort 直接加到 Mood。

## 4. 归属、预约、占用与失败恢复

来源：HS12–HS14。

| 状态 | 含义 | 典型生命周期 |
|---|---|---|
| 所有权 / assignment | 这个床位长期属于谁 | 更换床、手动指定、失去床时更新 |
| reservation | 谁正在为当前任务预约床位 | 选任务至结束/失败/取消 |
| occupancy | 谁真的在床头格以在床姿态躺着 | 到达并躺下至起身离开 |

床主白天离开后，床不再被占用，但仍有所有权。检查“床上现在没人”不足以允许其他人自动领取。自动找床偏好自己的有效床，再按伴侣、床定义等条件选择；可用性还包括地图、着火、体型、社交关系、囚犯/医疗用途、禁用、可达和可预约等。

`JobDriver_LayDown` 以睡眠槽数为预约容量；地面目标容量是 1。随后非医疗床进行归属处理，人物走到对应床头位置，床位若已占用或变得不可用可失败/重选。

`ClaimBedIfNonMedical` 本身在显式领取满床时可以撤销最后一个主人，但不能据此推导 AI 会随意抢床：自动选择的合法性检查发生在前面。

项目建议至少保留 `ownerId`、`reservedBy`、`occupantId` 三种语义。睡眠动作开始前重复确认床存在、床位合法和可达；取消、改作息、床拆毁、人物死亡后释放预约和占用。具体存储可合并结构，但状态含义不能混为“busy”。

## 5. 门：成本、等待、通行与关闭

来源：HS15–HS19。

普通门 XML 声明 25 单位材料、WorkToBuild 基值 850。DoorBase 具有 fillPercent=1、holdsRoof=true、blockLight=true；原版 `rotatable=false`。这些是二维地图与绘制定义，**不能把 staticSunShadowHeight 或 fillPercent 解读成三维门的物理高度**。

材料 stat 按 `基值 × stuff.statFactors + stuff.statOffsets` 的相关分支处理。Wood 的 WorkToBuild=.7、DoorOpenSpeed=1.2；Steel 没有该开门倍率覆盖，选定基准仍是 1；StoneBlocksBase 的 WorkToBuild=×6+140、DoorOpenSpeed=.45。

| 物体 | 木材工作量 | 纯材料基准石材工作量 |
|---|---:|---:|
| 床，基值 800 | 560 | 4940 |
| 门，基值 850 | 595 | 5240 |

这里是 stat 工作量，不是实际建造耗时。实际还受工人 ConstructionSpeed、技能、工具、失败和供料影响。

原版开门时长：

```text
无电：RoundToInt(45 / DoorOpenSpeed × unpoweredDoorOpenSpeedFactor)
通电：RoundToInt(45 / DoorOpenSpeed × .25 × poweredDoorOpenSpeedFactor)
```

开门因子默认 1。Unity 的 RoundToInt 在 .5 情况取最近偶数；以下为数学复算，不是原版帧计时实验：

| 门材料 | 原版手动开门 tick | 60 TPS 秒数 | 项目保秒数、向上取整的 20 TPS tick |
|---|---:|---:|---:|
| 木材 | 38 | 约 .633 | 13 |
| 钢 | 45 | .75 | 15 |
| 石材 | 100 | 约 1.667 | 34 |

`Open`、`TicksTillFullyOpened`、`FreePassage` 是不同概念。已开始开门并不代表开门等待结束；`FreePassage = open && (holdOpen || !WillCloseSoon)`。人物是否能开门还受阵营、能力等规则影响。路径执行可以请求开门并等待剩余开门 tick，离开后启动关闭计时。

普通关闭延迟基值为 110 原版 tick，接近时可延到 300 tick；近期友好触碰窗口 120 tick。保持开启、门格中人物/物品/尸体等障碍会影响关闭。不要把视觉开关动画直接当作寻路开关；也不要在人物仍穿过门格时立即关门。

## 6. 房间、开门和温度

来源：HS17、HS18、HS20、HS21；温度扩展见 [03-rooms-temperature-power.md](03-rooms-temperature-power.md)。

`RegionTypeUtility.GetExpectedRegionType` 只要格子有门就返回 **Portal**，不检查 open。Portal 是单格 region，不允许合入普通多 region district；`RegionAndRoomUpdater.ShouldBeInTheSameRoom` 仅让 Normal / ImpassableFreeAirExchange / Fence 等合并，排除 Portal。

因此相邻两个房间不会因为门打开就变成一个 room identity。原版通过门的热交换连接处理温度流动，默认闭门每 375 tick、开门每 34 tick 执行相关均温路径；这不意味着“开门后室内外温度瞬间相等”。完整换热公式见已有环境研究，本章只核实门状态与间隔。

另一个容易混淆的规则是 `Room.UsesOutdoorTemperature`：碰到地图边缘，或无顶格数达到 `ceil(面积×.25)`，就使用室外温度规则。它与心理上的室外判定不同，也不等于完整的三维封闭体检测。

对三维项目的设计建议：房间身份分区保留门边界；门的开度控制通行与换热边。屋顶、楼板、楼梯、跨层连通、门高、墙高和露天泄漏，需要由项目自己的体素空间算法定义和验证。原版的二维 region 代码不能证明任何一种三维房间算法正确。

## 7. 20 TPS / 12000 tick 每日的映射合同

原版 60 TPS、60000 tick/日，对应常速 **1000 秒/日**。项目 20 TPS、12000 tick/日为 **600 秒/日**。两个比例不同，必须逐项选择保游戏日平衡或保真实秒数。

| 参数 | 项目基准 / 建议 | 性质 |
|---|---|---|
| 清醒休息基础消耗 | `.95 / 12000` 每 tick，再乘低休息档位与人物因子 | 保游戏日速率 |
| 基础睡眠恢复 | `(24 / 10.5) / 12000` 每 tick，再乘床与人物倍率 | 保游戏日速率 |
| 舒适度上升/下降 | `.60 / 500`、`.04 / 500` 每 tick，向目标靠近 | 每游戏小时 500 tick |
| 需求的批量间隔 | 原版 150 → 30 tick，或每 tick 等价积分 | 保游戏日粒度 |
| 睡眠任务复查 | `round(211×20/60)=70` tick | 保真实秒数的近似建议，尚未接入 |
| 受打扰后禁睡窗口 | `round(400×20/60)=133` tick | 建议值，尚未接入 |
| 木门开启/关闭延迟 | `ceil(38/3)=13`、`ceil(110/3)=37` tick | 保真实秒数，向上取整 |
| 木床/木门工作量 | `ceil(800×.7/3)=187`、`ceil(850×.7/3)=199` | 工人速率为 1 的简化基准 |

不要同时把每 tick 的需求损耗乘 5，又把 tick/day 改成 12000 后再次补偿；也不要把所有 150、211、400 统一除以 3。它们分别属于日平衡与响应等待。本章用理想 10.5 小时换算恢复，和原版浮点常量有极小舍入差异。

当前实现记录采用逐 tick 的醒来判定、每 20 tick 的入睡与饥饿检查；没有接入原版 211 tick 复查或 400 tick 打扰机制。上表的 70/133 是后续映射方案，不能列为已实现的原版一致性。代码行为与实际验证结果以实现记录为准。

在项目界面用 0–100 需求值时，对上表的 `[0,1]` 每 tick 变化乘 100。床 1×2 且可旋转、三维门高度 2 是项目约定；门高 2 的放置必须检查上下两个体素格及足够通行净空。H06 只演示床头锚点的自定义坐标映射，未验证项目实际坐标系或碰撞算法。

## 8. 建议的实现验收场景

这些场景是实现验收要求，不等同于本次已通过的解析案例。

1. 一个殖民者，普通床：R=.3 入睡，确认只增休息、不扣清醒消耗，接近 7.35 游戏小时后到满值。
2. 同一人物睡地面：恢复倍率 .8，舒适度目标为 0；不应把地面当床一样提升舒适度。
3. 22:00，R=.8：Sleep 排程不强制普通主动入睡；R=.74 可选睡眠任务。
4. 06:00 切到 Anything，R=.5：允许继续睡；切到 Work，R=.2 可停止继续睡眠，R=.199 不应被该条件叫醒。
5. 急饿且 R>.14：有可用食物时转向重新选任务；找不到食物时不因这条规则反复起床躺下。
6. 两名人物同时找同一单人床：只能有一份有效床位预约；床主白天离床不会丢失归属。
7. 床旋转四个方向：占地、床头、脚部、选中轮廓、角色睡姿和路径终点一致；无界外格或楼层穿插。
8. 拆除正在被预约/占用的床：任务失败后清理引用并重新规划，存档恢复也不留下幽灵占用。
9. 门前寻路：先开门再通过；人或物品卡门时不关；HoldOpen 与门的剩余开启时间分别处理。
10. 门分隔两室：开/关均保持两室身份，开门提高热交换；三维漏顶、边缘、楼梯连通另设专项测试。

本章未覆盖完整情绪 thought 数值、卧室 impressiveness 评分、社交共享床、医疗质量、怀孕育儿、死亡休息、DLC 电力床具、全部门的权限/真空逻辑，以及三维冷热对流。后续可以按一个规则、一组来源、一组行为验收逐步加入。

## 9. 重提取与验证

在 `experiments/rimworld-like` 目录下：

```powershell
./scripts/research/extract-housing.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld' `
  -DecompilerPath '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'

./scripts/research/collect-housing-xml.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'

node scripts/research/verify-housing-evidence.mjs
node scripts/research/verify-housing-evidence.mjs --local

./scripts/research/verify-housing-evidence.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'
```

默认 Node 检查不需要原游戏或完整派生代码，验证记录身份、格式、引用范围和 10 个独立解析案例；`--local` 额外核对 34 个本地派生文件。PowerShell 核对原 DLL、Version.txt、10 个原 XML 文件的哈希与 128 个字段，然后调用同一 Node 解析模型，避免复制第二套算式。

通过这些检查只能说明证据包内部一致、所选本地来源匹配、模型算术符合预期；**不代表原版运行时已验证，也不代表复刻代码通过了上面的行为验收**。
