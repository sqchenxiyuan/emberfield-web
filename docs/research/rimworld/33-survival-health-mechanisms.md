# 33 饥饿、温度疾病、倒地与救护

本章补齐“缺粮或环境恶劣 → 身体能力下降 → 倒地 → 搬运救援 → 卧床喂食 → 条件改善后恢复”的规则链，承接 [第 12 章食物](12-farming-cooking-food.md)、[第 14 章睡眠与住房](14-sleep-housing-mechanisms.md)及 [第 02 章战斗与健康](02-combat-and-health.md)。范围是普通成年人的 Malnutrition、Hypothermia、Heatstroke，以及救援、医疗床位和真实食物喂食；没有把器官损伤、药物、完整服装数据库或所有 DLC 健康系统一并视为已实现。

证据来自本机 **RimWorld 1.7.4980 rev60**。`F:\SteamLibrary\steamapps\common\RimWorld\Assembly-CSharp.dll` 的 SHA256 为 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`；ILSpy 分析引擎版本为 `11.2.0.10050`，引擎 SHA256 为 `587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78`。分析脚本读取 PE/CIL 与 XML，不执行游戏程序集。完整派生 C# 留在忽略目录 `.local-research`；仓库交付规则、定位、筛选的数值与独立算例。

## 33.1 实现合同

下表是本章所审阅的原版规则。项目时间、身体模型、调度和存档取舍见 33.10；静态证据不代表项目已通过运行验收。

| 主题 | 已确认规则 | 实现影响 |
|---|---|---|
| 食物类别 | 普通杂食者的临界值为 0、.12、.24 | .24 已是 Fed；自动患者喂食另用 `<=.26` |
| 营养不良 | 每 150 原版 ticks，先扣食物，再按是否 Starving 增减严重度 | 吃饭先改变营养，恢复在后续需求更新发生 |
| 营养不良进度 | 每次 `±.0011325×个人固定因子`，因子在 .8..1.2 | 不是每次重新随机，也不是统一每秒扣生命 |
| 温度基线 | 无其他修正的人类舒适温度 16..26°C，安全温度 6..36°C | 安全区与疾病恢复区是不同条件 |
| 温度疾病 | 每 60 原版 ticks 检查一次，严于安全边界才增长 | 恰好 6°C 或 36°C 不触发最小增量 |
| 温度恢复 | 失温要求 `T>舒适下限`，中暑要求 `T<舒适上限` | 失温在 6..16°C、中暑在 26..36°C 可停止恶化但不恢复 |
| 能力变化 | 先算身体 worker，再叠加 offset、postFactor、setMax，按百分之一取整 | 阶段减益不是最终移动或操作能力 |
| 倒地 | 意识 `<.3`，或移动 `<=.15`，或疼痛达到阈值等 | 多种未到最高阶段的疾病可以叠加致倒 |
| 医疗床 | 有可保存的 Medical 标志，选床仍检查实体、资格、可达与预约 | 医疗标志不保证温度合适，也不直接治好这三种状态 |
| 救援 | 预约患者与床，走到患者，实际携带，送到床上 | 不是立即移动坐标并回血 |
| 喂食 | 找到、预约并搬运真实食物，等待吞食完成后才增加营养 | 取消、被阻挡、食物消失都需要处理 |
| 简单餐喂食 | 基础 500 ticks × 1.5 = 750 原版 ticks | 正常 60 TPS 下为 12.5 秒，路程另算；患者 Eating 不参与该等待公式 |

可定位规则为 [survival-claims.json](evidence/survival-claims.json) 的 SV01–SV24。每条绑定原始 XML 记录或带指纹的派生类型行号。

## 33.2 饥饿与营养不良

食物条 `f=CurLevel/MaxLevel` 是营养存量比例，不是生命或疾病程度。普通杂食者 `FoodLevelPercentageWantEat=.3`，因此：[SV01、SV19]

| 条件 | 类别 | 对基础食物下降速度的倍率 |
|---|---|---:|
| `f<=0` | Starving | 0 |
| `0<f<.12` | UrgentlyHungry | .25 |
| `.12<=f<.24` | Hungry | .5 |
| `f>=.24` | Fed | 1 |

饥饿时营养消耗变慢，但食物为零后营养不良开始发展。基础消耗为 `lifeStage.hungerRateFactor × race.baseHungerRate × 2.6666667E-05` 营养/原版 tick；正常成年默认值约合 **1.6 营养/日**，再乘类别、健康、特性及当前床的 BedHungerRateFactor 等。床倍率默认 1。所读 Need_Food 路径没有直接用“倒地”或“睡着”再乘一个统一折扣；DLC 的代谢、泌乳等另有分支。

需求每 150 原版 ticks 更新。执行顺序是先扣除 `FoodFallPerTick×150`，再检查扣除后的 Starving 状态，然后修改 Malnutrition。个人因子来自 pawn ID 的固定种子抽样：

```text
r = lerp(.8, 1.2, seededRandom(pawn))
每次营养不良变化 = Starving ? +.0011325*r : -.0011325*r
每个原版日 = 60000 ticks = 400 次需求更新
连续饥饿的基础日增长 = .453*r
```

食物刚被本次扣到零，即进入增长分支。吃饭不直接清除 Malnutrition：营养先增加，到下一次需求更新仍不处于 Starving 才下降。例：food=.9、malnutrition=.2、个人因子=.8，普通成年且仅有这项健康修正时，下一次 food=.8936、严重度=.199094；个人因子只改变疾病变化，不乘到食物消耗上。[SV02；S02]

严重度阶段使用包含下限的 `>=` 判断。下表中的意识列是 modifier，不是最终身体能力。[SV03]

| 严重度范围 | 意识 offset | 意识 setMax | hungerRateFactorOffset |
|---|---:|---:|---:|
| `[0,.2)` | -.05 | 无 | +.5 |
| `[.2,.4)` | -.10 | 无 | +.6 |
| `[.4,.6)` | -.20 | 无 | +.6 |
| `[.6,.8)` | -.30 | 无 | +.6 |
| `[.8,1]` | 0 | .10 | +.6 |

健康饥饿倍率的聚合先乘各 factor，再加各 offset，最后限制非负。只有 Malnutrition 时，倍率为第一阶段 1.5、其余阶段 1.6。因此刚吃过饭的营养不良患者，在恢复期间可能比健康角色更快饿；不能因为“原先正在挨饿”就固定采用 1 倍消耗。

连续 Starving、从严重度 0 开始、固定 `r=1` 的算术估计：约 1.766 个原版日到 .8，约 2.208 日到 1。`r=.8..1.2` 对应日增长 .3624..5436。这里没有计入首个更新相位、提前死亡或其他疾病，也不是原版计时实测。[S04]

这三种疾病原始定义均没有覆盖 tendable、initialSeverity、minSeverity、maxSeverity、comps。类默认 initialSeverity=.5，但 `HealthUtility.AdjustSeverity` 创建新效果时会把严重度设置为本次正增量；首次挨饿并不会从 .5 开始。没有现存效果时的负增量不会创建疾病。severity 降到 0 或以下可移除；普通致命效果达到 lethalSeverity=1 可触发死亡。效果不存在与“现存效果恰好为 0、等待移除”必须分开。[SV04；S13]

## 33.3 舒适温度、安全温度与衣物

Human 的 XML 明确声明 ComfyTemperatureMin=16、ComfyTemperatureMax=26。StatDef 自身的默认 0/40 不是裸身成年人的最终区间。原版 safe range 在最终 comfy range 两侧各扩展 10°C；无衣物、特性、基因等修正时即为 **6..36°C**。[SV05]

`StatPart_GearStatOffset` 对每件已穿衣物读取最终对应隔热 Stat，并计入 StatOffsetFromGear：防寒从舒适下限减去，耐热向舒适上限加上。最终舒适 Stat 在后处理开启时限制在 [-2000,2000]；安全区是在此后再扩展 10，并不再次套同一个范围。[SV06]

例如已算好的两件衣物防寒值为 10 和 5、耐热值为 2 和 3，则舒适区间由 16..26 变成 1..31，安全区间为 -9..41°C。这里的输入已经含材质、品质及其他服装修正，不能直接把 XML 基值当成最终隔热量。

InsulationBase 的品质倍率从 Awful 到 Legendary 依次为 .8、.9、1、1.1、1.2、1.5、1.8。Cold/Heat 各自声明材质 StatPart 与 StuffPower、StuffEffectMultiplier 依赖。本章确认接入关系，没有展开全部衣物、材料、基因的有效属性数据库。项目尚无衣物系统时，选用 16..26 的无衣物基线应明确标为设计取舍，而不是假定所有殖民者都穿同一套服装。

## 33.4 失温与中暑的增长、恢复

OrganicStandard giver 集合把人类接到失温/中暑 giver；健康更新按每 60 原版 ticks 的 hash interval 调用。下列数值均为**一次 giver 调用的变化量**，不能直接当成任意项目 tick 或秒的增量。[SV07]

令 `T` 是角色当前环境温度，`L/U` 是其最终舒适下限/上限，安全下限为 `L-10`，上限为 `U+10`。

**失温 Hypothermia：**[SV08]

```text
若 T < L-10：
  增长 = max((L-10-T)*.0000645, .00075)
若本次开始时已经存在失温，且满足以下任一条件：
  T > L
  或角色及父容器均不处于生成状态
  或所在 terrain.heatPerTick > 0
则：
  恢复量 = clamp(当前严重度*.027, .0015, .015)
```

增长与恢复是两个顺序分支。已经失温的角色即使仍处低温，在暖地形上也可能先增长再恢复；恢复使用增长后的严重度。giver 缓存了调用开始时的效果引用，因此本次新建的失温不会立即通过这份旧引用恢复。增长已造成死亡则直接返回。S06 覆盖相邻温度端点与缓存引用差异。

若未进入恢复分支，普通非 insectoid 在 T<0 且严重度>.37 时还有独立冻伤判定：每次以 `.025×severity` 的概率，从尚存在的易冻伤部位按权重挑选，施加 `ceil(部位定义HP×.5)` 的冻伤伤害。这是另一个身体损伤链；不能把本章聚合疾病模型称为已经复现冻伤。Insectoid 还使用不同 hediff，不在普通人模型内。

**中暑 Heatstroke：**[SV09]

```text
若 T > U+10：
  x = T-(U+10)
  增长 = max(overageCurve(x)*.0000645, .000375)
否则，已有中暑且 T < U：
  恢复量 = clamp(当前严重度*.027, .0015, .015)
```

overageCurve 在以下点间线性插值：

| 超出安全上限 °C | 0 | 25 | 50 | 100 | 200 | 400 | 4000 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 调整后的超额 | 0 | 25 | 40 | 60 | 80 | 100 | 1000 |

因此超额 37.5°C 对应调整后 32.5，不是始终按温差线性累加。T 严格高于舒适上限+150°C 时，每 420 ticks 的嵌套检查还可能施加空气灼伤，数量 `max(RoundRandom(overageCurve(额外超温)*.06),3)`；此伤害不等于中暑严重度增量。

对 16..26°C 基线，失温在 **6..16°C（含端点）** 既不增长也不因气温恢复；中暑相应是 **26..36°C（含端点）**。失温在恰好 6°C 不加最小增长，在恰好 16°C 也不因气温恢复。中暑的两个端点同理。低温例外的暖地形条件仍可改变结果。

恢复不是固定每秒减 .015。严重度 .5 每次减 .0135，.1 减 .0027，.02 减 .0015；接近 0 时最终被严重度下限截到 0。适温床位能让病人处在恢复条件里，床的 Medical 标志本身不会触发此分支。[S09]

## 33.5 阶段、意识与行动能力

失温与中暑的阶段下限均为 0、.04、.2、.35、.62，lethalSeverity 均为 1。[SV10]

| 严重度范围 | 意识 offset / setMax | 移动 offset | 仅失温的操作 offset | 疼痛 offset | 可见性 |
|---|---|---:|---:|---:|---|
| `[0,.04)` | 无 | 0 | 0 | 0 | 阶段不可见 |
| `[.04,.2)` | -.05 | 0 | -.08 | 0 | 可见 |
| `[.2,.35)` | -.10 | -.10 | -.20 | 0 | 可见 |
| `[.35,.62)` | -.20 | -.30 | -.50 | +.15 | 可见 |
| `[.62,1]` | setMax=.10 | 0 | 0 | +.30 | 可见、lifeThreatening |

最高阶段中的 0 offset 不代表能力恢复；意识被限制到 .1 后，Moving/Manipulation 的不能清醒门禁直接令其为 0。中暑虽没有直接操作 offset，仍会通过意识降低间接损害操作能力。

一般能力计算先检查 `zeroIfCannotBeAwake`，再运行该能力的身体 worker。worker 基值大于 0 时，汇总匹配的 offset、postFactor、最小 setMax；最后应用 minValue 并取百分之一。默认 modifier 为 offset=0、postFactor=1、setMax=999。不能只找当前疾病的一列，忽略其他疾病、器官、疼痛或基因。[SV11]

对**身体完整、成年、无其他效果、血液和呼吸能力正常**的人，可把本章三个状态约简为：[SV12]

```text
pain = clamp01(各阶段疼痛 offset 之和)
painPenalty = clamp((pain-.1)/.9*.4, 0, .4)
若 painPenalty < .01，则将该扣减视为 0
C = roundHundredth(max(0, min(1-painPenalty+各意识offset之和, 最小setMax)))
若 C < .3：Moving=0；Manipulation=0
否则：
  Moving = roundHundredth(max(0, min(C,1)+各移动offset之和))
  Manipulation = roundHundredth(max(0, C+各操作offset之和))
```

这里 postFactor 都是 1，且只有意识 setMax；真实完整算法仍按上一段规则计算。`roundHundredth` 对应 `Mathf.Round(value*100)/100`；独立算例按最近偶数处理精确半值，没有宣称 JavaScript 双精度和 Unity float 在所有临界输入逐位一致。

| 健康前提相同的示例 | 意识 | 移动 | 操作 | 疼痛 |
|---|---:|---:|---:|---:|
| 无这三种疾病 | 1 | 1 | 1 | 0 |
| Malnutrition=.6 | .70 | .70 | .70 | 0 |
| Hypothermia=.2 | .90 | .80 | .70 | 0 |
| Hypothermia=.35 | .78 | .48 | .28 | .15 |
| Heatstroke=.35 | .78 | .48 | .78 | .15 |
| Hypothermia=.62 | .10 | 0 | 0 | .30 |
| Malnutrition=.6 + Hypothermia=.35 + Heatstroke=.35 | .21 | 0 | 0 | .30 |

最后一行说明残留疾病能叠加致倒，不能只写“任一疾病到 extreme 才倒”。原版意识 worker 还依赖血液循环、呼吸、过滤等；移动依赖腿、脊椎与骨盆，操作依赖操作部位效率。本章约简不代替完整身体模型。[S11]

## 33.6 倒地、死亡与恢复

`CanBeAwake` 要求意识 **>=.3**，Moving 的 `CapableOf` 要求能力严格 **>.15**。普通疼痛休克要求疼痛达到最终 PainShockThreshold；其默认值为 .8。不能清醒、不能移动、疼痛休克或特定生命周期状态等会进入倒地。注意 .3 的意识端点仍可清醒，.15 的移动端点已不具备移动能力。[SV13；S12]

原版死亡除了本章三种状态的严重度达到 1，还检查致命能力、身体核心、受伤等条件；意识本身是生命必需能力。正常殖民者在倒地条件不再成立时会被重新判定并 `MakeUndowned`。这个过程不是对某个全局 HP 做一次简单正负判断，也不能给已经死亡的人仅靠恢复 severity 自动复活。

低温/高温的定义允许能力变化触发 death-on-downed 检查。非玩家角色另有死亡概率分支，殖民者简化合同不能直接用于敌人、野生动物和所有客人。部分仍清醒的倒地成年人可爬行，例如操作能力至少 .15、年龄至少 8 且无禁止爬行条件；意识=.1 的本章最高阶段不满足此条件。原版死亡保护、特殊生命周期、基因和复活系统不在本次独立模型内。

## 33.7 救援与医疗床位

普通自动救援先要求患者确实需要救援：倒地、尚未卧床或充电、没有被停用，以及精神状态、屠宰、远行和仪式等分支允许。非强制救援还要求同阵营、未禁止、附近无敌人，并且可预约和到达。实际 `CanRescueNow` 调用 `EnemyIsNear(patient,25f)`；WorkGiver 中另有未使用的 40 常量，不能把它写成执行中的警戒距离。强制命令放宽部分社会/危险条件，仍需实体与可达检查。[SV14]

`FindBedFor` 对需要医疗休息的人优先采用已有且有效的医疗床，再搜索医疗床定义和危险等级通行层级，最后可以回退到所属床、伴侣床和其他普通床。有效性包括生成状态、地图、火焰/真空、床类型、空位、囚犯/奴隶/所属、医疗策略、预约与可达等。原版选床不等于保证该床已经处于适温房间。[SV15]

`JobDriver_TakeToBed` 的基本链路为：[SV17]

1. 预约患者与床位；需要时认领非医疗床。
2. 走到患者，重新确认倒地与到床的可达性。
3. `StartCarryThing` 把患者放入携带容器。
4. 走到床，释放相关床预约，执行 `TuckIntoBed`。
5. 将患者实际放到床上；只有床仍可用才通知患者卧床。

任务非正常继续时的结束动作会把仍携带的患者放回执行者位置附近。完整项目实现还要防止取消、床拆除、执行者倒地后留下重复患者、永久携带或悬空床预约；静态看见这些原版方法不等于项目已有相同清理行为。

Medical 是床上可切换、可保存的标志；变更会清除床的 owners。建筑属性默认 bed_canBeMedical=true、bed_defaultMedical=false、bed_healPerDay=0；具体床再覆盖。[SV16]

| 原始记录 | 休息效能 | 免疫增长倍率 | 包扎质量 offset | 伤口床位治疗量/日 | 默认医疗床 |
|---|---:|---:|---:|---:|---|
| SansComfortBedBase 直接值 | 未在本记录声明 | 1.07 | 未在本记录声明 | 4 | 未在本记录声明 |
| Bed 直接值 | 1 | 见完整继承链 | 见完整继承链 | 见完整继承链 | 见完整继承链 |
| HospitalBed 直接值 | 1 | 1.11 | .10 | 10 | true |

此表忠实区分直接声明与继承，床的其余父类关系见第 14 章。免疫、伤口治疗和包扎质量不是 Malnutrition/Hypothermia/Heatstroke 的恢复率；医疗床不会给三者套统一“10/日”的治疗。

## 33.8 医疗休息与真实喂食

紧急医疗休息包括倒地（排除天生常倒地生命周期）、需要包扎、现在要做手术或分娩；普通医疗休息还包含已包扎且愈合的伤口、尚未免疫的可免疫疾病。三种本章状态均不可包扎，单独的中阶段营养不良或温度疾病不一定让角色自动求医；由其造成的倒地则满足紧急休息条件。WorkGiver_Tend 还检查实际需要包扎、护理许可，以及人类患者卧床。[SV18]

患者喂食资格与找得到食物是不同的判定。普通人类需要不是站立姿态、已在床上、属于玩家或由玩家收容、有食物需求且需要医疗休息，另有客人、屠宰、婴儿、种族、看守工作与预约限制。`IsHungry` 使用 `CurLevelPercentage <= PercentageThreshHungry+.02`，所以普通杂食者是 **<=.26**。[SV19]

WorkGiver 找食物时按患者需求与偏好选择许可的真实来源，尊重预约、禁用和不合适食物的限制，允许某些库存与驮兽库存来源，不临时收割食材。计划数量和实际消费数量不是同一个舍入步骤：[SV20]

```text
计划拿取：RoundToInt(所需营养/单件营养)，至少 1，受 maxNumToIngestAtOnce 限制
实际吞食：CeilToInt(所需营养/单件营养)，受现有实体数量和 maxNumToIngestAtOnce 限制
```

例如需要 .12 营养、单件 .05，计划可为 2；若消费时实体栈有足量食物，向上取整可为 3，但若实际只携带 2 就只能吃 2。不能把独立算法的向上取整解释为系统凭空补出第三件。[S18]

FoodFeedPatient 依次预约患者与食物，按地面、执行者库存、其他携带者或营养膏机路径取得食物，再搬到患者身边。`ChewIngestible` 直接设置 `RoundToInt(baseIngestTicks×1.5)` 并使用 Delay 完成模式，没有在该等待公式里读取患者 Eating 或进食速度。SimpleMeal 的完整父链 `MealSimple → MealCooked → MealCookedIngredientless → MealBaseIngredientless` 未覆盖 baseIngestTicks，类默认值为 500，因此等待 750 原版 ticks。患者仍符合喂食资格、能够接触、食物仍存在等条件会继续检查。[SV21]

750 ticks 在正常 60 TPS 下等于 12.5 秒，尚未计入找食物、取货、移动、暂停和实际运行速度。一次画面上停留 12 秒不足以单独判定任务卡死；也不能用系统墙钟反推原版精确吞食工时。

`FinalizeIngest` 才调用物理来源的 `Thing.Ingested`，实际分栈或销毁消费数量，接收返回的营养；随后仅当患者仍活着且有食物需求时增加 CurLevel，并受 MaxLevel 限制。SimpleMeal 的 XML 基础营养 .9、每次最大/默认消费 1 件；有效营养仍应来自实际食物和对应消费者规则，不能将全部食物强行视为 .9。[SV22]

食物条 .24、上限 1，消费一份 .9 营养餐后只能到 1；.14 超出的容量不会成为第二份食物。完成喂食也不会同步把 Malnutrition 清零。患者死亡、食物被抢走或任务取消时的实体账目，必须由项目工作状态机和资源测试负责，不能用“全局食物 -1、疾病=0”替代这条链。

## 33.9 存档与证据边界

原版分别保存 hediff 严重度、Pawn 健康状态、食物状态与 lastNonStarvingTick、床的 medicalInt 等。它们不是同一个健康数值。项目还需要保存或安全恢复患者、床、食物、携带者、路径阶段及剩余工作时间之间的关系；本章没有声称原版存档格式可直接用于项目。[SV23]

独立算例中的 severity=0 是对阶段查询或移除边界的输入；正常恢复后效果应消失。倒地/死亡示例只覆盖已声明的普通殖民者前提。救援/医疗休息/喂食布尔算例是资格子集，不含完整寻路、预约竞争、特殊社交和所有 DLC 分支。XML 是选定字段的直接快照，保留 ParentName 与明确缺省检查；除已说明的 SimpleMeal 父链，不宣称它是整套 Def 数据库的继承、Mod 补丁和运行时资源求值结果。

本章验证器不会启动原版或调用项目模拟代码。原版界面操作、运行存档观察与项目浏览器验收由各自的运行证据记录承担；不能由本章 PASS 推出已经完成了对应游戏内动作。

## 33.10 项目适配与验证要求

本轮项目日历采用 **60000 原版 ticks/日 → 12000 项目 ticks/日** 的明确映射：[SV24；S20]

| 行为 | 原版间隔/工时 | 按日历映射的项目值 |
|---|---:|---:|
| 需求/营养不良更新 | 150 ticks | 30 ticks |
| 温度疾病更新 | 60 ticks | 12 ticks |
| 基准简单餐喂食等待 | 750 ticks | 150 ticks |

20 TPS 是项目的墙钟运行频率，单独不能推导这个日历比例。原版的 hash 调度相位、跳帧 delta 处理、实际浮点、暂停和加速语义都要由项目明确选择。将源代码每次增量不经换算放入项目每 tick，会把疾病发展速度放大数十倍。

本轮可采用并需要如实标记的适配包括：无衣物人类温度基线；固定且可复现的个人因子；仅完整身体下的意识/移动/操作约简；殖民者倒地和死亡状态；明确的救援/喂食工作优先级；中断时保全患者与食物实体；旧存档迁移。如果项目让喂食者的 manipulation 影响 150 点喂食工作的推进速度，这也是额外项目适配；原版本章审阅的 ChewIngestible 等待为固定的 baseIngestTicks×1.5。它们是项目设计决定，不是从一个原版工作类自动推出的完整复刻。

项目验收应至少覆盖：缺粮逐步恶化、进食后延迟恢复、严于温度端点的增长和恢复、疾病叠加致倒、搬运到适温床后恢复、无床/无食物/不可达时的失败反馈、喂食过程中取消与读档、物品和患者数量不增不减、已经死亡者停止正常工作。完整衣物、器官伤害、冻伤/灼伤、感染/免疫、药物和非玩家死亡概率不在本轮约简模型内，后续扩展要重新对接证据。

## 33.11 可复跑证据包

本章新增 26 个类型，复用 food/housing/combat/environment/generation 中的 15 个类型，共 41 个引用类型；24 条规则含 **80 个代码定位、33 个 XML 定位**。10 份原始 XML 选出 25 个记录，验证 **134 个叶字段、7 个属性节点、70 个明确缺省检查**。20 个独立算例共 **353 个解析断言**，另有 **42 项篡改拒绝检查**。

| 文件 | 用途 |
|---|---|
| [survival-types.json](evidence/survival-types.json) | 新增类型清单 |
| [survival-manifest.json](evidence/survival-manifest.json) | 原件、分析器、派生类型指纹与行数 |
| [survival-xml.json](evidence/survival-xml.json) | 原始 XML 选定字段、属性、父名与缺省 |
| [survival-claims.json](evidence/survival-claims.json) | SV01–SV24 规则与定位 |
| [survival-cases.json](evidence/survival-cases.json) | S01–S20 的输入、期望、范围说明 |
| [survival-validation.json](evidence/survival-validation.json) | 原件和本地派生核验记录 |

项目目录下可运行：

```powershell
node scripts/research/verify-survival-evidence.mjs
node scripts/research/verify-survival-evidence.mjs --local
./scripts/research/verify-survival-evidence.ps1 -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'
node scripts/research/test-survival-verifier.mjs
```

Portable 模式验证已冻结的来源身份、路径、行号范围、XML 模式/数值、算例输入指纹与独立计算；`--local` 额外校验本机 41 个派生文件。PowerShell 再读原件 DLL、版本和 XML，逐项比较选区、属性、父名与缺省。算例与验证器均不导入项目实现。

本机缺少派生文件时，可用 [extract-survival.ps1](../../../scripts/research/extract-survival.ps1) 重建新增类型及缺少或不匹配的复用类型；复用结果必须与已有清单指纹一致，不重写旧清单。XML 收集器为 [collect-survival-xml.ps1](../../../scripts/research/collect-survival-xml.ps1)，规则/算例生成器为 [write-survival-evidence.mjs](../../../scripts/research/write-survival-evidence.mjs)。分析器依赖放在本机 tools 中，不随本章分发。

```powershell
./scripts/research/extract-survival.ps1 -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld' -DecompilerPath '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'
```

[拒绝测试脚本](../../../scripts/research/test-survival-verifier.mjs)只修改忽略目录 `test-results/survival-verifier-negative` 中的 15 份元数据副本；覆盖错误版本/程序集/分析器、复用身份、派生路径、越界行号、疾病和能力端点、即时治愈误解、错误日历、删除边界用例、XML 继承/缺省篡改及派生源文件破坏。其结果不是原版玩法测试，也不是项目功能覆盖率。
