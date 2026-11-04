# 世界选址：地区身份、气候生态和局部地图种子

核对日期：2026-11-04；目标 RimWorld **1.7.4980 rev60**。这一章连接“先选世界地区，再生成当地营地”的设计链。复用 [06 世界生成](06-world-generation-resources.md)、[27 生态区与地表](27-biomes-terrain-generation.md)、[28 原版世界查看](28-native-world-generation-runtime.md)，只补提取六个种子/选址入口类型，**没有重新运行原版或新建原版世界**。

程序集 SHA-256 为 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`，ILSpy 11.2.0.10050 的 SHA-256 为 `587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78`。反编译结果是派生文本，完整文件留在 `.local-research/world-site-selection/`；[manifest](evidence/world-site-selection-manifest.json) 记录哈希和行数，[证据索引](evidence/world-site-selection-evidence.json) 连接新来源及旧证据，不复制已有整组材料。

## 1. 世界种子与地区身份不是同一个字段

原版 `WorldGenerator` 和 `WorldInfo.Seed` 都通过 `GenText.StableStringHash(seedString)` 取得整数种子。实现对空引用返回0；普通字符串从23起，按每个 **UTF-16 code unit** 执行 `hash = hash × 31 + unit`，以32位整数保留结果。空字符串因没有循环返回23。它不是浏览器运行时随意选择的字符串哈希，也不应按 Unicode 码点遍历替代代码单元。[WS01]

`PlanetTile` 包含 tileId 和世界层。其 `GetHashCode()` 为：

```text
effectiveLayer = 0                         若 layerId < 0 或 Layer.IsRootSurface
                 layerId                  其他世界层
tileHash = int32(tileId × 397) XOR effectiveLayer
```

因此原版普通地图的种子输入不是裸 `tileId`。根地表层的别名归一为0；不同世界层通常会产生不同 hash，但32位输出不是无碰撞身份编码。[WS02]

普通 `MapGenerator.GenerateMap` 使用：

```text
worldSeed = StableStringHash(world.info.seedString)
mapSeed = HashCombineInt(worldSeed, parent.Tile.GetHashCode())

HashCombineInt(seed, value) = int32(
    seed XOR (value + 2654435769 + (seed << 6) + (seed >> 2))
)
```

其中移位按 C# 有符号32位语义处理；无 parent 时 tile 输入回退0。Pocket map 是另一个分支，使用 parent ID 或随机整数，不能把正常地表公式泛化到所有地图。随后生成步骤按 `order,index` 排序，各步骤再用其 SeedPart 派生随机流；重复 SeedPart 有此前重复次数偏移。[WS03]

可手工复算的例子：旧28中的世界字符串 `whip` 得整数 `24889423`；根地表 tile99363 的 hash 为 `39447111`，按上述公式得到 map seed `-23486052`。**这是本轮独立算术推导，未读取该格实际生成地图的seed，也未调用原版生成器。** 证据内还有另一格、非根世界层、根层别名和UTF-16代理对算例，用来检查整数与字符串语义。

这条链支持“固定世界身份和地区身份，得到稳定的当地生成入口”。它不证明改变游戏版本、地图尺寸、有效Defs、DLC、场景、生成步骤或随机消费顺序后，仍能逐格生成同一地图。Web应保存完整 `version + worldSeed + tileId`，将 mapSeed 当派生输入；不要仅用32位seed代替世界/地区身份。

## 2. 先生成环境，再让生态区竞争

`WorldGenStep_Terrain.GenerateTileFor` 先生成海拔和山地类型，再按纬度、海拔降温、独立温度噪声和总体气温曲线得到均温，赋予另一条降雨噪声产生的雨量，最后调用 `BiomeFrom`。山地分档还依赖山脊及丘陵噪声和部分随机分支，不能把原版简化成纯海拔阈值。[WS04]

`BiomeFrom` 遍历 implemented、generatesNaturally 且允许当前世界层的候选，取最高分；严格大于才替换，所以同分保留先遇到的定义。27已经审查了四个评分器，而不再只是知道“存在评分”：[BM01、BM02]

| Worker | 非水面条件与分数 |
|---|---|
| TemperateForest | T≥−10 且 R≥600：`15+(T−7)+(R−600)/180`，否则0 |
| BorealForest | T≥−10 且 R≥600：15，否则0 |
| Desert | R<600：`T+0.0001`，否则0 |
| Tundra | `−T` |

四者对水面均返回−100。**其余生态区仍会参加竞争，四个worker不是完整世界分类器。** 比如两个森林的分数相等时，还要看候选顺序与其他生态区；不能仅用两条阈值声称复刻全部原版生态分布。R取世界面板的降雨单位，T是世界均温，均不是当前房间温度。

对Web最重要的约束是让地区的温度、雨量、海拔和山地参与生成生态与玩法设置，使选址代表一组相互关联的环境条件。三生态区分类和气候阈值可以采用项目暂定规则，必须与原版四worker及全部候选机制区分。把生物群系任意手选、再把气温改成与之矛盾的数值，是额外的自定义覆盖模式，不能冒充自然生成结果。

## 3. 地区能查看，不表示能建立营地

`Page_SelectStartingSite.DoWindowContents` 把所选地区传入开局数据；前进之前 `CanDoNext` 还要检查有效地区、`TileFinder.IsValidTileForNewSettlement` 和教程权限。`DoNext` 调用邻近定居点关系确认 helper 后才继续。[WS05]

普通定居点检查拒绝：biome不允许建基地、biome未实现、`Hilliness.Impassable`，以及部分已有/邻近定居点和其他地图占位。Core Ocean/Lake 明确 `canBuildBase=false`。更多占位helper和重力船例外没有在这一章完整展开，所以这里只给普通入口边界，不能写成“只检查海洋和高峰就完全等价”。

旧28是在**现存世界地图**点击查看五个地区，其中包括一个 Impassable 地区。它证明该地区可选中查看Terrain信息，不证明可在该处落地；没有进入新开局确认，也没有生成对应局部地图。Web可以允许查看不可定居格的属性，同时禁用“在此建立营地”并给出原因。项目不实现派系聚落和旅行时，对应的占位/邻近关系检查属于未实现范围。

## 4. 选址取舍必须落到当地地图和生存条件

原版地区信息继续参与局部生成：山地类型改变高程场及矿脉散布基率；biome影响地表、野生植物和可用石种；`NaturalRockTypesIn` 可使用biome强制石种，否则用tile hash暂时设置随机状态并抽2–3种适用天然岩石。它不保证固定数量的最终可挖矿物，后续生成阶段仍会改图。[WS06；GN09、GN10、GN16]

旧28的原生面板提供了三个值得保留的设计对照：[WS07、WS08]

| 原生地区 | 均温 | 降雨 | 面板生长季 | 能说明什么 |
|---|---:|---:|---:|---|
| Desert / Mountainous，282619 | 15.9°C | 568mm | 50/60天 | 与温带森林同均温，但水分、地表和生态不同 |
| Temperate forest / Flat，99363 | 15.9°C | 801mm | 50/60天 | 温和、平地、较湿润的组合 |
| Boreal forest / Flat，111646 | 2.4°C | 801mm | 30/60天 | 与温带森林同雨量，但低温和较短生长季改变准备需求 |

这张表是旧截图转录，不是用三点拟合生态阈值。世界生长季标签来自季节温度采样，与当天气温、室内保温、植物能否种植和一次作物必定成熟不同。更完整的气候/生长边界继续以27为准。

旧运行记录完整保留了一个操作错误：观察后殖民地误续跑，总计前进83,122ticks，随后两次相同tick保存证明最终暂停。世界info/grid在五档中相同，只证明那次观察期间未改变，不证明相同seed重新生成等价。本轮只复核已有五档、八张裁图和41次记录，不新增操作或把旧观察改称v35新运行。

## 5. Web v35 的明确适配边界

| 项目设计 | 与原版证据的关系 |
|---|---|
| 48×24地区，球面场采样后经纬度投影展示 | 便于浏览和确定地区身份；不是原版球面网格细分或等面积六边形 |
| 温带、针叶、沙漠三类支持生态 | 受气候约束的项目分类；非全部原版评分器竞争结果 |
| 海洋与不可通行峰不能建立营地 | 对齐普通入口的部分排除原则；没有派系/旅行的完整限制 |
| 地区派生当地mapSeed与settings，进入64×64×16地图 | 继承“世界地区驱动局部生成”的结构；不是原版二维局部高程的逐项重建 |
| 地区规则version1与世界种子、tileId保存 | 便于恢复选址来源；规则升级必须保留旧版本解析或明确迁移 |

具体气候噪声、海平面、高峰阈值、三生态边界和推荐地区评分均为项目暂定参数。独立地图seed表示可由地区确定的生成入口，不等于密码学独立或所有可能世界之间无碰撞。此轮不宣称原版星球精确复刻、河流、局部海水模拟、多地图和旅行。

## 复核

```powershell
& scripts/research/collect-world-site-selection-evidence.ps1
node scripts/research/verify-world-site-selection-evidence.mjs
node scripts/research/verify-world-site-selection-evidence.mjs --local
```

[采集器](../../../scripts/research/collect-world-site-selection-evidence.ps1) 创建来源索引和Ocean/Lake必要字段投影；[校验器](../../../scripts/research/verify-world-site-selection-evidence.mjs) 检查六个新类型、旧组文件哈希/行范围、五个独立整数算例，并直接复用27/28校验器。local额外读取原DLL、工具、派生、XML、原截图和存档；不会启动游戏、重放输入或验证原版同seed逐格生成。旧组文件未修改。
