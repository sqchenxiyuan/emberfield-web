# 91 · 动物圈养：边界、筛选、牵引与允许区域

研究对象是本机 **RimWorld 1.7.4980 rev60**。本章基于固定程序集的 ILSpy 派生 C# 和 Core XML；派生结果不是原始源码。具体实机范围见 [92 · 原版圈养运行观察](92-native-animal-pens-runtime.md)。本轮关注可玩的规则链，不做时间、建造成本、走失概率或生态容量的平衡校准。

## 证据入口

- [静态结论与 XML 投影](evidence/animal-pens-evidence.json)：20 条结论、8 组 XML 选择，逐项关联文件哈希与行号。
- [类型清单](evidence/animal-pens-types.json)、[提取清单](evidence/animal-pens-manifest.json)：27 个类型。
- [原版运行记录](evidence/animal-pens-runtime-evidence.json)：7 份存档摘要、99 个成功输入记录、9 张裁图。
- [采集脚本](../../../scripts/research/collect-animal-pens-evidence.ps1)、[运行采集脚本](../../../scripts/research/collect-native-animal-pens-runtime.ps1)、[完整性验证脚本](../../../scripts/research/verify-animal-pens-evidence.mjs)。

程序集 SHA-256：`eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。ILSpy 引擎版本 `11.2.0.10050`；工具哈希见 manifest。REA 已有制品身份记录；其成员表示超过 67,108,864 字节预算，本轮沿用已记录的 ILSpy 回退，没有把“未返回成员”当作“不存在机制”。

## 1. 动物管理首先分物种

鹿的 Core Def 有 `roamMtbDays=2`，属于 `Roamer`，受围栏阻挡，使用牵引与圈栏管理。野兔的选定继承链没有该字段，支持允许区域。`SupportsAllowedAreas = !Roamer && !disableAreaControl`；读档还会清除 Roamer 的允许区域设置。

因此，驯服只改变阵营与管理关系，不能直接推导所有动物都能“分配到圈栏”。普通野兔和鹿的饥饿、驯服与繁殖基础见 [88 · 动物饲养机制](88-animal-husbandry-mechanisms.md)。本章对应静态结论 AP01、AP16。

## 2. 三种建筑的基础值

| 建筑 | costStuffCount | WorkToBuild | MaxHitPoints | 材料类别 |
|---|---:|---:|---:|---|
| Fence | 1 | 70 | 40 | Metallic / Woody / Stony |
| FenceGate | 25 | 500 | 20 | 继承 DoorBase，同上 |
| PenMarker | 30 | 600 | 100 | Metallic / Woody / Stony |

这是基础 Def 值，材料会进一步修正；不能把表内 HP 当成所有成品的最终 HP。实机木圈门为 13 HP、木标记为 65 HP。圈门基础 `DoorOpenSpeed=1.15`；围栏 `PassThroughOnly`、`pathCost=80`、`fillPercent=0.25`。本轮建筑由 God mode 准备，未观察普通资源扣除或建造工时，Web 所用倍率须单独注明为暂定映射。AP02–AP03 / PX01–PX02。

## 3. 圈栏是可达拓扑，不只是画出的矩形

`AnimalPenEnclosureCalculator` 从标记所在 District 开始。如果不存在 District，或起始/遍历到的区域接触地图边缘，则不是封闭圈。它遍历 Normal 与 Doorway 区域；Fence 区域不作为普通内部区域穿过。

门是否放行圈养动物取决于：

```text
RoamerCanPass(door) = door.FreePassage || door.def.building.roamerCanOpen
FreePassage = 门已打开 && (保持开启 || !WillCloseSoon)
```

`WillCloseSoon` 还考虑关门倒计时、自动关闭、临时堵门及附近能开门的友方角色。不能仅用视觉开合或 `openInt` 判定漏口。圈门短暂让驯养员通过，与永久保持开启，在圈地拓扑上可能不同。

墙、围栏和门应保留不同语义：墙能完全阻断；围栏能挡鹿但人能跨过；普通门/圈门能阻止自由活动的鹿自行开门。动物门帘 `AnimalFlap` 明确设置 `roamerCanOpen=true`，会连通动物可达区域，适合作为同一圈内棚舍通道，而不能独自充当圈栏外边界。

状态缓存记录可通行/不可通行门；门通行状态变化会重算，建筑生成或移除会让 pen manager 变脏。破口、拆除和门状态必须更新后续圈养判定。AP04–AP07。

### 封闭不等于能从外面牵进去

`PenMarkerState.HasOutsideAccess` 单独检查：封闭圈需要有一个动物不能独自穿过的门区域，才能报告外部入口。全围栏闭环可能显示封闭，却没有可用牵引入口。人自己跨得过围栏，并不意味着牵着鹿也能走那条路。AP08、AP11。

## 4. 圈标记筛选

`AcceptsToPen` 同时要求：标记自身过滤器允许、固定可圈养动物过滤器允许。固定集合限制在 Roamer 动物中，普通兔子不会因为勾选广泛动物类别而获得鹿的圈养语义。

原版 Animals 页签使用 ThingFilterUI，提供物种和 `Allow females` / `Allow males`。性别过滤器直接匹配 `pawn.gender`，两者默认允许。本轮实机关闭公鹿的雄性许可，存档保留 `AllowMaleGender` 禁止项；恢复后才执行普通优先牵引。这里只验证了性别开关，物种排除仍是静态证据。本次提取未建立专用年龄筛选，Web 若添加幼体/成年筛选，应标为产品扩展。AP09。

## 5. 普通牵引是跨实体任务

牵引的关键链条为：

1. 检查玩家家园地图、同阵营、可圈养物种、预约、交互、驯养员允许区域；非 Roaming 精神状态或“放归野外”指定会阻止任务。
2. 选择接受该动物且允许使用、可达的圈栏。先考虑封闭圈，再拴马桩，特定工作者才允许未封闭目的地。
3. 以动物的 `FenceBlocked` 条件检查驯养员路线。接近动物时，挂绳交互格须严格四邻接，且双方都可站立。
4. 普通角色走过去挂绳，等待 30 ticks；动物也进入临时 Wait，并由 FollowRoper 跟随。
5. 角色选择圈内可达、可预约站立点。动物自己的 Region 进入圈的 connected regions 后，逐只放绳；不必抵达标记格。

普通 `TakeToPen` 显式使用 `ignoreSkillRequirements=true`，不能沿用驯服鹿所需 Animals 8 的门槛。它还可顺带牵附近 10 格内同目的地动物，默认最多 10 只，行进速度受最慢动物影响。名义绳长 8、FollowRoper 距离 7.2 属于原版行为常量，不是 Web 必须逐项照抄的调参目标。AP10–AP14。

### 自由鹿与被牵引的鹿不是同一通行状态

`Building_Door.PawnCanOpen` 允许被具有开门权限的人牵着的动物通过普通门/圈门。寻路应区分人、自由鹿、被牵鹿。简单地把所有围栏格设为人和动物共同不可通行，会丢失这一玩法。

绳索状态保存双向引用；死亡、倒地、征召、着火、被牵动物睡眠、某些精神状态、驯养员不再执行牵引任务或双方不可达都会解除。任务结束也会丢绳。目标圈变为未封闭时，RopeToPen 的抵达逻辑会允许释放；不能因此继续声称动物受圈栏约束。AP06、AP14–AP15。

## 6. 允许区域与破口后的行为

野兔的允许区域是行为限制。`SeekAllowedArea` 在当前格不允许、又没有正在前往允许区域的有效任务时，寻找普通可达位置发起 Goto。它不能让动物穿墙，也不直接瞬移动物。实机名单已确认兔子显示区域按钮，鹿显示圈栏状态；本轮没有测试兔子重新分配区域后的返区路径。AP16。

圈栏破口不会立刻退野或删掉动物。自然 Roaming 还需：已生成、玩家家园、玩家阵营、Roamer、未被牵住、未处于漫游冷却、可达地图边缘，且开局至少 **300,000 ticks（5 日）**。鹿 `roamMtbDays=2` 是平均发生时间参数，不是“开门两天必丢”。

进入 Roaming 后会寻找出口；无法找到出口或重新被绳住会恢复。距离出口 12 格内开始等待 7,000–8,000 ticks；等待结束或精神状态年龄超过 60,000 ticks 后，`ShouldExitMapNow` 返回真。结束状态后有 30,000 ticks 冷却。本次未追踪最终离图 Job，也未做长期实机走失实验。所有运行样本都早于 300,000 ticks。AP17–AP18。

## 7. 供草能力与动物数不能混为一谈

圈栏重平衡比较的是 District 内动物 BodySize 总和/格数，候选密度乘 1.2 后仍较低才算更好；它可把牵引途中的动物计入目的地。这不是营养承载力，也不是硬性动物数量上限。

实机小圈显示营养生长约 0.03、成年鹿消耗 0.32。消耗与前章的成年鹿基础 0.32 营养/日相符，但这只是界面观察，未测季节、植物增长或长期缺粮。不要用一次截屏校准畜牧经济。AP19–AP20。

## 8. Web 实现与后续边界

已足以支持的设计结构包括物种管理方式、建筑边界、动态连通性、圈标记筛选、带失败原因的牵引任务、双向绳索关系、入圈释放和破口状态。Web 可以缩小地图和压缩时间，但应保留“命令—走近—挂绳—同行—入圈—放绳”的可见过程。

尚未实测：普通建造资源/工时、自然鹿驯服、围栏被打坏、门帘与多圈重平衡、物种排除、兔子返区、长期漫游离图、供草容量和繁殖。本轮验证器检查证据完整性与内部一致性，不是游戏重放或数值拟合。

```powershell
pwsh -NoProfile -File scripts/research/collect-animal-pens-evidence.ps1
pwsh -NoProfile -File scripts/research/collect-native-animal-pens-runtime.ps1
node scripts/research/verify-animal-pens-evidence.mjs
node scripts/research/verify-animal-pens-evidence.mjs --local
```
