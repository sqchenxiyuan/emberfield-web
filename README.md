# 余烬边境 · Emberfield

v59接通动物训练与实际协作：从商队取得拉布拉多犬 → 饲养员取粮并分两次喂食训练 → 学会服从、释放攻击、救援和搬运 → 实际跟随、战斗、驮送病人和搬送物资。主人指派、技能遗忘、真实货物、工作中断和存读共同接入；救援和搬运无需主人。玩法机制优先，数值集中后调。见[161原版静态机制](docs/research/rimworld/161-animal-training-mechanisms.md)、[162玩法与验证](docs/research/rimworld/162-animal-training-gameplay.md)。本轮仅静态与无界面验证，下文各版本记录当时边界。

v58接通囚犯实体送餐：狱卒实际取餐并搬进牢房落地，囚犯自行取餐、寻找餐位和咀嚼，完成才消费食物并补充营养；卧床者继续床边喂食。支持房间供餐估算、份额竞争、满地等待、中断与存读。玩法机制优先，数值后调。见[159原版静态机制](docs/research/rimworld/159-prison-food-mechanisms.md)、[160玩法与验证](docs/research/rimworld/160-prison-food-gameplay.md)。本轮仅静态和无界面验证；下文版本段落保留当时边界。

v57接通共享饮食政策与手动食用：按进食者政策选择真实食物，居民自行取餐、医生/狱卒送餐与途中中断共同遵守规则；玩家可临时指定食物覆盖政策，仍须实际前往并吃完。存档保留实际批次和任务，旧营地继续原有自由饮食。玩法机制优先，数值后调。见[157原版静态机制](docs/research/rimworld/157-food-policies-mechanisms.md)、[158玩法与验证](docs/research/rimworld/158-food-policies-gameplay.md)。本轮仅静态和无界面验证。

v56接通服装政策与自动换装：共享筛选 → 从真实储存区取衣 → 步行装备 → 旧衣落地和搬运；手动穿戴有强制保留标记，可逐件或全部解除。政策修改、预约竞争、区域限制、中断和存读共同接入，旧营地保留手动管理。玩法机制优先，数值后调。见[155原版静态机制](docs/research/rimworld/155-apparel-policies-mechanisms.md)、[156玩法与验证](docs/research/rimworld/156-apparel-policies-gameplay.md)。本轮仅静态分析与无界面验证。

v55接通动物环境生存：实际房间温度与物种耐受 → 失温/中暑 → 寻温避险或倒地 → 实际救助转床 → 适温恢复；地面火焰接触也会产生可护理的烧伤。病情贯穿交易与存读，草药不能治疗纯温病。玩法机制优先，数值集中后调。见[153原版静态机制](docs/research/rimworld/153-animal-environment-mechanisms.md)、[154玩法与验证](docs/research/rimworld/154-animal-environment-gameplay.md)。本轮仅静态分析与无界面验证；附着火、自行灭火、冻伤等继续待补。

v54接通动物医疗：伤口与失血 → 倒地 → 现场护理/实际救助搬运 → 动物医疗睡眠点 → 取食喂养与逐步恢复。动物保留身份和归属，支持护理政策、任务中断与存读；医护负责治疗，医护或饲养员可以救助和喂食。见[151原版静态机制](docs/research/rimworld/151-animal-medical-mechanisms.md)、[152玩法与验证](docs/research/rimworld/152-animal-medical-gameplay.md)。完整动物器官、感染和手术继续待补。

v53接通活畜交易：商队带真实公母鸡、羊驼或单峰驼入场 → 按个体与物资统一结算 → 保留年龄/健康/孕期和产物进度 → 接回圈养繁殖，或出售后随商队走出地图。支持受阻等待、妊娠分娩、历史回执和存读；新商队改为供活鸡，旧档已有受精蛋保留。见[149原版静态机制](docs/research/rimworld/149-live-animal-trade-mechanisms.md)、[150玩法与验证](docs/research/rimworld/150-live-animal-trade-gameplay.md)。机制优先、数值后调，本轮继续只做无界面验证。

v52接通蛋箱：真实搬料建造 → 母鸡集中产蛋 → 箱内孵化/保鲜 → 搬运工到场取蛋 → 实际入库。支持提前清空、禁止、仓位预约、工作中断、拆除/火灾和存读续行；玩法机制优先，数值后调。见[147原版静态机制](docs/research/rimworld/147-egg-box-mechanisms.md)、[148玩法与验证](docs/research/rimworld/148-egg-box-gameplay.md)。本轮未操作原版或浏览器，下文版本段落记录当时边界。

v51接通鸡蛋与孵化：商队受精蛋取得（Web适配）→ 适温孵化 → 幼鸡成长圈养 → 实际配种与自行产蛋 → 按营养烹饪或继续繁殖。搬运、堆叠、温损转换、存读和旧账单选择相互衔接；机制优先、数值后调。见[145原版静态机制](docs/research/rimworld/145-animal-eggs-mechanisms.md)、[146玩法与验证](docs/research/rimworld/146-animal-eggs-gameplay.md)。蛋箱和活畜贸易继续待补，本轮未操作原版或浏览器。

v50接通剪毛与材质衣物：温带羊驼 → 驯服圈养 → 公母成年长毛 → 到场剪毛 → 实物羊毛 → 裁缝单材选料 → 未完成品 → 穿衣御寒。旧存档保留原材料与筛选，玩法机制优先，数值后调。见[143原版静态机制](docs/research/rimworld/143-animal-wool-mechanisms.md)、[144玩法与验证](docs/research/rimworld/144-animal-wool-gameplay.md)。当前继续暂停原版与浏览器交互。

v49接通单峰驼产奶：荒漠野生动物 → 实际驯服与圈养 → 成年雌性积奶 → 饲养员到场挤奶 → 实物储存、食用、烹饪和交易。支持工作打断、存读续行、拥堵等待和原有自动宰杀；机制优先，数值后调。见[141原版静态机制](docs/research/rimworld/141-animal-milk-mechanisms.md)、[142玩法与验证](docs/research/rimworld/142-animal-milk-gameplay.md)。本轮只有静态分析及无界面验证，未操作原版或浏览器。

v48接通自动宰杀：按物种设置成年、幼年和总数上限 → 保护孕兽并筛选超额个体 → 饲养员实际前往处理 → 唯一尸体进入屠宰加工。支持修改配额取消任务、中途保存继续，手动指令独立保留；旧档默认全部不限。机制优先，数值后调。见[139原版静态机制](docs/research/rimworld/139-auto-slaughter-mechanisms.md)、[140玩法与验证](docs/research/rimworld/140-auto-slaughter-gameplay.md)。本轮仅静态分析和无界面验证，未操作原版或浏览器。

v47接通施工失误与恢复：建造技能和身体能力 → 按实际劳动累计风险 → 实物材料损失与余料落地 → 普通蓝图重新搬料施工。重试独立于家园自动重建，拥堵、取消、火灾、货架联动和旧档可继续衔接；数值平衡后调。见[137原版静态机制](docs/research/rimworld/137-construction-failure-mechanisms.md)、[138玩法与验证](docs/research/rimworld/138-construction-failure-gameplay.md)。本轮仅静态分析和无界面验证，未操作原版或浏览器。

v46接通毁坏后的恢复经营：家园自动重建开关 → 普通蓝图 → 真实搬料施工 → 可取消与保存继续。补上施工框架燃烧、完工耐久比例继承、整墙损伤和电线／沙袋重建，货架保留收纳设置与联动组。继续先搭玩法机制，数值后调。见[135原版静态机制](docs/research/rimworld/135-auto-rebuild-mechanisms.md)、[136玩法与验证](docs/research/rimworld/136-auto-rebuild-gameplay.md)。本轮遵守暂停程序交互的约束，仅做静态分析、无界面模型测试、构建和发布字节核对。

v45接通通用物品禁止／允许：可逐堆切换，也可按当前工作层框选；普通搬运、施工和生产取料、吃饭、护理与饲养共同遵守。禁止保留实物、库存、财富及交易资格；未完成品保留进度，明确装备／穿戴会解除该物品的禁止。继续优先玩法与机制，数值后调。见[132静态机制](docs/research/rimworld/132-item-forbidden-mechanisms.md)、[133玩法与本地验证](docs/research/rimworld/133-item-forbidden-gameplay.md)、[134验证边界](docs/research/rimworld/134-native-item-forbidden-runtime.md)。本轮仅静态分析、无界面模型测试及构建，未完成原版或浏览器交互验证。

v44接入居民允许区域：创建和命名 → 按工作层绘制 → 分配居民 → 工作、取料、生活与收纳筛选 → 修改后的任务衔接 → 保存继续。区域与兔子的活动范围共用，空区不限活动，允许经过区外通路，征召和手动装备武器有明确例外。继续先搭玩法与机制，数值后调。见[129原版机制](docs/research/rimworld/129-allowed-area-mechanisms.md)、[130玩法与验证](docs/research/rimworld/130-allowed-area-gameplay.md)、[131原版实机](docs/research/rimworld/131-native-allowed-area-runtime.md)。

v43接通河流与架桥：世界河网和局部水道 → 浅水涉行／深水阻挡 → 连续规划木桥 → 实际搬料施工 → 通行、轻型建造与拆除 → 保存继续。桥下保留水体，浅水允许实际仓储，旧营地保持原地形。先完成玩法闭环，桥梁成本、河宽与移动速度后调。见[126原版机制](docs/research/rimworld/126-river-bridge-mechanisms.md)、[127玩法与验证](docs/research/rimworld/127-river-bridge-gameplay.md)、[128原版实机](docs/research/rimworld/128-native-river-bridge-runtime.md)。

v42接通成品去向：制作完成后就地放下、由制作者送往最佳仓库，或送往指定区域／货架／联动储存组。地面仓库支持稳定身份、命名和扩展；成品配送不依赖搬运分工，途中保存和目标失效保留实物，完成次数只结算一次。继续先搭机制闭环，数值后调。见[124原版机制](docs/research/rimworld/124-production-output-mechanisms.md)、[125玩法与验证](docs/research/rimworld/125-production-output-gameplay.md)。

v41接入独立未完成品：13条裁缝、武器和护甲配方保存实物材料、作者与加工进度；暂停和删除账单保留物品，可搬运入库、跨兼容工作台由原作者续作，单独取消才退料。见[122原版机制](docs/research/rimworld/122-unfinished-production-mechanisms.md)、[123玩法与验证](docs/research/rimworld/123-unfinished-production-gameplay.md)。继续先搭玩法闭环，退料比例、耐久和工作速度等数值后续统一调整。

一个可在浏览器游玩的殖民地模拟游戏。目前主要扩展64×64×16的多层体素模式：真实地下开凿、楼层建造、跨层物流、生产、健康和殖民地经营。另保留96×96的二维营地首版，其通信信标与撤离流程属于二维入口。

画面和音效由程序独立生成，运行不需要RimWorld安装目录或资源文件。原有仓库主游戏不受这个独立子项目影响。

在线试玩：[多层体素](https://sqchenxiyuan.github.io/emberfield-web/?world=voxel) · [二维营地](https://sqchenxiyuan.github.io/emberfield-web/) · 源码：[sqchenxiyuan/emberfield-web](https://github.com/sqchenxiyuan/emberfield-web)。

2026-11-04储存组联动（v38）：货架、施工蓝图和打包货架可共享筛选与优先级，支持改名、转组、解除与成员定位。规则变化驱动实际搬运，建成和跨层搬装保持联动，旧存档继续可用。原版普通操作与 Web 差异见[116机制](docs/research/rimworld/116-storage-groups-mechanisms.md)和[117玩法与验证](docs/research/rimworld/117-storage-groups-gameplay.md)。继续以玩法闭环为先，数值后调。

2026-11-04通道与寻路：人物会比较绕行与穿过货架、积雪、沙袋和自动门的通行成本；途中堵路可保留任务改走其他路线，普通移动读档也能恢复目的地。动物目标路线保留自身速度与通行限制。原版实机确认了货架两侧的一次真实绕行，Web 的多层适配、验证与未完成边界见[115 加权寻路](docs/research/rimworld/115-weighted-navigation-gameplay.md)。仍使用 v37 存档，继续优先玩法机制，数值后调。

2026-11-04实体货架：小货架一格三堆、大货架两格六堆；工人按整架筛选与优先级搬入，从旁边取用。满架可卸下、散货并重装，保留原架身份、耐久和设置；空间不足时等待，火毁拥堵保留可继续搬运的散货。界面支持逐堆查看、设置和搬装预览，存档升级 v37 并兼容旧档。见[114 货架玩法与验证](docs/research/rimworld/114-shelves-gameplay.md)。玩法机制优先，成本与节奏数值后调。

2026-11-04补充[111实体货架机制](docs/research/rimworld/111-shelf-storage-mechanisms.md)与[112原版实机](docs/research/rimworld/112-native-shelves-runtime.md)：正常建造后同格储存三堆，满架可直接卸下；物资留在地图上，原架的储存设置随重装和读档保留。Web 实现承接[113物资预约基础](docs/research/rimworld/113-storage-reservations-foundation.md)，原版事实与 Web 适配分别记录。继续优先玩法与机制，成本和效率数值后调。

2026-11-04补充[110原版探索实机](docs/research/rimworld/110-native-exploration-runtime.md)：普通操作验证未知区域可规划采矿、不能直接建墙；实际挖通后显露空间并清除空地上的采矿标记，重新载入保留结果。本次原版目标为岩壁封住的露天空地，和Web的三维地下洞室区分记录。研究更新未改变v36游戏逻辑，继续以机制与操作闭环为先、数值后调。

2026-11-04地下探索更新（v36）：新地图加入真实地下洞室与相连隧道。可以开凿梯井、在未知区域拖出采矿计划，挖通后揭示连通空间及矿面；空洞里的多余采矿标记自动清除。切层和侧栏遵守探索状态，发现记录随存档保留，旧营地继续原地形与可见状态。优先接通开采、发现与回运，洞穴密度和劳动参数后续再调。当前洞室需人工开入口，尚无天然地表洞口或地下水。见[108原版机制](docs/research/rimworld/108-caves-exploration-mechanisms.md)、[109玩法与验证](docs/research/rimworld/109-caves-exploration-gameplay.md)。

2026-11-04世界选址更新（v35）：菜单新增世界地图，固定世界种子生成1,152个地区。可以点选、键盘选择和对比三个地点，再进入对应的实际营地；气候、起伏、可耕地、林木和有限矿脉影响开局取舍。地区身份随存档保留，旧营地不重新生成；仍支持自定义地图。先接选址与经营机制，世界分布参数后续再调整。海洋仅用于世界图背景，本地河流和世界旅行尚未实现；地下洞室由v36加入。见[106原版机制](docs/research/rimworld/106-world-site-selection-mechanisms.md)、[107玩法与验证](docs/research/rimworld/107-world-site-selection-gameplay.md)。

2026-11-04家具搬装更新（v34）：床、餐桌和餐椅可以卸下、入库、跨层搬移和旋转重装。工人实际搬运指定的原家具，身份、品质与耐久保留；取消、满地面、征召或倒地、火灾和途中读档均按实体处理。新增搬装按钮、预览与阶段检查，旧仓储筛选保持原设置。先完成营地改造玩法，参数后续再调整。见[103原版机制](docs/research/rimworld/103-furniture-reinstall-mechanisms.md)、[104实机对照](docs/research/rimworld/104-native-furniture-reinstall-runtime.md)、[105玩法与验证](docs/research/rimworld/105-furniture-relocation-gameplay.md)。

当前开发重点是先搭好可操作的玩法和机制闭环，数值采用初步默认值，后续再平衡。体素模式已接通狩猎与肉食生产、动物驯养繁殖与圈养管理、心情娱乐、俘虏招募、卫生清洁、火灾修理及天气联动，见[开发路线](docs/research/rimworld/05-reconstruction-roadmap.md)；研究文档中的原版数值不代表当前游戏已经完成平衡。

2026-11-04家具品质更新（v33）：床、餐桌和餐椅在实际施工完成时按完工者的建造技能确定品质，影响实际睡眠恢复、床椅舒适、美观与房间/营地财富；品质不增加家具耐久。界面可检查品质和使用效果，旧家具按普通品质延续，修理和读档不重抽。沿用暂定成本与基础属性，先连接建造分工与生活反馈。见[100原版机制](docs/research/rimworld/100-furniture-quality-mechanisms.md)、[101实机对照](docs/research/rimworld/101-native-furniture-quality-runtime.md)、[102玩法与验证](docs/research/rimworld/102-furniture-quality-gameplay.md)。

2026-11-04居民交往更新（v32）：餐桌可开关聚会，居民实际走到空闲餐椅休闲，附近同伴自然发生闲聊、深入交谈或侮辱。两方向好感、来源记忆和独立侮辱心情可检查；座位与用餐共享预约，支持中断、离图身份和旧档继续。先完成社会玩法基础，亲属/恋爱/性格及社交打架仍待扩展，数值后续调整。见[97原版机制](docs/research/rimworld/97-social-interaction-mechanisms.md)、[98实机对照](docs/research/rimworld/98-native-social-runtime.md)、[99玩法与验证](docs/research/rimworld/99-social-colony-gameplay.md)。

2026-11-04房间生活更新（v31）：新增实体木餐桌和餐椅，居民取走实际餐食后预约座位、步行就座并持续吃饭，完成才恢复饱食度。舒适、无桌记忆、房间评价与卧室/宿舍体验接入人物状态，支持中断、火灾和旧档延续。先打通玩法，家具成本与行为节奏仍采用暂定参数，见[94原版机制](docs/research/rimworld/94-dining-comfort-mechanisms.md)、[95实机对照](docs/research/rimworld/95-native-dining-runtime.md)、[96玩法与验证](docs/research/rimworld/96-living-dining-gameplay.md)。

2026-11-04圈养管理更新（v30）：围栏可拖动连续施工，栏门和圈地标记形成真实三维圈地；饲养员挂绳后带鹿实际穿门，动物进入后才解绳。兔使用可绘制的活动范围并步行返回。界面支持圈地筛选、命名、暂停/指定牵引和范围管理；中断、火灾破圈与途中存档相互衔接。参数保持集中可调，见[91原版机制](docs/research/rimworld/91-animal-pens-mechanisms.md)、[92原版实机](docs/research/rimworld/92-native-animal-pens-runtime.md)及[93圈养管理](docs/research/rimworld/93-animal-pens-gameplay.md)。

2026-11-04动物经营更新（v29）：驯养员取来实际生粮，两次喂食后尝试驯服；家畜吃真实草、作物和食物，同种成年雌雄需要接触才能繁殖。饥饿影响成长与孕期，幼体有独立身份；宰杀、放归和兔的驯顺维护均需实际处理。列表与详情显示性别、成长、营养不良及孕期，旧档可升级。暂未实现完整围栏识别、牵引、畜产品及动物训练，孕期和成长速度为Web暂定值。见[88原版机制](docs/research/rimworld/88-animal-husbandry-mechanisms.md)、[89原版实机](docs/research/rimworld/89-native-animal-husbandry-runtime.md)、[90玩法与验证](docs/research/rimworld/90-animal-husbandry-gameplay.md)。

2026-11-04环境经营更新（v28）：淋雨产生可刷新、避雨后逐渐消退的心情记忆；雨天影响户外散步，雨水冲走露天污物。地面物资按真实耐久劣化，仓储划区、有顶棚和封闭仓库提供不同保护。拆分、混堆、搬运、施工退料与交易保留物品状态，食物温度腐坏单独计算。选择物资、人物或天气入口可查看原因与状态。见[85原版机制](docs/research/rimworld/85-environment-storage-mechanisms.md)、[86原版实机](docs/research/rimworld/86-native-environment-storage-runtime.md)、[87玩法与验证](docs/research/rimworld/87-environment-storage-gameplay.md)。优先完成机制衔接，概率和节奏继续后调。

2026-11-04天气更新（v27）：晴、雾、雨、雷雨与雪按实际日历过渡，降水压制露天火焰，天气影响露天移动和射击。积雪保留在真实地表或楼板上，停雪后仍影响通行，变暖后融化。底栏天气入口与选中格显示局部遮蔽、降水和雪层；剖切屋顶不会让室内淋雨。普通雨雾的画面暗化不会额外削减太阳能。见[82原版机制](docs/research/rimworld/82-weather-mechanisms.md)、[83原版实机](docs/research/rimworld/83-native-weather-runtime.md)及[84玩法与验证](docs/research/rimworld/84-weather-gameplay.md)。

2026-11-04火灾更新（v26）：正常雷击或电气事件生成独立火焰，消耗真实可燃物、加热房间并留下结构损伤。“火灾与修理”面板可定位火点、划定家园、安排灭火分工或手动指派；人物到场后反复拍打。幸存建筑可由施工人员恢复耐久，烧毁对象需要重建。木楼板烧毁还会影响上层支撑。火势、蔓延与事件频率仍采用暂定参数，完整天气、人体烧伤与爆炸系统后续扩展。见[79原版机制](docs/research/rimworld/79-fire-firefighting-mechanisms.md)、[80原版实机](docs/research/rimworld/80-native-firefighting-runtime.md)和[81玩法与验证](docs/research/rimworld/81-fire-gameplay.md)。

2026-11-04卫生更新（v25）：人物把泥土带上铺装地板，流血、屠宰和呕吐产生真实污物；“卫生”面板可设置家园范围、安排清扫，清洁与搬运遵循分工优先级。厨房卫生与厨师技能影响简餐污染，餐食搬运、混堆、喂食和存档保留污染状态。食物中毒经历初期、严重和恢复期，呕吐会打断工作，恢复中再次摄入可能返回严重期；清扫也影响既有伤口护理环境。旧档不补发污物或疾病，具体平衡仍待调整。见[76原版机制](docs/research/rimworld/76-sanitation-food-poisoning-mechanisms.md)、[77原版实机](docs/research/rimworld/77-native-sanitation-runtime.md)和[78玩法与验证](docs/research/rimworld/78-sanitation-gameplay.md)。

2026-11-04俘虏与招募更新（v24）：倒地袭击者可由未征召的殖民者实际抱入牢房，护理和喂食使用真实物资；恢复后由看守面对面交谈降低抵抗，归零后的下一次招募交谈才加入殖民地。囚犯床同房联动，支持仅照料、降低抵抗、招募和步行释放；途中任务与新增人口可保存。当前牢房要求封闭且有屋顶，暂不含越狱、奴役和完整社会关系。见[73原版机制](docs/research/rimworld/73-prisoner-recruitment-mechanisms.md)、[74原版床位操作](docs/research/rimworld/74-native-prisoner-runtime.md)与[75玩法和验证](docs/research/rimworld/75-prisoners-gameplay.md)。

2026-11-04心情与娱乐更新（v23）：人物可查看当前心情、目标和具体原因；加入户外散步、实体马蹄铁桩、娱乐作息、同类厌倦和有限期失落游荡。活动需要实际到场，饥饿/睡眠/医疗会参与调度，旧档可继续。玩法参数先用集中定义的默认值，完整关系、性格、娱乐室和其他崩溃类型后续扩展。见[原版机制](docs/research/rimworld/71-mood-recreation-mechanisms.md)与[玩法及验证](docs/research/rimworld/72-voxel-mood-gameplay.md)。

2026-11-03动物与狩猎更新（v22）：鹿和野兔有持续活动、觅食、休息与受伤逃跑，可在地图或野生动物列表选择、定位和标记狩猎。持弓或枪的猎人实际追踪与射击，尸体经搬运和屠宰产出生肉，再进入混合烹饪、冷藏与食用。加入狩猎分工、屠宰开关、尸体身份保留和v21旧档迁移；暂定参数集中配置，驯养与繁殖后续再做。见[玩法与验证](docs/research/rimworld/70-voxel-wildlife-gameplay.md)。

2026-11-03商队贸易更新（v21）：多层体素模式加入实体银币、大宗/军火商队、家园区域和社交议价。人物实际走到商人旁交谈，再选择买卖数量；购入物品在商人附近落地，需要搬回营地。物品年龄、装备身份和有限库存保留；可赠礼，商人银币不足时需明确接受少收。新营地800银，旧档不补发，可出售真实产出积累资金。701项本地单元测试、16.07游戏日普通经营和Worker/main各17项页面检查通过。[66原版规则](docs/research/rimworld/66-trade-market-mechanisms.md)、[68实现与验收](docs/research/rimworld/68-voxel-trade-implementation.md)记录数值和边界；载畜、完整派系外交及商队食宿仍待实现。以下版本记录中的“无贸易”指当时状态；二维入口保持原有功能范围。

2026-11-03财富与叙事更新（v20）：多层体素模式按实物统计物品、建筑和殖民者财富，结合健康人口、难度、营地年龄和伤亡适应计算威胁。菜单可选择六档难度并展开财富/压力明细。Cassandra 的初始袭击机会在第5.4天；第11天起按4.6天活动、6天休息的周期安排1–2次机会，是否入场仍需检查。袭击按预算组成多人队伍，关闭再开启不会重置日历。旧v19待发生袭击保留一次，旧墙/地板身份不明的格子使用明确标记的兼容估值。当前只实现Cassandra袭击与三种低阶海盗兵种子集，未实现贸易、其他叙事者、围攻及完整事件库。[63原版机制](docs/research/rimworld/63-storyteller-wealth-mechanisms.md)、[64原版财富实机](docs/research/rimworld/64-native-storyteller-runtime.md)、[65实现与验证](docs/research/rimworld/65-voxel-storyteller-validation.md)记录证据和实际验收状态。

2026-11-03医疗更新（v19）：多层体素模式加入药根种植与实体草药、三档护理策略、伤口感染、共享免疫和实际卧床休养。种植8级可播药根，医生从真实药堆取药并逐批护理；草药可以跨层入库和冷藏，护理不会立刻抹掉伤口或疾病。人物面板显示病情、免疫、护理期限和实际医生进度。旧档保留营地，旧伤不补抽感染。[60原版机制](docs/research/rimworld/60-medicine-infection-mechanisms.md)、[61实机护理](docs/research/rimworld/61-native-medicine-runtime.md)、[62实现与验收](docs/research/rimworld/62-voxel-medicine-implementation.md)区分来源和适配。工业药、医院床、自疗、手术和其他疾病尚未实现。

2026-11-03远程战斗（v18）：多层体素模式加入短弓、左轮、冲锋手枪、供电机械加工台和布沙袋。先研究锻造→机械加工→枪械制造/反冲式自动武器，再用实际木材、钢材和零件制造；楼上机械台需要跨层布线。征召后选择目标射击，瞄准、连发、飞行、掩体、误伤及护甲伤口由模拟推进，检查面板显示命中因素。旧档保留现有营地和制作进度，新枪械科技需要研究。[57原版规则](docs/research/rimworld/57-ranged-combat-mechanisms.md)、[58实机观察](docs/research/rimworld/58-native-ranged-runtime.md)、[59实现与验收](docs/research/rimworld/59-voxel-ranged-implementation.md)分别记录来源、三维适配和验证边界。

2026-11-03护甲更新（v17）：燃料锻造台可实际制作钢头盔和钢板甲，板甲需研究及工艺7级。护甲按真实部位、穿透和层次判定挡下/减伤，每击消耗耐久，损毁计入物品账本；板甲减慢实际步行。点击装备查看品质、防护、覆盖和移动影响，旧档保留现有营地并新增未完成的板甲研究。[54规则](docs/research/rimworld/54-armor-penetration-mechanisms.md)、[55原版实机](docs/research/rimworld/55-native-armor-runtime.md)、[56实现与验收](docs/research/rimworld/56-voxel-armor-implementation.md)。此前版本介绍中的“无护甲”“无远程”属于历史边界。

2026-11-03人体更新（v16）：多层体素模式加入64部位、11身体能力、近战伤害传播、缺失子树和断端护理；视力与手部功能影响真实劳动与研究。旧伤、物资、装备及科研保留，读取后按新规则重算能力并暂停。右手缺失可改用左手持械。[51规则](docs/research/rimworld/51-anatomy-capacity-mechanisms.md)、[52原版实机](docs/research/rimworld/52-native-anatomy-runtime.md)、[53实现与验收](docs/research/rimworld/53-voxel-anatomy-implementation.md)。

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

2026-11-03外伤历史更新（v12，固定准备期已由v20日历替代）：当时菜单可开启有三日准备期的袭击，殖民者支持征召、近战和战术移动。真实外伤进入疼痛、失血与能力计算；医护实际赶路逐处无药包扎，包扎后仍需恢复。败退敌人恢复后沿通路离场，v12保留旧营地和平设置。[39原版规则](docs/research/rimworld/39-injuries-medicine-mechanisms.md)、[40原版护理实机](docs/research/rimworld/40-native-injuries-runtime.md)、[41实现边界与验收](docs/research/rimworld/41-voxel-combat-injuries-implementation.md)。当前七区人体、固定命中与袭击节奏为项目适配；无完整护甲、药物感染和俘虏系统。

2026-11-03实体武器更新：免费制作点可制作木棒和钢匕首，100 钢材建造的燃料锻造台还可制作钢长剑。工人实际运料、加工和搬运成品；点击武器查看信息、安排取用，人物面板可放下。更换旧武器落地，主动丢弃和地面倒地后的武器禁止自动搬运，明确装备可解除。v13 保存武器身份、耐久、燃料和中途任务，该阶段420项单元测试通过；后续技能和品质见下方v14更新。无环境腐蚀或完整护甲。[42规则研究](docs/research/rimworld/42-weapons-crafting-equipment-mechanisms.md)、[43原版正常制作与换装](docs/research/rimworld/43-native-weapons-runtime.md)、[44实现与验证](docs/research/rimworld/44-voxel-weapons-implementation.md)。

2026-11-03技能更新：体素人物现有七项技能、热情、实际劳动经验、升级与高等级衰退。采矿/种植/建造/烹饪/医疗和格斗按各自规则生效；工艺影响配方门槛及衣物、钢刀剑品质，切石不提供经验。多人采矿累积产量贡献，低技能作物可能收获失败；成品品质和收获量在完成时锁定，满地面、换人和读档不重抽。v14保留旧存档已有物品与品质，不补发历史经验。研究仍预解锁。[45规则研究](docs/research/rimworld/45-skills-learning-quality-mechanisms.md)、[46原版制刀与技能观察](docs/research/rimworld/46-native-skills-runtime.md)、[47实现与验证](docs/research/rimworld/47-voxel-skills-implementation.md)。

体素供粮：尽早在土壤上规划约110–128格稻米（每次框选最多128格），保留阳光，建一座20木材灶台。点击灶台设置简餐目标；每餐消耗10生食材和1木材。稻米约8游戏日首收，1日常速10分钟，可开3倍速。简餐宜少量制作，囤餐需实际降温的冷库；树木需继续砍伐补燃料。新世界需考虑季节和土壤：寒带低温会停长，沙地不能种普通作物；8日首收是适温普通土壤的参考。断粮会产生健康后果；v25已加入厨房污染和食物中毒，需划定家园清洁范围并安排清扫。

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

## 第一局怎么玩（二维营地）

1. 建议先暂停。在营地附近放三张木床、一座燃木灶台；拖动划定仓储区，以及6×8谷物田。
2. 用伐木工具标记一片树林，补充建设和燃料所需木材。工人会先预定、收集材料，再施工；点击人物可以查看其当前工作。
3. 在“分工”设置优先级。1最高、4最低、横线表示不参与；种植、做饭和医疗不要全部关闭。身体需求会优先于常规工作。
4. 第4日前后会出现第一次袭击。选中人物按R征召，右键安排位置。射手会攻击射程内目标，近战角色守住原位；右键敌人才是明确追击。防御掩体可以降低远程命中。
5. 战后解除征召，有医疗岗位的人会带药救治；倒地者可以被搬到床位。伤口、出血和失去朋友会影响生活。
6. 建研究桌，完成“基础电力→远程通信→救援信标”。采矿获取更多金属；燃木发电机与信标需要相邻连接或通过导线连通。
7. 启动信标后保持供电两日，在半日和一日半时抵御两波袭击。救援到达后可以结束，或选择继续经营。

普通事件和战斗存在随机性。研究所需劳动与人物技能、分工有关，第一版不承诺所有玩家在固定天数撤离。

## 操作（二维营地）

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

## 已实现的范围（二维营地）

- 3名固定初始殖民者；需求、心情、记忆、工作优先级、三种日程、征召。
- 18种建筑定义，谷物/药草两种种植区，仓储区、伐木、采矿、浆果采集、拆除与蓝图取消。
- 真实物品堆、可跨堆收集的材料预定、搬运与中断释放；厨房储备账单和有劳动成本的零件加工。
- 6个研究项目；燃木/太阳能供电、导线连通、蓄电、局部冷藏；信标掉电暂停且不重复刷波次。
- 身体六部位、伤口、出血、倒地、死亡、救援与包扎；射程、墙体视线、掩体和战后恢复。
- 日夜、天气、作物受温度影响、食品腐败、有限事件日志；普通袭击、终局两波、胜败和继续经营。
- 版本化完整存档、导入验证、独立手动/自动槽、页面重载恢复；生成式小型纹理与合成音效。
- 可达范围内的动物闲逛、短休和受困提示；选中对象实时检查；劳动工具/粒子与进度反馈，移动不挥工具、暂停冻结。

这是基于设计稿核心链条做出的第一版独立游戏，不是完整Core或DLC内容实现。尚未加入贸易/派系任务、招募与人口成长、动物狩猎/驯养、感染与免疫、详细社交、屋顶/房间热交换、火灾、装备制造与护甲、多地图、多人和Mod兼容。冷藏在本版是设备周围四格的简化效果；营火用于局部寒冷心情与娱乐，不是完整房间热力系统。

## 技术结构（二维营地）

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

推送到独立仓库的 `main` 后，GitHub Actions 只安装锁定依赖、构建并发布；`npm run build` 保留 TypeScript 类型检查。规则测试、经营长跑、研究证据与浏览器验收在本地完成，发布流水线不重复执行。新提交会取消尚未完成的旧发布。也可在 Actions 中手动运行 **Deploy Emberfield to GitHub Pages**。Pages 的 Source 设置为 **GitHub Actions**。

Vite使用相对资源路径，模块Worker也由构建处理，因此可部署在 `/emberfield-web/` 子路径；不需要额外服务器或跨源隔离响应头。运行存档留在访问者浏览器，网站不会上传游戏存档。 localhost与GitHub Pages是不同来源，需要用JSON导出/导入迁移进度。

本地综合工作区的开发目录为 `experiments/rimworld-like`。该目录通过Git subtree发布到独立仓库，后续同步可在综合工作区根目录提交本项目后执行：

```sh
git subtree push --prefix=experiments/rimworld-like emberfield main
```

直接克隆独立仓库开发时，正常提交并推送到 `main` 即可触发发布。

2026-11-03研究更新：3×2简易科研台、智识技能和五项后续科技已接入，工业新局保留七项起始知识；旧档v15保留旧功能。见[50研究实现与验收](docs/research/rimworld/50-voxel-research-implementation.md)。
