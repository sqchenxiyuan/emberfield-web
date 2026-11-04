# 生产策略：材料筛选、搜索半径与工人限制

核对日期：2026-11-04。目标为本机 RimWorld **1.7.4980 rev60**。延续 [118：生产账单](118-production-bills-mechanisms.md)，本章回答一条生产计划“允许用什么、去哪里找、由谁开始做”，重点是机制边界，不扩展产量、工时或平衡调参。Web 适配与验收见 [121](121-production-policies-gameplay.md)。

核心结论：**配方要求、玩家材料筛选、材料搜索范围、玩家工人限制和配方硬性技能要求是不同层次。策略主要决定下一次派工，不能把每次修改都实现为强制取消当前批次。** 指定某个工人会绕过玩家设置的技能区间，但不会绕过配方硬性技能要求；空的非固定材料筛选意味着不允许任何材料。

证据入口：[PPL01–PPL14 静态证据](evidence/production-policies-evidence.json)、[新增类型 manifest](evidence/production-policies-manifest.json)、[原版有限实机记录](evidence/native-production-policies-runtime.json)。全量派生 C#、原始存档和完整屏幕保留在忽略的 `.local-research`；公开内容为规则、哈希、范围、字段投影和经过检查的界面裁剪。

## 1. 来源与复核

| 项目 | 身份 |
|---|---|
| 原文件 | `F:\SteamLibrary\steamapps\common\RimWorld\Assembly-CSharp.dll` |
| DLL SHA-256 | `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3` |
| MVID | `8e962ecc-7ac7-42d2-8f3b-1b16cd24d2cd` |
| 静态工具 | ILSpy `ICSharpCode.Decompiler 11.2.0.10050` |
| 工具 SHA-256 | `587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78` |
| 原始 XML | Core `Defs/RecipeDefs/Recipes_Production.xml` |
| 本轮实机 | Core + Odyssey，独立存档目录，原版 PID 31584，已正常退出 |

复用 [118 保留的 REA 身份记录](evidence/production-bills-rea-managed.json)，因为目标 DLL 未变。其 metadata coverage 为 complete；其中 `.NETCoreApp,Version=v10.0` 是记录的元数据，不据此推断启动游戏实际采用的运行时。静态派生允许未解析依赖，不是开发者原始源码；Core XML 不是 Mod/DLC patch 后的有效 Def 数据库。

新增派生类型为 `RimWorld.BillDialogUtility` 和 `Verse.IntVec3`；其余来自同 DLL/工具哈希的 food、work、preservation、production-bills。静态 JSON 对每条来源保留文件哈希、行范围和范围哈希。

在项目根复核：

```powershell
pwsh -NoProfile -File scripts/research/extract-production-policies.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-production-policies-evidence.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-native-production-policies-runtime.ps1 -Check
```

第一条重新静态提取并比对两个类型；第二条重核复用来源和 XML，精确重建静态 JSON；第三条只读核对已经记录的五份存档、81 组输入/捕获回执、10 张裁剪和读取后的账单投影。三条均不启动原版、不发送输入、不编辑存档。第三条需要本机保留的原始证据，不是仅下载公开仓库即可重新运行的实机实验。

## 2. 三层材料约束（PPL01–PPL03）

| 层次 | 作用 |
|---|---|
| 配方的 `ingredients` | 每个原料槽允许什么，以及需要多少 |
| 配方的 `fixedIngredientFilter` | 整份配方可选材料的范围；名称中的 fixed 不表示每个槽都只有一种材料 |
| 账单的 `ingredientFilter` | 玩家在可选范围内作出的限制 |

`IngredientCount.IsFixedIngredient` 判断的是该槽的 `filter.AllowedDefCount == 1`。这与 `recipe.fixedIngredientFilter` 不是同一个概念。例如，Any stone blocks 使用 StoneChunks 类别；单一 granite 配方对应固定花岗岩槽。单一石材配方由游戏生成，不能把它描述成 Core XML 中直接存在的独立 RecipeDef 节点。

创建账单时，从 `recipe.defaultIngredientFilter` 复制允许项；若配方没有单独的 default filter，配方初始化会从 fixed filter 复制。**这只解释新建默认值，不意味着玩家点 Clear all 后会自动恢复默认。**

`Bill.IsFixedOrAllowedIngredient` 先检查：若某个固定原料槽允许该物品，立即通过；否则要求配方 fixed filter 和账单 player filter 都允许。派工还要求至少一个实际原料槽匹配；NoMix 和 AllowMix 的选料分支也保留固定槽的例外。不能将所有路径简单压成“配方筛选与玩家筛选永远取交集”。

实际 Thing 的筛选还可能检查小型化物品内层、耐久百分比、品质及特殊规则；只传 ThingDef 的重载只看 Def 集合。UI 在所有原料槽都固定时隐藏可选材料面板；存在可选槽时，以配方 fixed filter 为面板父筛选。保存时还会清除玩家集合中超出配方 fixed filter 的 Def。

这解释了原版截图中的差异：固定花岗岩账单没有右侧材料清单，Any stone 账单有多种石块勾选。Web 可以先实现材料种类，耐久、品质及 DLC 特殊筛选必须单独列为未覆盖项。

## 3. 搜索范围是空间规则（PPL04–PPL07）

普通地图上已生成的材料，其距离条件为：

```text
(material.x - table.x)^2 + (material.z - table.z)^2 < radius^2
```

这里的中心是 `billGiver.Position`，通常即工作台锚点；原版 X/Z 是水平平面。**边界严格小于，不包含恰好等于半径的普通地面材料。** 这不是工人的当前位置，不是工作台交互格，也不是实际绕路的路径长度。候选还要满足配方/筛选、未禁止、可预留；区域遍历和区域内接触可达检查另行参与，不能把“在圆内”等价成“必然取得到”。

搜索起点则不同：具有交互格的建筑从交互格对应区域开始；异常无交互格建筑退回工人位置；非建筑取 bill giver 位置。NoMix 的候选距离排序使用该 root cell。因此搜索起点、排序起点与范围判定中心应分别理解。

特殊材料来源不能套用普通地面分支：

| 路径 | 已核对规则 | 边界 |
|---|---|---|
| 普通地面 Thing | 自身位置到工作台锚点的水平平方距离 | `<` |
| 启用的 IHaulSource | 已生成容器的位置经过 `InHorDistOf`，再遍历容器内物品并检查禁止/预留/配方 | `<=` |
| 自主工作台内箱 | 先尝试自己的 innerContainer | 独立分支，不能据此推断统一半径规则 |

容器 `<=` 来自本轮新增的 `IntVec3.InHorDistOf` 派生证据；没有在实机做恰好踩边界的试验。

**原版半径是浮点数。** UI 滑条为 3 到 100，到达 100 时改存 999，并显示 Unlimited；有限值用 `F0` 格式显示为整数文本。999 使区域范围剪枝失效，但普通地面材料仍经过 `distance < 999`，不是数学上的无穷大。本轮原版保存得到 **3.83620691，UI 显示 4**。因此不能仅凭界面文字推断半径数据是整数。

## 4. 谁可以接新任务（PPL08–PPL10、PPL14）

原版的关键顺序：

1. 若账单指定了某个人，`PawnAllowedToStartAnew` 直接返回是否为这个人。
2. 否则检查奴隶/机械体等类别，以及玩家设置的技能区间。
3. 技能区间使用配方 `workSkill`，下限与上限都包含；机械体可使用固定技能等级。
4. WorkGiver 随后独立检查配方 `skillRequirements`，不因已指定某个人而跳过。
5. 通过后继续材料与作业条件；这一条账单不可执行时，队列可继续寻找后面的账单。

所以，“指定 Squint”与“任何人且 Crafting 10–20”是两种策略，不应同时要求 Squint 满足玩家的 10–20。UI 也会在指定人后隐藏玩家技能区间，但旧值仍可保留在账单中。**这不允许低技能角色越过配方的硬要求。** Core 制作零部件声明 Crafting 8；切石基类使用 Crafting 作为 workSkill，学习系数为 0。此处引用数值只用于识别规则层次，不是本轮平衡目标。

工人下拉菜单来自 `AllMaps_FreeColonists`，可经过额外 validator，并按标签/技能/工作启用/不能工作状态排序。不能从事该工作的人选项禁用；未分配该工作的人可以出现为可选项，并标记 NotAssigned。选择只设置账单限制，**不会开启工作优先级、改变日程或把人传送到工作台**。账单校验会清除死亡、阵营改变或被绑架的指定人；并非所有暂时离开都立刻清除。

## 5. 改策略与当前批次（PPL11–PPL12）

派工创建 Job 时已经记入具体原料对象和数量。检查到的普通收料及工作阶段，不会每 tick 再检查玩家材料筛选、搜索半径、指定工人和技能区间。它们仍会因目标被毁、禁止、预留失败、工作台不可用、账单删除等条件失败；工作阶段还明确检查手动 suspended。

因此，编辑策略应主要约束后续派工，不能等同于“立即撤回所有已接任务”。这与手动暂停不同，也不表示当前作业绝不被其他机制打断。长时间在制品作业存在周期性 override 检查。

在制品另有路径：没有自身绑定 UFT 的订单寻找合适 UFT，要求同配方、同创作者、所含原料 Def 仍被 fixed-or-allowed 接受且可预留；候选可仍绑定另一订单，没有 `BoundBill == null` 限制（后续[122](122-unfinished-production-mechanisms.md)复核纠正）。搜索从工人位置出发，使用 9999 范围，并非账单原料半径。已绑定 UFT 的续作分支检查绑定工人、可达、可预留和未禁止，不作相同的原料重筛；外围工人限制及配方硬性要求仍先执行。本轮只记录静态差异，后续 UFT 实机试验见122。

## 6. 保存、复制与 Web 适配（PPL13）

账单保存材料筛选、浮点半径、技能范围、指定人的引用及类别标记；半径字段缺省解释为 999。Clone 会建立独立的筛选对象，复制允许项和策略字段；这不意味着复制了已分配的工作或地图上的原材料。

Web 多层体素世界采用自己的坐标和输入规则：

| 项目 | 本轮核对的原版 | Web 适配约定 |
|---|---|---|
| 有限半径输入 | 浮点滑条，整数仅为显示格式 | 整数 3–100 |
| 无限表示 | 999 sentinel，普通地面仍有限距离判断 | `null` 表示不施加距离限制 |
| 空间维度 | 水平 X/Z 距离 | 三维欧氏距离，包含楼层高度 |
| 普通材料边界 | 严格 `<` | 保留严格 `<` |
| 材料种类之外的筛选 | 耐久、品质、特殊筛选等 | 以 [121 实现范围](121-production-policies-gameplay.md) 为准 |

这些是重建产品的设计选择，尤其是三维和整数半径，不能写成原版已经验证的事实。数值可以后调，但策略快照、实体身份、禁止/预留/可达约束、明确阻塞原因和存档语义需要先成立。

## 7. 本轮原版有限实机验证

实验使用独立 profile，复制 [25 的 stonecutting-working 基线](25-native-stonecutting-runtime.md)，源与副本 SHA-256 均为 `41c9cbbac0909b8804450eaca7a2c8d32cd023f6348676a4af02d027edc17233`。历史实验室使用开发者/God 模式放置木制切石台和花岗岩块，并恢复 Squint 的需求；本轮 devMode 保持开启，但只通过普通 UI 修改账单、征召/取消征召、时间控制、存读档和退出，没有注入、生成物体或修改 XML。读取原始存档参与观察，因此不宣称是纯屏幕实验。

固定对象为工作台 `TableStonecutter42144`、位置 `(113,0,138)`，工人 `Human961 / Squint`、Crafting 3。基线账单 Bill0 为 Make_StoneBlocksGranite，次数 1。

### 7.1 已开始的一批继续，新派工受限

| 状态 | tick | 玩家技能区间 | 当前工作 |
|---|---:|---|---|
| 基线 | 47518 | 0–20 | DoBill 36124，workLeft 1195.07764，已工作 666 ticks |
| 改为最低 10 后保存 | 47546 | 10–20 | 同一个 DoBill 36124，workLeft 1178.66187，已工作 693 ticks |

截图 [011](evidence/production-policies-runtime/011-skill-minimum.png) 显示 Any worker 与 10–20。一次 400 ms 有限时间脉冲后，存档仍是同一个工作，剩余工作量下降；这支持“此项修改未打断已经开始的普通切石批次”。**基线 Job 是 playerForced，不能把这个单例扩展为所有自主调度情形。**

随后通过征召/取消征召主动取消了旧任务，再右击工作台，[024](evidence/production-policies-runtime/024-skill-rejection-menu.png) 明确显示 Under allowed skill 10。打断来自征召操作，不是之前修改技能范围。

改为指定 Squint 后，[033](evidence/production-policies-runtime/033-specific-squint.png) 隐藏范围 UI，[036](evidence/production-policies-runtime/036-specific-allowed.png) 显示可执行的 Prioritize cutting stone blocks；后续存档仍保留 10–20 和 `Thing_Human961`。没有点击该优先工作命令，所以这是**新派工可用性**证据，不是指定工人又完成了一批的证据。

### 7.2 同一暂停时刻改变半径与筛选

暂停原 Bill0，新增 Bill1 Make_StoneBlocksAny，排除 Granite，允许 Sandstone、Limestone、Slate、Marble、Vacstone 五类。

| 仅调整的策略 | UI/存档状态 | 右键命令结果 |
|---|---|---|
| 有限半径 | [046 显示 4](evidence/production-policies-runtime/046-radius-three.png)，存档原值 3.83620691 | [049：Missing 1x stone chunks](evidence/production-policies-runtime/049-radius-rejection.png) |
| 改为 Unlimited，筛选不变 | [059](evidence/production-policies-runtime/059-radius-unlimited.png) | [062：可优先切石](evidence/production-policies-runtime/062-unlimited-eligible.png) |
| 保持 Unlimited，Clear all | [067：六类全部禁止](evidence/production-policies-runtime/067-clear-filter.png) | [070：Missing 1x stone chunks](evidence/production-policies-runtime/070-empty-filter-rejection.png) |

三次比较都在 tick 47546 暂停状态下进行。保留文件名 `046-radius-three.png` 记录了操作前的意图，**实际值不是 3，必须以画面 4 和原始存档 3.83620691 为准**。

这里建立的是有限范围内“改半径使材料候选可用、清空非固定筛选使候选不可用”的因果对照；没有下达后来可用的命令，没有实际远程搬料，也没有测试恰好位于圆周边界的物品。

### 7.3 实际读档再保存

| 文件 | tick | 关键信息 |
|---|---:|---|
| ProductionPoliciesBaseline | 47518 | Bill0，Crafting 3 正在工作 |
| New Arrivals1 | 47546 | Bill0 范围 10–20，旧工作仍前进 |
| New Arrivals2 | 47546 | Bill0 暂停且指定 Squint；Bill1 排除 Granite，半径 3.83620691 |
| New Arrivals3 | 47546 | Bill1 空筛选，半径字段省略即 999 |
| New Arrivals4 | 47547 | 通过 Load 读取 New Arrivals3 后，再用普通 Save 保存 |

New Arrivals3 与 4 的完整 `billStack.OuterXml` **逐字相同**，包括两条账单顺序、loadID、指定人、旧技能区间、空筛选和无限半径默认。读档/保存期间前进了 1 tick，工人 HaulToCell 的 JobDriver XML 随之改变，所以只声明账单策略回环，不声明整世界完全一致。有限半径档已保存和读取 XML，但没有执行它的读档回环。

原版通过普通 Quit to OS 退出。退出后的截图因前台进程校验而未生成，没有虚构第 082 张图或动作回执；单独保留的 fresh CIM 记录确认 PID 31584 已不存在、无剩余 RimWorld 进程。既有 Web 预览未被停止或替换。

### 7.4 覆盖边界

已覆盖固定/非固定配方的面板差异、技能限制对当前与新作业的有限对照、指定人后的可派工菜单、半径与空材料集合的可派工菜单、账单策略存读档。

未做：配方硬技能不足时指定人的实机测试、技能上下限等值测试、执行中修改材料/半径/指定人、容器和自主工作台取料、UFT、精确半径边界、多层距离、完整自主生产一轮。原始导航尝试 006/007、022/023、025–028、043 未达预期界面，采集器保留了这些回执和说明；只有清晰截图与存档支持的结果进入上表。

复核脚本校验目标/版本/模组/原始文件哈希、存档关键断言、操作序列 001–081 和每张公开裁剪的重生成哈希；它不通过截图自动识字，也不把当时的失败导航包装成成功实验。
