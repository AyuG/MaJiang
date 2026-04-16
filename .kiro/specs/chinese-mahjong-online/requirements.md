# 需求文档：中国麻将在线游戏

## 简介

本项目是一个基于 Web 的在线中国麻将游戏，以四川麻将为底色，使用完整 136 张牌（条、筒、万 + 风牌字牌）。支持 4 人联网对战，仅允许自摸胡牌，支持碰、杠操作。前端采用纯文字界面，后端使用 Next.js + Socket.io + Redis 架构，通过 Docker 部署于单台服务器。系统设计优先考虑规则可扩展性，以便后续增加新的规则设定。

## 术语表

- **Game_Server**: 基于 Next.js + Socket.io 的游戏服务端，负责房间管理、状态同步和游戏逻辑执行
- **Mahjong_Engine**: 麻将核心引擎，封装洗牌、发牌、状态机流转、胡牌校验等核心游戏逻辑
- **State_Machine**: 游戏状态机，管理游戏阶段流转（DEALING → TURN → AWAITING → WIN/DRAW）
- **Tile_Set**: 完整的 136 张麻将牌集合，包含条（1-9）、筒（1-9）、万（1-9）、风牌（东南西北）、字牌（中白发），每种 4 张
- **Player**: 参与游戏的玩家，每局游戏固定 4 名
- **Room**: 游戏房间，容纳 4 名玩家进行一局麻将游戏
- **Hand**: 玩家当前持有的手牌
- **Discard_Pool**: 玩家打出的牌的集合，公开可见
- **Wall**: 牌墙，洗牌后尚未被摸取的牌的有序集合
- **Draw**: 从牌墙中摸取一张牌的操作
- **Discard**: 玩家从手牌中选择一张牌打出的操作
- **Peng**: 碰牌操作，当其他玩家打出的牌与当前玩家手中的两张相同牌组成三张时可选择触发
- **Ming_Gang**: 明杠操作，当其他玩家打出的牌与当前玩家手中的三张相同牌组成四张时可选择触发
- **An_Gang**: 暗杠操作，当玩家手中持有四张相同牌时可选择主动发起的杠操作
- **Bu_Gang**: 补杠操作，当玩家已碰的三张牌再摸到第四张时可选择发起的杠操作
- **补牌**: 杠操作后从牌墙末端摸取的替补牌
- **Zi_Mo**: 自摸胡牌，玩家通过自己摸牌完成胡牌牌型
- **Gang_Shang_Kai_Hua**: 杠上开花，玩家杠后补牌恰好完成胡牌
- **Hai_Di_Lao_Yue**: 海底捞月，摸取牌墙最后一张牌时完成胡牌
- **Seed**: 随机种子，用于洗牌算法的确定性随机数生成，支持复盘
- **Redis_Store**: Redis 持久化层，存储游戏房间状态、玩家手牌和桌面信息
- **Client_UI**: 基于 React 的纯文字前端界面
- **Score**: 分数，杠分和胡牌分的统计值，固定每次 5 分。杠分在游戏过程中累计记录，仅在胡牌时统一结算；流局时杠分清零不计算
- **Qi_Dui**: 七对子，手牌由 7 组对子（每组 2 张相同牌）组成的合法胡牌牌型，不翻倍，按固定分值计算
- **Vote_Dissolve**: 投票解散机制，发起方自动同意，其余在线玩家全部同意方可解散当前游戏，断线玩家默认同意
- **Turn_Timer**: 回合计时器，限制玩家每回合的操作时间
- **Seat**: 座位，按玩家进入房间的顺序依次分配为东、南、西、北
- **Dice_Roll**: 掷骰子，4 名玩家各掷一次骰子，点数最大者为庄家；若存在相同最大点数，则相同点数的玩家重新投掷，直至决出唯一最大者
- **Dealer**: 庄家，每局游戏中首先行动的玩家，由 Dice_Roll 决定首局庄家，之后谁胡牌谁当庄，流局则庄家不变
- **Mock_Wall**: 调试用预设牌墙，允许开发者通过 Debug 接口指定牌墙序列，用于测试特定场景（如天胡、连续杠等）
- **Smart_Auto_Play**: 智能托管模式，当玩家断线或超时时，系统自动代替玩家进行操作。出牌时选择最孤立的牌（与手中其他牌关联度最低的牌），碰/杠响应阶段自动选择"过"，能胡时自动胡牌
- **Score_Log**: 分值日志，按房间分类记录每局的分数变动，存储于 Redis 中，保留 7 天
- **Auto_Ready**: 自动准备，玩家创建或加入房间时自动进入准备状态，可手动取消准备

## 需求

### 需求 1：项目基础架构初始化

**用户故事：** 作为开发者，我希望项目具备完整的基础架构配置，以便能够快速启动开发和部署。

#### 验收标准

1. THE Game_Server SHALL 使用 Next.js + TypeScript + Socket.io 技术栈进行初始化
2. THE Game_Server SHALL 提供 Dockerfile 和 docker-compose.yml 配置文件，包含 Game_Server 服务和 Redis 服务的定义
3. THE Game_Server SHALL 支持通过 docker-compose up 命令在单台服务器上完成完整部署
4. THE Redis_Store SHALL 作为游戏数据持久化层，存储房间状态和玩家数据

### 需求 2：游戏日志系统

**用户故事：** 作为开发者，我希望系统记录每局游戏的关键信息，以便进行问题排查和游戏复盘。

#### 验收标准

1. WHEN 一局游戏开始时，THE Game_Server SHALL 记录本局使用的 Seed 值
2. WHEN Player 执行任意操作（摸牌、出牌、碰、杠、胡、过）时，THE Game_Server SHALL 按时间顺序记录该操作及其参数
3. THE Game_Server SHALL 以 JSON 格式输出所有游戏日志，便于后续脚本分析和问题排查
4. THE Game_Server SHALL 将每局的 Seed 和操作序列持久化存储，支持后续复盘查询

### 需求 3：牌集与洗牌

**用户故事：** 作为玩家，我希望游戏使用标准的 136 张麻将牌并进行公平洗牌，以确保游戏的公正性。

#### 验收标准

1. THE Mahjong_Engine SHALL 生成包含 136 张牌的 Tile_Set：条（1-9）、筒（1-9）、万（1-9）各 4 张共 108 张，风牌（东、南、西、北）各 4 张共 16 张，字牌（中、白、发）各 4 张共 12 张
2. WHEN 一局游戏开始时，THE Mahjong_Engine SHALL 使用指定的 Seed 对 Tile_Set 执行确定性洗牌算法
3. WHEN 使用相同 Seed 进行洗牌时，THE Mahjong_Engine SHALL 产生相同的牌序结果

### 需求 4：游戏状态机

**用户故事：** 作为玩家，我希望游戏按照明确的阶段流转进行，以确保游戏流程的正确性。

#### 验收标准

1. THE State_Machine SHALL 管理以下游戏阶段：DEALING（发牌）、TURN（回合）、AWAITING（等待碰杠响应）、WIN（胡牌结束）、DRAW（流局结束）
2. WHEN 4 名 Player 全部就绪且 Dealer 已确定时，THE State_Machine SHALL 从 DEALING 阶段开始，按顺序为每位 Player 发 13 张牌，Dealer 额外获得第 14 张牌
3. WHEN DEALING 阶段完成后，THE State_Machine SHALL 进入 TURN 阶段，由 Dealer 开始行动
4. WHEN 当前 Player 打出一张牌后，THE State_Machine SHALL 进入 AWAITING 阶段，检查其他 Player 是否可执行碰或明杠操作
5. WHEN AWAITING 阶段所有可操作 Player 均选择"过"或超时后，THE State_Machine SHALL 进入下一位 Player 的 TURN 阶段
6. WHEN 某位 Player 完成 Zi_Mo 时，THE State_Machine SHALL 进入 WIN 阶段并结算分数
7. WHEN Wall 中剩余牌数为 0 且无人胡牌时，THE State_Machine SHALL 进入 DRAW 阶段，本局不计分

### 需求 5：摸牌与出牌

**用户故事：** 作为玩家，我希望能够正常摸牌和出牌，以进行基本的游戏操作。

#### 验收标准

1. WHEN 进入某位 Player 的 TURN 阶段时，THE Mahjong_Engine SHALL 从 Wall 正方向（首端）摸取一张牌加入该 Player 的 Hand
2. WHEN Player 摸牌后，THE Mahjong_Engine SHALL 等待该 Player 从 Hand 中选择一张牌执行 Discard 操作
3. WHEN Player 执行 Discard 操作后，THE Mahjong_Engine SHALL 将该牌加入该 Player 的 Discard_Pool

### 需求 6：碰牌操作

**用户故事：** 作为玩家，我希望在其他玩家出牌时能够碰牌，以组成有利的牌型。

#### 验收标准

1. WHEN 某位 Player 执行 Discard 操作后，THE Mahjong_Engine SHALL 检查其他每位 Player 的 Hand 中是否持有两张与该弃牌相同的牌
2. WHEN Player 选择执行 Peng 操作时，THE Mahjong_Engine SHALL 从该 Player 的 Hand 中移除两张对应牌，与弃牌组成公开的三张一组，对所有 Player 可见
3. WHEN Player 完成 Peng 操作后，THE Mahjong_Engine SHALL 要求该 Player 从 Hand 中选择一张牌执行 Discard 操作

### 需求 7：杠牌操作与补牌逻辑

**用户故事：** 作为玩家，我希望能够执行各类杠操作并获得正确的补牌，以丰富游戏策略。

#### 验收标准

1. WHEN 某位 Player 执行 Discard 操作后且另一位 Player 的 Hand 中持有三张相同牌时，THE Mahjong_Engine SHALL 允许该 Player 执行 Ming_Gang 操作，杠出的四张牌对所有 Player 公开可见
2. WHEN Player 的 Hand 中持有四张相同牌时，THE Mahjong_Engine SHALL 允许该 Player 在自己的 TURN 阶段执行 An_Gang 操作，暗杠组合标记为已杠但不公开具体牌面
3. WHEN Player 已有 Peng 的三张组且 Hand 中摸到第四张相同牌时，THE Mahjong_Engine SHALL 允许该 Player 执行 Bu_Gang 操作，补杠的四张牌对所有 Player 公开可见
4. WHEN Player 在当前回合执行首次 Ming_Gang 时，THE Mahjong_Engine SHALL 从 Wall 末端倒数第 2 张位置取补牌
5. WHEN Player 在当前回合执行首次以外的连续杠操作时，THE Mahjong_Engine SHALL 从 Wall 末端倒数第 1 张位置取补牌
6. WHEN Player 执行 An_Gang 或 Bu_Gang 时，THE Mahjong_Engine SHALL 从 Wall 末端倒数第 1 张位置取补牌
7. WHEN 补牌完成后，THE Mahjong_Engine SHALL 允许该 Player 继续执行出牌或再次杠操作

### 需求 8：胡牌校验

**用户故事：** 作为玩家，我希望系统能准确判断胡牌条件，以确保游戏结果的正确性。

#### 验收标准

1. THE Mahjong_Engine SHALL 仅允许 Zi_Mo 方式胡牌，不允许点炮胡牌
2. WHEN Player 摸牌或补牌后，THE Mahjong_Engine SHALL 检查该 Player 的 Hand 是否满足胡牌牌型
3. WHEN Player 的 Hand 满足胡牌牌型且 Player 选择胡牌时，THE Mahjong_Engine SHALL 判定该 Player 胜出
4. THE Mahjong_Engine SHALL 不要求缺门条件即可胡牌
5. THE Mahjong_Engine SHALL 支持 Qi_Dui（七对子）作为合法胡牌牌型，不翻倍，按固定分值计算
6. WHEN Player 通过杠操作补牌后完成胡牌时，THE Mahjong_Engine SHALL 判定为 Gang_Shang_Kai_Hua
7. WHEN Player 摸取 Wall 中最后一张牌后完成胡牌时，THE Mahjong_Engine SHALL 判定为 Hai_Di_Lao_Yue

### 需求 9：分数计算

**用户故事：** 作为玩家，我希望游戏能正确计算各项得分，以公平反映游戏结果。

#### 验收标准

1. WHEN Player 执行 Ming_Gang 操作时，THE Mahjong_Engine SHALL 记录该杠分：被杠的 Player 欠 5 分给执行杠操作的 Player
2. WHEN Player 执行 An_Gang 操作时，THE Mahjong_Engine SHALL 记录该杠分：其他三位 Player 各欠 5 分（共 15 分）给执行杠操作的 Player
3. WHEN Player 执行 Bu_Gang 操作时，THE Mahjong_Engine SHALL 按照 Ming_Gang 的规则记录杠分（被杠者欠 5 分）
4. WHEN Player 完成 Zi_Mo 胡牌时，THE Mahjong_Engine SHALL 统一结算本局所有累计杠分，并从其他三位 Player 各扣除 5 分（共 15 分）加给胡牌的 Player
5. WHEN 游戏进入 DRAW 阶段（流局）时，THE Mahjong_Engine SHALL 清零本局所有累计杠分，不进行任何分数变动
6. THE Mahjong_Engine SHALL 在游戏过程中维护每位 Player 的累计杠分记录，仅在胡牌结算时转化为实际 Score 变动

### 需求 10：房间管理

**用户故事：** 作为玩家，我希望能够创建或加入游戏房间，以便与其他玩家进行对战。

#### 验收标准

1. THE Game_Server SHALL 允许 Player 创建新的 Room
2. THE Game_Server SHALL 允许 Player 通过房间标识加入已存在的 Room
3. WHEN Room 中 Player 数量达到 4 人时，THE Game_Server SHALL 阻止更多 Player 加入该 Room
4. WHEN Player 加入 Room 时，THE Game_Server SHALL 按进入顺序依次分配 Seat 为东、南、西、北，并自动将该 Player 设为准备状态
5. WHEN Player 加入 Room 后，THE Client_UI SHALL 允许 Player 手动取消准备状态
6. WHEN Room 中 4 名 Player 全部处于就绪状态时，THE Game_Server SHALL 启动 Dice_Roll 流程
6. WHEN Dice_Roll 流程中所有 Player 完成投掷后，THE Game_Server SHALL 将点数最大的 Player 设为 Dealer
7. WHEN Dice_Roll 中存在多名 Player 点数相同且为最大值时，THE Game_Server SHALL 要求这些 Player 重新投掷，直至决出唯一最大者
8. WHEN 上一局某位 Player 完成 Zi_Mo 胡牌时，THE Game_Server SHALL 将该 Player 设为下一局的 Dealer
9. WHEN 上一局进入 DRAW 阶段（流局）时，THE Game_Server SHALL 保持上一局的 Dealer 不变
10. WHEN Player 尝试加入一个正在游戏中的 Room 时，THE Game_Server SHALL 检查是否存在断线 Player；若存在则允许新 Player 补位替代断线 Player 并恢复游戏状态；若不存在断线 Player，THE Game_Server SHALL 拒绝加入并返回错误提示"房间已满，游戏进行中"
11. WHEN Player 尝试加入一个不存在的 Room 时，THE Game_Server SHALL 返回错误提示"房间不存在"

### 需求 11：断线处理与智能托管

**用户故事：** 作为玩家，我希望在有人断线时游戏能自动托管继续进行，以保证游戏节奏不被中断。

#### 验收标准

1. WHEN 游戏进行中某位 Player 的 Socket 连接断开时，THE Game_Server SHALL 在 5 秒内检测到断线，将该 Player 标记为断线状态，并立即启用智能托管模式代替该 Player 进行操作
2. WHILE Player 处于断线托管状态时，THE Game_Server SHALL 向所有在线 Player 发送托管通知，在界面上显示该 Player 的托管标识（🤖）
3. WHEN 断线的 Player 重新连接时，THE Game_Server SHALL 从 Redis_Store 恢复该 Player 的 Hand、Discard_Pool 及当前桌面完整状态，并取消托管模式
4. WHEN 断线 Player 的 TURN 阶段到来时，THE Game_Server SHALL 立即自动执行智能出牌（选择最孤立的牌打出），不启动倒计时，不参与超时判断
5. WHEN 断线 Player 处于 AWAITING 阶段且可执行碰/杠操作时，THE Game_Server SHALL 立即自动选择"过"操作，不启动倒计时

### 需求 12：投票解散

**用户故事：** 作为玩家，我希望在特殊情况下能发起投票解散游戏，以避免无法继续的僵局。

#### 验收标准

1. WHEN 任意 Player 发起解散请求时，THE Game_Server SHALL 向 Room 内所有 Player 发送投票请求，发起方自动视为同意
2. WHEN 除发起方外的所有在线 Player 均同意解散时，THE Game_Server SHALL 立即结束当前游戏，本局不计分
3. WHEN 任意在线 Player 拒绝解散时，THE Game_Server SHALL 取消解散请求，向所有 Player 广播投票取消通知，关闭投票提示界面，继续游戏
4. THE Game_Server SHALL 为每次投票设置 30 秒的投票时限，超时未投票的在线 Player 视为不同意
5. WHEN 存在断线 Player 时，THE Game_Server SHALL 将断线 Player 的投票默认视为同意
6. WHEN 投票解散通过时，THE Game_Server SHALL 注销该 Room（从内存中删除），后续任何 Player 不可再加入该 Room
7. WHEN 投票解散通过时，THE Game_Server SHALL 将该 Room 的积分历史记录随 room:dissolved 事件发送给所有在线 Player，以便在大厅页面展示
8. WHEN 发起方发起投票后，THE Client_UI SHALL 向发起方显示"已发起投票解散，等待其他玩家响应"的提示

### 需求 13：回合计时与智能超时处理

**用户故事：** 作为玩家，我希望每个回合有时间限制，并在超时时由系统智能代打，以保证游戏节奏流畅。

#### 验收标准

1. WHEN 进入某位 Player 的 TURN 阶段时，THE Game_Server SHALL 启动 30 秒的 Turn_Timer
2. WHEN Turn_Timer 到期且 Player 未执行任何操作时，THE Game_Server SHALL 首先检查该 Player 是否满足胡牌条件，若满足则自动胡牌；否则自动执行摸牌，并通过智能出牌算法选择最孤立的牌（与手中其他牌关联度最低的牌）打出
3. WHEN 进入 AWAITING 阶段时，THE Game_Server SHALL 为每位可操作的 Player 启动 15 秒的响应计时器
4. WHEN AWAITING 阶段响应计时器到期且 Player 未做出选择时，THE Game_Server SHALL 自动为该 Player 选择"过"操作
5. WHEN 超时自动出牌完成后，THE Game_Server SHALL 在该 Player 的玩家区域显示托管标识（🤖），标记为超时托管状态
6. WHEN 超时托管状态的 Player 手动执行任意操作时，THE Game_Server SHALL 取消该 Player 的超时托管状态，恢复正常倒计时
7. THE Client_UI SHALL 仅在当前 Player 的回合（TURN 阶段）或当前 Player 可执行碰/杠操作（AWAITING 阶段）时显示倒计时元素，其他情况下隐藏倒计时

### 需求 14：状态持久化

**用户故事：** 作为玩家，我希望游戏状态能可靠存储，以便在服务重启或断线后恢复游戏。

#### 验收标准

1. WHEN 游戏状态发生变化时，THE Game_Server SHALL 将当前完整游戏状态同步写入 Redis_Store
2. THE Redis_Store SHALL 存储以下数据：Room 信息、每位 Player 的 Hand、所有 Discard_Pool、Wall 剩余牌、State_Machine 当前阶段、每位 Player 的 Score
3. WHEN Game_Server 重启后，THE Game_Server SHALL 从 Redis_Store 读取并恢复所有进行中的游戏状态
4. WHEN 一局游戏结束后，THE Redis_Store SHALL 保留该局的 Seed 和操作日志记录

### 需求 15：文字版前端界面

**用户故事：** 作为玩家，我希望通过简洁的文字界面参与游戏，以便在任何设备上进行游戏。

#### 验收标准

1. THE Client_UI SHALL 使用 React 框架实现纯文字显示界面
2. THE Client_UI SHALL 显示当前 Player 的 Hand，格式为文字列表（如 [一万, 二万, 三万...]）
3. THE Client_UI SHALL 在当前 Player 手牌上方显示可用操作按钮区域（含倒计时），包含 [碰]、[杠]、[胡]、[过] 按钮，仅在对应操作可执行时显示；倒计时仅在当前 Player 的回合或可执行碰/杠响应时显示，非玩家回合时隐藏整个操作栏
4. THE Client_UI SHALL 显示每位 Player 的 Discard_Pool 内容
5. THE Client_UI SHALL 显示 Wall 中剩余牌的数量
6. THE Client_UI SHALL 显示每位 Player 的当前 Score
7. WHILE 游戏处于暂停状态时，THE Client_UI SHALL 显示全屏遮罩提醒，包含断线 Player 的信息和等待重连的提示文字
8. THE Client_UI SHALL 通过 Socket.io 与 Game_Server 保持实时连接，接收状态更新并刷新界面

### 需求 16：规则可扩展性

**用户故事：** 作为开发者，我希望游戏规则模块具备可扩展性，以便后续方便地增加新的规则设定。

#### 验收标准

1. THE Mahjong_Engine SHALL 将胡牌校验、分数计算、特殊牌型判定等规则逻辑封装为独立的可替换模块
2. THE Mahjong_Engine SHALL 支持通过配置参数调整规则设定（如是否允许点炮胡、是否要求缺门等），无需修改核心引擎代码
3. THE Mahjong_Engine SHALL 提供规则接口定义，允许开发者实现自定义规则模块并注册到引擎中

### 需求 17：调试与测试支持

**用户故事：** 作为开发者，我希望能够预设牌墙序列进行调试，以便高效测试各种边界场景。

#### 验收标准

1. THE Mahjong_Engine SHALL 提供 Mock_Wall 接口，允许在调试模式下指定完整的牌墙序列替代随机洗牌结果
2. WHEN Mock_Wall 被启用时，THE Mahjong_Engine SHALL 使用预设的牌墙序列进行发牌和摸牌，跳过 Seed 洗牌流程
3. THE Mock_Wall 接口 SHALL 仅在开发/测试环境下可用，生产环境中自动禁用

### 需求 18：自动开局与分值日志

**用户故事：** 作为玩家，我希望一局结束后能自动开始下一局，并且能查看历史分数记录。

#### 验收标准

1. WHEN 一局游戏以 WIN 或 DRAW 结束时，THE Game_Server SHALL 在 5 秒后自动开始下一局，保留所有玩家的累计分数
2. WHEN 自动开局时存在断线未重连的 Player 时，THE Game_Server SHALL 取消自动开局，将所有在线 Player 返回大厅
3. WHEN 一局游戏结束时，THE Game_Server SHALL 将本局分数变动记录写入 Redis Score_Log，按房间分类存储
4. THE Score_Log SHALL 记录每局的局数编号、时间戳、结果类型（胡牌/流局）、胜者 ID、每位 Player 的分数变动和累计分数
5. THE Score_Log SHALL 保留 7 天，过期自动清理
6. THE Client_UI SHALL 在游戏界面左下角显示积分变动日志面板，实时记录每局的分数变动
7. WHEN Player 返回大厅时，THE Client_UI SHALL 保留并显示之前游戏的积分变动历史记录

### 需求 19：抓牌视觉提醒

**用户故事：** 作为玩家，我希望在摸到新牌时有明显的视觉提醒，以便快速识别新摸到的牌。

#### 验收标准

1. WHEN Player 摸到新牌时，THE Client_UI SHALL 对该牌应用闪烁加上下抖动的动画效果，持续约 4.5 秒（3 次循环）
2. THE Client_UI SHALL 以金色边框和金色文字高亮显示最近摸到的牌，与其他手牌形成视觉区分

### 需求 20：移动端 H5 适配

**用户故事：** 作为手机玩家，我希望游戏界面能适配手机屏幕，无需上下滑动即可完整显示游戏内容。

#### 验收标准

1. THE Client_UI SHALL 设置 viewport meta 标签，禁止用户缩放，确保移动端正确渲染
2. THE Client_UI SHALL 使用响应式布局，在 768px 以下屏幕宽度时自动缩小字体、间距和牌面尺寸
3. THE Client_UI SHALL 压缩游戏棋盘中间区域的空闲面积，使四位玩家区域紧凑排列
4. THE Client_UI SHALL 在 480px 以下屏幕宽度时进一步缩小牌面和按钮尺寸
5. THE Client_UI SHALL 使用 `100dvh`（动态视口高度）确保在移动浏览器中不出现地址栏遮挡

### 需求 21：出牌二次确认

**用户故事：** 作为玩家，我希望出牌需要二次确认，以避免误操作。

#### 验收标准

1. WHEN Player 第一次点击手牌中的某张牌时，THE Client_UI SHALL 将该牌标记为选中状态，显示红色边框和上下跳动闪烁动画
2. WHEN Player 第二次点击同一张已选中的牌时，THE Client_UI SHALL 执行出牌操作
3. WHEN Player 点击另一张不同的牌时，THE Client_UI SHALL 取消之前的选中状态，将新点击的牌设为选中
4. WHEN 游戏状态发生变化（回合切换、阶段变化）时，THE Client_UI SHALL 自动清除选中状态

### 需求 22：UI 架构重构（牌桌中心化）

**用户故事：** 作为玩家，我希望游戏界面更接近真实麻将桌的视觉体验，信息层级清晰，空间利用率高。

#### 验收标准

1. THE Client_UI SHALL 使用中心化牌桌布局，四位玩家环绕中心区域排列（上/左/右/下）
2. THE Client_UI SHALL 将弃牌区（河）渲染为固定宽度的 Grid（每行 6 张），模拟真实麻将摆放
3. THE Client_UI SHALL 将牌抽象为独立的 Tile 组件，支持选中/跳动/阴影效果，预留 background-image 接口用于未来图形化
4. THE Client_UI SHALL 使用图标代替冗余文字：🤖 表示托管，🕒 表示当前出牌，🔴 表示断线
5. THE Client_UI SHALL 将对手信息精简为紧凑的状态卡片（座位+分数+手牌数+状态图标）
6. THE Client_UI SHALL 预留音频服务接口（audioService），在关键动作处埋点

### 需求 23：房间号输入验证

**用户故事：** 作为玩家，我希望输入房间号时有格式限制和错误提示。

#### 验收标准

1. THE Client_UI SHALL 限制房间号输入为 6 位大写字母+数字（与系统生成的房间号格式一致）
2. THE Client_UI SHALL 自动过滤非法字符，仅允许 A-Z（排除 I/O）和 2-9
3. WHEN 输入长度不足 6 位时，THE Client_UI SHALL 禁用"加入房间"按钮
