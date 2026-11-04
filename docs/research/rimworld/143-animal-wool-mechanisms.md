# 剪毛、羊驼和保留材质身份的服装生产

更新：2026-11-05。目标版本 RimWorld **1.7.4980 rev60**。本页只记录本地安装包的静态证据，重点是「动物饲养 → 周期生长 → 现场劳动 → 实体毛料 → 指定材质衣物」的机制连接。数值是原版参考，不要求 Web 初版立即复刻全部平衡。

## 证据边界

- 程序集：F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll；SHA-256 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。
- 沿用 [REA 托管身份记录](evidence/production-bills-rea-managed.json) 证明目标身份；派生结果不是原始源码，也不是运行证明。
- [提取清单](evidence/animal-wool-manifest.json)：**34 个类型**的派生文件哈希；[机制投影](evidence/animal-wool-mechanisms.json)：**60 个锚点、6 项有界检查、37 项 XML 投影**。
- 完整派生类型仅留在忽略目录 `.local-research/animal-wool/`。仓库只保留有限锚点、定义字段、哈希和解释，不提交程序集、原版美术、音频或完整反编译源码。
- 本轮没有启动原版、浏览器、预览、GUI 操作或截图。未构造完整模组补丁后的有效 Def 数据库，也未模拟所有 DLC、世界动物和特殊任务路径。

## 物种选择：原生可野生获取的羊驼

Core `Races_Animal_SheepGroup.xml` 的 Alpaca 带 `CompProperties_Shearable`：产品 **WoolAlpaca**，周期 **10 天**，满周期产量 **45**。现有 Dromedary 节点没有剪毛组件，不能因为已支持单峰驼产奶就让它兼产毛。

羊驼 Wildness=0.25、bodySize=1、baseHungerRate=0.275、食性 VegetarianRoughAnimal、roamMtbDays=3；继承 AnimalThingBase 的 trainability=None。这是一种需要围栏和牵引管理、能驯服但没有高级训练链的食草动物。按 `Need_Food` 的原版每 tick 基率，在成年、Fed、忽略其它修正时约为 **0.44 营养/天**；0.275 本身不是每日营养。Wildness 经既有 MinimumHandlingSkill 曲线约为驯服要求 Animals 2；这不是剪毛工作的技能门槛。

AnimalBaby 和 AnimalJuvenile 没有 shearable 字段；类型默认 false。AnimalAdult 明确 shearable=true。羊驼幼年起点 0.2 年，成年 0.3333 年；成熟之前不积累这一组件的毛量。

TemperateForest、TemperateSwamp、TropicalRainforest、TropicalSwamp 的野生 Alpaca commonality 都为 **0.5**，原生群体范围 **2～5**。这是相对生成权重，仍受季节、群体等原版生成机制影响，不是 50% 独立出现概率。Web 可以选温带地图的确定性分布提供可玩入口，但应明确这种分布是适配。

## 毛量是动物状态，公母都可以生产

`CompShearable` 继承与挤奶相同的 `CompHasGatherableBodyResource`，独有活动条件为：父类活动、当前生命阶段 shearable、不是启用 Anomaly 时的 Shambler。父类要求 Faction 非 null、未 Suspended。

有界检查表明，剪毛专用活动 getter 没有性别、怀孕、泌乳、睡眠、倒地、体型或温度条件。因此**成年公羊驼也会长毛**；不得复用产奶的雌性限制。倒地、睡眠等可能阻止工人当时接近工作，与毛量是否增长是不同条件。

每个活动原版 tick：`fullness += HungerMultiplier / (10 × 60000)`，最高为 1。Fed / Hungry / UrgentlyHungry / Starving 的倍率分别为 1 / 0.5 / 0.25 / 0。饥饿延迟下一批毛，没有额外独立扣除一笔生产饲料；满量不会继续存第二批。

满度保存在动物组件的 **woolGrowth** 键下，缺省 0。不活动暂停增长，不清空旧满度。野生无阵营个体不会按普通组件路径积毛；驯服不应直接赠送满毛。

## 剪毛必须由工人完成真实现场劳动

WorkGiver_Shear 使用 Handling，要求 Manipulation，原版 priorityInType=85；挤奶为 90。它复用 gathering work giver，扫描与工人同阵营的已生成动物，要求组件 ActiveAndFull、未倒地、未被工人牵引、可日常互动、可预约。该资格函数**没有 MinimumHandlingSkill 或 Animals 最低等级检查**。

JobDriver_Shear 的 WorkTotal 是 **1700 工作量**。公共 driver 预约目标、走到可触碰位置，让动物维持等待；每个实际工作间隔先增加 Animals 经验 `0.13 × delta`，再以 AnimalGatherSpeed 增加工作进度。速度与等级、身体能力等 stat 有关，所以 1700 不等于任何工人都固定工作 1700 tick。

与 [产奶研究](141-animal-milk-mechanisms.md) 相同，AnimalGatherYield 是一次整批成功概率。成功按 `RoundRandom(ResourceAmount × fullness)` 产生实体堆；失败整批浪费。普通任务要求满度达到 1，因此羊驼正常满周期成功产 45 毛，失败产 0；高于 100% 的成功率不额外增产。

组件满度与 driver 的 gatherProgress 分开保存：同一任务读档能继续工作；普通取消/失去接触/禁止/目标倒地会中断，结束回调不清空毛量、不产生物资。新任务有自己的新进度，不应把旧工人的进度转成动物永久共享值。

产物用 GenPlace.TryPlaceThing 放在工人附近，随后满度归零；原版此处忽略放置返回值，没有保留待交付容器。Web 可以在全批物品无法落地时预检并保留毛量与劳动，但这是适配，必须避免重试多次抽签、重复经验和重复产出。

## 毛是独立物资，不应转换成棉布

继承链：`WoolAlpaca → WoolBase → ResourceBase`。

| 项目 | 羊驼毛原版值 | 与衣物的关系 |
|---|---:|---|
| 堆叠上限 | 100 | 应保留真实物资堆 |
| 原料 MaxHitPoints / deterioration | 90 / 3.4 每天 | 是毛料自身的耐久、露天损耗 |
| MarketValue / Mass | 3.8 / 0.028 | 影响材料成本与物品价值 |
| 原料 Flammability | 0.4 | 不是羊毛成衣的燃烧系数 |
| healthAffectsPrice | false | 原料不按 HP 比例折价 |
| Stuff 类别 | Fabric | 可用于接受 Fabric 的衣物 |
| Cold / Heat power | 30 / 16 | 通过衣物各自的材料倍率参与保温 |
| Sharp / Blunt / Heat armor power | 0.36 / 0 / 1.10 | 分别参与三类护甲 stat |
| stuff Flammability / Beauty factor | 1.7 / 1.5 | 用于由该材料制成的物品 |

所查三层定义没有腐败组件，也没有 ingestible：羊毛不是奶或生食，不应进入进食、煮饭或腐败路径；其普通搬运、储存、禁止、耐久、交易等仍是物资系统职责。

## 同一件衣服只用一种主材，材质贯穿半成品与成品

`RecipeDefGenerator.SetIngredients` 从服装 CostStuffCount 和 stuffCategories 生成材料需求，并设置 productHasIngredientStuff=true。普通 RecipeDef 的 allowMixingIngredients 默认 false，所查生成器没有开启它。WorkGiver_DoBill 的 NoMix 分支可以汇集**相同 Def 的多个堆**，不能把不足的布与不足的羊毛拼成一件普通衣服。

BasicShirt、Pants、Parka、Duster 的 XML 均接受 Fabric，因而能用羊驼毛；接受 Metallic 的装备不能仅因同属「服装」就用羊毛制造。Bill 材料过滤器应能表达实际允许的纺织料。

`Toils_Recipe` 创建 UnfinishedApparel 时用实际主料 Def 作为 Stuff；恢复半成品时从既有 ingredients 找回 UFT.Stuff 对应材料；`GenRecipe.MakeRecipeProducts` 给完成品传入主料 Def。Thing 自身保存 stuff 字段。这使材料选择必须一直保留到：取料、搬运、半成品、中断、读档、完成、穿戴、出售，不能只在列表显示一个「羊毛」标签。

## 材料影响属性，但不能由原料耐久推导衣物耐久

`StatPart_Stuff` 的公式为：`value += garmentMaterialMultiplier × materialPower`。XML 给这个 part priority=100；StatDef 按优先级降序排序，品质 part 默认 priority=0，因而先加入材料贡献，再应用该 stat 的品质倍率。

普通参考式是：`衣物属性 = (衣物基础值 + 衣物材料倍率 × 材料 power) × 对应品质因子`，另有 stat 上下限、其它组件和情境修正。防寒、防热、三类护甲使用不同的 power 和衣物倍率，不能把所有数值统一乘「羊毛加成」。例如羊毛 cold power 30 对布 18，但衣物有基础值时，不能据此声称整件衣服恒为 30/18 倍保暖。

WoolAlpaca/WoolBase 与 Cloth 的 stuffProps 都没有 MaxHitPoints 或 WorkToMake 倍率/偏移；`StatUtility.GetStatFactorFromList` 缺省为 1。**毛料 HP90、布 HP80 不会使相同衣服耐久按 90/80 提升**；普通衣物仍使用其自身 MaxHitPoints。两种材料也没有额外制作工作倍率。

普通 ApparelNoQualityBase 的 Flammability=1，所以未覆盖的布衣为 1×1.2，羊毛衣为 1×1.7；这与原料羊毛 Flammability=0.4 完全不同。UnfinishedBase 与 UnfinishedApparel 均未声明 Flammability，stat 默认值为 0；在所查 Core 静态定义中其结果为 0。若 Web 让纺织半成品可燃，应记录为已有玩法适配，不能拿成衣或原料的燃烧值冒充原版 UFT 定义。

## 成衣价格保留材料价值

没有显式 MarketValue 覆盖时，`StatWorker_MarketValue.CalculatedBaseMarketValue` 在普通 CostStuffCount 路径计入材料数量 / VolumePerUnit × 材料市场价值，并加其它固定原料成本；制作/建造工作取较大值，超过 2 时增加工作量×0.0036，再按产品数量分摊。后续还有品质、HP 曲线和其它 stat parts；实际交易价格还有交易情境。

因此羊毛成衣的基础价值应随真实羊毛投入变化，不能仍套棉布价格，也不能只把整件成衣价格乘 3.8/1.5。原料 healthAffectsPrice=false 不会让制成的衣物自动免疫破损折价。

## 本轮可复用的机制与尚未证明的内容

优先实现：成年公母羊驼自然获取与饲养、毛量周期、真实剪毛劳动、整批浪费、物理毛堆、单一主料选择、半成品材料锁定、读档与成品材料效果。周期、工作量、经济参数可集中配置后慢慢调整。

没有本轮运行验收原版特殊天气、伤残、睡眠、远行队、Mod 覆盖、全部衣物配方、GPU 动画或渲染表现；静态定义和派生链路不能替代这些证明。Web 的材料公式也不等于已经实现原版完整装甲、温度、热交换或价格系统。

复核命令：`pwsh -NoProfile -File scripts/research/extract-animal-wool.ps1 -Check`；随后 `pwsh -NoProfile -File scripts/research/collect-animal-wool-evidence.ps1 -Check`。提取步骤只读目标 PE 元数据，目标游戏代码不被加载执行。
