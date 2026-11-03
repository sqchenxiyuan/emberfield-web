# 57｜远程战斗：武器、瞄准、掩体、弹体与伤口

本章给出 **RimWorld 1.7.4980 rev60 的选定 Core 远程战斗规则**，供当前复刻接入既有装备、制作、科技、健康与护甲系统。实现内容选择为短弓、左轮、冲锋手枪；自动手枪保留为静态对照。原版运行时观察与复刻集成验证分别记录，不用本章的静态算例替代。

## 1. 证据与边界

- 原件：本机 `F:/SteamLibrary/steamapps/common/RimWorld`，只读取 Def XML 和程序集 PE/CIL。
- 程序集 SHA256：`eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。
- ILSpy：`11.2.0.10050`；分析过程不加载或执行目标程序集。
- [80 条 XML 选择记录](evidence/ranged-xml.json)：保留父链、明确缺省路径、嵌套属性和原文件 SHA。
- [派生数值表](evidence/ranged-data.json)、[23 条声明及源行范围](evidence/ranged-claims.json)、[50 个独立算例](evidence/ranged-cases.json)。声明编号 `RGxx`，算例编号 `RVxx`。
- 新增 20 个类型，复用 42 个此前核验类型；完整派生类仅存忽略目录 `.local-research/`，提交内容不包含原版二进制或完整类。增补的 `VerbTracker` 连接人物热身与装备连发的 tick 调度证据。

原件元数据为 `.NETCoreApp v10.0`；派生代码是分析证据，不称原版源代码。所选 Core 父链不等于运行中全部 DLC、mod patch 与特性的有效数据库。以下公式以无特殊基因、衣物 stat、品质外特殊武器特性、场景修正的成年 pawn 为基线。

## 2. 武器和生产数据

来源：`RG02–04`；`RangedNeolithic.xml`、`RangedIndustrial.xml`、`BaseWeapons.xml`。成本中的“组件”为 `ComponentIndustrial`。

| Def | 成本 | 制作 Work | Crafting 最低 | 研究 | 制作台 |
|---|---|---:|---:|---|---|
| `Bow_Short` | 30 木材 | 2400 | 2 | 无 | CraftingSpot、ElectricSmithy、FueledSmithy |
| `Gun_Revolver` | 30 钢 + 2 组件 | 4000 | 3 | Gunsmithing | TableMachining |
| `Gun_Autopistol` | 30 钢 + 2 组件 | 5000 | 4 | BlowbackOperation | TableMachining |
| `Gun_MachinePistol` | 45 钢 + 3 组件 | 11000 | 4 | BlowbackOperation | TableMachining |

所有四种武器 `workSkill=Crafting`、`workSpeedStat=GeneralLaborSpeed`，基础 MaxHP 100，质量组件不改变最大耐久。质量不等于制作速度；工作速度沿用劳动能力、台子与环境的既有管线。CraftingSpot 自身台速基础 .5。

四者用固定 `costList`，**成品 Stuff=null**。短弓的 30 木材不是 stuffable 配方，不能再把木材 .65 HP 倍率或材料近战伤害倍率乘到短弓。XML 的 `recipeUsers/li` 默认追加，因此弓同时继承两种锻造台和自己的制作点；不能只保留最末子节点。

| 武器 | 质量 Normal 精度：3 / 12 / 25 / 40 格 | 瞄准秒 | 冷却秒 | 最大射程 | 每轮弹数 | XML 名义发间隔：原版 tick | 重量 |
|---|---|---:|---:|---:|---:|---:|---:|
| 短弓 | .75 / .65 / .45 / .25 | 1.35 | 1.65 | 22.9 | 1 | 缺省 15，单发不使用 | .8 |
| 左轮 | .80 / .75 / .55 / .40 | .3 | 1.6 | 25.9 | 1 | 缺省 15，单发不使用 | 1.4 |
| 自动手枪 | .80 / .70 / .40 / .30 | .3 | 1 | 25.9 | **1** | 缺省 15，单发不使用 | 1.2 |
| 冲锋手枪 | .90 / .65 / .35 / .15 | .5 | .9 | 19.9 | **3** | **7** | 2.5 |

自动手枪是单发，不能仅按名称归入连发武器。四者没有普通弹药消耗/装填组件；已审射击路径不直接按发扣武器 HP。它们仍有 `DeteriorationRate=2`，也能受到外部伤害，不能说永不损坏。此结论不推广到 charged weapon、可切换弹体武器或 mod（`RG22`）。

### 弹体、质量与穿甲

| 弹体 | DamageDef | 基础伤 | Normal AP | XML speed | 实际格/原版 tick | stoppingPower |
|---|---|---:|---:|---:|---:|---:|
| `Arrow_Short` | Arrow | 11 | .165 | 44 | .44 | .5，类缺省 |
| `Bullet_Revolver` | Bullet | 12 | .18 | 55 | .55 | 1，显式 |
| `Bullet_Autopistol` | Bullet | 10 | .15 | 55 | .55 | .5，类缺省 |
| `Bullet_MachinePistol` | Bullet | 6 | .09 | 55 | .55 | .5，类缺省 |

| 质量 | Awful | Poor | Normal | Good | Excellent | Masterwork | Legendary |
|---|---:|---:|---:|---:|---:|---:|---:|
| 精度倍率 | .8 | .9 | 1 | 1.1 | 1.2 | 1.35 | 1.5 |
| 弹体伤害倍率 | .9 | 1 | 1 | 1 | 1 | 1.25 | 1.5 |
| 弹体 AP 倍率 | .9 | 1 | 1 | 1 | 1 | 1.25 | 1.5 |
| 枪托/弓身近战伤害倍率 | .8 | .9 | 1 | 1.1 | 1.2 | 1.45 | 1.65 |

对本章无显式 AP 的弹体：

```text
damage = Mathf.RoundToInt(baseDamage × rangedDamageQuality)
AP     = baseDamage × .015 × rangedAPQuality
```

`Mathf.RoundToInt` 的半整数按偶数舍入：大师冲锋手枪 `6×1.25=7.5→8`，传说短弓 `11×1.5=16.5→16`。大师短弓伤害 14，AP .20625；AP 不能从舍入后的 14 再乘 .015。质量不改变本表的射程、冷却或 HP（`RV02–05`）。

## 3. 射击状态与源时间

来源：`RG03、09、19`；`Verb`、`Verb_Shoot`、`Stance_Warmup`、`Pawn`、`Pawn_EquipmentTracker`、`VerbTracker`。

```text
合法目标/射程/视线
  → warmup
  → WarmupComplete 当次立即发首弹
  → 设 ticksToNextBurstShot，由 VerbTick 递减并发下一弹
  → 最后一次成功发射或中止后进入 cooldown
  → 可开始下一轮
```

原版换算是 `SecondsToTicks(seconds)=RoundToInt(seconds×60)`：

```text
warmup = verb.warmupTime × weapon.RangedWeapon_WarmupMultiplier × pawn.AimingDelayFactor
cooldown = weapon.RangedWeapon_Cooldown × pawn.RangedCooldownFactor
```

成年默认两种 pawn factor 都为 1。当前 Core 的 AimingDelayFactor 有年龄部件，4/12/13 岁对应 1.8/1.1/1，成年无额外延迟；这两个 stat 没有本章 Sight、Manipulation 或 Shooting 能力部件。视力与操作能力降低会影响命中，不能顺手再把它们当作枪械热身、冷却倍率。

**XML 的 7 不是这条人物热身路径每一段实测间隔。** `Pawn.Tick` 先调用 `stances.StanceTrackerTick`；热身到期的 `WarmupComplete` 当即发首弹，并把后继倒计时设为 7。随后同 tick 的 `equipment.EquipmentTrackerTick` 对非 Normal ticker 的装备调用 `VerbsTick → VerbTick`，先将这个 7 减为 6。后续弹在 `VerbTick` 内发射，新设倒计时到下一个 tick 才再减，因此后续间隔保持 7。

Normal 冲锋手枪从热身开始计，三弹在源 tick 偏移 `30、36、43` 发射，即相对首弹 `0、6、13`，末发后冷却 54 tick，计时预算到 97。这里的结束预算不额外断言下一次 Job 实际开始的绝对 tick。`RV25、26、28` 已按该装备人物热身调度修正；不能把早先只由 XML 推出的 `30、37、44` 当作原版运行事实。热身只付一次。连发期间每次发射仍检查 LOS，缺省 `stopBurstWithoutLos=true`。

[第 58 章原生观察](58-native-ranged-runtime.md)对这条调用链给出交叉验证：热身开始 144348、三弹 `spawnedTick=144378、144384、144391`，间隔 6、7；这些是原版存档观察，不是本章公式脚本执行目标程序集所得。不同入口、ticker 类型或 mod 改写不由本案例覆盖。

目标离图、未 Spawned、当前不再能命中，可取消热身；原先站立目标倒地也会取消这次热身。原地攻击 Job 会停止寻路，并按目标销毁/倒地等条件结束。已有明确点名射击倒地目标时，行为又不同，不能统一写成“永远不能攻击倒地者”。

原版状态和项目 20 TPS 是两种时钟。当前复刻选择上述人物路径，将累计发射偏移 `0、6、13` 按 `ceil(source×20/60)` 映射为 `0、2、5` 项目 tick；把每段都舍成固定 2 或 3 tick 会累积偏差。名义 `AdjustedFullCycleTime` 及 Shooting XP 仍用 `(burst−1)×7/60`，不因首段调度提前而减去 1/60 秒。具体存读档恢复由集成章节验证。

## 4. 命中率组成

来源：`RG04–07`；`ShotReport`、`VerbProperties`、ShootingAccuracyPawn XML。

### 4.1 射手能力和武器距离

有技能系统的成年 pawn：

```text
raw = ShootingLevel
    + 12 × (min(Sight, 2) − 1)
    +  8 × (min(Manipulation, 1) − 1)
perCell = ShootingAccuracyPawn.postProcessCurve(raw)
shooterFactor = max(.0201, perCell^distance × pawnDistanceFactor)
```

常见曲线点：skill 0→.89，2→.93，6→.95，10→.97，14→.98，20→.99；完整 21 点曲线见 `ranged-data.json.shootingCurve`。`noSkillOffset=8` 仅用于没有技能 tracker 的实体，不是在所有人的技能值上额外 +8。技能 6、Sight .5、Manipulation .5 得 raw −4，perCell .85。

武器的四个距离精度先分别乘质量并 clamp `.01..1`，再在 3/12/25/40 格间线性插值；端点外保持端点。最大射程另做硬检查，因此计算出 40 格精度不代表短弓能射到 40 格。

例：传说冲锋手枪 Touch 先从 1.35 clamp 为 1，Short .975；7.5 格取二者均值 .9875。把未夹取的 1.35 与 .975 插值再 clamp 会错误得到 1。

### 4.2 ShotReport 与姿态

```text
standard = max(.0201,
  shooterFactor × weaponFactor × weatherFactor × gasFactor × executionFactor
  + darknessOffset)
ignoringPosture = standard × clamp(targetSize, .5, 2)
aim = ignoringPosture × postureFactor
passCover = 1 − combinedCover
totalEstimated = clamp01(aim × passCover)
```

- Pawn 的 targetSize 是 BodySize；其他实体用 `fillPercent×占格面积×2.5`，空格为 1。
- 非站姿且距离 ≤3.9：executionFactor=7.5；非站姿且距离 ≥4.5：postureFactor=.5。3.9 与 4.5 之间两者均为 1。
- 任一射线格有 BlindSmoke，gas=.7，重复经过烟雾不再重复相乘。
- 射手和目标**都**有屋顶才忽略天气。Fog/FoggyRain=.5；Rain/RainyThunderstorm/SnowHard/SnowGentle=.8；Clear/DryThunderstorm/Underground=1。
- 天气转变用 `Lerp(lastWeather,currentWeather,TransitionLerpFactor)`，不能只按天气名称瞬间替换。
- 普通环境没有一条通用“天黑命中减半”。darknessOffset 属于 Ideology 特殊 stat；特殊武器还能忽略天气和烟雾负项，均需单列扩展。

这个 `totalEstimated` 是面板估计值；真正起射不拿它直接决定最终伤害。

## 5. 相邻掩体、遮挡和探身

来源：`RG08–09、17`。

| 实体 | fillPercent | 基础掩体阻挡 | MaxHP | 特点 |
|---|---:|---:|---:|---|
| 布制 Sandbags | .55 | .55 | 300 | 5 布、Work180、pathCost42 |
| 钢 Barricade | .55 | .55 | 300 | 5 钢、Work320、pathCost42 |
| 木 Barricade | .55 | .55 | 195 | 5 木、Work224 |
| 完整 Wall 的侧角掩体 | 1 | .75 | 随材料 | 直接 LOS 仍受墙阻挡 |
| Poplar/Pine/Oak | .25 | .25 | 200 | 掩体与最大 HP 不乘 growth |
| SaguaroCactus | .35 | .35 | 130 | 明确覆写 TreeBase 数值 |

Sandbags 原版接受 Fabric/Leathery 的 5 单位 stuff，布是当前内容选择；Barricade 接受 Metallic/Woody/Stony。两者可穿行但带路径成本。沙袋不需要追加一个未声明的科研或建造技能门槛。

相邻掩体只取目标周围 8 格。每格由 CoverGrid 选出 `def.fillPercent` 最高的存在实体，不读取植物生长比例。目标 Pawn 或炮塔才受这套 cover benefit；直接射击普通沙袋自身时，不用给沙袋再套自己的保护概率。

从目标看，计算掩体方向与射手方向夹角；斜邻格夹角先 ×1.75：

| 有效角度 | <15° | <27° | <40° | <52° | <65° | ≥65° |
|---|---:|---:|---:|---:|---:|---:|
| 角度因子 | 1 | .8 | .6 | .4 | .2 | 0 |

再按射手到该掩体的距离：<1.9 格 ×.3333；否则 <2.9 格 ×.66666；再远不缩放。多个掩体依次 `B += (1-B)×b`：两块完整 .55 掩体合计 .7975，而不是 1.10。

LOS 是另一层检查。原版从射手原位置到目标占格矩形的最近格验距离，随后尝试直接射线和 pawn 侧身探射格；pawn 目标也能有可射击侧格。Full 建筑堵住视线，开门和 partial 掩体能看过。射向完整建筑本身还会检查格边缘。3D voxel 的高度射线可以是明确的改编，但不能称已复现这套二维探身算法。

站立敌对 pawn 的有效最小射程至少 1.421 格，横向、纵向及斜相邻格均不能普通开枪；倒地敌对 pawn 例外。范围比较在等于最大/最小边界时允许。

## 6. 发射、飞行与终点

来源：`RG10–14`。这是本章最需要保持顺序的机制。

### 6.1 发射分支

排除 forced-miss 特例后，每弹：

1. 按各掩体 adjusted block 权重选一个“打偏向掩体”的候选。
2. 对 `AimOnTargetChance_IgnoringPosture` 做 aim roll。失败进入 wild，使用 standard aim 决定偏射半径；此处不乘趴下因子。
3. 瞄准成功、目标可受 cover benefit，且 passCover roll 失败，朝选定掩体发射。
4. 否则朝 intended target 发射。

Hit flags 控制后续允许命中的实体：wild 为 NonTargetWorld，并有 50% 机会允许 NonTargetPawns；cover 分支为 NonTargetWorld 加允许的 NonTargetPawns；target 分支有 IntendedTarget 加允许的 NonTargetPawns，仅空格/fullfill 目标再加 NonTargetWorld。

原版 `Rand.Chance(p)` 对 `p<=0` 直接 false、`p>=1` 直接 true。不能因为 `Rand.Value` 可取 1，就把 `Chance(1)` 错误判成可能失败；第 54 章裸比较的护甲端点规则不能直接挪用。

### 6.2 Wild 偏射

| standard aim | .02 | .04 | .07 | .11 | .22 | 1 |
|---|---:|---:|---:|---:|---:|---:|
| 最大半径 | 10 | 8 | 6 | 4 | 2 | 1 |

每列随机值 0 对应半径 1，随机值 1 对应该列最大值；列间再线性插值。半径抽定后取随机方向并量化到格，拒绝偏到射手背后的格子；非 overhead 且路径遮挡时还会调整终点。它不是高斯散布，也不是命中失败后任取相邻格。

### 6.3 飞行时钟

**此构建 `SpeedTilesPerTick = XML speed / 100`，不是 `/60`。** 原版 60 tick/s 下，箭实际 26.4 格/s、所选子弹 33 格/s。11 格基准路径分别需 25 与 20 原版 tick；真实终点会加半径 .3 的随机水平偏移，实际时长可能变化。

```text
destination = usedTarget.Cell 中心 + RandomHorizontalVector(.3)
ticksToImpact = max(1, ceil(distance(origin,destination) / SpeedTilesPerTick))
```

源位置、终点和目标引用会记录下来；飞行轨迹不随目标移动重新定位。品质快照写入最终 DamageInfo，但 DamageAmount/AP 属性仍可从 equipment 引用求值，不能把整枚弹体描述成全属性冻结。

### 6.4 途中拦截

先排除终点格，再计算距射手的因子：

```text
d² <= 25  → 0
d² >=144  → 1
其余       → (d²−25)/119
```

因子为 0 时先返回，随后才处理完整墙的直接截获；这点区别于起射时的 LOS 检查。对当前 hit flags 允许的实体：

- 完整非开门建筑：直接截获。
- 开门：`.05 × distanceFactor`。
- Pawn：`.4×clamp(BodySize,.1,2)×distanceFactor`；非站姿另乘 .1。友方可由 preventFriendlyFire 归零，否则乘 storyteller 的 friendlyFireChanceFactor。
- Partial 非 Pawn：要求 fill>.2；紧邻终点格用 `fill×distanceFactor`，其他格用 `fill×.15×distanceFactor`。

源实现检查每步跨越的格，长步约按 .2 格细分；`checkedCells` 在每次该分支开始时清空，只保证当次采样内去重。未跨出当前格时提前返回，但长步采样可以再次包含上一 tick 的末格，不能写成“整个飞行过程中每格只判一次”。当前 3D 实现用进入格子的累计 `tEnter` 每格判定一次，这是明确的网格适配。只检查弹体当前格会漏掉高速度穿格，属于另一种实现错误风险。

### 6.5 目标已经移动，原版仍可按引用命中

到终点时，`ImpactSomething` 首先检查 `usedTarget.HasThing && CanHit(usedTarget.Thing)`。`CanHit` 检查 Spawned、同图、不是 launcher、同格完整物覆盖与 hit flags，**没有检查目标当前位置是否等于 destination**。

因此，目标移动但仍符合 CanHit 时，弹体到旧终点后仍直接命中该引用。它既不是每帧追踪位置的视觉制导，也不是纯空间碰撞的“跑开即可躲弹”。远距非站姿 pawn 此时再做 50% 判空。

引用不再可命中才遍历终点格候选，先 shuffle：Pawn 基础 `.5×clamp(BodySize,.1,2)`，远距非站姿再 ×.5，友方再乘源距离因子；其他实体 `1.5×fill`。`RV32` 明确测试了 moved=true 仍可命中旧引用、姿态判空及引用失效回落。

## 7. 接人体、护甲与结构 HP

来源：`RG15–18`；护甲顺序延续[第 54 章](54-armor-penetration-mechanisms.md)。

| DamageDef | worker | 默认伤口 | skin 覆写 | solid 覆写 | armorCategory | overkill |
|---|---|---|---|---|---|---|
| Bullet | DamageWorker_AddInjury | Gunshot | 无 | 无 | Sharp | 0～.7 |
| Arrow | DamageWorker_AddInjury | Cut | 无 | Crack | Sharp | 0～.7 |

两者都 `harmAllLayersUntilOutside=true`。`Bullet.Impact` 创建 DamageInfo 时不指定 HitPart，Height/Depth 缺省 Undefined，沿用人体覆盖抽样。它们不走 `DamageWorker_Stab` 的强制内层命中或 `DamageWorker_Cut` 的多目标切割。普通 AddInjury 内部命中可向有 coverage 的外侧父部位复制同伤，不能把所有投射物简单别名为 Stab。

先过装备/自然护甲，再 IncomingDamageFactor，再当前 worker 的伤口处理。Sharp 半伤转换为 Blunt 后仍保留原 AddInjury worker，详细顺序见第 54 章。

| Hediff | pain / severity | 平均 permanent pain / severity | bleed / severity | canMerge |
|---|---:|---:|---:|---|
| Gunshot | .0125 | .00625 | .06 | false |
| Cut | .0125 | .00625 | .06 | false |
| Crack | .01 | .00625 | 0 | false |

疼痛再除 HealthScale；新鲜伤口失血还乘种族 bleedRateFactor 与部位 bleedRate。Solid 部位直接不失血，所以 Gunshot 落到骨骼仍叫 Gunshot，但不代表会按 .06 流血。包扎、永久伤、不能流血等也会提前归零。

Gunshot 与 Cut 的感染组件基础 chance 都为 .15，实际感染仍走既有清洁度、治疗等机制，不把 .15 解释为每 tick 感染概率。自然愈合没有枪伤/箭伤专用速度：非永久伤可自然愈合，非饥饿肉身每 600 原版 tick 随机选择一个伤；基础 8/天，非站姿 +4，在床上再加床的 bed_healPerDay，再乘 HealthScale 与 InjuryHealingFactor。包扎额外治愈预算为 `8×(.5+clamp01(tendQuality))`/天，同样每 600 tick 随机选择一伤。

### Stagger

`Bullet.Impact` 在 TakeDamage 后直接通知 stagger，不读取伤害结果。护甲完全挡下也会通知。默认条件为 `BodySize <= stoppingPower + .001`，成功后 95 原版 tick、移动倍率 .17；种族与 StaggerDurationFactor 可覆写。左轮 stoppingPower1 可影响普通 BodySize1 成年人，其他选定弹体默认 .5。Stagger 是移动减速，不是 stun，不能把它当作必中打断瞄准。

### 建筑与植物

普通建筑/植物不走 Pawn 护甲。Bullet/Arrow 的 building/passable/impassable/plant damage factor 缺省均 1，所选沙袋、路障、树父链没有额外 damageMultipliers。墙的额外列表只含 Bomb、Thump 各 ×2，不影响本章两种 DamageDef。

非 Pawn 伤害随机舍入后限制于剩余 HP，再扣除/销毁。Normal 左轮打中 300 HP 布沙袋变 288；大师冲锋手枪 8 点伤打中只剩 7 HP 的沙袋，实际扣 7 并销毁。植物归一化 health 可作为复刻存储形式，但要按树种 HP 转换：`health -= actualDamage/200`，Saguaro 则 `/130`；不能用成熟度替代耐久。

## 8. 近战后备、技能与科技

来源：`RG19–21`。

### 弓身和枪托不是一个固定 DamageDef

短弓 limb capacities 为 Blunt/Poke，生成两个独立 Verb；枪的 grip Blunt 加 barrel Blunt/Poke，共三个。Tool.Maneuvers 会为每个 capacity 匹配相应 Maneuver，不是随机选择一条 DamageDef 写回 Tool。

这些工具基础伤 9、冷却 2 秒、未指定 AP，因此 Normal AP .135。分别算 `damage×(1+AP)×accuracyTouch/cycle×chanceFactor`：与最高权重相比，≥.95 为 Best，<.25 为 Worst，其余 Mid；Best 组总 .75、Mid 组总 .25，按组内 Verb 个数平分，再按目标可用性与建筑倍率过滤并归一化。不能给同一 Tool 每个 capacity 都重复分配整组 .75。

### Shooting 经验

`Verb_Shoot.WarmupComplete` 在 base 调用之后，对非倒地、非殖民机械 Pawn 目标调用 Learn：

```text
cycleForXP = 原始 verb.warmupTime + 调整后 cooldown + (burst−1)×interval/60
rawXP = (敌对 ? 170 : 20) × cycleForXP
```

此 cycle 使用原始 warmup 字段，不包含 AimingDelay 或武器 warmup multiplier；原始经验仍会经过技能激情、全局学习速度与每日预算机制。它不是按击中或逐弹给予。

| 武器 | 正常周期秒 | 对敌 rawXP/轮 | 非敌对 rawXP/轮 |
|---|---:|---:|---:|
| 短弓 | 3 | 510 | 60 |
| 左轮 | 1.9 | 323 | 38 |
| 自动手枪 | 1.3 | 221 | 26 |
| 冲锋手枪 | 1.633333… | 277.666667… | 32.666667… |

### 研究与机械加工台

```text
Electricity + Smithing → Machining 1000
Machining             → Gunsmithing 500
Gunsmithing           → BlowbackOperation 500
```

三项 techLevel 都是 Industrial。TableMachining 为 3×1，150 钢 +5 组件，Work3000、HP180、Construction4，需要 Machining，消耗 350W，交互点 `(0,0,-1)`，fill .5、pathCost50。

该台 `unpoweredWorkTableWorkSpeedFactor` 未设置，类缺省 0；`CanWorkWithoutPower` 因而为 false。断电无法加工，不能误读 `WorkTableWorkSpeedFactor` 的 min .1 为“断电仍能慢做”。

室内、非 PsychologicallyOutdoors 的房间不是 Workshop 时，台速 ×.8。露天不走这条房间角色惩罚，另走已研究的 Outdoors/Temperature 部件；两类环境因素应保留独立来源。

## 9. 复刻实现必须明确的边界

1. 原版是二维格、目标可射边与侧身格；3D voxel 高度和射线属于空间改编。墙遮挡、相邻掩体与飞行拦截是三段判断。
2. 所有射击阶段使用原版源时间换算；连发进度、发射偏移、冷却、弹体飞行与目标引用需要存档恢复。不能只保存一个“正在射击”布尔值。
3. 偏射和掩体分支仍生成弹体；误伤、命中树或沙袋、目标失效都是可能结果。静态展示一个命中百分比不足以证明这些机制。
4. 原版目标引用命中语义、整数伤害与独立 AP、无材料短弓倍率、自动手枪单发、每轮 XP，应保持；改变时必须记录为设计调整。
5. 特殊武器、forcedMissRadius、烟雾生成、完整 DLC 伤口/特性与 storyteller 友军参数，不因本章提到公式就自动算已实现。

## 10. 可复现验证

在本实验目录运行：

```powershell
node scripts/research/verify-ranged-evidence.mjs
node scripts/research/test-ranged-verifier.mjs

./scripts/research/extract-ranged.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld' `
  -DecompilerPath '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'

./scripts/research/verify-ranged-evidence.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'
```

Portable 验证不需要游戏或派生类，检查已审核语义 hash、XML 结构/父链、声明引用、独立数值派生与算例。Local 验证再检查 62 个派生文件和声明行范围 hash、安装程序集及 22 个原 XML 文件，并重新采集逐项对照。提取包装器先验证 portable 快照，只补齐缺失/不同的本地派生类，不重写历史 manifest。

[当前验证结果](evidence/ranged-validation.json)：80 条 XML 记录、23 条声明、50 个算例、394 个数值/状态断言；24 个证据破坏用例及 16 个公式错误变体均被拒绝。错误变体包括 `/60` 飞行速度、先插值后夹精度、按距离相乘代替幂、掩体概率相加、姿态提前用于 aim roll、AP 从舍入伤反推、逐弹 XP、移动目标必须在旧落点、继承列表丢失、短弓错误材料倍率、`Chance(1)` 端点，以及忽略人物首发同 tick 倒计时递减。

这些验证不执行原版，不复演原版随机流，也不证明项目集成等价。原版观察和实际复刻的操作、持久化与回归测试应独立记录。
