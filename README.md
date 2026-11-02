# 余烬边境 · Emberfield

一个可在浏览器游玩的殖民地模拟首版。三名幸存者在96×96温带地图上建立营地，自动采集、搬运、施工、种植、做饭、休息和救治；玩家安排分工、征召防守、研究电力与通信，最终启动信标等待救援。

画面和音效由程序独立生成，运行不需要RimWorld安装目录或资源文件。原有仓库主游戏不受这个独立子项目影响。

在线试玩：[GitHub Pages](https://sqchenxiyuan.github.io/emberfield-web/) · 源码：[sqchenxiyuan/emberfield-web](https://github.com/sqchenxiyuan/emberfield-web)。

原版机制研究见 [RimWorld 详细机制与复刻设计](docs/research/rimworld/README.md)：工作与预定、战斗与医疗、房间温度与电网、财富叙事与贸易，附版本哈希、公式、算例和未验证边界。研究对象是本地 `1.7.4980 rev60`，这些数值不代表当前Web版已经实现。运行 `npm run research:check` 可独立核对证据索引与算例。

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
| 左键 / 拖动框选 | 选择人物、放置蓝图、划定区域 |
| 右键 | 给选中人物下移动/攻击指令 |
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
npm run test:campaign
npm run test:seeds
npm run test:performance
# 另一个终端保持 npm run preview 运行
npm run test:browser
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
