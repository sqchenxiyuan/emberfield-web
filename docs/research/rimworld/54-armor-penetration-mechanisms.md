# 54｜护甲、穿透、部位覆盖与钢制防具

本章固定本机 RimWorld **1.7.4980 rev60**，从 Core XML 与程序集静态派生结果建立护甲规则。它补充[人体与能力机制](51-anatomy-capacity-mechanisms.md)、[衣物与裁缝机制](36-apparel-tailoring-mechanisms.md)和[武器机制](42-weapons-crafting-equipment-mechanisms.md)。派生代码不是原始源码，独立算例不启动原版，也不导入项目实现。

证据入口：[结论 AR01–AR18](evidence/armor-claims.json)、[35 个算例](evidence/armor-cases.json)、[58 条直接 XML 记录](evidence/armor-xml.json)、[8 件服装的解析数据](evidence/armor-data.json)、[新增类型](evidence/armor-types.json)、[派生文件清单](evidence/armor-manifest.json)、[验证报告](evidence/armor-validation.json)。完整派生代码保存在忽略目录 `.local-research/`。

## 1. 一次伤害的处理顺序

普通物理伤害先由原始 `DamageWorker_AddInjury` 确定准确部位。Stab/Poke 可以在这一步强制转到内部节点；然后才针对这个节点执行护甲。（AR05、AR17）

```text
原始伤害 worker 选择命中部位
→ ArmorUtility：覆盖该部位的外层衣物 → 内层衣物 → 自然护甲
→ 将护甲处理后的 DamageDef、伤害量写回 DamageInfo
→ 符合条件时应用 IncomingDamageFactor
→ 仍由原始 worker 处理切割邻接、刺伤父链或钝伤溢出
→ 为各目标节点生成伤口，更新缺失部位和身体能力
```

`InstantPermanent` 或 `IgnoreArmor` 绕过 ArmorUtility；伤害没有 `armorCategory` 时，ArmorUtility 直接返回，也不磨损衣物。外部护盾、伤害组件、火焰完整行为和爆炸链不在本章模型范围。

护甲可能把 `DamageInfo.Def` 从 Cut/Stab/Bullet 改为 Blunt，但**不会替换已经执行中的 worker 对象**。因此，原 Cut worker 的扩散规则和原 Stab worker 的父链规则仍继续使用，伤口类型映射则读取新的 DamageDef。Cut、Stab、Blunt 生成的次级节点伤通过 Finalize 写入，不会每扩散一个节点就重新过一次护甲。

## 2. 单层护甲是三分支随机检定

设护甲值为 A、穿透为 P、入层伤害为 D：

```text
E = max(A − P, 0)
r = Rand.Value；浮点结果可以包含 0 和 1

r < E/2       → 全挡，伤害 0
否则 r < E    → RoundRandom(D/2)
否则          → 保留 D
```

比较符是严格 `<`。护甲 Stat 最终范围是 0–2；界面中的 100% 护甲对应数值 1，并不意味着完全免伤。下面采用连续均匀 roll 的理想概率模型，忽略原版有限浮点取值和端点质量，不能当作原版逐位概率分布。（AR04）

| A | P | 全挡概率 | 减半概率 | 全伤概率 | 平均剩余伤害比例 |
|---:|---:|---:|---:|---:|---:|
| 90% | 10% | 40% | 40% | 20% | 40% |
| 20% | 50% | 0% | 0% | 100% | 100% |
| 100% | 0% | 50% | 50% | 0% | 25% |
| 150% | 0% | 75% | 25% | 0% | 12.5% |
| 200% | 0% | 100% | 0% | 0% | 0% |

原版 `Rand.Value` 实际计算 `(float)((signedHash + 2147483648.0) / 4294967295.0)`，能得到 1。**roll=1 时，E=1 走全伤，E=2 走半伤**，因此源码不能替换为“E≥2 直接全挡”。AV33 独立复算 Int32 到 float 的边界，AV34–AV35 检查这两个端点；这些都没有执行游戏 RNG。项目现有随机源若明确采用 `[0,1)`，应记录为随机源适配，不宣称原版同种子重放。

`RoundRandom(x)` 先取整数部分，再以小数部分为概率加 1：2.5 可以变 2 或 3，0.25 可以变 0 或 1。半伤不是固定向下取整，也不是 `Math.round`。1 点伤走半伤分支仍可能归零；上层调用方见伤害 `< .001` 会返回零，即使层内实际走的是 half 分支。

各层分别检定，不能把多件护甲加起来做一次 roll。代码调用 Rand 的次数还受衣物扣血、半伤舍入等影响；本包显式提供各次 roll，**不声称重放原版同一个随机种子**。

## 3. 锐器转钝器后，后续层仍读取最初的护甲 Stat

`GetPostArmorDamage` 在入口只缓存一次 `damageDef.armorCategory.armorRatingStat`。某层对 Sharp 伤害减半后，当前 DamageDef 变 Blunt，后续衣物和自然护甲仍读取最初的 Sharp 护甲，穿透也保持不变。（AR05）

独立算例 AV04 取入伤 12、穿透 .1：

| 层 | 使用的护甲 | roll | 入层伤 | 衣物掉 HP | 结果 |
|---|---:|---:|---:|---:|---|
| 外层 | Sharp .9 | .6 | 12 | 3 | 半伤为 6，DamageDef 改 Blunt |
| 内层 | Sharp .6 | .4 | 6 | 1，舍入 roll=.9 | 半伤为 3，仍为 Blunt |
| 自然 | Sharp 0 | .9 | 3 | 无 | 保留 3 |

该例刻意将内层 Blunt 护甲设为 0：若错误地重新选成 Blunt Stat，结果会变为 6，从而被独立验证器拒绝。原始 worker 在整个例子中仍标记为 Cut。

## 4. 挡住攻击也会磨损，最后一点耐久仍可完成本层防护

每个覆盖层的顺序是：先读取该衣物护甲值，进入 ApplyArmor 后先对衣物施加 `RoundRandom(D × .25)`，再做护甲 roll。（AR06）

普通所选衣物及其完整父链没有 `damageMultipliers`。通用非 Pawn 扣血路径对普通衣物不额外套建筑、植物或尸体倍率；实际掉血封顶为剩余 HP。代码仍允许其他 Def、组件或特殊伤害 worker 改变物品损害，这不能推广为所有 Mod 物品的统一规则。

- 全挡也会磨损当前层。
- 外层已挡住时，没有到达的内层不磨损。
- 外层减半后，内层按新的入层伤害计算四分之一损耗。
- 当前层被打坏也会完成这次防护，因为护甲值已经在扣血前读取。
- 自然护甲没有对应衣物实体，不扣装备 HP。

例如 12 点入伤打在仅剩 1 HP 的护甲上，衣物实际扣 1 HP 并销毁，但其已经读取的护甲仍可以全挡本次攻击。销毁后后续攻击不能继续使用该实体。

## 5. 材料、品质与耐久的数值关系

所审 ArmorRating 子 Stat 继承 `ArmorRatingBase`。其 Stuff part 的 priority=100，Quality part 默认 priority=0；`StatDef.PostLoad` 按 priority 降序稳定排序，因此先加材料贡献，再乘品质。（AR07–AR09）

```text
Armor(category) = clamp(
  (baseArmor + stuffArmorPower(category) × StuffEffectMultiplierArmor)
  × qualityFactor,
  0, 2
)
```

此式针对所审物品，未纳入场景或其他额外 Stat 修正。

| 品质 | Awful | Poor | Normal | Good | Excellent | Masterwork | Legendary |
|---|---:|---:|---:|---:|---:|---:|---:|
| 护甲倍率 | .60 | .80 | 1 | 1.15 | 1.30 | 1.45 | 1.80 |
| 近战武器伤害倍率 | .80 | .90 | 1 | 1.10 | 1.20 | 1.45 | 1.65 |
| 远程武器穿透倍率 | .90 | 1 | 1 | 1 | 1 | 1.25 | 1.50 |

三行不是一套通用品质倍率。保温还使用它自己的[品质表](36-apparel-tailoring-mechanisms.md)。

| 材料 power | Sharp | Blunt | Heat |
|---|---:|---:|---:|
| Steel | .90 | .45 | .60 |
| Cloth | .36 | 0 | .18 |
| WoodLog | .54 | .54 | .40 |

| Normal 成品 | Armor multiplier | Sharp | Blunt | Heat |
|---|---:|---:|---:|---:|
| 钢 SimpleHelmet | .5 | 45% | 22.5% | 30% |
| 钢 PlateArmor | .9 | 81% | 40.5% | 54% |
| 布 Duster | .3 | 10.8% | 0% | 5.4% |
| 布 Parka、Pants、BasicShirt、CollarShirt、Tuque | .2 | 7.2% | 0% | 3.6% |
| 木 PlateArmor，静态参考 | .9 | 48.6% | 48.6% | 36% |

所审护甲链没有 HitPoints part，所以 **100%、50% 或 1% 剩余耐久时，仍存在且穿着的同一件衣物提供相同护甲数值**。所选钢制品的 MaxHitPoints Stat 没有 Quality part，CompQuality 也没有改写通用 Stat factor/offset；简单钢盔 HP 上限始终 100，钢板甲始终 290。不可把护甲品质倍率乘进 HP，也不可把 HP 比例乘进护甲。

自然 Human 的 Human 与 BasePawn statBases 均未声明三种 ArmorRating，ArmorRatingBase 默认 0，因此无其他修正的天然 Human 三项自然护甲都是 0。这不适用于动物、机械体、特殊 Hediff、基因或 Mod。

## 6. 覆盖、层次与共穿

`CoversBodyPart` 只看节点自己的 groups 与衣物 bodyPartGroups 是否相交；groups 不自动从父节点继承。Inside 节点也可以有对应 group，因此会受到护甲保护。（AR02、AR03、AR16）

| 衣物 | 占用层 | 最后层 drawOrder | 完整 Human 覆盖节点数 |
|---|---|---:|---:|
| BasicShirt | OnSkin | 0 | 16 |
| CollarShirt | OnSkin | 0 | 23 |
| Pants | OnSkin | 0 | 6 |
| Parka | Shell | 200 | 23 |
| Duster | Shell | 200 | 29 |
| PlateArmor | Middle + Shell | 200 | 29 |
| Tuque、SimpleHelmet | Overhead | 400 | 各 5 |

Middle 的 drawOrder=100。WornApparel 按最后层 drawOrder 升序存放，护甲从尾部逆序读取；没有覆盖命中节点的衣物被跳过。板甲虽然占两个层，仍是一个物品，只做一次护甲检定。同 drawOrder 的其他排序细节不由本包承诺。

SimpleHelmet 的 UpperHead 恰好覆盖 **Head、Skull、Brain、左右 Ear**，不覆盖 Eye、Nose、Jaw 或 Neck。不能简单把“头盔”实现为保护所有头部子树。

PlateArmor 的 Torso、Neck、Shoulders、Arms、Legs 覆盖躯干与对应内部器官/骨骼、颈部、肩臂和腿部，共 29 节点，**不覆盖 Head、Hand/Finger、Foot/Toe**。Duster 同样含 Legs；Parka 不含 Legs。此次静态核对因此也补齐了项目风衣腿部覆盖的依据。

共穿先检查有无共同 apparel layer。没有共同层即可共穿；有共同层时，通过实际身体节点构造 interfering groups 再双向检查。对于本章所选衣物，可等价表达为“共同层且覆盖节点有交集则冲突”，不能仅比较 group 名称是否相同。

- PlateArmor 与 Duster/Parka 冲突，与 OnSkin 的衣裤兼容。
- SimpleHelmet 与 Tuque 冲突，与 PlateArmor 兼容。
- BasicShirt 与 Pants 虽同属 OnSkin，但覆盖节点不重合，能够共穿。

## 7. 穿透来自具体攻击，不能从任意 DamageInfo.amount 猜测

近战 Tool 的 `armorPenetration` 默认 −1。对选中的具体攻击：（AR10、AR11）

```text
未指定穿透：AP = AdjustedMeleeDamageAmount × .015
指定 AP >= 0 且有装备：AP = 显式值 × 装备 MeleeWeapon_DamageMultiplier
指定 AP >= 0 且无装备：AP = 显式值
```

AdjustedMeleeDamageAmount 包含武器伤害倍率、按原伤害类别取的材料 Sharp/Blunt damage multiplier，以及适用的攻击者/天然部位能力修正。显式 AP 分支不会再次乘材料伤害类别倍率或攻击者伤害因子。

`Verb_MeleeAttackDamage` 先计算调整伤害与 AP，然后才对伤害做 .8–1.2 随机浮动。因此，基础调整伤害 18 的同一攻击，实际伤害 14.4 或 21.6 时，默认 AP 都是 .27。若质量把调整伤害提高为 29.7，默认 AP 才提高为 .4455。

`DamageInfo` 构造器的默认 AP 是 **0**，不会自动按 amount 推算。开发者调试伤害、环境伤害与真实近战攻击必须分别确认来源。角色与武器面板的平均近战穿透是多个可用攻击的加权统计，也不能作为每一次选定攻击的固定 AP。

远程规则只记录接口边界，本轮不据此宣称已实现远程射击：（AR12）

1. Projectile DamageDef 无 armorCategory 时，AP=0。
2. 有显式 damageAmountBase，或 armorPenetrationBase≥0 时，先选 armorPenetrationBase；否则选 DamageDef.defaultArmorPenetration。
3. 选中的 AP 仍小于 0 时，用无武器倍率的 `GetDamageAmount(null) × .015`。
4. 最后乘武器 `RangedWeapon_ArmorPenetrationMultiplier`，由 Bullet 传给 DamageInfo。

## 8. 简单钢盔、钢板甲的制作与副作用

以下取 Steel、Normal 品质；工量是源 WorkToMake，尚未按项目时间步长换算。（AR13–AR16）

| 属性 | SimpleHelmet | PlateArmor |
|---|---:|---:|
| 钢材 | 40 | 170 |
| WorkToMake | 3200 | 38000 |
| MaxHitPoints | 100 | 290 |
| Mass | 2 | 15 |
| EquipDelay | 1.5 秒 | 15 秒 |
| 防寒 | .45°C | 3°C |
| 耐热范围增量 | 0°C | 0°C |
| 移速 offset | 0 | −.8 |
| 最低 Crafting | 未声明 | 7 |
| 前置研究 | Smithing | PlateArmor |
| 源材料类别 | Metallic | Metallic、Woody |
| recipeUsers | TableMachining、ElectricSmithy、FueledSmithy | ElectricSmithy、FueledSmithy |

两件均以 Crafting 为 workSkill，以 GeneralLaborSpeed 为 workSpeedStat；Crafting 最低门槛、经验/品质作用、工作速度是不同字段，不能相互替代。默认 wearPerDay=.4，两件均未覆盖此默认值。低耐久不按比例削弱上述所审护甲和保温值。

SimpleHelmet 的完整父链是 `ApparelNoQualityBase → ApparelBase → ArmorMachineableBase → ArmorHelmetMakeableBase → Apparel_SimpleHelmet`。XML 列表默认追加，相关 recipeUsers 没有 `Inherit="false"`，所以机械加工台来自父类，再追加两种锻造台，合计三台。项目若只开放已有锻造台，应记录为内容范围选择，不能改写源事实。

PlateArmor 研究成本 **600**、科技层级 Medieval，前置 **Smithing + ComplexClothing**；Smithing 成本 700。Parka 的所审父链没有研究门槛，其余五件所选布衣帽都有 ComplexClothing。开局已经完成某研究不等于配方没有研究条件。

钢板甲唯一声明的 equippedStatOffset 是 MoveSpeed −.8。通用 StatWorker 先加装备 offset，再乘 Moving 能力；最后应用 Glow 等 part 并夹到 min .15。无其他修正、明亮环境中的 Human 为：

```text
MoveSpeed = max(.15, (4.6 − .8) × Moving)
Moving 100% → 3.8
Moving 50%  → 1.9
```

不能计算为 `4.6 × Moving − .8`。黑暗且适用 Glow 惩罚时还要乘 .8；失去视力等条件能令该 Glow part 不适用。品质不缩放这条 −.8。源装备没有直接降低 Manipulation 或 GeneralLaborSpeed 的 offset；搬运、赶工变慢可来自行走时间增加，不应另加任意工速惩罚。

## 9. 项目集成合同与证据边界

当前实现目标是在既有衣物、部位伤害、近战、制作、研究和存档上加入护甲，而不是在此扩展整个原版战斗系统。至少应保留：（AR18）

1. 从真实命中节点取覆盖衣物；保存原始 worker 与入口护甲类别，分开记录当前 DamageDef。
2. 穿透由具体攻击来源提供，层间不重算，浮动伤害不反推 AP。
3. 逐层记录入伤、护甲、穿透、全挡/半伤/全伤、衣物损耗；被毁装备从穿着与实体归属中移除。
4. 锻造消耗真实钢材，制作遵守研究和 Crafting 门槛；产品具有稳定 ID、品质、HP、唯一位置与穿着状态。
5. 钢板甲移速影响进入实际移动；存档恢复后衣物、HP、研究、制作进度与损耗结果一致。

项目缩放工量、限定钢材、仅使用已有锻造台、简化视觉反馈、选择自己的确定性随机序列和迁移旧存档，都属于实现决策。它们必须由项目实现章节与集成验证说明，本静态包不替代这些证明。旧存档也不应仅因新增 PlateArmor 定义就被视为已完成该研究。

本包只审选定 Core 声明及父链，没有加载有效 Mod 数据库；没有证明护盾、火焰完整链、DLC 特殊装备、伤害特效或所有射击行为。原生界面的随机样本可以验证可见后果，但单次成功/失败不能证明理论概率分布或内部随机数顺序。

## 10. 可复跑的验证

在项目目录运行：

```powershell
# 无需本地游戏和完整派生代码的静态算例检查
node scripts/research/verify-armor-evidence.mjs
node scripts/research/test-armor-verifier.mjs

# 有相同版本安装时，重用已核验代码，缺失时才重建；不加载游戏代码
./scripts/research/extract-armor.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld' `
  -DecompilerPath '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'
./scripts/research/verify-armor-evidence.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'
```

此次结果：**9 新类型 + 23 复用类型，58 XML 记录，18 条结论，35 个算例、289 项标量断言**；本机 **24 个 XML 文件、32 个派生代码文件**身份一致。XML 保留 485 个叶值、34 个带属性节点和 343 条所选路径缺失记录。父链、列表追加、默认值和 absence 不只靠最终数字推断。

验证器还拒绝了 **25 个证据破坏样本及 9 个公式错误变体**：错误的后续护甲类别、全挡不磨损、HP 比例削弱护甲、非严格概率边界、按浮动伤害重算 AP、列表替换、品质提升 MaxHP、错误的移速乘法顺序、E≥2 无条件全挡。反例只写忽略目录中的临时副本，随后验证路径边界再清理。

源程序集 SHA-256：`eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。分析器为 ICSharpCode.Decompiler **11.2.0.10050**，SHA-256：`587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78`。公式使用 JavaScript 双精度，不承诺 C# float 逐位一致性。
