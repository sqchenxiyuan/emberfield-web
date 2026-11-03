# 79 火灾、消防与普通建筑修复

本轮围绕“点燃 → 扩散/损坏 → 居民灭火 → 修复经营设施”补齐机制。版本锁定 **RimWorld 1.7.4980 rev60**，原版程序集和离线 ILSpy 身份见 [fire-manifest](evidence/fire-manifest.json)。以下代码结论是已安装程序集的派生重建，不是原始源码，也不是实测频率。精选 Core XML 尚未合并所有继承、DLC 补丁和运行时 Def。

可复核的十组结论、派生文件 SHA256/行号和九组 XML 摘录在 [fire-evidence](evidence/fire-evidence.json)。[80 原版观察](80-native-firefighting-runtime.md)只确认一次开发者准备火源后的普通灭火指令；Web 落地范围另见 [81](81-fire-gameplay.md)。

## 火源是独立状态，不是建筑上的一个布尔值

`Fire` 继承 `AttachableThing`。`parent=null` 是静态火，可以和木墙、物品、地面同格存在；附着到 Pawn 的火会随人移动。存档保留火势、存活时间和 instigator，火生成/消失还会重算本格及周围八格的感知路径成本。因此“建筑着火”“火焰实例”和“建筑受损”应分开建模。依据 FI01/FI02。

| 状态/参数 | 本版本静态规则 | 对设计的意义 |
|---|---|---|
| 火势 `fireSize` | 默认 0.1，最大 1.75；灭火后低于 0.1 消失 | 可以抢救小火，也会有大火反复扑打 |
| 更新 | `UpdateRateTicks=15`；复杂计算 hash 间隔 150 ticks | 模拟步与视觉粒子不必同频 |
| 燃料 | 取可燃地形及同格可燃对象中的最大易燃性；附着火取 parent | 同格对象数量并不直接相加为生长倍率 |
| 缺燃料 | 最大易燃性 <0.01 时销毁火 | 砍出隔离带、不可燃地面会改变传播条件 |
| 生长 | 每次复杂计算增加 `0.00055 × maxFlammability ×150 ×(1−effectiveVacuum)`，封顶 1.75 | 真空与材质会影响火势 |
| 地板 | 存活达到 7500 ticks 后对可燃地形走 `Notify_TerrainBurned` | 地板损毁与建筑 HP 是不同路径 |

点燃资格也不是“地图上所有格都能燃烧”：已有火、某些多格实心建筑内部、`allowsFire=false` 的污物等可以阻止点燃。地形燃性考虑上层与 foundation；`FireBulwark` 也会阻断可燃判断。灭火泡沫 Def 的 `allowsFire=false` 属于这里。`TryStartFireIn` 只检查资格值大于零，然后建火；是否随机成功由具体调用者决定，不能给所有点火来源套同一概率。

## 扩散、烧伤与环境

依据 FI03：只有 `fireSize>1` 才尝试扩散，间隔是 `max(75,150−(size−1)×40)`。每次抽一个目标：80% 用径向索引 1..8，20% 用 10..20。再验证地图范围和目标点燃概率；近处产生 size0.1 的火，远处还需要视线并发射 Spark。它不是每次把八邻格全部点燃。

每次复杂计算从可燃候选中选择一个对象受伤，或伤害附着的 parent。名义 Flame 伤害为 `RoundRandom(clamp(0.0125+0.0036×size,0.0125,0.05)×150)`，至少 1；最终 HP/身体伤害还经过伤害系统。小于 0.4 的火不烧非 parent 的 Pawn，超过 0.4 才有另一条人物附着火路径。人物受伤选择外部身体区域，随机一件穿着衣物也可受损。

火同时向热系统注入 `size×160` 热量，格上有门则乘 0.15；这不是直接给房间加 160℃。雨和真空通过 Extinguish 伤害减火。特别注意：虽然常量名有 `BaseSkyExtinguishChance=0.04`，当前 interval 实现实际比较 `Rand.Value<6`，不能写成“每 150 ticks 有 4% 灭火”。无屋顶可受雨，厚顶不可，薄顶还取决于该格建筑 `holdsRoof`，不能简单概括为“有顶永远不受雨”。本轮没有测雨天频率、温升或真空效果。

## 自动消防和玩家右键是两条入口

这是本轮最重要的调用链修正。**不能用 `WorkGiver_FightFires.HasJobOnThing(forced=true)` 推断 1.7 的实际右键菜单行为。** 依据 FI04/FI05。

| 路径 | 主要目标门槛 | 创建的 Job |
|---|---|---|
| 自动 `WorkGiver_FightFires`，静态火 | 消防 WorkTag 未禁用，目标在 Home；远处检查占用，普通自动任务避开近处正在处理的火 | `BeatFire` |
| 自动，附着在兼容阵营/HostFaction 人物上的火 | 不给自己；Home 外允许救助曼哈顿距离 ≤15 的兼容人物，并检查可达 | `BeatFire` |
| 真正的右键 `FloatMenuOptionProvider_ExtinguishFires` | 允许征召/未征召和多选，要求操作能力、消防工作类型未禁用、Deadly 级可达、点击格在 **Allowed area** | `ExtinguishFiresNearby` |

自动静态火的 Home 条件不因该方法的 `forced` 参数消失，但右键 provider **没有 Home 条件**。右键先通过 `GetFiresNearCell` 收集房间/区域内的火，将点击格火优先入队；driver 接近、扑打，并能继续寻找可达且可预留的火。`Allowed area` 和 `Home` 是不同概念。这里只确认入口对点击格的 Allowed 检查，不声称所有后继队列目标沿用完全相同的门槛。

两个 driver 都反复调用 native beat-fire verb。该 verb 名义范围 1.42、warmup 0、cooldown 1.1 秒；全身忙碌或刚出生的火会阻止施放。每次名义 Extinguish 伤害 32，`DamageWorker_Extinguish` 按伤害 ×0.01 减火势，低于 0.1 才移除火。火仍会生长、人物仍要走路，所以不能把 `1.75/0.32` 直接当实测扑灭时长。手动 driver 还有累计扑打 ticks 的 600 秒上限，与整段行走墙钟时间不同。依据 FI06。

## 灭火之后才轮到普通修复

依据 FI07：`ListerBuildingsRepairable` 维护按阵营划分的受损可维修建筑；满 HP 后移出。普通候选要求 `Building`、使用 HP、`building.repairable`、同阵营，当前 HP 低于最大值。玩家建筑需位于 Home，可预留，未被指定拆除，相关 mineable 目标未指定挖掘；**正在燃烧的建筑不会在这次任务选择中获得 Repair**。

`JobDriver_Repair` 预留并走到接触位置，预算初值 80；每工作 tick 学习 Construction 0.05 XP，预算减 `ConstructionSpeed×1.7`。预算 ≤0 时加 20、建筑加 1 HP、封顶最大 HP；满血后完成。普通 HP 修复路径没有取用/搬运/消耗原材料或零部件。电器 Breakdown 的组件维修是另一机制，不应混为一谈。driver 本身没有显式“新起火即终止”的检查，因此这里只把燃烧限制陈述为**任务选择门槛**。

建筑受损也不意味着殖民地建筑财富同步打折。`WealthWatcher` 对玩家人工建筑读取 **`MarketValueIgnoreHp`**；普通 `MarketValue` 才有 `(HP比例,倍率)=(0,0),(.5,.1),(.6,.5),(.9,1)` 的曲线。若 Web 因火损直接降低建筑财富，那应明确是自己的设计。建筑摧毁、移出统计与仅损 HP 要分开。依据 FI10。

## 电路怎么引火

依据 FI08，原生 ShortCircuit 事件候选是有活跃电源网络上的**普通 `PowerConduit` Def**，并不是随机挑任何发电机/电池/用电器。

- 网络若有任一电池储能 >20：抽干该网络全部电池，火焰爆炸半径为 `clamp(sqrt(totalEnergy)×0.05,1.5,14.9)`；半径 >3.5 再追加半径 ×0.3 的 Bomb 爆炸。
- 否则从导线周围半径 3、视线可达且能点燃的格中随机选择一个，初始 size 在 0.1..1.75；没有合格燃料可能不起火。
- 雨天设备短路是另一入口，检查开机且配置 `shortCircuitInRain` 的 PowerTrader，或储能 >100 的电池，然后产生半径 1.9 的 Flame 爆炸。该方法的外层雨量/暴露调用条件未继续追踪，不能说此函数自身已经检查雨和屋顶。

| Core 定义 | XML 中易燃性 |
|---|---:|
| PowerConduit 普通导线 | 0.7 |
| HiddenConduit 隐藏导线 | 0 |
| PowerSwitch | 0.5 |
| WoodFiredGenerator、Battery | 1 |
| Heater / Cooler | 0.5 / 0.7 |

因此“导线是金属所以原版不燃”不成立。Heater 选中节点还明确 `shortCircuitInRain=true`；Cooler 节点没有该覆盖值。本轮不外推全部继承后的运行时电器属性。

## 面向 Web 的设计取舍与证据边界

有意义的最小循环是：独立火势 → 邻格燃料/传播 → 高优先级消防打断普通经营 → 灭火后修复 → 电网、食物保鲜、房间温度恢复。玩家应能看到火源、目标、为什么不能执行和修复进度；不要把火灾实现成弹窗扣一次资源。

Web 的确定性随机流、限火数、离散更新频率、手动操作是否继续要求 Home，以及弱化电池爆炸都是实现决策，具体见 81。原生观察未覆盖自然短路、扩散概率、自动消防选择、Home 外手动命令、普通维修、雨天或建筑财富。不得把这一次原生灭火完成写成上述全部规则的运行时验证。

重新采集静态摘录与检查：

```powershell
pwsh -File scripts/research/collect-fire-evidence.ps1
node scripts/research/verify-fire-evidence.mjs
node scripts/research/verify-fire-evidence.mjs --local
```

portable 只校验已提交记录的结构、引用、哈希和观察关系；local 额外核对本机派生文件、动作、原始截图和存档。两者都不会启动游戏或重做随机实验。
