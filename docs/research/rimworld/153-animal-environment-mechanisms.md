# 153 动物的火灾、冷热暴露、寻温与离图

这轮把已经建立的动物医疗接到环境生存循环：**火烧或极端温度 → 动物改变行为 → 持续伤害与倒地 → 消防、搬运及环境恢复 → 存活或死亡**。机制先完整，原版数值作为可追溯参考，后续再调 Web 的节奏。

目标是本机 **RimWorld 1.7.4980 rev60**，`Assembly-CSharp.dll` SHA256 为 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。[派生类型清单](evidence/animal-environment-manifest.json)记录类型、行数和哈希；[静态机制证据](evidence/animal-environment-mechanisms.json)记录代码锚点、限定方法检查、Core XML 投影及五物种温区。REA 仅复用[同一程序集的元数据证据](evidence/production-bills-rea-managed.json)，具体方法由本地 ILSpy 离线重建。

本轮未运行或操作原版、浏览器、预览、GUI，也未截图。下文属于安装包静态证据，不是运行时观察。全文 C#、DLL、游戏贴图不随研究结果发布。已选 Core 定义没有合并全部 DLC、Mod、情景和运行时属性变化。

## 三种环境状态要分别存储

| 状态 | 原版载体 | 为什么不能合并 |
|---|---|---|
| 身上正在燃烧 | 附着到 Pawn 的 `Fire` 实例，带 `fireSize` 与 parent 引用 | 可以随动物移动并被扑灭；火消失不等于伤口痊愈 |
| 烧伤、冻伤等身体伤口 | `DamageWorker_AddInjury` 进入具体解剖部位 | 与已有疼痛、运动能力、护理和自然恢复共享系统 |
| 低体温、中暑 | 全身 `Hypothermia` / `Heatstroke` Hediff 的 severity | 无需先损失总 HP；可直接降低意识、导致倒地、达到致死严重度 |

常规 Flame 伤害既能造成伤口，又有点燃目标的入口。高温空气还可以产生额外 Burn，严重低体温还能随机产生 Frostbite。不能把这些全部实现成同一个“每秒减血”。

## 五物种的舒适区、安全缓冲区与当前温度

`GenTemperature.ComfortableTemperatureRange(Pawn)`读取 `ComfyTemperatureMin/Max` 有效属性。`SafeTemperatureRange(Pawn)`再向两端各扩 **10℃**。这意味着“不再增加温病”和“开始恢复温病”有不同边界。

| Core 物种 | 舒适区 ℃ | 安全区 ℃ | 定义来源 |
|---|---:|---:|---|
| Hare 野兔 | −30～40 | −40～50 | 最低值来自 BaseHare；最高值为 StatDef 默认 40 |
| Deer 鹿 | −30～40 | −40～50 | Deer 覆盖最低值；最高值为 StatDef 默认 40 |
| Alpaca 羊驼 | −20～45 | −30～55 | Alpaca 直接覆盖两端 |
| Dromedary 单峰骆驼 | −22～60 | −32～70 | Dromedary 直接覆盖两端 |
| Chicken 鸡 | −10～40 | −20～50 | Chicken 覆盖最低值；最高值为 StatDef 默认 40 |

`BasePawn` / `AnimalThingBase` 没有统一覆盖舒适最高温。以上不是把人类衣物温区复制给动物；若有效属性受到健康、DLC、情景等修改，最终区间仍以 Pawn 属性为准。普通动物默认 `Intelligence.Animal`、`FleshType.Normal`，不走昆虫的 `HypothermicSlowdown` 替代规则。

`Thing.AmbientTemperature` 对地图上的动物取当前格温度；被携带的对象先检查容器是否提供固定温度，否则从 `PositionHeld/MapHeld` 取携带者所在位置的温度。不能因为动物被抱起就固定读取它原来倒地的坐标，或无条件让它回到 21℃。

## 温病由健康调度更新，不靠普通动物行为任务推进

调用链是：

`Pawn.TickInterval → health.HealthTickInterval(delta) → IsHashIntervalTick(60, delta) → RaceProps.hediffGiverSets → OrganicStandard → HediffGiver_Hypothermia / HediffGiver_Heat.OnIntervalPassed`。

`AnimalThingBase` 指定 `OrganicStandard`，因此家养、野生和商队动物的普通生物学机制共享这套入口。每 **60 个原版 ticks** 调用一次，下表都是**每次调用的严重度增减**，不能直接当每个 Web tick 的值。

| 过程 | 原版条件与公式 |
|---|---|
| 低体温增加 | `T < safe.min` 时，增加 `max(abs(T−safe.min) × 0.0000645, 0.00075)` |
| 中暑增加 | `T > safe.max` 时，先对 `T−safe.max` 过热差曲线，再增加 `max(curve(overage) × 0.0000645, 0.000375)` |
| 常规低体温恢复 | `T > comfy.min` 时，减去 `clamp(severity × 0.027, 0.0015, 0.015)` |
| 常规中暑恢复 | `T < comfy.max` 时，减去同一恢复量 |

热差曲线点为 `(0,0)、(25,25)、(50,40)、(100,60)、(200,80)、(400,100)、(4000,1000)`。普通低体温另允许“自身与所有容器均未在地图生成”或“当前位置地形 `heatPerTick > 0`”走恢复分支。这些例外与地上普通动物的规则分开记录。

几个重要边界：

- 正好处于安全边界时不增加温病；正好处于对应舒适边界时还不满足严格恢复条件。
- 在舒适边界与安全边界之间，已有温病可以保持；回到安全区不是立即痊愈。
- `Heatstroke`、`Hypothermia` 的 Core Def 没有开启 `tendable`，类默认是 false。治疗烧伤和搬到合适温度是不同操作；草药不能直接清空温病。
- 恢复逻辑没有普通伤口自然恢复的饥饿门槛。营养、卧床与温病不能因为同在医疗面板就共用一个恢复公式。

原版还有本轮需要明确边界的二级伤害：温度高于 `comfy.max + 150℃` 后每 420 ticks 有一次高温空气 Burn 检查；非昆虫、温度低于 0℃、低体温 severity 大于 .37 时，可按 `.025 × severity` 的随机机会对易冻伤部位产生 Frostbite。它们各自进入真实身体伤害系统，不是温病严重度的别名。

## 迟缓、倒地与死亡的真实连接

两个温病都使用 `0 / .04 / .20 / .35 / .62` 的阶段起点。共同的主要效应如下，低体温额外降低操作能力。

| 严重度阶段 | 主要容量与疼痛变化 |
|---|---|
| < .04 隐藏 | 不显示初期状态 |
| ≥ .04 初期 | 意识 offset −.05 |
| ≥ .20 轻微 | 移动 offset −.10，意识 offset −.10 |
| ≥ .35 严重 | 移动 offset −.30，意识 offset −.20，疼痛 offset +.15 |
| ≥ .62 极端 | 意识 setMax .10，疼痛 offset +.30，lifeThreatening=true |
| ≥ 1 | `lethalSeverity=1`，满足系统性致死条件 |

阶段变化会从 `Hediff.Severity` 通知 `Pawn_HealthTracker.Notify_HediffChanged`，清除缓存并检查健康状态。普通清醒条件为意识 ≥ .30，极端温病将意识封顶 .10，因此能在还有完整身体、没有严重流血时倒地。温病恢复跨回阶段边界后，仍要结合所有伤口、疼痛和其它容量重新判断能否站起；不能仅凭某一个状态下降就直接恢复行走。

还有一条会影响“到 1 才死”结论的原版规则：两个温病都配置 `canApplyDodChanceForCapacityChanges=true`。在符合入口的**非玩家、非玩家 Host** 动物倒地时，健康追踪器有默认 **.5** 的死亡随机，种类、覆盖值与特殊状态另有例外。这不是所有动物通用的每次温病死亡率，更不是殖民地动物到 .62 就必定有 .5 概率死亡。Web 若沿用 v54“不给普通动物追加随机倒地死亡”的规则，应明确写成设计差异。

## 家养动物寻温与野生动物离图不是同一套 AI

`Animal.xml` 的顺序很重要：保持必须卧倒、Downed、BurningResponse 等紧急节点位于正常需求之前。后面的玩家阵营分支先处理医疗卧床、活动区返回，再到 `JobGiver_SeekSafeTemperature`。

这个名称中的 Safe 容易误导：默认 `requiresInjury=true`，只有 `HasTemperatureInjury(Serious)`，即温病达到 **.35** 或更严重，才执行；目的地实际上使用**舒适区**。已经处于舒适区时生成 `Wait_SafeTemperature`，500 ticks 后允许重查；否则按可通行区域广度搜索合适房间，排除门道区域，并要求候选格在活动区内，生成实际行走任务 `GotoSafeTemperature`。未找到可达合适位置则返回无任务，不传送、不改阵营。

`maxRadius` 参数虽然出现在区域搜索签名，但当前重建的方法体没有把它传给候选格筛选，因此这里不承诺此参数提供真实搜索半径限制。

野生动物位于 `ThinkNode_ConditionalHasFaction` 的反向分支，走 `LeaveIfWrongSeason`：

1. **季节不适**：`MapTemperature.SeasonAcceptableFor(race)` 用季节温度与物种舒适上下限进行严格比较，默认 buffer 为 0；不适则 `ExitMapRandom`，Walk。
2. **当前环境危险**：当前位置超出安全温区，并且该格使用室外温度，才走另一条 `ExitMapRandom`，Jog。

两者都先找出口，再生成 `Goto` 并设置 `exitMapOnArrival=true`。倒地而不能爬行者不会得到离图任务。房间内当前温度、室外天气、季节长期温度是三个相关但不同的量；不能把本轮查到的两个条件混成“所有动物冷了就立即从列表消失”。野生动物生成器也用季节适宜性筛选种类。

## 火焰如何点燃和伤害动物

`FireUtility.CanEverAttachFire` 要求目标尚未毁坏、当前可燃、类别为 Pawn、具有 `CompAttachBase`，没有 Humanlike 限制。`BasePawn` 提供附着组件和基础易燃性 .7。成功 `TryAttachFire` 创建独立火实例、附着目标、生成到同格，并 `pawn.jobs.StopAll()`，所以点燃会中断原来的活动。`CompAttachBase.CompTick` 将附件位置更新到 parent 位置，`AttachableThing.DrawPos` 也跟随 parent 绘制位置；移动与火焰不是两个独立随机坐标。

原版可从两条已追到的入口点燃动物：

- 静态火在复杂计算中检查同格 Pawn；火势严格大于 .4 时，按易燃性曲线及 150 ticks 累积概率判断，起始附着火势为静态火势 × .2。
- Flame 伤害走 `DamageWorker_AddInjury` 后，在伤害没有被 deflect、不是即时永久伤且随机门槛通过时，另附着 .15～.25 的火。

火更新间隔为 15 ticks，复杂伤害/燃料/热量计算为 150 ticks。附着火选自己的 parent 受伤；小于 .4 的静态火通常不烧 Pawn，但这个豁免**不适用于已经附着的火**。伤害名义值为 `RoundRandom(clamp(.0125+.0036×fireSize,.0125,.05)×150)`，至少 1，并指定外部身体区域，随后仍经伤害系统。

`Fire` 也向热系统注入热量，可能让封闭房间出现中暑；“在火上烧伤”和“在热房间中暑”可同时发生。具有 `extinguishesFire` 的地形不收集燃料，后续缺燃料分支会销毁火，附着火也经过该逻辑。雨和真空另以 Extinguish 伤害减火，具体雨暴露边界沿用 [79](79-fire-firefighting-mechanisms.md)，本轮没有声称实测其概率。

## 动物自救、乱跑与居民协助扑火

`BurningResponse` 由“是否有 Fire 附件”触发。流程是先尝试跳水，再尝试自灭，最后随机跑动；其中跳水被 `minIntelligence=ToolUser` 包裹，五种普通动物不走这条主动跳水节点。

`JobGiver_ExtinguishSelf` 在**每次求任务时**以 .1 随机门槛选择自灭任务。它不是每 tick 10% 的灭火率。任务原地等待 150 ticks，然后直接销毁目标火实例并记一次 FiresExtinguished。已有 Burn 伤口保留，仍需医疗恢复。没选中自灭时，`RunRandom` 使用半径 7、等待 5～10 ticks、Sprint 的局部跑动；XML 放宽 `maxDanger=Deadly`，不保证它总跑到更安全的地方。

`WorkGiver_FightFires` 对附着在 Pawn 身上的火有独立分支，允许同阵营或兼容 HostFaction 的动物成为消防救助目标；不是只救人。目标在 Home 外时要求与消防者曼哈顿距离不超过 15，并要能到接触位置。无阵营野生动物通常不满足这个自动阵营门槛。这个分支自身没有静态火分支的 `WorkTagIsDisabled(Firefighting)` 检查；外层工作调度仍可能决定谁执行，不能据此声称所有居民都会救火。

普通扑打通过 `DamageWorker_Extinguish` 让 `fireSize -= damage × .01`，小于 .1 时移除。自灭任务、别人扑打、雨、灭火地形是不同入口，都不应该直接把动物治疗为满血。

## 对 Web 的实现约束与本轮边界

完整的基础玩法应让玩家看到：动物着火会中断活动并移动，实际火势会消退；居民能接近救火；烧伤留下伤口；不同物种耐温不同；长期暴露引发温病与迟缓；动物寻找允许且可达的恢复地点；倒地动物要由人实际搬运；进入合适温度后逐步恢复；持续暴露能够死亡并留下同一套尸体产物。所有过程需要与医疗预留、床位、商队身份、活动区及存档连接。

以下实现选择必须与原版事实区分：确定性自灭计时、提前于 .35 进行寻温、商队动物的环境逃生策略、简化季节离图、是否暂省略二级冻伤/热空气烧伤、是否不采用随机倒地死亡。它们可以是适合当前 Web 的取舍，但通过测试不等于已证明原版行为相同。数值调优应集中配置，不改变这些状态和因果连接。

静态证据可以独立再生成、再核对：

```powershell
pwsh -File scripts/research/extract-animal-environment.ps1
pwsh -File scripts/research/collect-animal-environment-evidence.ps1
pwsh -File scripts/research/extract-animal-environment.ps1 -Check
pwsh -File scripts/research/collect-animal-environment-evidence.ps1 -Check
```

`-Check` 重新读取本机程序集或 XML，与已保留类型和投影逐字比较；它不加载执行目标 DLL，也不启动原版交互。固定字面锚点和方法哈希仅支持记录中的调用路径和限定范围结论，不能代替完整运行时验证。
