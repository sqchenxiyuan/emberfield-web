# 48｜研究、科技门槛与科研台

本章核对本机 RimWorld **1.7.4980 rev60** 的 Core XML 与 `Assembly-CSharp.dll` 静态派生结果，覆盖常规研究，不把 Anomaly 知识研究、Royalty 科技蓝图或所有 DLC 机制合并进一个进度条。派生文本用于解释机制，**不是原始源码，也不是原版运行证据**。完整派生类保留在忽略目录 `.local-research/technology/`，不随 Git 提交。

证据入口：[逐条结论](evidence/technology-claims.json)、[独立算例](evidence/technology-cases.json)、[XML 声明与缺失字段](evidence/technology-xml.json)、[类型清单](evidence/technology-types.json)、[程序集及派生文件清单](evidence/technology-manifest.json)、[验证结果](evidence/technology-validation.json)。结论编号为 `TC01–TC16`。

## 1. 研究是全局项目，劳动发生在实体科研台

`ResearchManager` 保存一个常规 `currentProj`，另用 `ResearchProjectDef → float` 字典保存各项目进度。科研台没有自己的科技进度；`Building_ResearchBench` 显示管理器当前项目及进度。换项目、停止研究都保留已经完成的工作。多个科研台可以各有一个研究者，贡献给同一当前项目。（TC01）

流程是：玩家选择合法项目 → 工作系统找到适合且可预约的台 → 人物走到交互格 → 实际劳动增加研究点和 Intellectual XP → 到成本阈值完成 → 清空当前项目。**选择项目本身不产点，也不要求这些早期项目必须先有科研台。** 已选项目完成后不会自动研究下一项。（TC06、TC08、TC14）

需要区分三个检查层：

| 层 | 实际检查 |
|---|---|
| `ResearchProjectDef.CanStartNow` / 研究界面 | 未完成、显式与隐藏前置、科技蓝图、特殊 DLC 条件等；只有 `requiredResearchBuilding` 非空时才要求存在适配科研台 |
| `CanBeResearchedAt` | 指定科研台类型、该台供电、所需链接设施是否 active；此函数不重查科技前置 |
| `WorkGiver_Researcher` / `JobDriver_Research` | 台类型与适配、台/交互位置预约、可达/可触碰、目标未移除或禁止等 |

`SetCurrentProject` 自己不校验科技前置，不能把低层 setter 当成玩家命令的全部校验。查找“拥有适配台”会扫描所有玩家地图，忽略科研台自身断电；实际劳动必须满足电力。忽略台电力不等于忽略设施电力：`CompFacility.CanBeActive` 对有电力组件的设施仍要求 `PowerOn`。（TC06–TC07）

## 2. 研究点、成本和经验

原版正常工作点数为：（TC02–TC05）

```text
真实研究点增量 = sourceWorkTicks × ResearchSpeed × ResearchSpeedFactor
               × 0.00825 × difficulty.researchSpeedFactor / CostFactor

CostFactor = 1 + 0.5 × max(0, min(projectTechLevel, Industrial=4) - factionTechLevel)
项目 techLevel=Undefined 时 CostFactor 固定为 1

显示成本 = baseCost × 玩家阵营 CostFactor
显示进度 = 真实进度 × 玩家阵营 CostFactor
进度百分比 = clamp01(真实进度 / baseCost)
```

原版科技枚举依次为 Undefined=0、Animal=1、Neolithic=2、Medieval=3、Industrial=4、Spacer=5、Ultra=6、Archotech=7。科技等级差对项目等级最多算到 Industrial。因此 Neolithic 阵营研究 Medieval 为 1.5 倍成本，研究 Industrial 及以上为 2 倍；Industrial 阵营全部为 1 倍。完成一项工业研究不自动改写 `FactionDef.techLevel`。

难度 XML 的研究倍率为 Peaceful/Easy=1.20，Medium/Rough=1，Hard=.95，Extreme=.9；Custom 在所选 XML 无直接声明，不能仅从缺失值推断玩家当前自定义设置。调试 `fastResearch ×500` 不属于正常平衡。

对无其他特殊 Stat 修正的普通人物，ResearchSpeed 是：（TC03）

```text
max(0.1,
    (0.08 + 0.115 × Intellectual等级) × WorkSpeedGlobal
    × (0.5 + 0.5 × min(Manipulation, 1.1))
    × (0.5 + 0.5 × min(Sight, 1.1)))
```

健康、全局速度 1 时，L0 / L1 / L5 / L10 / L20 分别为 .1 / .195 / .655 / 1.23 / 2.38。容量权重 .5 是 `Lerp` 混合，不是平方根。完整 Stat 还可能受特性、装备、场景等影响。

每个原版实际工作 tick，研究点结算之后给 `Intellectual.Learn(0.1 × delta)`。XP 不直接乘科研台效率、难度或科技成本差，但继续应用技能自身的热情、全局学习倍率与每日饱和。热情系数为 .35 / 1 / 1.5，事件开始前每日有效 XP **严格大于 4000** 才乘 .2。完整学习规则见 [45 章](45-skills-learning-quality-mechanisms.md)。走路、排队、等待和暂停不能凭“已选择项目”获得劳动 XP。（TC04）

完成时进度写为 `baseCost`，多余点数不进入下一项目。`FinishProject` 还会递归完成未完成的**显式**前置、补所需科技蓝图/分析、应用研究变化和发出完成信号；隐藏前置在选择阶段检查，但不在这个递归列表里。正常游戏命令应先保证选择合法，不能依赖递归补前置作为研究捷径。（TC14）

## 3. 本轮 12 项科技与初始状态

以下项目都没有指定 `requiredResearchBuilding`、`requiredResearchFacilities`、隐藏前置或科技蓝图数量；普通简易台即可劳动。`—` 表示本机 Core XML 未声明前置，相关缺失字段也在证据中保存。（TC05、TC13）

| DefName | 基础点数 | 科技等级 | 前置 | Crashlanded 初始完成 |
|---|---:|---|---|---|
| ComplexFurniture | 300 | Medieval=3 | — | 是 |
| PassiveCooler | 400 | Neolithic=2 | — | 是 |
| Stonecutting | 300 | Medieval=3 | — | 是 |
| ComplexClothing | 600 | Medieval=3 | — | 是 |
| Electricity | 1600 | Industrial=4 | — | 是 |
| NutrientPaste | 400 | Industrial=4 | Electricity | 是 |
| AirConditioning | 500 | Industrial=4 | Electricity | 是 |
| TreeSowing | 1000 | Neolithic=2 | — | 否 |
| Smithing | 700 | Medieval=3 | — | 否 |
| LongBlades | 400 | Medieval=3 | Smithing | 否 |
| **Batteries** | 400 | Industrial=4 | Electricity | 否 |
| SolarPanels | 600 | Industrial=4 | Electricity | 否 |

电池建筑的 DefName 是 `Battery`，科技是复数 **`Batteries`**。

Crashlanded 从 `ScenarioBase` 继承 `PlayerColony`，其阵营等级 Industrial，起始研究标签 `ClassicStart`；Core 中对应上表 7 项。`ResearchUtility.ApplyPlayerStartingResearch` 遍历标签并调用 `FinishProject`，不是按固定中文名称列表判断。

LostTribe 覆盖为 `PlayerTribe`，等级 Neolithic，`TribalStart` 对应 PsychoidBrewing=500、TreeSowing=1000、PassiveCooler=400、Pemmican=500、RecurveBow=400。场景还可以通过 `ScenPart_StartingResearch` 额外完成研究，Ideology meme 和科技蓝图另有分支。这里的初始集合是所选 Core 标签结果，不声明所有 DLC/mod 组合都固定为此列表。

后续扩展的边界样本：MicroelectronicsBasics=3000、Industrial、前置 Electricity，仍无特定科研台要求；它解锁高级台。HospitalBed=1200、前置 MicroelectronicsBasics，要求 HiTechResearchBench。MultiAnalyzer=4000、显式前置 MicroelectronicsBasics、隐藏前置 Machining，要求高级台；Fabrication=4000、前置 MultiAnalyzer，同时要求高级台和 active MultiAnalyzer 设施。这些只用于证明检查层，不属于本轮 12 项实现范围。

## 4. 科研台尺寸、材料与环境

| 项目 | SimpleResearchBench | HiTechResearchBench |
|---|---|---|
| 实际占地 | **3×2** | **5×2** |
| 美术 drawSize | 5×4 | 7×4 |
| 材质数量 | 75；Metallic / Woody / Stony | 150；Metallic |
| 额外材料 | 25 Steel | 100 Steel + 10 ComponentIndustrial |
| 基础 WorkToBuild | 2800 | 5000 |
| Construction 门槛 | 0（自身/父链未声明，字段默认零） | 6 |
| 建造科技 | 无 | MicroelectronicsBasics |
| 基础 ResearchSpeedFactor | .75 | 1 |
| 电力 | 无 | 250 W |
| 交互格偏移 | (0,0,-1) | (0,0,-1) |
| 目标房间角色 | Laboratory | Laboratory |

材料的工作量修正继续走已有 Stuff/Stat 计算；2800/5000 是基础工作量。木制简易台为 **75 木材 +25 钢**。`comps Inherit="False"` 覆盖 BenchBase 的组件列表，不能误继承父级配方工作台组件；绘图尺寸不能代替占地和预约。（TC10）

原版台效率为以下条件相乘后下限 .25：（TC11–TC12）

| 部分 | 规则 |
|---|---|
| 户外 | `Room.OutdoorsForWork` 或科研台本格无屋顶时 ×.75；需存在 room 对象 |
| 错误房间 | room 存在且非 `PsychologicallyOutdoors`，但角色不是 Laboratory 时 ×.8 |
| 温度 | 严格低于 9°C 或高于 35°C 时 ×.7；9°C、35°C 不罚 |
| 卫生 | Cleanliness 曲线 `(-5,.75),(-2.5,.85),(0,1),(1,1.15)`，线性插值、端点夹紧 |
| 书架 | 按全房间书架已填格的总比例累计：首格 +.04、第二 +.02、第三 +.01、其后每格 +.005，最多 +.2 |

`OutdoorsForWork` 为未屋顶格超过 100 或超过房间格数的 25%；`PsychologicallyOutdoors` 是另一组条件（未屋顶格至少 300，或触地图边界且未屋顶比例至少 50%）。两者不能合并成一个原版字段。

Room 只有 `ProperRoom && RegionCount<=60` 时计算实际房间 stats，否则 `GetStat` 返回 roomlessScore（研究卫生 .75、书架 1）。若根本没有 room 对象，`StatPart_RoomStat` 直接不乘；这与有 room 但缺 stats 不同。Laboratory 的候选评分为每个房内/相邻科研工作台 +60，最终还与其他房间角色竞争，不能看到一张科研台就直接断言是实验室。

## 5. session、优先级与解锁落点

`JobDriver_Research` 的研究 toil 为 **4000 原版 tick**，随后 `Wait(2)`。研究者每段不是承包整项科技；段落结束回到通用调度。正常成功结束时通用 `Pawn_JobTracker` 释放预约，人物未移动可能先插 1 tick `Wait_MaintainPosture`，再选择后续任务。constant think tree 还每 30 原版 tick 检查可抢占任务，因此不能要求饥饿、危险等一律等到 4000 tick。（TC08–TC09）

研究 toil 每次读取管理器当前项目，实时检查项目仍存在、台适配且可触碰；在同一台可研究的新项目之间切换，不必把旧项目进度绑在人物 job 上。台最多预约 1 人，并预约指定交互格的椅子/位置。`WorkGiver_Researcher.Prioritized=true`，台优先值是 `ResearchSpeedFactor`；通用工作列表仍决定 Research 与其他工作的顺序并处理可达性。Research 工作类型相关技能 Intellectual，naturalPriority=100；研究 WorkGiver priorityInType=100，要求 Manipulation，禁止机体工作。这些数字属于不同层，不应当作同一玩家优先级。（TC08）

| 已有内容 | 原版研究门槛 | 独立技能条件示例 |
|---|---|---|
| 切石台 | Stonecutting | — |
| 手工裁缝台 / 电裁缝台 | ComplexClothing / 再加 Electricity | — |
| 燃料锻造台 / 电锻造台 | Smithing / 再加 Electricity | Construction 4 / 5 |
| 木发电机、电线、Heater | Electricity | 不同建筑各自检查 Construction |
| Cooler | AirConditioning | Construction 5 |
| 电池 / 太阳能 | Batteries / SolarPanels | 太阳能 Construction 6 |
| 燃料炉 / 电炉 | 无 / Electricity | 各建筑门槛独立 |
| 橡树、松树、桦树播种 | TreeBase 继承 TreeSowing | Plants 6 |
| LongSword 配方 | LongBlades | Crafting 5 |
| BasicShirt / Pants / Duster / Tuque 配方 | ComplexClothing | 所选配方无 Crafting 等级门槛 |
| Parka 配方 | 所选父链无独立研究要求；仍需可用台 | — |

这张表来自 XML 及父链（TC15），技能的完整证据见 45 章。建筑门槛、配方门槛、播种门槛必须在各自入口校验，不能只把 UI 按钮变灰。拥有现成或迁移的工作台不代表配方研究必定完成；技能等级也不能替代科技解锁。

## 6. 项目 v15 的映射和验证边界

项目按 20 TPS、12000 tick/日运行；原版为 60 TPS、60000 tick/日。此轮按现实工作秒映射：**每项目研究工作 tick 系数 .02475，原始 Intellectual XP .3**。例如速度 1、简易台 .75、难度/科技差 1，600 原版工作 tick 与 200 项目工作 tick 都产生 3.7125 点和 60 原始 XP。按日映射用 ×5 会改变现实耗时，不能同时称为两个时间尺度都完全相同。（TC16）

本轮范围由主线选定：12 项科技，Industrial 起点，3×2 木制简易台，既有室内/温度逻辑，工作 session `ceil(4000/3)=1334` tick。建设基础工作 `ceil(2800/3)=934`，两处取整均是项目适配；原版 4000 tick 是 66.6667 秒，项目 1334 tick 为 66.7 秒。原版后续 Wait2 与通用姿态等待若合并或取整，也应在实现章说明，不能误写原版 session=1000。

本轮未实现实验室角色竞争、室内卫生曲线、书架、完整 Sight/WorkSpeedGlobal/难度配置、高级科研台及设施；这些未实现因子固定 1。项目现有 `outdoor` 另外映射原版室外 .75 和 roomless 卫生 .75，所以常温露天简易台为 `.75×.75×.75=.421875`，界面显示约 42%。该映射没有实现原版完整 `ProperRoom`、区域数和两套户外判定，室内仍以卫生 1 处理；因此不声明所有环境组合完全等价。

建议/已约定状态契约为 `origin`、`current`、按 12 个 DefName 保存的有限非负 `progress`。初始 7 项写入完成成本，其他为零；新局拒绝研究未完成前置、完成项不能再选。停止与切换保留进度，完成后清 `current`。旧 v14 及更早的无研究存档迁移为本轮科技全解锁并标 `legacy-unlocked`，保留已有工坊、电池与林地；这是兼容策略，不是原版新局机制。具体生产代码、UI和存档集成由实现章与对应测试提供证明，本章的静态验证不替代那些检查。

本证据包验证了 **18 个新增类型 +11 个复用类型、25 个 XML 文件/79 条记录、16 条结论、23 个独立算例/116 个标量断言**。XML 包含 229 个叶值、18 个属性记录和 275 个明确缺失字段。18 项便携篡改测试及 1 项本地派生文件篡改测试全部拒绝；测试会检查程序集/反编译器身份、类型与代码区间、XML 值/父链/属性/缺失字段、算例输入和预期值。语义 SHA pin 由审阅后固定，collector/writer 不会自动“祝福”修改后的数据。

可重复执行（在项目根目录）：

```powershell
./scripts/research/extract-technology.ps1 -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld' -DecompilerPath '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'
./scripts/research/collect-technology-xml.ps1 -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'
node scripts/research/write-technology-evidence.mjs
./scripts/research/verify-technology-evidence.ps1 -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'
```

验证 wrapper 会比对已安装程序集、版本、ILSpy 和 XML 哈希，重新收集 XML 并逐项比较，再运行便携、本地和反向篡改校验。没有原版安装时可运行 `node scripts/research/verify-technology-evidence.mjs` 做便携检查；它只证明已审阅快照内部一致，不能声称已重新读取本机游戏。脚本没有运行原版程序集、修改原版游戏、存档或进程。
