# 日常社交、好感记忆与桌边休闲

本轮锁定本机 **RimWorld 1.7.4980 rev60**。普通闲聊、深入交谈、侮辱是即时互动事件；SocialRelax 是独立的持续娱乐任务。两者通过人物位置和当前社交模式相互联系，不应合并为一个长时间“聊天 Job”。

依据：[静态证据](evidence/social-interaction-evidence.json)、[核心提取清单](evidence/social-interaction-manifest.json)、[补充清单](evidence/social-interaction-extra-manifest.json)。程序集 SHA-256 为 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`；ILSpy 11.2.0.10050 派生 C# 保留本地，仅公开带哈希的行号、机制摘要和选定 XML 字段。派生结果不是原始源码，Core XML 也不是所有 DLC/Mod 补丁执行后的 Def 数据库。REA 的 67,108,864 字节成员预算失败沿用既有记录，未重复请求，也未将失败解释为成员不存在。

本轮原版运行见 [98：原版社交观察](98-native-social-runtime.md)。实机新增观察到一次 DeepTalk；下文 Chitchat、Insult、完整寿命与概率属于静态机制证据，不伪装成全部亲历验证。

## 1. 一次普通互动究竟做什么

`Pawn_InteractionsTracker.TryInteractWith` 先检验资格，再给 InteractionDef 指定的发起者/接收者添加记忆，给指定发起者技能经验，考虑社交打架，调用 worker，生成互动气泡，更新双方 `lastInteractionTime/lastInteraction/lastInteractionDef`，最后写入 `PlayLogEntry_Interaction`。三种普通 worker 只提供抽选权重；基类 `Interacted` 只初始化输出参数，不创建长对话任务。（SC01、SC15）

因此，正在工作、行走或娱乐的人可以在允许的时机发生一次互动并继续原来的事情。屏幕气泡是瞬时表现；记忆和日志才保存双方身份及后果。Log 保存 `intDef/initiator/recipient` 等，tracker 保存最近互动与待尝试状态；不能只保留一段无人物 ID 的聊天文案。

## 2. 谁可以发起、谁可以接收

默认近距离条件为**水平距离不超过 6 格且存在视线**，视线调用跳过起点格。`CanInteractNowWith` 要接收者已生成且位置适合；携带对方的特殊分支另算。（SC02）

| 条件 | 随机发起者 | 随机接收者 |
| --- | --- | --- |
| Humanlike、未倒地、非攻击性精神状态 | 要求 | 要求 |
| 清醒、不着火、mutant/互动阻断许可 | 要求 | 要求 |
| interactions tracker、Talking 能力 | 要求 | 接收检查未对称重复 |
| Faction、life-stage 允许、非 Inhumanized | 随机发起额外要求 | 不能自行照搬发起限制 |
| Hearing 非零 | 此处没有硬性要求 | 此处没有硬性要求 |

`IsInteractionBlocked` 涉及精神状态的随机禁令或特定互动白名单；没有精神状态时检查阻断社交的 Hediff 与 Lord。这里有控制流优先级，不应把所有分支机械地同时执行。发起者要能说话，不等于接收者也必须具有完全相同的说话/听力条件；听力还会影响 SocialImpact 数值。

## 3. 调度、模式和抽选

默认模式 Normal，当前 JobDriver 的 DesiredSocialMode 可以替换，duty 和精神状态可设上限。征召把高于 Quiet 的模式压到 Quiet，**原版不把所有征召者直接设为 Off**。（SC03）

| 模式 | 随机尝试 MTB，tick | 其他行为 |
| --- | ---: | --- |
| Off | 不尝试 | 清除 wantsRandomInteract |
| Quiet | 22,000 | 每次 interval 先清除 wantsRandomInteract |
| Normal | 6,600 | 允许保留失败意图 |
| SuperActive | 550 | SocialRelax 的实际休闲 toil 使用此模式 |

最近互动超过 **320 tick** 后，在人物 `hash interval 60` 上执行 `Rand.MTBEventOccurs(MTB, 1, 60)`。抽中但未互动成功可留下 `wantsRandomInteract`，再于 `hash interval 91` 重试。通用发起冷却是 **120 tick**；此方法没有同时检查接收者自己的 120 tick 冷却，但成功仍更新双方最近时间。

候选是地图中同 Faction 已生成人物，打乱顺序后过滤自己、敌对或资格不符者，再按各 InteractionDef worker 权重抽类型。参与抽选的不只本文三种。MTB 不是“每 N tick 必聊一次”，worker 权重也不是每 tick 的固定概率。原版使用全局 `Rand`；若 Web 使用独立社交随机流，应写为可复现性设计选择。

## 4. 类型、权重与 SocialImpact

| 互动 | 抽选相对权重 | 基础社交记忆 | 发起者经验 |
| --- | --- | --- | --- |
| Chitchat | 1；Inhumanized 分支为 0 | 双方各 +0.66 累积闲聊 | Social +4 |
| DeepTalk | `0.075 × C(compatibility)` | 双方各 +15 | Social +10 |
| Insult | `0.007 × negativeFactor` | 接收者 -15，另派生心情记忆 | 本条未配置 |

DeepTalk 的 `C` 折线点为 `(-1.5,0),(-0.5,0.1),(0.5,1),(1,1.8),(2,3)`。Insult 的 negativeFactor 为发起者对接收者的意见曲线乘双方 compatibility 曲线；Kind 发起者为 0，Abrasive 额外乘 2.3，奴隶对非奴隶的 Insult 权重为 0。（SC04）

| 曲线 | `(输入, 系数)` |
| --- | --- |
| 负面互动 Opinion | `(-100,6),(-50,4),(-25,2),(0,1),(50,0.1),(100,0)` |
| 负面互动 Compatibility | `(-2.5,4),(-1.5,3),(-0.5,2),(0.5,1),(1,0.75),(2,0.5),(3,0.4)` |

这里没有按当前 mood 的曲线。Insult 的 `socialFightBaseChance=0.04` 只是一项基础值；社交打架还要经过可行性和好感、能力、traits 等因素，不能写成无条件固定 4% 打架。（SC16）

`AddInteractionThought(A,B,thought)` 使用**对方 B 的 SocialImpact**，给新记忆的 moodPowerFactor 和 social opinionOffset 赋当时缩放值，再尝试入库。故同一次 DeepTalk，A 对 B 与 B 对 A 的实际偏移可以不同，而且以后技能变化不应重算旧记忆。（SC05、SC06）

Core 的 SocialImpact 基值 1，最小值 0.2；Social 技能系数 `0.82 + 0.0275 × L`。Talking/Hearing 的权重分别 0.9/0.3，allowedDefect 都是 0.05、max 都是 1。将容量 c 转成 q：c<1 时 `clamp01(c/0.95)`，否则最多 1；两项分别乘 `0.1+0.9qTalking`、`0.7+0.3qHearing`。健康、无其他修饰时，L=0/10/20 对应 0.82/1.095/1.37。装备、traits、Hediff 和其他 Stat 链仍可修改最终值。

## 5. 三种记忆不能使用同一过期算法

### 闲聊：每个有向人物对一条累积记忆

Chitchat 使用 `Thought_MemorySocialCumulative`，同 def、同 otherPawn 的新偏移加进既有记录；**不重置旧 age**。内部累计可超过 10，只有计算贡献时取 `min(offset,10)`。每累计 60,000 tick，偏移向 0 移动 1，再把 age 归 0；恰好 0 才丢弃。它覆盖普通 duration 过期，不使用“最后 30% 线性淡出”。例如内部有 12，第一天衰减成 11，贡献仍为 10。（SC07）

### 深入交谈/侮辱：独立记录、最后六天淡出

DeepTalk 和 Insulted 的持续时间均为 **20 日=1,200,000 tick**，同 otherPawn 最多 10 条，同 def 总计最多 300 条，叠加系数 0.9。普通 social memory 不自动合并，超过上限先删除组内最旧，再处理同 def 总上限。默认 `lerpOpinionToZeroAfterDurationPct=0.7`，所以前 14 日保持完整贡献，最后 6 日线性淡到 0；普通 ShouldDiscard 使用 `age > duration`，age==终点时贡献已是 0。（SC08、SC09）

记忆按 150 tick interval 增龄，不同人物的采样相位可以不同。计算一个有向 def 组时，先去掉贡献为 0 的条目，按 age 从小到大排序：

`groupFloat = newestContribution + olderContribution×0.9 + next×0.9² + …`

每组单独 RoundToInt；非零正/负组结果至少 +1/-1，然后汇总各组。并非先把所有浮点记忆相加后只 round 一次。完整意见还包括关系与情境思想、Hediff 对他人意见系数；敌对关系正值清零，最后钳制 [-100,100]。

### 被侮辱的心情是另一条记忆

Insulted 的 `thoughtToMake=InsultedMood` 通过新的 `TryGainMemory(def,other)` 生成，**没有继承原 social memory 的 SocialImpact moodPowerFactor**。它是基础 mood -5、2 日、最多 10、叠加 0.9。普通 Thought_Memory 在 other 不同时允许格式化标签相同的记忆分组；本条固定 label 为 insulted，因此不同侮辱者共享心情组。组满后基类 Renew 最旧记录 age，而不是创建第 11 条。（SC10）

## 6. Compatibility 与好感是不同变量

Compatibility 由生理年龄差和固定人物对随机项构成：年龄差 0..20 映射为 +0.45..-0.45，再加以 `(idA XOR idB)×37` 为 seed 的 asymmetric Gaussian(0.3,1,1.4)。PushState/PopState 保留外围 RNG。自己或不同 pawn def 的特殊分支返回 0。（SC11）

这是稳定的人物对倾向，不是当前好感；不能把 Opinion 直接代入 DeepTalk 的 compatibility 曲线。没有年龄/traits 等模型时，Web 可明确暂取 0，但这属于产品范围决定。

## 7. SocialRelax：设施、座位、持续任务

CompGatherSpot 新建 `active=true`；保存字段的缺省值为 false，非玩家的新生成物会停用。普通 Gather spot 开关负责向地图 activeSpots 注册/注销；despawn 注销。TableGatherSpotBase 增加这一 comp，普通餐桌据此可以成为聚集点。（SC12）

JoyGiver 从 activeSpots 随机尝试，过滤 forbidden、fog、Touch/Danger.None 不可达、社会/政治不合规、真空危险以及聚会范围不符等。选中 Eat surface 时，要找桌边四邻的可坐家具（最多随机尝试 30 次），找不到就不给本次任务，**没有桌旁地坐兜底**。非 Eat 聚集物才会在 3.9 格附近找椅，随后尝试合规地面位置。这里不要求已有同伴。（SC13）

可选饮料要满足可 nursing 的娱乐药物、非禁酒、policy/意识许可、可预约等；没有酒仍可休闲。任务 targetA=聚集物，targetB=椅/地格，预预约转换成实际坐席。人物真实走到该格，然后朝向聚集物、逐 tick 获得 comfort 和 Social joy；休闲 toil 才是 SuperActive。JobDef joyDuration=4000，JoyGiver baseChance=4 是相对候选权重，娱乐满足可提前结束，finish 时尝试娱乐室记忆。（SC14）

所以单人坐桌边可以涨娱乐，即使没有任何一次普通聊天成功；路过的人也可能与他互动。临近的人不自动占据同一把椅，不能用全局“桌子数量”直接为所有人提供休闲增益。座位选择/预约与吃饭的联系见 [94：用餐与舒适度](94-dining-comfort-mechanisms.md)。

## 8. 复刻实现边界与复核

至少分开保存：有向意见记忆、瞬时互动事件、最近互动/重试调度状态、持续 SocialRelax Job 与具体坐席。UI 可同时表现“正在桌边休闲”和一条双方互动气泡，并能查看意见来源与事件日志。没有原版依据时，不加持续 conversation Job，不把每次闲聊存成无限增长独立行。

本轮不校准随机发生频率，不复刻爱情、关系全树、社交打架细节、精神状态所有分支、所有 InteractionDef 或 DLC 扩展。若 Web 排除征召/某些工作、用独立 RNG、简化 LOS 或固定 compatibility，需在实现报告标为 Web 假设。

复核脚本：[静态采集](../../../scripts/research/collect-social-interaction-evidence.ps1)、[运行采集](../../../scripts/research/collect-native-social-runtime.ps1)、[校验器](../../../scripts/research/verify-social-interaction-evidence.mjs)。portable 模式检查公开记录一致性，`--local` 额外校验原始文件哈希和 XML 投影；两者都不重放游戏、不证明全部概率与分支已覆盖。
