# 27 生态区、自然地表、植被与生长季

本章补全 [06 世界生成、地形与资源闭环](06-world-generation-resources.md) 中尚未展开的温带森林、寒带森林、沙漠和苔原评分，并给出可以迁移到本项目的地表、木材、丘陵与气候参数。研究对象仍是本机 **RimWorld 1.7.4980 rev60**。本章是静态研究和独立公式验证，**没有操作原版 UI，也没有生成原版地图来检验这些结论**。

本项目计划建立可选择生态区和丘陵类型、可预览、可保存配置的三维局部世界。原版局部 `Elevation` 是二维生成标量；将它映射为可行走的 z 层、地下矿体和三维土层，是本项目的设计选择。本章不把这种映射称为复刻原版球面世界或原版随机流。

## 1. 证据及复核方式

原件 `Assembly-CSharp.dll` SHA-256：`eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。ILSpy 为 `11.2.0.10050`，引擎 SHA-256：`587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78`。

- [biomes-manifest.json](evidence/biomes-manifest.json) / [biomes-types.json](evidence/biomes-types.json)：17 个新增类型的哈希与行数；完整派生文本只保存在被忽略的 `.local-research/biomes/`。另复用 generation 的 14 个类型及 environment 的 2 个类型，没有重做已有 35 类型的完整生成研究。
- [biomes-xml.json](evidence/biomes-xml.json)：7 个 Core XML 文件、19 个选定定义、241 个叶值、19 处 `MayRequire` 属性、47 个明确缺失的所选根字段。为这次需求补足父链和字段缺失证据，并交叉检查 generation 已有的 12 条记录、113 个共有叶值；旧文件未改写。
- [biomes-claims.json](evidence/biomes-claims.json)：BM01–BM20，关联 62 处代码行范围、32 处 XML 记录引用。
- [biomes-cases.json](evidence/biomes-cases.json)：14 个独立算例、234 个结果断言。模型不导入本项目生成器，也不执行游戏代码。
- [biomes-validation.json](evidence/biomes-validation.json)：本机原件、XML、派生文本和独立算例验证结果。另有 30 项篡改拒绝测试，隔离报告位于被忽略的 `test-results/biomes-verifier-negative/report.json`。

所选 XML 父链可解释本章的标量、阈值和 Core 植物权重；它不是启动游戏后经过 DLC、Mod 和补丁处理的有效 Def 数据库。`MayRequire` 条目保留在证据中，Core 权重计算明确排除它们。静态反编译是派生重建，不是原始源码。

在项目根目录运行：

```powershell
./scripts/research/extract-biomes.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld' `
  -DecompilerPath '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'
./scripts/research/collect-biomes-xml.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'
node scripts/research/write-biomes-evidence.mjs
node scripts/research/verify-biomes-evidence.mjs
./scripts/research/verify-biomes-evidence.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'
node scripts/research/test-biomes-verifier.mjs
```

Portable 验证检查身份、路径、父链、先前证据一致性、字段约束和算例；`--local` 再检查 33 个被引用派生文件的 SHA/行数。PowerShell 验证器先运行这些检查，再读取原游戏的版本、DLL 和 XML。提取包装脚本优先复用经过哈希验证的旧派生文件；缺失时可用同版本引擎重建并比对旧哈希，不更改旧 manifest。

## 2. 世界气候如何选择生态区

四个 worker 的输入是已生成的格点温度 `T`、降雨 `R` 和 `WaterCovered`；`R` 在世界界面显示为 mm。这些定义自身没有 ParentName。[BM01–BM04、BM17]

| 生态区 | 非水面可得有效分数的条件 | 分数 | plantDensity | 野生再生 MTB 天数 |
|---|---|---|---:|---:|
| TemperateForest | `T >= -10 && R >= 600` | `15 + (T - 7) + (R - 600) / 180` | 0.65 | 20 |
| BorealForest | `T >= -10 && R >= 600` | 15 | 0.40 | 25 |
| Desert | `R < 600` | `T + 0.0001` | 0.05 | 35 |
| Tundra | 任意非水面 | `-T` | 0.19 | 28 |

不满足前两个森林门槛或沙漠雨量门槛时返回 **0**；这不是负无穷。四者在水面都返回 -100。世界生成还遍历其他 implemented、generatesNaturally 且适合该世界层的生态区，取最高分；相同分数保留先遇到的定义。因此不能把表格当成完整的世界分类边界，也不能认为“沙漠必然高温”。[BM01、BM02]

在只比较两个森林的条件下，温带比分数 15 更高的分界为：

```text
T > 7 - (R - 600) / 180
```

例如 `T=7,R=600` 两者均为 15；`T=6,R=780` 也均为 15。最终生态区仍受全部候选和有效 Def 顺序影响。显式选择“温带森林 + -20°C”的项目界面是在让玩家覆盖原版自然评分，不应伪装成自然生成必然产生的组合。

世界均温与雨量先独立产生，再用于评分。均温基线使用 `abs(latitude)/90` 的曲线 `(0,30)、(.1,29)、(.5,7)、(1,-37)`，叠加海拔降温与温度噪声，再经过总体温度设置。海拔降温是 `40*clamp01((elevation-250)/4750)`。降雨来自另一条噪声、纬度和海拔处理链。局部肥力噪声也单独生成，不能自行增加“每多 100mm 降雨，土壤肥力增加若干”的原版规则。[BM13]

## 3. 生成肥力与最终地表是两个量

不受 patch、高程、岩体等覆盖时，基础地表查表如下。两端均包含、首匹配优先，故恰为 `.87` 或 `.80` 时归前一项。[BM04]

| 生态区 | 第一项 | 第二项 |
|---|---|---|
| TemperateForest / BorealForest / Tundra | Soil `[-999, .87]` | SoilRich `[.87, 999]` |
| Desert | Sand `[-999, .80]` | Soil `[.80, 999]` |

真正的选地表顺序为：先 biome terrain patches；未命中时 `0.55<e<0.61` 生成 Gravel（除非 noGravel），`e>=0.61` 生成当地岩石地表；仍未命中才查上表，再回退 Sand。`preferRock` 会将支持岩石的已选结果替换为自然岩石地表。Desert 还声明 SoftSand patch：频率 `.05`、maxFertility `.8`、minSize `13`、patch 阈值 `.65..999`。本章保留其声明，没有重建 TerrainPatchMaker 的完整噪声分区和清理算法。[BM05]

最终地表都派生自 `NaturalTerrainBase`：[BM06]

| 地表 | 实际 fertility | pathCost | 直接声明 GrowSoil |
|---|---:|---:|---|
| Soil | 1.0 | 2 | 是 |
| SoilRich | 1.4 | 2 | 是 |
| Gravel | 0.7 | 2 | 是 |
| Sand | 0.1 | 4 | 否 |
| SoftSand | 0 | 14 | 否 |

例如生成肥力 `.9` 可以选出 SoilRich，植物随后使用的是 **1.4**。FertilityGrid 通常读最终 TerrainDef；影响肥力的建筑可以覆盖它，Biotech 污染分支可将地表肥力封顶为 `.5`。本项目不实现这些额外分支时，应保持适配说明。

`GrowSoil` 是地表的能力标签，不能替代全部物种种植检查。`CanEverPlantAt` 对正常植物要求 `fertility >= fertilityMin`，相等允许；还检查气候极值、地表标签、污染及阻挡等。于是 Gravel `.7` 能通过白杨和松树的最低肥力门槛，Sand `.1` 无法通过它们，却能通过 Saguaro `.05` 的门槛。此处说明适生检查，不代表已满足玩家播种的研究、技能、野生物种限制、光照和空间条件。[BM06、BM09、BM18]

## 4. plantDensity 不是树覆盖率

普通正肥力、非洞穴、无水生覆盖曲线的格子，其期望植物容量为：[BM07]

```text
desiredCapacity = min(plantDensity * plantDensityFactor * fertility², 1)
```

| 生态区 | Soil 1.0 | Rich 1.4 | Gravel .7 | Sand .1 |
|---|---:|---:|---:|---:|
| TemperateForest | .65 | 1 | .3185 | .0065 |
| BorealForest | .40 | .784 | .196 | .004 |
| Desert | .05 | .098 | .0245 | .0005 |
| Tundra | .19 | .3724 | .0931 | .0019 |

这些是容量模型，不能逐格当作独立树木生成概率。原版先随机顺序访问地图，只有 `.001` 的跳过概率；随后检查已有植物、掩体、建筑、肥力、雪/沙覆盖、饱和度和适生候选，并按全局比例、群落距离、局部分布和 wildOrder 关系选择物种。[BM07、BM08]

Desert 的 `wildPlantsCareAboutLocalFertility=false` 只使非混合生态地图的 **SaturatedAt** 走全图植物数量检查；它没有取消上式中的肥力项，也没有取消植物最低肥力。小型地图另有“局部期望很少时使用全图检查”的分支，因此缩小地图后继续按某个固定树概率散点，不会自然等价于原版。[BM07]

Core 直接声明的完整权重如下；带 MayRequire 的植物被排除：[BM03]

| 生态区 | Core wildPlants 权重 | 合计 |
|---|---|---:|
| TemperateForest | Grass 5；TallGrass 2；Brambles 1；Dandelion .5；Bush .6；Oak .5；Poplar .5；Berry .05；HealrootWild .05 | 10.20 |
| BorealForest | Grass 9；Pine 5；Moss 4；Bush 3；Brambles 2；Birch 1.5；Poplar 1.2；Berry .16；HealrootWild .16 | 26.02 |
| Desert | Grass 6；PincushionCactus 1；SaguaroCactus 1；Dandelion .5；Drago .45；Agave .25；Bush .25 | 9.45 |
| Tundra | Grass 3.6；Moss .5；Bush .3；Astragalus .1；Dandelion .1；Pine .08；Birch .08；Berry .07；HealrootWild .05 | 4.88 |

如果仅作声明层的树权重比例，温带为 `1/10.2≈9.80%`，寒带为 `7.7/26.02≈29.59%`，沙漠木材型植物为 `1.45/9.45≈15.34%`，苔原为 `.16/4.88≈3.28%`。再乘 plantDensity 得到 `.063725/.118370/.007672/.006230` 的声明代理值；这些仍不是实际格子树密度。`BiomeDef.TreeDensity` 有相似的权重比例公式，实际有效候选还能从其他定义增加；局部生成又有地形和群落约束。

TreeBase 声明群落半径 8、权重 24、wildOrder 3；Poplar 将群落权重改为 35，Saguaro 将半径改为 -1，因此不走普通群落分支。初始成长为 `clamp01(U(.15,1.5))`；理想连续均匀模型中完全成熟比例约 `10/27=37.04%`，并非每棵树都满产。[BM08]

再生使用分摊扫描，每内部 tick 约 `ceil(area*.0001)` 格，经过密度概率与 MTB 事件判断。20/25/35/28 天都是再生事件参数，不是“砍掉这一棵后固定等待 N 天原地重生”。洞穴还有 130 天的独立分支。[BM19]

## 5. 白杨、松树与沙漠木材

父继承链如下：[BM09]

```text
PlantBaseNonEdible → PlantBase → TreeBase → DeciduousTreeBase → Plant_TreePoplar
PlantBaseNonEdible → PlantBase → TreeBase → Plant_TreePine
PlantBaseNonEdible → PlantBase → TreeBase → Plant_SaguaroCactus
PlantBaseNonEdible → PlantBase → Plant_PincushionCactus
```

前三者由 TreeBase 继承产物 `WoodLog`、`harvestTag=Wood`、`harvestFailable=false`。Pincushion 是球状仙人掌，未继承 TreeBase，所选完整父链中没有收获产物；不能把沙漠所有仙人掌都作为木材。

| 物种 | 满成长/满血基础木材 | harvestWork | growDays | 最低肥力 | 肥力敏感度 | 最低可收获成长 |
|---|---:|---:|---:|---:|---:|---:|
| Poplar | 27 | 800 | 15.05 | .7 | .5 | 严格 > .4 |
| Pine | 27 | 710 | 20 | .7 | .5 | 严格 > .4 |
| SaguaroCactus | 15 | 210 | 5 | .05 | 0 | 严格 > .2 |
| Oak，现有对照 | 46 | 1400 | 30 | .7 | .5 | 严格 > .4 |

以上基数适用于难度产量系数 1、无病害、正常采收的条件。实际基础产出先按成长和生命调整，再随机舍入：[BM10]

```text
if growth <= harvestMinGrowth: 无收获
growthFactor = .5 + .5 * clamp01((growth-harvestMinGrowth)/(1-harvestMinGrowth))
healthFactor = .5 + .5 * hp/maxHp
yield = RoundRandom(baseYield * growthFactor * healthFactor * difficultyFactor)
```

例如成长 `.7`、满血白杨，基础期望木材是 `27*.75=20.25`；满成长、半血 Saguaro 的基础期望是 `15*.75=11.25`。`harvestFailable=false` 避免普通人类采收失败判定，但 `PlantHarvestYield>1` 仍可进一步提高产出。

工作每 tick 进度为 `PlantWorkSpeed*Lerp(3.3,1,growth)`。满成长、工作速度 1 时，白杨/松树/Saguaro 分别需 800/710/210 原版工作 tick，约 13.33/11.83/3.5 实秒，另加移动等成本。若项目选择固定木材数量和简化砍伐时间，应写成适配，不能让表中的基础数值变成无条件产出保证。

肥力生长因子为 `1+sensitivity*(fertility-1)`，因此普通树在 Gravel 上是 `.85`，Rich 上是 `1.2`；Saguaro 为 1。`growDays` 是基准生长工作量，实际成熟还受每日休眠、光照、温度和状态影响。

## 6. 丘陵增加岩体和矿脉尝试，不定义三维山高

复用第 06 章已经核实的生成链：[BM11、BM12]

| hilliness | 局部高程倍数 | 每万格矿脉基率 | 250×250 原版方图尝试数 |
|---|---:|---:|---:|
| Flat | .8 | 4 | 25 |
| SmallHills | .9 | 8 | 50 |
| LargeHills | 1 | 11 | 69 |
| Mountainous | 1.1 | 15 | 94 |
| Impassable | 1.2 | 16 | 100 |

高程与肥力是分开的噪声场。肥力场频率约 `.021`、6 层；山地系数乘高程场。天然岩体需 `e>.7` 且洞穴场不为正；薄岩顶阈值 `.7*1.04=.728`，厚岩顶阈值 `.7*1.14=.798`。矿脉数量使用 `RoundToInt(width² / RoundToInt(10000/rate))`，还可能有非初始图资源系数和放置系数。[BM11]

这张表是尝试数，不是最终矿脉数、矿物格数或保证储量：中心候选、已有岩体、间距、洞穴、后续河道等都会改变结果。原函数采用宽度平方，矩形面积或三维体积版本属于项目适配。

Mountain mutator 另向高程场加入有方向的边缘山体场：span 为地图宽度 `.15`，offset 为 `.2`，位移噪声频率 `.003`、强度 20；水面格有封顶 0 的分支。只有乘 1.1 并不等于完整复现原版山地。[BM12]

项目可以用高程决定真实表面高度，并让矿体占据多个 z 层，但应分别保存“原版参考系数”和“本项目体素映射参数”。给新手保留平地、保证可达矿物、按小图重配树木数量等措施也应明确记录。

## 7. 世界均温、季节温度、实际格子温度

原版时间为 60000 tick/天、60 天/年、15 天/季、5 天/twelfth。季节温度使用世界均温加余弦偏移：[BM14、BM15]

```text
d = abs(sin(latitude))
A = curve(d; (0,3), (.1,4), (1,28))
signedA = latitude < 0 ? -A : A
seasonalTemperature = meanTemperature - signedA * cos(2*pi*(dayOfYear/60 - 10/12))
```

这里的 `d` 在代码中是 `abs(tileCenter.y/Radius)`；纬度由 `asin(tileCenter.y/Radius)` 得到。**季节振幅用 sin 纬度，世界均温基线用纬度/90，两者不能混用。**45° 纬度季节振幅约 20.1895°C。北半球第 20 天达到暖峰，第 50 天达到冷峰；南半球反转。此公式的位相使用第 11 个 twelfth 的起点，不是某个 UI 季节名称的中点。

实际室外缓存温度还增加日尺度 Perlin 波动 ×7、昼夜余弦 `cos(2*pi*(localDayFraction+.32))*7`，以及地图游戏事件温度偏移；缓存刷新间隔为 60 tick。室内格子温度再由房间等系统决定。因此世界均温 12°C 不能直接当成每时每刻、每个 z 层都是 12°C。[BM16]

### 7.1 界面显示的户外生长期

世界 Terrain 页调用 `Zone_Growing.GrowingQuadrumsDescription`。它将一年分为 12 个名义上 5 天的 twelfth，每段从该段起点 +30000 tick 开始，以 2500 tick 间距采样 120 次 **均温 + 季节温差**，求平均值；平均值处于闭区间 `[6,42]` 的段数乘 5，显示 `N/60`，或显示全年生长。该预测不包含昼夜波动、日随机波动和事件偏移。[BM17]

独立算例：45° 北纬、世界均温为 12/0/32°C 时，这种显示算法分别得到 35/25/40 天。高温也可能缩短适宜生长期，不能只数“高于 0°C”的天数。这里是数学复算，未实际打开原版界面验证这些具体格点。

### 7.2 当前能否生长

当前格子的 `GrowthSeasonNow` 使用实际温度，要求严格 `minGrowthTemperature<T<maxGrowthTemperature`。普通植物默认 `0<T<58`，最佳区间为 `[6,42]`；Saguaro/Pincushion 最大生长温度声明为 75，但最佳温区仍继承默认 `[6,42]`。[BM18]

| 温度 | 普通植物温度生长因子 | Saguaro 温度生长因子 |
|---:|---:|---:|
| 0 | 0 | 0 |
| 3 | .5 | .5 |
| 6–42 | 1 | 1 |
| 50 | .5 | .7576 |
| 58 | 0 | .5152 |
| 75 | 0 | 0 |

温度因子在上下非最佳区间线性下降。这个因子大于零仍不保证本 tick 增长：生长阶段、休眠、光照、病害等条件独立存在。室内加热、受控光照也会使实际可生长时间不同于世界标签。

## 8. 本项目可采用的配置与预览边界

建议将以下概念分开保存，具体实现字段由项目生成器确定：[BM20]

```text
seed / generatorVersion
biome: TemperateForest | BorealForest | Desert
hilliness: Flat | SmallHills | LargeHills | Mountainous
meanTemperature / rainfall / latitude
mapDimensions / voxelElevationMapping
```

生态区决定候选植物与地表表格，hilliness 决定地质强度，气候独立影响季节温度。预览应读取与新建游戏相同的种子和规范化配置，并展示最终地表占比、实际树种数量、可采资源、可用平地和气候估算；`plantDensity` 与矿脉尝试率不应直接冒充这些结果。

如果只生成树而略去草、灌木和野生作物，应重新定义项目树密度，说明它相对于原版全植被模型的取舍。沙漠少树可以构成玩法差异，但额外保底木材、保证水源或自动铺设可耕地属于项目平衡规则。三维坡道、洞穴可达性、表面遮光、地层材料和矿体体积也需要自己的规则与测试。

本章不验证项目生成器、预览与存档是否实现上述设计，也不验证原版特定地图的最终植被和矿量。边界测试覆盖评分门槛、土壤分界、物种父链、密度语义、收获基数、丘陵尝试公式、南北半球季节和生长期统计；原版动态行为及本项目实现需由各自的专项验证记录承接。
