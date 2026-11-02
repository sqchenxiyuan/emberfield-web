# RimWorld 机制研究索引

本目录用于支持 Emberfield 的独立设计与后续实现。核对日期 **2026-11-02**，目标为用户提供的本地安装 **RimWorld 1.7.4980 rev60**。研究覆盖工作物流、战斗医疗、房间温度电网、财富叙事贸易、世界生成与资源五组机制链；另有实际运行的交互对照、多层体素方案与实施台账。

## 阅读入口

| 文档 | 回答的问题 |
|---|---|
| [01 工作、预定与物流](01-work-and-logistics.md) | 优先级如何排序？怎样选择工作对象？多人如何避免抢材料？搬运和路径成本怎么处理？ |
| [02 战斗与健康](02-combat-and-health.md) | 命中估计与实际弹道有什么区别？掩体/护甲/出血/治疗/感染/免疫怎样连接？ |
| [03 房间、温度与电网](03-rooms-temperature-power.md) | 房间如何评分？屋顶和墙如何散热？设备如何制冷与排热？电池与缺电怎样计算？ |
| [04 财富、叙事与贸易](04-wealth-storyteller-trade.md) | 建筑与囤货如何影响威胁？伤亡如何反馈难度？点数怎样变成敌人？买卖价格怎样计算？ |
| [05 复刻设计与验证顺序](05-reconstruction-roadmap.md) | 如何把这些机制落到现有20TPS Worker架构，如何分阶段验证？ |
| [06 世界生成与资源](06-world-generation-resources.md) | 世界气候和局部地形如何生成？矿脉、植物、动物、生长与采收如何计算？ |
| [07 原版实机与交互修复](07-runtime-interaction-comparison.md) | 实际点击、拖建和劳动观察到了什么？Web修复如何验收？ |
| [08 真正多层体素方案](08-voxel-feasibility.md) | 地下与楼层如何影响渲染、寻路、施工、房间和存档？内存怎样预算？ |
| [09 实施台账](09-implementation-ledger.md) | 哪些已实现、哪些仅有研究，接下来验收什么？ |

每篇均含具体来源与未决问题。先读感兴趣的系统，再查其 `evidence/*-claims.json` 和 `*-manifest.json`，不要把“已抽取一个类型”当成“这个类型涉及的全部机制已经理解”。

## 证据等级与版本身份

| 标签 | 本目录含义 | 不能证明的内容 |
|---|---|---|
| `static-derived` | 对指定哈希程序集的 ILSpy 静态派生分析 | 原始源码、目标已运行、所有条件都被覆盖 |
| `xml-declared` | 安装目录内指定XML/XPath的声明值 | DLC/模组补丁及全部继承完成后的有效Def数据库 |
| `runtime-observed` | 在指定版本、Core + Odyssey隔离新殖民地中的实际输入与画面，附记录 | 所有场景/概率已验证、纯Core结论或Web等价性 |
| `inference` / 算例 / 设计建议 | 在注明前提下的推导或本项目选择 | 原版运行样本，或Web版已经实现 |

- 原程序集 SHA-256：`eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。
- MVID：`8e962ecc-7ac7-42d2-8f3b-1b16cd24d2cd`；程序集版本 `1.7.9785.1822`，不要与产品版本互换。
- 匹配该哈希的既有 [REA身份记录](evidence/artifact-identity.json) 识别为 modern .NET、CIL、AnyCPU、`.NETCoreApp,Version=v10.0`。本轮重新核对了安装版本与程序集字节哈希。出现 UnityEngine 命名空间不代表这个安装仍是旧 Unity Mono 构建。
- ILSpy 分析库版本 `11.2.0.10050`，SHA-256：`587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78`。
- 本轮 REA 成员扫描遇到 **64 MiB元数据表示预算**，记录在 [rea-member-attempt.json](evidence/rea-member-attempt.json)，coverage为 unavailable。其返回零行不是“没有这些类/方法”。机制分析使用已能正常读取该程序集的 ILSpy，未将失败扫描包装成完整调用图证据。
- 前五组提取过程只加载分析器，原程序集按PE/CIL数据读取。后续已在隔离目录启动原游戏、检查启用列表并建立新研究存档；运行证据单列在07篇，不能据此升级所有静态结论。既有用户存档未用于本次实验。

完整派生代码位于本地忽略目录 `.local-research/<group>/`。公开内容为分析文档、必要数值、来源位置、哈希、自编提取/校验脚本及说明交互所需的裁剪截图；不含游戏二进制、提取素材、存档或完整反编译类。

## 覆盖清单

“已回答”仅在当前文件版本与明示条件内成立。

| 问题 | 状态 | 本轮边界 |
|---|---|---|
| 工作排序、扫描、预定、搬运状态机 | 已回答主要链条 | 各类专用Job、全部ThinkTree、全部寻路分支仍有空缺 |
| 普通枪击、掩体、单层护甲 | 已回答主要链条 | 爆炸、近战、特殊投射物与完整身体部位采样未全部展开 |
| 普通伤口、护理、感染、免疫 | 已回答所选类与疾病 | 未复刻完整手术/器官/疾病/基因数据库；无实机存活率样本 |
| 房间属性、豪华度、温度交换 | 已回答选定公式 | 房间拓扑维护、门/通风调用链与温度调度尚未全部闭合 |
| 电池单位、效率、供需/停机 | 已回答主要链条 | EMP、短路、破坏和全部发电机细节仍待研究 |
| 财富→适应→预算→普通组队 | 已回答主要链条 | 兵种、全部派系/策略/到达模式及DLC专属威胁未穷举 |
| 银币商品买卖报价 | 已回答入口公式 | 市值全部StatPart、商人库存及交易最终提交未闭合 |
| 世界生成、矿脉、生长与采收 | 已回答选定主要链条 | 完整洞穴底层、biome评分全表、球面网格与动物肉皮产出仍未闭合 |
| 原版实机基础交互 | 已短程观察 | 物品/动物/植物检查、蓝图拖建、优先砍树/挖掘；概率和精确时间未测 |
| 有效Def与原版性能 | 未完整验证 | 只确认本次启用列表及研究存档，不代表穷尽运行时Def补丁 |
| 真多层体素复刻 | 用户已选方向，设计完成首稿 | 尚未实现三维地图、跨层寻路或可玩原型 |

## 如何复核

本轮已通过本地核验：**112个选定类型的派生文件哈希、133条结论、360处来源引用的结构/行号范围、41组算例（160项数值或结果断言）、29个XML文件中的102处来源引用**，以及经济组22项声明快照、生成组94个XML节点的630个叶值。正文公式还经过交叉复核；这些计数只描述本研究集，不代表覆盖原游戏全部机制。

普通读者不需要原游戏即可检查JSON结构、来源位置范围、相对链接和文中算例：

```sh
npm run research:check
```

该命令运行**分析者编写的公式算例**，不调用 RimWorld、不跑原版随机过程，也不代表Web玩法已经符合原版。它已接入GitHub Actions。算例JSON中的 `formula` 是解释文本，脚本不执行该字符串；真正算式在显式维护的 `case-models.mjs` 中。

有相同版本安装与相同ILSpy库时，可在项目目录执行（路径按本机实际位置填写）：

```powershell
$gamePath = 'F:\SteamLibrary\steamapps\common\RimWorld'
$decompilerPath = 'C:\path\to\ICSharpCode.Decompiler.dll'
foreach ($group in @('work','combat','environment','economy','generation')) {
    ./scripts/research/extract-rimworld.ps1 -GameRoot $gamePath -DecompilerPath $decompilerPath -Group $group
}
./scripts/research/verify-local-sources.ps1 -GameRoot $gamePath
./scripts/research/verify-generation-evidence.ps1 -GameRoot $gamePath
```

综合工作区已有分析库路径是 `tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll`（相对综合工作区根目录）；独立Emberfield仓库不附带该库。提取器检查原程序集与工具哈希，按UTF-8无BOM、LF输出，以保证来源行号可复现。版本不同应另建版本证据集，不能沿用旧行号与算例结论。

`verify-local-sources.ps1` 检查原程序集哈希、派生文件哈希与行数、引用XML哈希及XPath存在性，并校验经济组22项XML声明快照。**XPath命中与哈希一致不自动证明文字解释正确**，语义仍需人工复核。环境、工作、战斗的XML值记录在各自结论账本中。

## 后续研究入口

下一轮继续推进世界生成/资源的实际实现、真多层体素切片与更受控的原版数值实验，再补房间拓扑/门与通风、身体部位受击与近战、生产账单与品质/失败、完整市值与贸易提交、招募/社交/关系。原版资料与 Emberfield 数值保持分开，避免将当前首版的简化实现误称为原版机制。
