# 动物医疗：倒地、救助、治疗、喂食与持续恢复

本轮先明确可玩的医疗闭环：伤口影响行动 → 动物倒地 → 找到合适的动物床 → 搬运同一个动物 → 处理伤口 → 运送并消耗食物 → 随时间恢复行动。药效、耗时和伤害数值作为独立参数保留，暂不把精确平衡作为机制完成的前提。

这是原版静态研究与 Web 设计约束，不是本轮产品功能或自动化测试已经通过的声明。Web 交付情况由相应验证文档与报告记录。

## 证据与复查

- 本地安装：`F:/SteamLibrary/steamapps/common/RimWorld`，版本 `1.7.4980 rev60`。
- 程序集 SHA-256：`eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。
- REA 精确身份：[production-bills-rea-managed.json](evidence/production-bills-rea-managed.json)，证据 ID `ev_41acdc3a1d6904fb12e36eeaac20397afac130d300dafc70973a154cd3fbfd84`。这里只复用程序集身份，不把元数据解析称为反编译。
- ILSpy `11.2.0.10050` 独立重建 **59 个类型**。引擎 SHA-256：`587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78`。只加载反编译器，读取目标元数据/CIL；不加载、执行游戏程序集。允许未解析依赖，相关限制写入 manifest。
- [animal-medical-manifest.json](evidence/animal-medical-manifest.json) 记录类型、文件和哈希；[animal-medical-mechanisms.json](evidence/animal-medical-mechanisms.json) 收录 **95 个代码锚点、13 个限定范围核对、31 个 XML 投影、4 棵身体树与 23 个身体部位定义**。
- 完整派生 C# 只在被忽略的 `.local-research/animal-medical/`；公开产物不含完整原版代码、程序集或美术素材。
- 全程静态，没有启动原版、浏览器、预览、GUI 输入或截图。Core XML 没有合并运行时 DLC/MOD patch；派生代码不是原作者源码或运行时证明。

```powershell
pwsh -NoProfile -File scripts/research/extract-animal-medical.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-animal-medical-evidence.ps1 -Check
```

`extract -Check` 重新反编译并比对现有类型及 manifest；`collect -Check` 复核身份、来源哈希、字面锚点、方法边界与 XML 投影。新环境先运行不带 `-Check` 的提取命令生成本地副本。检查旧产物与重新接受新产物必须分开，不能靠覆盖旧报告宣称验证成功。

## 先搭建的机制合同

| 环节 | 必须成立的规则 | 可后调的参数 |
|---|---|---|
| 受伤 | 伤口属于具体动物和身体部位；疼痛、失血、移动能力可以分别变化 | 伤害、疼痛系数、恢复速度 |
| 倒地 | 倒地仍是活体；停止普通移动、生产/处理任务并暴露照护需求 | 简化阈值与失能程度 |
| 救助 | 校验目标、床位、路径、工作能力和预约；先走过去再搬运 | 选床距离与工作优先级 |
| 搬运 | 动物位置跟随搬运者，保持原 ID；中断有实际落点 | 移速惩罚 |
| 治疗 | 预约并获取真实药品，接触患者，完成工作后扣药并标记处理状态 | 耗时、药品批量、质量 |
| 喂食 | 获取符合动物食性的真实食物，送达后消耗并恢复营养 | 每次营养与喂食时长 |
| 恢复 | 包扎与愈合分开；持续恢复后解除倒地，而非完成治疗就复活 | 各阶段恢复倍率 |
| 身份 | 救助不隐式驯服/购买；年龄、性别、孕育、产蛋与伤口仍在原个体上 | 暂无须数值化 |
| 存读档 | 床位、搬运/患者引用、护理策略与伤口状态可重建；取消任务释放预约 | 不属于平衡参数 |

Web 可以先选零成本、单格、专用于医疗的动物睡眠点来减少建造前置条件。它是原版动物睡眠点与医疗模式的组合；原版动物睡眠点本身也可用于普通睡眠，并非一律默认医疗。

## 动物床、床位与身体尺寸

`AnimalSleepingSpot` 是 `Building_Bed`：1×1、可站立、不用普通建筑 HP、建造工作为 0、没有材料成本，`bed_humanlike=false`。`AnimalSleepingBox` 和 `AnimalBed` 继承 `AnimalBedFurnitureBase`，该父定义增加 `bed_healPerDay=4`。

| 设施 | 体型上限 | 材料与工作参考 | 机制差别 |
|---|---:|---|---|
| 动物睡眠点 | 默认 9999 | 无材料，0 工作 | 地面床位，无家具治疗加成 |
| 动物睡眠箱 | 0.55 | 25 材料，180 工作 | 小型动物或符合尺寸的幼体使用 |
| 动物床 | 默认 9999 | 40 布料/皮革，400 工作 | 大型动物也可使用，具家具恢复加成 |

`RestUtility.CanUseBedEver` 用**当前** `Pawn.BodySize` 检查上限，并要求动物/人类床类型相符；不是只比较成年体型。年龄增长可能令原来可用的箱子不再适用。床位的预约、占用、火焰、可达性、派系与医疗许可在后续方法另行检查。

`FindBedFor` 在有医疗休息需求时先找医疗床，随后仍保留个人床和普通床回退。因此原版救助不要求“必须已勾选医疗”；但必须是目标能用、可到达并可预约的床。普通床通过 `ClaimBedIfNonMedical` 产生个人床分配；医疗床不产生该永久分配。`Building_Bed.Medical` 模式变化会清除原有床主。

## 谁会救、谁会治、谁会喂

`WorkGivers.xml` 把动物治疗归于 **Doctor**。动物照料工作 **Handling** 不能替代医疗技能与医生资格。

| 工作定义 | 工作类型 | 类型内优先级参考 | 说明 |
|---|---|---:|---|
| `DoctorRescue` | Doctor | 60 | 自动救助同派系倒地者；手动菜单另一路径 |
| `DoctorTendToAnimals` | Doctor | 50 | `WorkGiver_TendOther_Animal`，使用 Medicine 技能 |
| `DoctorFeedAnimals` | Doctor | 40 | 给有医疗需要的动物患者送食物 |
| `HandlingFeedPatientAnimals` | Handling | 150 | 继承同一喂食定义，`FeedPatientAnimals` 等价组 |
| `DoBillsMedicalAnimalOperation` | Doctor | 30 | 动物手术另属配方/手术系统，本轮不展开 |

两种职业都能喂同一个患者，不应因此各扣一次食物或绕过患者预约。Web 若让 `care` 与 `handle` 都参与救助，是工作分类适配；不要据此写成原版的自动救助属于 Handling。

| 入口 | 患者与关键前提 | 床要求 | 派系结果 |
|---|---|---|---|
| 自动救助 | 同派系、倒地、未在床、未安排屠宰、可预约到达、附近无敌人等 | 找到适用床 | 救助本身不换派系 |
| 手动救助 | `forced:true` 可跨派系；倒地、非敌对；NoCare 可禁用；可达预约 | 找不到动物床会反馈原因 | 野生/友好商队动物不会仅因搬到床上就入殖民地 |
| 自动治疗 | 有 `playerSettings`、护理允许、有需处理伤病；动物非 Standing；可预约 | 动物可躺在地上，人类通常需在床 | 通常不换派系；见独立 Bond 例外 |
| 征召现场治疗 | Doctor 未被禁用、有伤病、可接触，按征召治疗规则校验 | 无动物床要求 | 与救助、驯服分开 |
| 患者喂食 | 饥饿、有医疗休息需求、动物躺卧、非屠宰目标、食物可用 | **玩家派系的床** | 不要求患者本身属于玩家 |

手动救助仍不能无条件绕过所有检查：`WantsToBeRescued` 会排除已在床、正由组建商队接走、特定精神状态或屠宰目标等情况。自动路径对敌人距离使用 `HealthAIUtility` 的有效值 25；`WorkGiver_RescueDowned` 中另一个未用常量不能代替实际调用路径。

征召现场治疗的 `IsValidTendTarget` 先接受倒地目标，再检查未倒地目标的敌对关系；这与手动救助对敌对派系的排除不同。菜单还检查医生能力、伤病、路径与激怒状态，初始药品搜索只用医生库存，也可以选择不用药。不能把这一路径概括为自动护理的同一权限判断。

动物思考树的医疗入床节点分别处于玩家派系分支，以及非玩家非敌对派系分支；后者随后有离图行为。不能仅因存在 `JobGiver_PatientGoToBed`，就推断任何野生动物会主动跑进玩家病床。任务优先级、床资格和已有 Lord duty 仍影响实际行为。

## 搬运必须保留真实个体

`JobDriver_TakeToBed` 预约患者和目标床，前往患者身边，执行 `StartCarryThing`，再走到床边。前往床的阶段持续确认携带的是同一 `Takee`；目标不再倒地、床不可用、路径中断、目标消失等都可能导致任务失败。

任务结束清理会在搬运者当前位置放下携带物。完成放床前，如果患者没有 `Pawn_PlayerSettings`，会在**同一个 Pawn** 上创建设置，其构造函数初始化按派系区分的护理默认值。正常入床、喂食与起身方法没有生成新动物的路径；动物的健康、年龄和繁殖组件应继续归属于原个体。

“保留身份”不代表所有控制关系原样保留：床主、预约、当前任务、路径和商队行动组都可能调整。应分别记录动物 ID、派系、商队来源、床位、搬运者和护理状态，避免把救助实现成删除野生对象后生成殖民地对象。

## 治疗、药品与恢复是三个阶段

`WorkGiver_Tend` 先找药，有药时安排携带药品的治疗任务，没有药仍可安排 `TendPatient`。`JobDriver_TendPatient` 预约实际患者/药品，搬取药品并抵达患者，按 `600 / MedicalTendSpeed` 原版 ticks 做治疗工作，随后 `Toils_Tend.FinalizeTend` 给予 Medicine 经验并调用 `TendUtility.DoTend`。

`DoTend` 给选中伤病执行 `Tended(quality, maxQuality, index)`，并消耗一个药品单位。它没有直接调用伤口 `Heal`。普通伤口已处理后，其 `BleedRate` 路径返回 0；这不等于已经补回组织损伤或清空全身失血状态。

| 护理策略 | 含义 |
|---|---|
| NoCare | 不提供自动医疗；救助菜单也可能禁用 |
| NoMeds | 允许处理伤病，不消耗药物 |
| HerbalOrWorse | 允许药效不高于草药的药品 |
| NormalOrWorse | 允许药效不高于工业药的药品 |
| Best | 允许所有药品等级 |

`PlaySettings` 的新局野生动物、驯养动物、友好与中立派系护理默认都为 `HerbalOrWorse`，但玩家可以修改默认与个体设置。不能从 `Pawn_PlayerSettings.medCare` 字段初值 `NoMeds` 推断完整构造后的默认政策；构造函数会调用 `Notify_FactionChanged → ResetMedicalCare`。

处理质量由医生质量、药效、床治疗质量偏移和上限共同决定。无药参考药效 0.3、上限 0.7；草药 0.6/0.7、工业药 1.0/1.0、先进药 1.6/1.3。药物处理可把多个普通伤口打包到一轮内（总伤势参考上限 20）；无药通常只处理首个普通伤口，定义了 `tendAllAtOnce` 的病症另有同种批量规则。因此“一伤口恒等于一药品”也不准确。

自然恢复在 `Pawn_HealthTracker.HealthTickInterval` 中进行。对普通有机体，参考每 600 原版 ticks 更新，饥饿到 `Starving` 时不进入这里的普通恢复分支。自然恢复基础 8、躺卧加 4、家具床再加其 `bed_healPerDay`；选一条可自然恢复伤口，乘以 `HealthScale` 与 `InjuryHealingFactor`。已包扎伤口另有恢复分支，质量把基础倍率映射到 0.5–1.5。这里只描述该普通分支，不涵盖超常再生等 DLC 特例。

伤口变化重新触发状态检查，满足“不再应倒地”后才 `MakeUndowned`，恢复 Mobile 并重新判断任务；不要求所有伤口完全消失。原版 tick 数是参考时间单位，不应未经换算直接当作 Web 的逻辑帧数。

## 喂食不是直接增加一格需求

`FeedPatientUtility` 对动物检查当前床属于玩家、躺卧、有医疗休息需求、没有屠宰安排，并满足饥饿条件。患者可以是仍属野生或其他友好派系的动物；这让救助与照护不必绑定驯服。

`WorkGiver_FeedPatient` 用患者食性与食物政策找食物，遵守禁用和预约，不在这项任务里现场收割。`JobDriver_FoodFeedPatient` 从地面/库存/供餐设施获取实际食物，搬到患者旁边，执行喂食工作，再通过 `FinalizeIngest` 结算。

Web 应保留“食物来源 → 运送 → 接触 → 实际消耗”的过程，并在途中处理食物被拿走、患者死亡或床消失等失败情况。不能每次扫描患者时凭空加营养，也不能将正常牧草觅食和卧床患者喂食混成同一任务。

## 身体、疼痛、倒地与死亡

原版动物使用身体树，不使用建筑式单一 HP。`BodySize` 和 `HealthScale` 是两个不同量：

```text
当前体型 = 种族 baseBodySize × 生命周期 bodySizeFactor
当前生命尺度 = 种族 baseHealthScale × 生命周期 healthScaleFactor
身体部位最大 HP = ceil(BodyPartDef.hitPoints × 当前生命尺度)
```

| 现有物种 | 原版 BodyDef | 成年体型 | 成年生命尺度 | 身体树节点 |
|---|---|---:|---:|---:|
| Hare 兔 | QuadrupedAnimalWithPawsAndTail | 0.2 | 0.4 | 28 |
| Deer 鹿 | QuadrupedAnimalWithHooves | 1.2 | 0.9 | 27 |
| Alpaca 羊驼 | QuadrupedAnimalWithHooves | 1.0 | 1.0 | 27 |
| Dromedary 单峰驼 | QuadrupedAnimalWithHoovesAndHump | 2.1 | 1.6 | 28 |
| Chicken 鸡 | Bird | 0.3 | 0.35 | 21 |

四足动物有 4 条 Leg，兔用 Paw，鹿/羊驼/单峰驼用 Hoof，单峰驼额外有 Hump。鸡是 2 条 Leg、2 个 Foot、Beak、HeadWithEarHoles、尾巴及内脏；本版 `Bird` 身体定义没有独立 Wing 节点。不要套用人类左右臂、手，也不要凭外观推测原版一定有翼部位。

派生投影保留每个部位的树路径、局部 coverage、height/depth 与名称，以及所用 23 个 BodyPartDef。coverage 相对父节点，不是所有节点加总为 100%。Body 基础 HP 40、Leg 30、Brain 10；例如成年鸡分别是 14、11、4，而非一个统一的“鸡最大血量”。Web 如先用物种专属四肢加整体健康条，应明确是紧凑模型。

生命周期参考：普通幼体体型 0.2/生命尺度 0.25；鸡的 `AnimalBabyTiny` 体型 0.1 并继承幼体生命尺度 0.25；亚成年 0.5/0.6；成年默认都是 1。阶段切换不能重建个体并丢失伤口或妊娠。

原版倒地规则包括疼痛休克、无法保持清醒、Moving 不再 capable，或固定倒地生命周期。`PainShockThreshold` 默认 0.8；清醒要求 Consciousness 至少 0.3；Moving 的 `minForCapable=0.15` 且比较为严格大于。伤口疼痛受伤势、伤害定义和 `HealthScale` 影响，还有其他状态修正。**剩余健康低于 20% 并不是这些规则的等价实现。**

死亡另行检查：致命伤病、必需生理能力丧失、核心部位效率耗尽，以及伤势总量超过 `150 × HealthScale`。符合外来暴力等条件的非玩家、非玩家 Host 动物，在新倒地时还有默认 0.5 的死亡判定并存在覆盖路径。Web 先省略随机倒地死亡以保证救助玩法可观察，属于明确设计取舍。

## 所有权与商队边界

原版救助流程本身不把动物 `SetFaction(player)`。唯一需要单独说明的治疗例外是：人类医生为可更换主人的动物治疗时，尝试产生 Bond，基础机会 0.004；若产生 Bond 且双方派系不同，才通过 `DoRecruit → RecruitUtility.Recruit → SetFaction` 招募。

这个概率不是任意动物每次救助都有 0.4%：`RelationsUtility.TryDevelopBondRelation` 要求有效 trainability 至少 Intermediate，还有现有 Bond、性格、文化等门槛与倍率。现有 5 个物种的 Core 种族定义或父定义都为 None，普通状态不会进入此 Bond 结果。Odyssey 的 SentienceCatalyst 可以改变有效可训练性；运行时 MOD 也可能改定义，所以不能把结论写成“任何条件下这五种永不招募”。

商队还要分清**派系归属**和 **Lord 行动组**。`MakeDowned` 会先通知 `Notify_PawnLost(Incapped)`；`Lord` 按 `LordJob.ShouldRemovePawn` 决定移除。标准 `LordJob_TradeWithColony` 没有覆盖该方法，继承基类的 true，因此倒地动物会退出该商队 Lord，派系依然保留。单独的 `Pawn.DeSpawn` 方法没有直接更换派系或发该移除通知；不能把倒地与搬运离开地图容器混为一谈。

Web 为延续活畜交易、商队离开与照护交接，可以保留 `merchantId` 作为原商队关联，再规定恢复后离开或重返商队。这是 Web 的连续性约定，不是声称原版保留了同一个 Lord 成员资格。原版更完整的商队重聚、退出与多种 Lord 特例不在本轮证明范围。

## Web 初版边界与后续扩展

本轮建议先固定以下行为：Doctor 治疗；照护/动物工作按项目规则救助喂食；专用动物医疗睡眠点；五种动物不同的肢体模型；真实搬运、药品与食物消耗；疼痛/倒地/卧床/恢复；维持野生、殖民和商队身份；取消、死亡、拆床、断路和保存恢复都有清理规则。

完整器官树、感染/免疫疾病、手术、永久残疾、Bond 招募、随机倒地死亡、原版完整 Lord 状态机可后续展开。体型生命倍率、处理耗时、质量、恢复与食物消耗集中为可调整参数。验收首先看玩家是否能看懂原因并完成照护链，再看精确数值是否接近原版。

建议本地验收覆盖：殖民动物自动救助；野生/商队动物手动救助且身份不变；无床/满床/不可达反馈；两医生争抢目标；无药处理与有药扣减；无食物与禁用食物；搬运中断/读档；卧床患者死亡；床被拆除；伤愈后释放床位并恢复合法任务。这里是验收需求，不代表这些用例已在原版或 Web 运行通过。
