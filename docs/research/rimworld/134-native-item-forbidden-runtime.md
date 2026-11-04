# 物品禁止 / 允许：原版验证暂停与已有证据边界

更新：2026-11-04。**本轮 v45 未完成任何原版物品禁止机制的实机验证。** 用户明确要求“后续暂时不要运行程序来交互了”后，取消继续运行、输入和截图的计划，仅保留并只读核对此前准备记录。静态结论见 [132](132-item-forbidden-mechanisms.md)。

## 暂停前实际执行到哪里

独立研究进程 PID **35384**，启动时间 `2026-11-04T15:03:39.1793506Z`。启动程序是 `F:/SteamLibrary/steamapps/common/RimWorld/RimWorld.exe`，专用 profile 为 `.local-research/runtime/profile-item-forbidden-20261104`，日志位于 `.local-research/runtime/item-forbidden-20261104/Player.log`。命令行包含该 profile 的 `-savedatafolder`，与用户常用保存隔离。

基线为此前开发者准备营地 `RiverBridgeBaseline.rws` 的原样复制 `ItemForbiddenBaseline.rws`，SHA-256 `ab629e9b0d24252991f47d2c57149ad29c8152db24b1c004b5659a74862620cd`。继承了此前开发准备，不把它称作从零普通游玩建立的营地；本次没有新增开发者物品/地形、注入游戏代码或编辑保存 XML。

已留存 **4 份**完成的动作/截图回执：

| 序号 | 已记录动作 | 可支持的结论 |
|---|---|---|
| 001 | 初始化窗口截图 | 专用进程开始启动 |
| 002 | 主菜单截图 | 菜单可见；并非玩法结果 |
| 003 | 点击 Load game 并截图 | 打开加载列表，存在研究基线 |
| 004 | 点击基线对应 Load 并取得尾随截图 | 记录加载准备操作；文件名 `004-loaded` 是意图标签，不能单凭命名认定进入游戏或验证机制 |

采集截止为最后一份回执结束时间 **`2026-11-04T15:05:13.6441357Z`**。本轮没有禁止/允许切换、指定工作、进食、搬运、装备、买卖或保存/读档机制场景，也没有新建原生保存；该 profile 的 Saves 目录仅有原样基线。不能用这四份准备回执充当任何玩法验证通过的证据。

## 进程状态与未执行的操作

暂停后只读 CIM 核查发现 PID 35384 已不存在。不存在观察不等于观察到了退出动作；**退出原因未确定，没有声称普通 Quit to OS 成功，也没有对未知进程发送终止或 GUI 操作**。具体检查时间和原命令行保留在 [机器可读边界记录](evidence/item-forbidden-runtime-boundary.json)。

不再启动或操作此研究进程，不采新截图，不使用后台输入继续场景。保留在 `scripts/research/` 的启动/输入脚本仅描述暂停前的准备工具，当前不可当作获准执行的后续步骤。

## 证据保留与结论限制

完整原始截图、4 份输入回执、4 份截图回执、启动记录与中止核验留在忽略目录 `.local-research/runtime/item-forbidden-20261104`。截图可能包含账户/通知 UI，**不发布原图或裁剪**；公开记录包含其 SHA-256、动作、时间、PID/profile 及基线校验。既有文件只读核验不产生新的游戏交互。

本轮未完成的验证包括：材料禁止阻断并在允许后恢复、食物/搬运禁止、旗标经原生保存读取保留、不同旗标堆叠、Equip/Wear 解除状态、Reinstall 源物拒绝、禁止库存的出售与 until-X 计数。这些目前是 [132](132-item-forbidden-mechanisms.md) 中有范围的静态结论或未来验证缺口，不补写预期截图与虚构结果。

此前 [131 允许区域实机证据](131-native-allowed-area-runtime.md) 是独立的 v44 实验；它不能证明 v45 物品禁止状态和当前场景。原版派生代码和只读文件被用于研究，因此也不声称纯看屏幕。

## 只读重核

```powershell
pwsh -NoProfile -File scripts/research/collect-item-forbidden-runtime-boundary.ps1 -Check
```

仅复读上述既有文件、核对四步动作、原样基线、无新保存的边界及哈希；不启动程序、不操作进程、不输入、不拍摄新截图。
