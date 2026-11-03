# 余烬边境 · Emberfield

一个可在浏览器游玩的殖民地模拟首版。三名幸存者在96×96温带地图上建立营地，自动采集、搬运、施工、种植、做饭、休息和救治；玩家安排分工、征召防守、研究电力与通信，最终启动信标等待救援。

画面和音效由程序独立生成，运行不需要RimWorld安装目录或资源文件。原有仓库主游戏不受这个独立子项目影响。

在线试玩：[GitHub Pages](https://sqchenxiyuan.github.io/emberfield-web/) · 源码：[sqchenxiyuan/emberfield-web](https://github.com/sqchenxiyuan/emberfield-web)。

原版机制研究见 [RimWorld 详细机制与复刻设计](docs/research/rimworld/README.md)：工作与预定、战斗与医疗、房间温度与电网、财富叙事与贸易，附版本哈希、公式、算例和未验证边界。研究对象是本地 `1.7.4980 rev60`，这些数值不代表当前Web版已经实现。运行 `npm run research:check` 可独立核对证据索引与算例。

2026-11-02更新：修复动物长时间等待，增加物品/动物/资源检查、劳动动画与墙/导线连续拖建。[原版运行对照与修复验证](docs/research/rimworld/07-runtime-interaction-comparison.md) 记录实际操作和边界。

新增 **[多层体素试玩](https://sqchenxiyuan.github.io/emberfield-web/?world=voxel)**：64×64×16，真实地下开凿、逐格搭梯、跨层搬运、二层楼板与墙体、旋转剖切和独立存档。现已加入三种食用作物与棉花、遮光生长、自动收获补种、烧木灶台订单和实体进食。[施工验收](docs/research/rimworld/11-voxel-implementation.md)、[食物规则研究](docs/research/rimworld/12-farming-cooking-food.md)和[食物实现验收](docs/research/rimworld/13-voxel-food-implementation.md)分别记录来源与实现边界。住房、电网、房间温度以及营养/温度损伤、医疗床和跨层救援均已接入；近战伤口与无药包扎已接入，完整疾病医疗仍待实现。首页仍是原二维营地，两个入口分别保存进度。

体素操作：伐木 → 下挖梯井 → 切「地下」挖矿 → 回地面向上搭梯 → 切「二层」从梯旁铺楼板。Q/E旋转、[ / ]逐格切层、滚轮缩放、中键拖转、WASD平移、Space暂停。体素入口使用Three.js WebGL2 Worker，`?world=voxel&render=main`为兼容路径；二维入口继续使用PixiJS 8。

2026-11-03体素住房更新：双格木床、床位分配、24小时作息、真实步行上床睡眠、自动门/敞开/锁定，以及地下与楼上的六向房间检查。床45木材、门25木材，R切换建造朝向；先砍树补料。[住房规则和验证](docs/research/rimworld/15-voxel-housing-implementation.md)说明具体边界。

2026-11-03电力温控更新：木燃发电机1000 W、4×4太阳能板1700 W、电池600 Wd、实体补燃料、跨层电线，以及双侧冷气机、加热器与真实房间温度。采钢矿和机械矿取得设备材料，在竖井逐层铺线；点击设备调开关与目标温度。[16原版规则](docs/research/rimworld/16-power-thermal-mechanisms.md)与[17实现验收](docs/research/rimworld/17-voxel-power-thermal-implementation.md)区分来源、三维扩展和验证边界。该阶段尚无温度伤害、短路或季节；季节已在后续世界生成更新接入。

2026-11-03保鲜更新：食品按所在房间温度腐坏，0°C及以下暂停、0～10°C减慢；搬运、合堆、配送和回读保留进度。稻米/土豆/玉米与简餐的常温保存期为40/30/60/4日，初始包装生存口粮不腐坏。点击仓储设置“仅收食物”和较高优先级，工人会实际搬入冷库；新存档v5兼容v1～v4。[19机制研究](docs/research/rimworld/19-preservation-mechanisms.md)与[20实现验收](docs/research/rimworld/20-voxel-preservation-implementation.md)记录温度、容器和腐坏账本。

2026-11-03有限物流更新：地面一格一堆，木材/石砖/钢材/谷物75、零件50、餐食10；满仓等待，扩容后恢复搬运，检查面板显示占用、预留和单堆余量。开局请扩大仓储，食品冷库也需按实际堆数留位置。满地生产/退料不会丢物，运输中回读继续工作。该阶段v6引入有限堆迁移；旧大堆拆到附近合法空地后暂停，请检查冷库，空间不足则拒绝加载。[21原版规则](docs/research/rimworld/21-storage-logistics-mechanisms.md)、[22原版实测](docs/research/rimworld/22-native-storage-runtime.md)、[23历史验收](docs/research/rimworld/23-voxel-logistics-implementation.md)分别记录证据与适配，原版71木材实测没有被当作满75验证。

2026-11-03切石更新：天然花岗岩每个被移除的体素有25%机会留下1岩块（每格/每次搬运1块），不再直接产砖。建3×1木切石台需75木材+30钢材，1岩块加工为20石砖；点击设库存目标、暂停，R旋转并留出操作位。墙/楼板可选石砖，分别用10/4砖，工人沿梯子实际配送施工。修改目标保留当前批次，暂停账单才退料。该阶段v7保留旧石材为石砖，旧仓储需手动勾选岩块；切石科技暂默认解锁。[24原版规则](docs/research/rimworld/24-stonecutting-mechanisms.md)、[25原版操作](docs/research/rimworld/25-native-stonecutting-runtime.md)、[26实现验收](docs/research/rimworld/26-voxel-stonecutting-implementation.md)区分原版证据与三维适配。

2026-11-03世界生成更新：菜单中可预览并创建温带森林、寒带森林和沙漠，选择四档起伏，分别调整均温、雨量、纬度。实际土壤肥力、树种产量、有限三维矿脉与季节温度进入模拟；按真实出生点定位，新增总览视角。v8保留旧营地地形和旧温度规则。[27原版规则](docs/research/rimworld/27-biomes-terrain-generation.md)、[28原版选址](docs/research/rimworld/28-native-world-generation-runtime.md)、[29历史验收](docs/research/rimworld/29-voxel-world-generation-implementation.md)区分来源与适配；河海、洞穴和完整行星世界图仍未实现，植被更新见下。

2026-11-03林业更新：树木有成长、树龄、健康及当前木材收益，受光照、温度和肥力影响，画面大小随成长变化。「林地区」可选择白杨、松树或巨柱仙人掌，自动留一格间距、实际播种，手动采伐后补植；取消林地保留树，清除幼苗不产木材。自然新苗避开农田、仓储、工位和唯一通路，老化或长期遮光会损伤树木。v9兼容旧成熟树及在途采伐工作。[30原版规则](docs/research/rimworld/30-plants-lifecycle-forestry-regrowth.md)与[32实现验收](docs/research/rimworld/32-voxel-plants-implementation.md)记录14.21游戏日经营闭环、旧存档与两条渲染路径；科技技能预解锁，树桩、病害和完整生态尚未实现。

2026-11-03生存救援更新：断粮、过冷和过热会逐渐损害健康，严重时倒地或死亡。普通木床可切换为医疗床；启用同伴「医护」后，会实际抱起患者跨层送床、取食物并喂食。人物面板显示病情与能力，亦可手动安排帮助者。v10保存病情、死亡与在途救援，兼容旧营地。[33原版规则](docs/research/rimworld/33-survival-health-mechanisms.md)、[34实机救援/喂食](docs/research/rimworld/34-native-survival-runtime.md)、[35实现与验收](docs/research/rimworld/35-voxel-survival-implementation.md)区分证据、数值与适配。该阶段按裸身耐受计算，衣物保温现已在后续更新接入；近战伤口已在后续更新接入，完整疾病和搬尸仍未实现。

2026-11-03衣物裁缝更新：棉花成熟直接产布，3×1 手工裁缝台用 75 木材建造，可制作无边帽、派克大衣、长外套、T 恤和长裤。点击衣物指定同伴取穿，人物衣着栏可脱下；旧衣物真实落地，穿着改变温度耐受并逐日磨损。新营地每人有普通布衫和长裤，v11 保留旧营地原有状态，不补发衣物。当前只开放布材质，制作固定普通品质、研究预解锁。[36原版规则](docs/research/rimworld/36-apparel-tailoring-mechanisms.md)、[37实机验证](docs/research/rimworld/37-native-apparel-runtime.md)、[38实现验收](docs/research/rimworld/38-voxel-apparel-implementation.md)分别说明来源与适配。

2026-11-03外伤更新：菜单可开启有三日准备期的袭击，殖民者支持征召、近战和战术移动。真实外伤进入疼痛、失血与能力计算；医护实际赶路逐处无药包扎，包扎后仍需恢复。败退敌人恢复后沿通路离场，v12保留旧营地和平设置。[39原版规则](docs/research/rimworld/39-injuries-medicine-mechanisms.md)、[40原版护理实机](docs/research/rimworld/40-native-injuries-runtime.md)、[41实现边界与验收](docs/research/rimworld/41-voxel-combat-injuries-implementation.md)。当前七区人体、固定命中与袭击节奏为项目适配；无完整护甲、药物感染和俘虏系统。

2026-11-03实体武器更新：免费制作点可制作木棒和钢匕首，100 钢材建造的燃料锻造台还可制作钢长剑。工人实际运料、加工和搬运成品；点击武器查看信息、安排取用，人物面板可放下。更换旧武器落地，主动丢弃和地面倒地后的武器禁止自动搬运，明确装备可解除。v13 保存武器身份、耐久、燃料和中途任务，该阶段420项单元测试通过；后续技能和品质见下方v14更新。无环境腐蚀或完整护甲。[42规则研究](docs/research/rimworld/42-weapons-crafting-equipment-mechanisms.md)、[43原版正常制作与换装](docs/research/rimworld/43-native-weapons-runtime.md)、[44实现与验证](docs/research/rimworld/44-voxel-weapons-implementation.md)。

2026-11-03技能更新：体素人物现有七项技能、热情、实际劳动经验、升级与高等级衰退。采矿/种植/建造/烹饪/医疗和格斗按各自规则生效；工艺影响配方门槛及衣物、钢刀剑品质，切石不提供经验。多人采矿累积产量贡献，低技能作物可能收获失败；成品品质和收获量在完成时锁定，满地面、换人和读档不重抽。v14保留旧存档已有物品与品质，不补发历史经验。研究仍预解锁。[45规则研究](docs/research/rimworld/45-skills-learning-quality-mechanisms.md)、[46原版制刀与技能观察](docs/research/rimworld/46-native-skills-runtime.md)、[47实现与验证](docs/research/rimworld/47-voxel-skills-implementation.md)。

体素供粮：尽早在土壤上规划约110–128格稻米（每次框选最多128格），保留阳光，建一座20木材灶台。点击灶台设置简餐目标；每餐消耗10生食材和1木材。稻米约8游戏日首收，1日常速10分钟，可开3倍速。简餐宜少量制作，囤餐需实际降温的冷库；树木需继续砍伐补燃料。新世界需考虑季节和土壤：寒带低温会停长，沙地不能种普通作物；8日首收是适温普通土壤的参考。断粮现在会产生健康后果，食物中毒尚未实现。

## 启动

在此目录执行，建议Node.js 22.12以上：

```powershell
npm ci
npm run dev
```

打开 http://127.0.0.1:5178 。正式构建与预览：

```powershell
npm run build
npm run preview
```

预览地址为 http://127.0.0.1:4178 。`dist/`可部署到支持静态文件的HTTP服务；Worker不能通过直接双击HTML文件运行。默认优先尝试WebGPU Worker，再回退到WebGL；也可指定 `?backend=webgl` 或 `?backend=main` 验证兼容路径。浏览器需支持模块Worker与IndexedDB，桌面Chrome/Edge是本版主要目标。

## 第一局怎么玩

1. 建议先暂停。在营地附近放三张木床、一座燃木灶台；拖动划定仓储区，以及6×8谷物田。
2. 用伐木工具标记一片树林，补充建设和燃料所需木材。工人会先预定、收集材料，再施工；点击人物可以查看其当前工作。
3. 在“分工”设置优先级。1最高、4最低、横线表示不参与；种植、做饭和医疗不要全部关闭。身体需求会优先于常规工作。
4. 第4日前后会出现第一次袭击。选中人物按R征召，右键安排位置。射手会攻击射程内目标，近战角色守住原位；右键敌人才是明确追击。防御掩体可以降低远程命中。
5. 战后解除征召，有医疗岗位的人会带药救治；倒地者可以被搬到床位。伤口、出血和失去朋友会影响生活。
6. 建研究桌，完成“基础电力→远程通信→救援信标”。采矿获取更多金属；燃木发电机与信标需要相邻连接或通过导线连通。
7. 启动信标后保持供电两日，在半日和一日半时抵御两波袭击。救援到达后可以结束，或选择继续经营。

普通事件和战斗存在随机性。研究所需劳动与人物技能、分工有关，第一版不承诺所有玩家在固定天数撤离。

## 操作

界面按殖民地模拟游戏的布局组织：地图铺满主体，殖民者头像在顶部居中，资源列表在左侧，建造/区域/分工/研究/纪事入口在底部，天气、时间和倍速在右下角。选中人物或建筑后，详情在左下展开；再次点击底部面板按钮或按Esc收起。人物详情分“状态、健康、技能”，分工表按人物行、岗位列调整优先级。

| 操作 | 效果 |
|---|---|
| 左键 / 拖动框选 | 单击检查人物、动物、物品、资源、作物和建筑；框选只选殖民者，同格反复单击切换对象 |
| 建造工具内左键拖动 | 墙/导线按横竖主方向连续规划，显示材料需求和无效位置；材料不足也可放蓝图 |
| 右键 | 选择工具下指挥殖民者移动/攻击；建造等工具下退出工具 |
| 中键拖动、WASD、方向键 | 移动镜头 |
| 滚轮 | 缩放 |
| Space | 暂停/恢复 |
| 1 / 2 / 3 | 1× / 3× / 6× |
| R | 征召/解除征召 |
| Esc | 关闭面板、退出当前绘制工具 |

菜单提供手动保存、自动槽读取、JSON导入导出、音效开关和性能面板。每30现实秒自动保存；标签页隐藏时暂停并尝试保存，返回后保持暂停。浏览器清理站点数据会删除IndexedDB，重要存档应导出。

## 已实现的范围

- 3名固定初始殖民者；需求、心情、记忆、工作优先级、三种日程、征召。
- 18种建筑定义，谷物/药草两种种植区，仓储区、伐木、采矿、浆果采集、拆除与蓝图取消。
- 真实物品堆、可跨堆收集的材料预定、搬运与中断释放；厨房储备账单和有劳动成本的零件加工。
- 6个研究项目；燃木/太阳能供电、导线连通、蓄电、局部冷藏；信标掉电暂停且不重复刷波次。
- 身体六部位、伤口、出血、倒地、死亡、救援与包扎；射程、墙体视线、掩体和战后恢复。
- 日夜、天气、作物受温度影响、食品腐败、有限事件日志；普通袭击、终局两波、胜败和继续经营。
- 版本化完整存档、导入验证、独立手动/自动槽、页面重载恢复；生成式小型纹理与合成音效。
- 可达范围内的动物闲逛、短休和受困提示；选中对象实时检查；劳动工具/粒子与进度反馈，移动不挥工具、暂停冻结。

这是基于设计稿核心链条做出的第一版独立游戏，不是完整Core或DLC内容实现。尚未加入贸易/派系任务、招募与人口成长、动物狩猎/驯养、感染与免疫、详细社交、屋顶/房间热交换、火灾、装备制造与护甲、多地图、多人和Mod兼容。冷藏在本版是设备周围四格的简化效果；营火用于局部寒冷心情与娱乐，不是完整房间热力系统。

## 技术结构

| 文件 | 职责 |
|---|---|
| `src/sim/world.ts` | 纯TypeScript权威模拟，可直接在Node运行 |
| `src/sim/path.ts` | 可复用工作区的格网A* |
| `src/sim/defs.ts` | 建筑、资源、工作与科技定义 |
| `src/sim/save.ts` | 在替换世界前校验存档及材料预定 |
| `src/sim.worker.ts` | 20TPS固定步长、倍速、存档、显示缓冲池 |
| `src/render.worker.ts` / `src/renderer.ts` | PixiJS 8.22.0、OffscreenCanvas、插值、分块与视野裁剪 |
| `src/client.ts` / `src/main.tsx` | React界面、输入路由、Worker管理与兼容路径 |

模拟与渲染Worker用MessageChannel直连；显示快照约20Hz，UI摘要约5Hz；3个可归还ArrayBuffer循环使用。渲染端持有显示字段，不保存人物完整任务/健康模型；地形分16×16块，不烘焙整张世界大纹理。IndexedDB只在保存时接收完整世界。日志最多100条。

开发调试入口 `window.ember` 提供只读快照、完整状态导出，以及走同一模拟命令校验的 `command`、`speed` 和镜头 `focus`。它用于调试和测试，不作为屏幕型Agent评测的隐藏状态输入。

## 验证

```powershell
npm test
npm run test:animals
npm run test:campaign
npm run test:seeds
npm run test:performance
# 另一个终端保持 npm run preview 运行
npm run test:browser
$env:COLONY_TEST_URL='http://127.0.0.1:4178'
npm run test:interactions
npm run test:memory
```

浏览器脚本使用本机Chrome，通过Playwright驱动。`test:browser`与`test:memory`依赖`test:campaign`生成的第8日真实存档。内存脚本默认持续5分钟；`COLONY_SOAK_SECONDS`可调整。无需为此安装原游戏。

规则与流程证据、实际性能、统计口径、尚未验证的条件见 [首版范围与验证](docs/validation.md)。原始运行输出在本目录的 `test-results/`，由Git忽略，可以通过上述命令再生成。

## GitHub Pages 发布

推送到独立仓库的 `main` 后，GitHub Actions 会安装锁定依赖、运行规则与完整流程测试、构建并发布。也可在Actions中手动运行 **Deploy Emberfield to GitHub Pages**。Pages的Source设置为 **GitHub Actions**。

Vite使用相对资源路径，模块Worker也由构建处理，因此可部署在 `/emberfield-web/` 子路径；不需要额外服务器或跨源隔离响应头。运行存档留在访问者浏览器，网站不会上传游戏存档。 localhost与GitHub Pages是不同来源，需要用JSON导出/导入迁移进度。

本地综合工作区的开发目录为 `experiments/rimworld-like`。该目录通过Git subtree发布到独立仓库，后续同步可在综合工作区根目录提交本项目后执行：

```sh
git subtree push --prefix=experiments/rimworld-like emberfield main
```

直接克隆独立仓库开发时，正常提交并推送到 `main` 即可触发发布。

2026-11-03研究更新：3×2简易科研台、智识技能和五项后续科技已接入，工业新局保留七项起始知识；旧档v15保留旧功能。见[50研究实现与验收](docs/research/rimworld/50-voxel-research-implementation.md)。
