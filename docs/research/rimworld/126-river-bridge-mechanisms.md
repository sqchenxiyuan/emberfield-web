# 河流、水域、桥梁与地基机制

更新：2026-11-04。目标是先建立地形、通行、施工、承载、物流与保存之间的机制关系；下面记录的原版成本和速度只用于溯源，不要求 Web 先精确拟合。

本章对应本地 **RimWorld 1.7.4980 rev60**，`Assembly-CSharp.dll` SHA-256 为 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。复用 REA 模块身份与匹配 ILSpy 派生材料，新增定向提取 5 个 stockpile / foundation 类型。派生 C# 不是原始源码；原版实机证据另见 [128](128-native-river-bridge-runtime.md)，Web 实现与改编见 [127](127-river-bridge-gameplay.md)。

## 水深与通行身份

`Terrain_Water.xml` 的继承链比水面颜色或函数名称更可靠。

| 地形 | 普通步行 | 基础 pathCost | Bridgeable | 关键区别 |
|---|---|---:|---|---|
| WaterShallow / WaterMovingShallow | 可通行 | 30 | 有 | 浅水还提供 ShallowWater、WaterproofConduitable、Walkable |
| WaterMovingChestDeep | 可通行 | 42 | 有 | 齐胸流水；仍有 Walkable |
| WaterDeep | 不可通行 | 300 | 无 | changeable=false；另有飞行角色例外 |
| WaterOceanDeep | 不可通行 | 300 | 无 | 海洋深水；不能套用 WaterDeep 的全部例外 |

河流生成的 `DeepMovingWaterTerrainAt` 默认返回 **WaterMovingChestDeep**，不能因为名称有 Deep 就映射为不可通行水域。深水的 300 也不是“花 300 点就能通过”，Impassable 判定优先。

WaterBase 另有非征召 180、征召 18 的 perceived path cost，影响寻路对绕水的偏好。实际跨格移动使用另一条成本计算路径；不能将 perceived 值直接解释为速度倍数。`avoidWander` 是闲逛偏好，不等于禁止主动涉水。

## 河流生成关系

`WorldGenStep_Rivers` 从海岸、海拔与成本构造排水关系，累计降雨流量，并处理蒸发、河流等级与支流。局部 `TileMutatorWorker_River` 接收世界河流连接方向和宽度，以噪声改变弯曲、宽度与浅水带，生成深度图、替换地形，并清理相关岩石/屋顶。它还生成流向查找纹理。

这组证据证明世界连接与局部水道之间有数据关系，不证明存在通用三维体素流体、压力、地下水或物品漂流模拟。Web 的排水网络和三维河床应独立命名、版本化；不宣称与原版同 seed 同地图。

## 桥是独立地基层

1.7 的 `TerrainGrid` 分开保存 `topGrid`、`underGrid` 和 `foundationGrid`。桥的 `isFoundation=true` 使 `SetTerrain` 转到 `SetFoundation`；下方原有 terrain 保留。普通 `RemoveFoundation` 清掉 foundation 后重新露出原 terrain。本次实机的完整 top/under 解码字节在建桥、拆桥前后均未变化。

| 桥 | 放置要求 | 提供承载 | 其他 |
|---|---|---|---|
| Core Bridge | Bridgeable | Light | 木材 12、WorkToBuild 1500，易燃、可毁坏 |
| Odyssey HeavyBridge | 仍继承 Bridgeable | Light、Medium、Heavy、Walkable | HeavyBridges 研究，钢材 14、WorkToBuild 2500 |

重型桥扩展的是承载，不能据此推断可以在普通 WaterDeep 上施工。桥被破坏时 `destroyBuildingsOnDestroyed=true` 会影响上面的建筑；普通拆除另有阻挡检查。

`GridsUtility.GetAffordances` 在有 foundation 时读取 foundation affordances。**木桥上铺石地板不会把地基升级为 Heavy。** 建筑施工逐格检查其占地所需的 affordance。

## 建筑承载不是简单按外观重量分类

下表为 shipped Core XML 的 `ParentName` 标量继承解析，未假装还原所有 mod patch 后的数据库。

| 需求 | 已核对建筑 |
|---|---|
| Light | 床、餐椅、1×2 桌、货架/小货架、马蹄铁桩、电暖器、沙袋 |
| Medium | 手工裁缝台、简易研究台、木柴/太阳能发电机、电池、冷气机、燃料/电力锻造台、机械加工台、燃料/电力灶台 |
| Heavy | 切石台 |
| 随材料调整 | 墙、门、栅栏、栅栏门，启用了 useStuffTerrainAffordance |

材料替换承载要求必须经过 `useStuffTerrainAffordance`。木材为 Light，多数金属为 Medium，石材为 Heavy；多数家具和货架没有开启该替换，不能把所有石制家具归为 Heavy。此表属于静态证据，本次未完成逐建筑原版摆放矩阵。

## 普通拆桥、破坏与地形改变

普通 Remove foundation 要求目标可拆、未重复标记，并检查占格建筑、施工蓝图、安装蓝图与框架。若基础上还有地板，工作可能先拆地板；施工任务使用 Floor reservation 和 ConstructionSpeed。此阻挡路径读取 `buildDef.terrainAffordanceNeeded`，不要擅自将它改写成与建造路径完全相同的材料检查。

破坏 foundation 是另一条路径，可毁坏上方建筑。常规地形改变还会更新通行缓存、取消不再支持的蓝图/框架、处理植物、污物、积雪等。**这不是“露出水后删除所有物品”的通用规则。**

## 浅水可以划仓储，也可以留下散货

`Designator_ZoneAddStockpile.CanDesignateCell` 拒绝 Impassable terrain 及不允许 zone 重叠的占格物，没有统一的 IsWater 禁止项；父类另检查地图边界、迷雾、已有 zone 等条件。因此浅水可以划仓储区。`GenPlace` 的 Near 放置借助 `GenSpawn.CanSpawnAt` 检查可通行与占格；不要把这条条件泛化为每一种 Direct/spawn API。

本次实机实际划出 8 格浅水底层仓储，其中 1 格有桥；拆桥后同一格留有 **WoodLog ×6**，信息栏显示 `shallow moving water`。因此 Web 如果禁止浅水仓储，必须明确写成独立设计，不能归因于原版。

WaterBase 的 `extraDeteriorationFactor=3` 与环境暴露项共同参与 eligible spawned item 的 deterioration；未遮蔽雨天再乘相应因素，保护性建筑另可修正。实机信息栏显示当时这堆木材的预估 `2/day`，这不是实测一天掉血，也不是所有水中物品每 tick 固定受伤。

## 证据与复核

- [静态证据](evidence/river-bridge-evidence.json)：RIV01–RIV09，24 个建筑承载投影、XML 节点与文件哈希、每条派生类型的行范围和摘录哈希。
- [定向提取清单](evidence/river-bridge-manifest.json)：仅新增 5 个类型；派生 C# 留在忽略目录。
- [原版实机记录](evidence/river-bridge-native-runtime.json)：隔离 profile、普通操作、原生保存与地层解码，范围见 128。

在 `experiments/rimworld-like` 下运行：

```powershell
pwsh -NoProfile -File scripts/research/extract-river-bridge.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-river-bridge-evidence.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-native-river-bridge-runtime.ps1 -Check
```

两个 collector 的 `-Check` 只复读已保留材料；extract 的 `-Check` 重新静态提取 5 个类型并比对。它们均不启动游戏、不发送输入、不修改存档。原版安装、匹配的本地派生材料及忽略目录中的原始实验文件是复核前提；公开仓库不分发游戏 DLL、完整反编译源码或玩家存档。
