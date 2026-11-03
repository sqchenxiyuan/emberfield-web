# 51｜人体结构、十一项能力与部位伤害

本章固定本机 RimWorld **1.7.4980 rev60** 的 Core 声明与程序集，说明完整 Human 部位树、天然身体能力、缺失部位和普通物理伤害的实现合同。派生代码是静态重建结果，**不是原始源码，也不是原版运行证据**。本包的算例不导入项目 `src`，不启动原版，也不证明整个 `TakeDamage` 已复刻。

证据入口：[64 节点人体数据](evidence/anatomy-human.json)、[逐条结论 AC01–AC26](evidence/anatomy-claims.json)、[49 个独立算例](evidence/anatomy-cases.json)、[Core XML 记录](evidence/anatomy-xml.json)、[类型清单](evidence/anatomy-types.json)、[派生文件清单](evidence/anatomy-manifest.json)、[验证结果](evidence/anatomy-validation.json)。完整派生类留在忽略目录 `.local-research/anatomy/`；复用既有研究的类不重复提交。

## 1. 身体是带深度、覆盖率和功能标签的树

Human 有 **64 个 BodyPartRecord、32 种 BodyPartDef**，包含 24 个 Inside 节点、40 个 Outside 节点。Outside 中 39 个有正覆盖率；第 40 个为覆盖率 0 的 conceptual `UtilitySlot`。不能把身体化成互不关联的头、躯干、四肢血条。（AC01–AC03）

```text
Torso
├─ Ribcage / Sternum / Pelvis / Spine
├─ Stomach / Heart / 两肺 / 两肾 / Liver
├─ Neck → Head → Skull → Brain
│              ├─ 两眼 / 两耳 / Nose
│              └─ Jaw → Tongue
├─ 左右 Shoulder → Clavicle + Arm → Humerus / Radius / Hand → 五指
├─ UtilitySlot
└─ 左右 Leg → Femur / Tibia / Foot → 五趾
```

此图表示父子关系；内外层由各节点的 `depth` 决定。Jaw 是 Outside 的 solid 部位，Tongue 是其 Inside 子节点。大脑的直接父节点是 Skull，不能把一次对 Head 的内部抽样直接理解为“抽到 Brain”。

人体数据逐节点保留：原版前序 `index`、父/子 ID、`height`、`depth`、相对与绝对 coverage、直接 groups、定义 tags、HP、出血率、皮肤/硬组织/概念部位标志和伤害命中倍率。ID 来自英文标签的稳定 slug；项目 camelCase ID 与原版存档 index 属于不同标识体系。

| 部位定义 | 每个节点基础 HP |
|---|---:|
| Torso | 40 |
| Head、Neck、Skull | 25 |
| Shoulder、Arm、Leg、Ribcage | 30 |
| Clavicle、Humerus、Femur、Tibia、Pelvis、Spine、Foot | 25 |
| Radius、Hand、Sternum、Stomach、Liver、Jaw | 20 |
| Heart、Lung、Kidney | 15 |
| Ear | 12 |
| Brain、Eye、Nose、Tongue、Waist（UtilitySlot 节点） | 10 |
| Finger（含拇指）、Toe | 8 |

未显式声明的 BodyPartDef 默认 HP 10、bleedRate 1；skinCovered、solid、conceptual 默认 false，destroyableByDamage 与 alive 默认 true。天然成年 Human 本章取 HealthScale=1；通式是 `maxHP = Ceil(baseHP × HealthScale)`。

`BodyDef.CacheDataRecursive` 建立前序索引，并按以下方式算覆盖率：

```text
root.coverageWithChildren = 1
child.coverageWithChildren = parent.coverageWithChildren × child.coverageRelative
remainder = 1 − sum(直接孩子的 coverageRelative)
abs(remainder) < 0.00001 时设 0，再夹至 >= 0
node.coverageAbs = node.coverageWithChildren × remainder
```

全树 coverageAbs 合计 1；Outside 合计 **0.619631**。height/depth 缺省时继承父值，根缺省 Middle/Outside；groups 不自动继承。证据数据用双精度并保留 15 位小数，未声称逐位模拟 C# float。

## 2. 当前 HP、缺失子树和残端是三个不同状态

`GetPartHealth` 先从 maxHP 开始，按 Hediff 列表顺序逐伤扣除。某条伤 `destroysBodyParts=false` 时，该次扣除后至少剩 1；最终夹到非负，不可毁部位至少 1，再执行 **Mathf.RoundToInt**。直接 MissingPart 返回 0。（AC03–AC05）

取整会改变逻辑：20 HP 扣 0.5 得 20，扣 1.5 得 18，扣 19.5 得 0。不能用未取整的 0.5 剩余值计算能力，也不能仅在伤害累计精确达到 maxHP 时才毁部位。这里使用 Unity 中点取偶语义；浮点运算的逐位一致性仍不在本包保证范围。

非核心部位添加普通 Hediff 后，若这个整数 HP 为 0，原版建立 MissingPart。天然部位设 `IsFresh=true`；其 `PostAdd` 会：

1. 递归清除自身与后代旧 Hediff，保留作为例外的自身 MissingPart，以及显式 `keepOnBodyPartRestoration` 的效果。
2. 为直接孩子分别加入 nonfresh MissingPart，继续递归覆盖整个子树。
3. 保留缺失来源 `lastInjury`。缺失不会自行移除。

例如 Hand 缺失同时覆盖五指，共 6 个节点。普通旧伤不再参与痛感、出血与累计伤害致死阈值。项目可只存最高缺失根并通过祖先查询推导后代，但必须完成同样的旧伤清理；不能只把 HP 夹成 0 后继续叠算原伤。

新鲜残端生效需要：fresh 标志为真、年龄 **小于 90000 源 tick**、Outside、非 solid、父部位不缺失、父部位及祖先没有直接 added part。死亡与 CanBleed/causesNoPain 还分别约束出血/疼痛：

```text
残端 BleedRate = maxHP × 0.12 × part.bleedRate × race.bleedRateFactor
残端 PainOffset = maxHP × 0.0125 / HealthScale
```

成年完整 Human 的新鲜缺眼为 bleed 1.2、pain .125；新鲜缺手为 2.4、.25。Inside 器官、solid 下颌、旧缺失、缺失父节点下的子缺失不产生这条残端效果。全身出血还要乘各健康阶段 totalBleedFactor 并除 HealthScale。

`Tended` 即使质量为 0，也把 fresh 设 false，因而停止这条残端出血与疼痛，**缺失部位仍然存在**。90000 源 tick 到期同样不再 fresh。Dev 直接添加 Missing 默认 nonfresh，因此它不能单独证明残端护理流程。

## 3. 部位效率与能力聚合

天然部位的基础效率如下，其中 r 使用上节整数 HP：（AC07–AC10）

```text
r = 当前整数 HP / maxHP
Outside 且非核心：efficiency = clamp01((r − .1) / .9)
Inside 或核心：efficiency = r
缺失自身或祖先：efficiency = 0
```

外部部位剩余 10% HP 时已无自然效率；内部器官不能套用这个 10% 区间。完整通用算法还先检查祖先义体、父缺失，再乘自身 added part 效率与 HP 因子，最后加同部位健康阶段的 partEfficiencyOffset 并夹非负；partIgnoreMissingHP 可跳过 HP 因子。本轮只落实天然身体，记录通用算法是为了避免未来错误扩展。

`CalculateTagEfficiency` 遍历全身体具备该 tag 的节点，缺失仍以 0 参与分母；没有该 tag 时返回 1。普通模式算平均；best 权重 >=0 且至少有两个节点时算 `best×w + 其他平均×(1−w)`，然后可做 FloatRange 映射和 maximum 上限。

`CalculateNaturalPartsAverageEfficiency` 与之不同：只遍历尚未缺失、属于目标 group 的节点，义体节点贡献 0 但仍计数，空组为 0。`CalculateImmediatePartEfficiencyAndRecord` 在存在 added ancestor 时返回 1，防止义体祖先被肢体链重复惩罚。

肢体效率取每个 limbCore 的效率，乘其连通 segment 的全部效率，再乘指趾因子：

```text
每条肢体 = coreEfficiency × product(connectedSegmentEfficiency)
          × ((1 − appendageWeight) + appendageWeight × mean(digitEfficiency))
总肢体效率 = mean(每条肢体)
functionalFraction = 有正效率的 core 数 / core 总数
```

连通 segment 的遍历先沿连续 segment 父节点上爬，再取该点的全部 segment 后代。手臂链包括 Shoulder、Clavicle、Humerus、Radius、Hand；漏掉内部骨节点会让断锁骨仍保留完整操作能力。

能力最终包装层先检查 `zeroIfCannotBeAwake`；Consciousness < .3 时相应能力直接返回 0。正常路径算 worker，**仅 raw > 0 时**应用 offset 总和、postFactor 连乘与最小 setMax，然后取 minValue 下限，最后 `Mathf.Round(value×100)/100`。`CapableOf` 严格比较 `level > minForCapable`：Moving 阈值 .15，其余选定能力为 0。已死亡人物的 handler 全能力返回 0。

## 4. Human 全部十一项自然能力

下表的 T(tag) 是上节的 tag 效率，C、B、P、F 是已完成包装与百分位取整的意识、呼吸、泵血、过滤能力；每行 worker 结果仍需经过最终包装。（AC11–AC15）

| 能力 | worker 主公式 | 昏迷时提前归零 | 血肉必需能力 |
|---|---|---|---|
| BloodPumping | T(BloodPumpingSource) | 否 | 是 |
| Breathing | T(BreathingSource) × min(T(BreathingPathway),1) × min(T(BreathingSourceCage),1) | 否 | 是 |
| BloodFiltration | T(BloodFiltrationKidney) × T(BloodFiltrationLiver) | 否 | 是 |
| Metabolism | T(MetabolismSource) | 否 | 是 |
| Consciousness | (T(ConsciousnessSource) − painPenalty) × (.8+.2min(P,1)) × (.8+.2min(B,1)) × (.9+.1min(F,1)) | 否 | 是 |
| Manipulation | limbEfficiency(.8) × C | 是 | 否 |
| Moving | limbEfficiency(.4) × T(Pelvis) × T(Spine) × (.8+.2B) × (.8+.2P) × min(C,1) | 是 | 否 |
| Sight | T(SightSource, bestWeight=.75) | 否 | 否 |
| Hearing | T(HearingSource, bestWeight=.75) | 否 | 否 |
| Talking | T(TalkingSource) × min(T(TalkingPathway),1) × min(T(Tongue),1) × C | 是 | 否 |
| Eating | T(EatingSource) × min(T(EatingPathway),1) × (.5+.5T(Tongue)) × C | 是 | 否 |

补充条件：

- Consciousness 的 painPenalty 为 `clamp((pain−.1)/.9×.4, 0, .4)`，**只有结果 >= .01 才扣除**。
- Human 呼吸源为双肺，pathway 为 Neck，cage 为 Ribcage 与 Sternum 的平均；过滤为双肾平均乘肝。无 Kidney tag 的其他身体才用 BloodFiltrationSource 回退分支。
- Metabolism 是 Stomach 与 Liver 平均；Jaw 同时承担 Talking/Eating Source，Neck 承担两者 Pathway。
- Moving 在 alwaysDowned 生命阶段或 functionalFraction < .4999 时为 0。Moving 公式中的 B/P **不夹到 1**，与意识公式不同。
- Eating 正常最终下限 .1，但昏迷早退绕过这个下限。Sight/Hearing 没有昏迷早退；人物实际死亡后仍由 handler 统一归零。

| 孤立状态，其他自然部位健康、无 fresh 残端或额外疼痛 | 结果 |
|---|---|
| 左眼 5/10 HP | Sight .86 |
| 一眼缺失 | Sight .75 |
| 两眼缺失 | Sight 0；Manipulation 仍 1 |
| 一耳缺失 | Hearing .75 |
| 一根手指缺失 | Manipulation .92 |
| 一手或一锁骨缺失 | Manipulation .50 |
| 一根脚趾缺失 | Moving .96 |
| 一腿缺失 | Moving .50 |
| 一肺缺失 | Breathing .50、Consciousness .90、Moving .81 |
| Sternum 缺失 | Breathing .50、Consciousness .90、Moving .81 |
| 一肾缺失 | BloodFiltration .50、Consciousness/Moving .95 |
| 胃缺失 | Metabolism .50 |
| 肝缺失 | BloodFiltration 0，触发必需能力致死 |
| 舌缺失 | Talking 0、Eating .50 |
| 下颌缺失 | Talking 0、Eating .10 |

这些算例是受控的公式状态，不表示致死身体可以在原版中继续活动。也不能直接把带旧伤人物的原版界面数值当作“孤立缺眼”结果：本轮原版观察对象 Prophet 起始就有 Torso 永久 Stab 2，额外痛感要进入对照。

## 5. 倒地与死亡

普通成人倒地条件由 PainShock、CanBeAwake、Moving.CapableOf 共同决定；不会移动的种族与 alwaysDowned 生命阶段有特殊分支。死亡检查依次考虑 preventsDeath、致死 Hediff、血肉必需能力、核心效率 <= .0001、仍存在的 Injury 严重度合计 >= **150×HealthScale**。（AC16）

天然 Human 的必需能力包括 **Consciousness、Breathing、BloodPumping、BloodFiltration、Metabolism**。漏掉 Metabolism 会让胃和肝同时缺失仍被判为存活。缺失子树清掉的伤不能再累计到 150 阈值；残端的 MissingPart 本身不是 Hediff_Injury。

## 6. 命中抽样与伤型转换

普通近战 DamageInfo 的初始 depth 为 Outside。候选按 not-missing、height、depth 和直接 parent 限定筛选；若无正覆盖率候选，只能放开 height。先按 `coverageAbs × GetHitChanceFactorFor(damageDef)` 抽样，失败才回退 coverageAbs。parent 指定的是直接父子关系，不是整个子树。（AC17–AC18）

Eye 的 Blunt 命中因子为 0，conceptual 全部为 0。因此未缺失天然身体的 Outside 权重总量为 Cut .619631、Blunt .611231。Poke 的 DamageDef 身份不会因为其继承 BluntBase 而变成 Blunt；只能使用针对 Poke 自己的命中因子。显式 HitPart 绕过随机筛选，但仍要求 not-missing。

写伤型时先取 DamageDef.hediff，再应用 skinCovered 的 hediffSkin，最后 solid 的 hediffSolid 优先覆盖：

| DamageDef | 普通软部位 | 皮肤覆盖部位 | solid 部位 | worker |
|---|---|---|---|---|
| Cut | Cut | Cut | Crack | Cut |
| Stab | Stab | Stab | Crack | Stab |
| Blunt | Crush | Bruise | Crack | Blunt |
| Poke | Crush | Bruise | Crack | Stab |
| Bite | Bite | Bite | Crack | AddInjury，仅选择部位强制 Outside |

Poke 的 XML ParentName=BluntBase，而 Blunt 那条记录的 Name=BluntBase。它继承 Crush/Bruise/Crack、harmAllLayersUntilOutside=true、过量伤区间 .4~1；自己改为 Stab worker 和 .4 内层命中概率。直接字段缺失不代表最终默认空值。

普通伤痛一般是 `severity × painPerSeverity / HealthScale`。Cut/Stab/Bite/Crush/Bruise 的普通痛系数为 .0125；Crack 为 .01。Cut/Stab/Bite 出血系数 .06，Crush .01，Bruise/Crack 不出血。出血还受部位/种族、护理、solid、永久伤、年龄止血与健康阶段修正约束。永久伤使用自身永久疼痛参数，不能继续按普通伤处理。（AC06）

## 7. 四类伤害 worker 的传播合同

共同入口先选部位，再算护甲、IncomingDamageFactor，随后根据 AllowDamagePropagation 决定是否进入特殊 worker。显式禁止传播会直接 FinalizeAndAddInjury，跳过 worker 的保留与扩伤。低层直接添加 Injury 又是另一个入口，不能拿它证明普通攻击传播一致。（AC19–AC23）

### 外部保留

Outside 非核心、D >= 当前整数 HP 时，算 `overkill=(D−HP)/maxHP`，用 DamageDef.overkillPctToDestroyPart 对该值做 InverseLerp，抽签决定是否保留全伤害。失败把 D 降为 `HP−1`。Cut/Bite 区间 0~.1，Stab/Blunt/Poke .4~1。**Blunt 的 override 没有调用这条通用保留函数**，不能按 XML 上有区间就对所有钝击强行保 1。

### Stab / Poke

初始点不在 Inside 时，分别以 .6 / .4 概率尝试选该点的直接 Inside 子节点；不存在时保留原点。然后沿命中点到第一个 Outside 建立父链，先调用一次外部保留：单节点给全 D，多节点时每个 Inside 给 .4D、Outside 给 .75D。不是逐层耗尽剩余伤害，也不再重复 base 的外层复制。

例如显式命中 Brain、D=20，链是 Brain→Skull→Head，分配 8、8、15。普通随机 Head 内层选择只能先到直接孩子 Skull，不能跳过 Skull 直接抽 Brain。

### Cut

一般选择 Outside。显式 Inside 时同样沿父链到 Outside，首节点权重 .5，其余 1，归一化总权重 `节点数−.5`；Brain 链 D=20 时分配 4、8、8。

Outside 裂伤额外目标数 N 来自曲线 `(0,0)、(.6,1)、(.9,2)、(1,3)` 的均匀随机输入，再随机舍入。候选是直接孩子 + parent +（有祖父时的 parent 直接孩子），去掉主目标，随机顺序 Take(N) **之后**才过滤 conceptual 与 coverage<=0；没有先过滤 missing。加回主目标后，每个列表项伤害为 `D×(1+1.4)/(实际列表数+1.4)`。只在原 N=0 时调用外部保留。对 missing 目标，Finalize 自己返回 0；它仍可能消耗裂伤列表份额。

### Blunt

以 .4 概率触发内部事件；触发时转换比例均匀 .1~.2，否则 0。外层初始伤 `D×(1−convert)`；每次写伤后减去 Finalize 返回的 `min(severity,命中前HP)`。仅当前部位已 missing 且剩余 **>1** 时沿 parent 继续。

若内部事件发生，最终外部点为非 solid，则只从该点的直接 Inside solid 子节点按 coverage 抽一个，给予 `D×convert + D×U(.2,.35)`。这条规则主要对应内骨，不是随意抽任意内脏。存活时还存在躯干/意识同分支眩晕曲线与 2 秒 Stun；本轮没有实现眩晕动作系统。

### Bite 与共同边界

Bite 仅覆写选择部位为 Outside，继承 AddInjury 的“外部保留→写伤→CheckDuplicateDamageToOuterParts”，**没有 Cut 裂伤**。通常 Outside 命中只写一处。显式 Inside、允许传播且 harmAllLayersUntilOutside 为真时，base 才沿父链复制外层伤；此低层分支与普通随机咬击区分记录。

Finalize 还有永久伤预处理、殖民者即死保护的最多 7 次试伤调整、最后 Hediff 写入与实际扣伤返回。护甲、碎片/小体型多部位传播、社交打架保护、即死保护、永久瘢痕随机、感染、眩晕、义体、基因等不能因主干公式已完成就视为已经闭合。

## 8. 视力接回劳动统计，但不新增盲人禁工

所选七个 WorkGiverDef：Mine、ConstructFinishFrames、GrowerSow、GrowerHarvest、PlantsCut、DoctorTendToHumanlikes、Research，均只声明 requiredCapacities=Manipulation。调度器在普通与优先工作路径检查 `MissingRequiredCapacity`，操作能力必须 >0；所审计工作路径没有独立 Sight 资格门槛。（AC24–AC25）

| 工作 Stat | Sight weight | Sight 上限 |
|---|---:|---:|
| MiningSpeed | .5 | 1 |
| PlantWorkSpeed | .3 | 1 |
| ConstructionSpeed | .2 | 1 |
| MedicalTendSpeed | .8 | 1.3 |
| MedicalTendQuality | .7 | 1.4 |
| ResearchSpeed | .5 | 1.1 |

容量因子为 `(1−weight)+weight×min(capacity,max)`，不是指数。MedicalTendQuality 的容量因子在后处理曲线之前应用；CookSpeed 用 Sight offset：`4×(min(Sight,1.5)−1)`，连同技能/Manipulation offset 后进入自己的曲线。

所以盲人并非自动不能挖矿、种植或研究；本轮应通过完整 Stat 降速，不凭常识新增 Sight=0 禁工。完整 Stat 仍受特性、装备、材质、全局速度等影响。独立算例的 ConstructionSpeed 固定木材速度倍率 1.7，其余相关全局倍率为 1；这项输入约定避免与裸 Stat 混淆。

## 9. 项目适配与验证边界

项目此次使用完整 64 节点自然身体、11 能力、普通 Cut/Stab/Poke/Blunt/Bite worker、缺失根存储与 fresh 残端护理。生产入口 `applyBodyDamage` 负责普通伤害分配；直接 `applyInjury` 是明确绕过 worker 的插伤接口，用于指定状态与测试，调用方不能把二者互换。世界状态、保存迁移、界面、生产集成及浏览器验证由对应实现与验证包独立证明。

项目 daily time 从 60000 源 tick 映射到 12000 项目 tick，因此 fresh 90000 源 tick 对应 **18000 项目 tick**。能力公式本身无需时间倍率。原先七区伤势迁移到同名自然部位；旧的“损毁七区”归档与缺失根是项目存储决策，不能伪造历史存档中并不存在的器官损伤细节。（AC26）

本包验证结果：**66 条选定 XML 记录、64 个 Human 节点、21 个新类型、27 个复用类型、26 条结论、49 个独立算例、184 项标量断言、21 项证据损坏拒绝、4 项独立公式变更拒绝**。安装侧另核对了本包及复用 XML 的 48 个文件、48 个派生类；新鲜 XML 采集与人体推导数据均与快照一致。

证据 pin 固定审阅后的 JSON 语义快照；XML 采集器与 claims writer 不会自动更新校验 pin。人体校验从保留的 XML 叶字段独立重建前序、父子、默认字段、tags 与 coverage，不只是比较一个文件 hash。公式变更检查覆盖眼权重、HP 中点取整、意识疼痛扣除门槛和单层 Stab 伤量。

```powershell
# 仅静态读取：需要用户自己的同版本安装及匹配的 ILSpy 库。
./scripts/research/extract-anatomy.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld' `
  -DecompilerPath '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'
./scripts/research/verify-anatomy-evidence.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld' `
  -DecompilerPath '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'

# 无原版安装时可验证可移植证据与独立算例。
node scripts/research/verify-anatomy-evidence.mjs
node scripts/research/test-anatomy-verifier.mjs
```

固定 Assembly-CSharp SHA256 为 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`；ILSpy 11.2.0.10050，库 SHA256 为 `587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78`。本章不从历史安装结构推断当前运行时；REA 检查到本程序集元数据为 `.NETCoreApp v10.0`。源码位置仅对记录的派生 hash 有效，后续游戏更新须重新核对。
