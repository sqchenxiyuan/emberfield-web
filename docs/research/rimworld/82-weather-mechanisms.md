# 82 天气、降水、遮蔽与经营影响

本轮研究的重点是把“天气变了”连接到居民行动、火灾、仓储、情绪和电力，而不是提前校准天气概率。目标锁定 **RimWorld 1.7.4980 rev60**；15 个选定类型的离线派生重建身份在 [weather-manifest](evidence/weather-manifest.json)，11 组结论与文件 SHA256/行号、6 组精选 XML 在 [weather-evidence](evidence/weather-evidence.json)。派生 C# 不是原始源码；XML 摘录没有全量合并继承、DLC 补丁或运行时 Def。

原版观察见 [83](83-native-weather-runtime.md)，Web 实现和简化见 [84](84-weather-gameplay.md)。本轮原版实机只验证一次开发者准备的 Rain 过渡、天气显示、屋顶/室内外提示和淋湿记忆，没有测自然天气概率、速度、命中或发电量。

## 天气如何选择、持续和过渡

依据 WE01/WE02，`WeatherDecider` 从 WeatherDef 中按权重选择，而权重不只是一个固定“下雨概率”。它先过滤不允许重复的当前天气、不合室外温度的天气、定居早期不允许的恶劣天气、禁雨时段/条件等；再以生态 `baseWeatherCommonalities` 为基础，乘当地年降雨曲线、GameCondition 因子，最后还允许地块 mutator 修改。强制天气有单独优先入口。

选中新天气后，`StartNextWeather` 调用 `WeatherManager.TransitionTo`，并从新 Def 的 `durationRange` 抽持续时间。Def 默认范围为 16000..160000 ticks；普通新局初始持续时间为 10000。它不是所有天气都固定每一天重抽，也不是一天对应 86400 个游戏 ticks。

火灾还会反过来影响天气：`FireWatcher` 累加每个火源的 `0.5+fireSize`，危险值 >90 时视为大火危险，常规观测间隔 426 ticks。存在大火危险或当前天气与温度不兼容等条件时，当前持续阈值乘 0.25；选择权重阶段对 `rainRate>0.1` 的天气再乘 15。已有禁雨/温度等过滤仍然有效，因此不能描述为“大火立即自动召来一场雨”。

`WeatherManager` 同时保留 last/current/age，按 `min(age/4000,1)` 插值雨、雪、风、移动倍率和天气命中倍率。外观 Worker 处理叠层、声音和天气事件；玩法消费者读取相应插值结果。

显示名称与思想选取不是同一个开关：新天气感知优先级更高时，`CurWeatherPerceived` 在 18% 过渡处切名，更低时 82%，相同则 50%；`CurWeatherLerped` 固定在 50% 切换。故“HUD 已显示 Rain”不代表降水已达满强度或天气思想已经开始生效。实际原版存档也确认了 Rain 已进入 current、age=0，但画面仍写 Clear 的阶段。

## 选定天气参数

表内值来自 Core XML，标记“默认”的值来自 `WeatherDef` 字段初始化。它们是静态参考，不是本次实测或 Web 必须等速复刻的参数。

| 天气 | rainRate | snowRate | 移动倍率 | 天气命中倍率 | 温度选择条件 |
|---|---:|---:|---:|---:|---|
| Clear | 0 默认 | 0 默认 | 1 默认 | 1 默认 | 默认宽范围 |
| Fog | 0 默认 | 0 默认 | 1 默认 | 0.5 | 默认宽范围 |
| Rain | 1 | 0 默认 | 0.9 | 0.8 | 0..100℃ |
| DryThunderstorm | 0 默认 | 0 默认 | 1 默认 | 1 默认 | 0..999℃ |
| RainyThunderstorm | 1 | 0 默认 | 0.8 | 0.8 | 0..999℃ |
| FoggyRain | 1 | 0 默认 | 0.9 | 0.5 | 0..999℃ |
| SnowGentle | 1 | 0.8 | 1 默认 | 0.8 | −999..−0.5℃ |
| SnowHard | 1 | 1.2 | 0.8 | 0.8 | −999..−0.5℃ |

雪天气也设置 `rainRate=1`，因此消费 RainRate 的灭火等逻辑会受到雪天气影响。这是机制字段的共用，不代表画面应同时渲染雨与雪。

## 遮蔽：移动和射击分别检查哪里

依据 WE03，`Pawn.TicksPerMove` 从 MoveSpeed（必要时 CrawlSpeed）构造基础移动 ticks；只有 **Pawn 当前格无屋顶** 才除以天气移动倍率。对角线、搬运人物、约束状态和工作步态还有各自因子。不要把 `Rain.moveSpeedMultiplier=.9` 直接当成整条任务完成时间乘 1/.9，也不要对室内劳动动画一律降速。

依据 WE05，`ShotReport` 在**射手或目标至少一端无屋顶**时乘 `CurWeatherAccuracyMultiplier`，双方有顶则不加此项；能够忽略命中减益的特殊武器有例外。天气只是命中计算中的一项，还存在距离、武器、掩体、烟雾、目标体型和黑暗等因素。它不是“下雨最终命中率固定 80%”。该检查针对两端格，不能外推成逐格遍历整条射线的屋顶检测。

这两条路径都使用 roof grid 的 Roofed；有屋顶但与户外相通的棚子仍然可以遮雨。“室内温度房间”“有屋顶”“可供太阳能接光”需要分别判断。

## 积雪具有记忆，停雪不会清空地图

依据 WE04，`SteadyEnvironmentEffects` 每 tick 处理 `ceil(mapArea×0.0006)` 个格，沿随机顺序表循环，而不是每 tick 全地图积一次雪。仅在无房间或使用室外温度的房间中，并且**该格无屋顶**，才加入新雪。单次格检查的基础新增量为 `0.046×SnowRate`，再乘空间 Perlin 系数（最低 0.5）。这些量不可直接照搬成 Web 的每格每 tick 增量。

积雪深度由 `SnowGrid` 保存，限定 0..1；完整填充建筑及不承雪地形会阻止保留雪。融化依据该格相应室外/室内温度：

| 温度 T | 每次格检查的融雪量 |
|---|---|
| T<0 | 0 |
| 0≤T<10 | `T²×0.0058×0.1` |
| T≥10 | `T×0.0058` |

落雪和融雪在各自条件下都可能发生；有屋顶不会在此处无条件删除旧雪。身体大小 >0.9 的人物进入新格还会减少 0.001 雪深。火、热地形另有局部融雪路径。

| 深度 | 分类 | 移动格代价参考 |
|---|---|---:|
| [0,0.03) | None | 0 |
| [0.03,0.25) | Dusting | 0 |
| [0.25,0.5) | Thin | 4 |
| [0.5,0.75) | Medium | 8 |
| [0.75,1] | Thick | 12 |

`PathGrid.CalculatedCostAt` 对地形、物件、雪（以及启用时的沙）代价取较大值，再处理门等额外条件；`Pawn_PathFollower` 将得到的格代价加到人物基础移动 ticks。它不是“泥地代价+障碍代价+雪代价全部累加”。雪跨分类时触发路径成本重算；只改变雪花画面无法表达这条经营影响。

## 雨既能灭火，也能带来电气风险

依据 WE06，`Fire` 的复杂计算读取 RainRate>0.01 和 `VulnerableToRain`，施加 Extinguish 伤害。雪天气的 rainRate 因此也能参与。火对雨的暴露规则有自己的例外：无顶可受雨、厚顶不可、薄顶取决于该格建筑 holdsRoof。原版当前 interval 代码比较 `Rand.Value<6`，不能把常量名中的 0.04 误写成每次只有 4% 概率；详见 [79](79-fire-firefighting-mechanisms.md)。这仍不意味着每帧瞬间清空所有露天火。

雷暴的 `WeatherEventMaker` 用 `1/averageInterval×transitionStrength` 逐次随机抽事件，DryThunderstorm 的 lightning flash 和 strike 都配置 averageInterval=1200。自然雷击选择可站立、无屋顶格，未迷雾时产生半径 1.9 的 Flame 爆炸；不是每次从全部殖民地设施中抽一个扣 HP。

本轮补齐上一轮尚未追踪的**雨天电器短路外层调用**（WE10）：环境 tick 在 97 tick 间隔经过 0.02 的概率门槛；随后用 `0.2×电气火灾候选数×RainRate` 进行下一次判定，从该候选表选建筑，要求建筑位置无顶，才调用 `TryShortCircuitInRain`。后者再检查通电且配置 shortCircuitInRain 的用电器或储能 >100 的电池等条件。未继续穷举候选表注册来源，不把这里推成“所有电器下雨必短路”。这与有活跃电源的普通导线 ShortCircuit incident 是两条路径。

## 天色暗了，不一定意味着太阳能降低

依据 WE07，`WeatherWorker.CurSkyTarget` 将光照值设为 `min(天文日光,maxGlow)`，天空颜色另行插值。`SkyManager` 再混合上一个/当前天气、GameCondition、闪电等事件和影响天空的设施。`GlowGrid` 仅对无顶格引入天空光，再与人工光取较高值。

太阳能板读取最终 `CurSkyGlow`，乘额定输出和占地格中无屋顶的比例。Core SolarGenerator 名义额定为 1700W；例：4/6 格无遮顶时其屋顶因子为 2/3。这里检查的是面板占地，不是整间房是否使用室外温度。

**Core 的普通 Rain/Fog 没有覆盖 maxGlow，字段默认 1；灰色画面本身不是减产证据。** Odyssey 的 Overcast 则明确 `maxGlow=.95`，提供了真正限制天空光上限的天气实例；它限制上限，而不是全天所有日光都再乘 .95。Web 可以设计更明显的雨天发电惩罚，但应标为自定经营规则。本次原版没有太阳能实测，且观察跨越下午时间，不能把画面亮度变化都归因于雨。

## 淋湿、娱乐、清洁与仓储

依据 WE08，`Pawn_MindState` 每 120 hash ticks 为符合条件、有 mood 的 flesh Pawn 处理当前 `CurWeatherLerped.weatherThought`。只有一个 stage 的天气思想要求人物无顶；多 stage 天气思想另有室内/外 stage 规则。Core SoakingWet 为 **−3 心情、0.1 天记忆、最多一层**，另有可使其无效的适用 precept；进屋不通过这条入口即时清除记忆。游泳之后短期不重复获得同一记忆也有独立检查。本轮原版 Needs 面板与存档确认了 Rain 后新增这一记忆，未测记忆开始和结束的精确 tick。

`JoyUtility.EnjoyableOutsideNow` 在 RainRate≥0.25 时返回不适合户外娱乐，还要叠加 GameCondition 和人物舒适温度检查。可以据此让室内娱乐有实际价值，不能写成所有娱乐在下雨时停止。

依据 WE09，露天且 `filth.rainWashes=true` 的污物，在环境格访问时按 RainRate 判定是否减薄。雨不会一律清空所有污染，也不会代替所有室内清洁。

露天物品的环境劣化因子会乘 `lerp(1,5,RainRate)`，但是否可劣化、屋顶、房间温度类别、地形和有保护功能的设施仍要参与。选定 Def 中“无顶+0.5、户外+0.5”，保护设施因子为 0。这是物品 **HP 劣化**，与温度驱动的食物腐坏是不同机制，不应在两条系统重复扣同一损失。

## Web 落地顺序与复核

先让天气状态可存读、可观察，再接暴露判断、消防、移动/射击、持续雪层。随后接入淋湿、室内娱乐和仓储保护；电气概率和天气分布留在明确的暂定参数层。已有屋顶/楼板的三维几何应复用真实遮蔽，切层视图不能改变天气规则。具体已做和未做见 84。

```powershell
pwsh -File scripts/research/collect-weather-evidence.ps1
node scripts/research/verify-weather-evidence.mjs
node scripts/research/verify-weather-evidence.mjs --local
```

portable 校验已提交证据关系、裁图哈希和文档链接；local 再核对本机派生文件、原图、动作与原始存档。它们不会启动游戏、重新测量数值或证明所有候选天气都已运行验证。
