# 实施计划：中国麻将在线游戏

## 概述

按四个阶段递进实施：环境与基础架构 → 核心引擎开发（含属性测试）→ 联网与状态同步 → 文字版前端。使用 TypeScript 全栈开发，fast-check 进行属性测试，vitest 作为测试框架。

## 任务

### 第一阶段：环境与基础架构

- [x] 1. 项目初始化与基础架构搭建
  - [x] 1.1 初始化 Next.js + TypeScript 项目，配置 vitest、fast-check、socket.io、ioredis 依赖
    - 创建 `package.json`，安装 next、react、react-dom、socket.io、socket.io-client、ioredis、fast-check、vitest 等依赖
    - 配置 `tsconfig.json`，启用 strict 模式
    - 配置 `vitest.config.ts`
    - _需求: 1.1_

  - [x] 1.2 创建 Docker 部署配置
    - 编写 `Dockerfile`（Node.js 运行环境）
    - 编写 `docker-compose.yml`（Game_Server + Redis 双服务定义）
    - 确保 `docker-compose up` 可一键启动
    - _需求: 1.2, 1.3_

  - [x] 1.3 定义核心类型与接口
    - 创建 `src/types/tile.ts`：TileSuit 枚举、Tile 接口
    - 创建 `src/types/game.ts`：GamePhase、GameState、PlayerState、Meld、GangRecord、ActionLogEntry 等类型
    - 创建 `src/types/rule.ts`：RuleConfig、RuleProvider、WinChecker、ScoreCalculator 接口
    - 创建 `src/types/events.ts`：ClientEvents、ServerEvents Socket 事件协议类型
    - _需求: 4.1, 16.1, 16.3_

  - [x] 1.4 实现 RedisStore 持久化层
    - 创建 `src/store/redis-store.ts`，实现 RedisStore 接口
    - 实现 saveGameState / getGameState / deleteGameState（JSON 序列化 GameState）
    - 实现 saveActionLog / getActionLog（seed + 操作序列持久化）
    - 实现 saveRoom / getRoom / getAllActiveRooms
    - 支持 ioredis-mock 用于测试环境
    - _需求: 1.4, 14.1, 14.2, 14.4_

  - [ ]* 1.5 编写 GameState 序列化 round-trip 属性测试
    - **Property 17: GameState 序列化 round-trip**
    - 使用 fast-check 生成随机 GameState，验证 JSON.stringify → JSON.parse 后与原始对象等价
    - **验证: 需求 14.2**

- [x] 2. 第一阶段检查点
  - 确保项目可正常编译，vitest 可运行，docker-compose 配置正确。如有问题请向用户确认。

### 第二阶段：核心引擎开发（含属性测试）

- [x] 3. 牌集、洗牌与发牌
  - [x] 3.1 实现牌集生成与洗牌
    - 创建 `src/engine/tile-set.ts`，实现 createTileSet()（生成 136 张牌）和 shuffle(tiles, seed)（基于 seed 的确定性洗牌）
    - _需求: 3.1, 3.2, 3.3_

  - [ ]* 3.2 编写牌集不变量属性测试
    - **Property 1: 牌集不变量**
    - 验证总数 136、各花色数量、id 唯一性
    - **验证: 需求 3.1**

  - [ ]* 3.3 编写确定性洗牌属性测试
    - **Property 2: 确定性洗牌**
    - 相同 seed 两次洗牌结果完全一致
    - **验证: 需求 3.2, 3.3**

  - [x] 3.4 实现发牌逻辑
    - 创建 `src/engine/deal.ts`，实现 deal(wall)：每位非庄家 13 张，庄家 14 张，返回剩余牌墙
    - _需求: 4.2_

  - [ ]* 3.5 编写发牌不变量属性测试
    - **Property 3: 发牌不变量**
    - 验证手牌数量、牌墙剩余 83 张、牌总量守恒
    - **验证: 需求 4.2**

- [x] 4. 摸牌、出牌与补牌
  - [x] 4.1 实现摸牌与出牌
    - 创建 `src/engine/draw-discard.ts`，实现 draw(wall) 和 discard(hand, tileId)
    - draw 从牌墙首端取牌，discard 从手牌移除指定牌
    - _需求: 5.1, 5.2, 5.3_

  - [ ]* 4.2 编写摸牌不变量属性测试
    - **Property 5: 摸牌不变量**
    - 验证取首端牌、牌墙长度减 1、剩余子序列正确
    - **验证: 需求 5.1**

  - [ ]* 4.3 编写出牌不变量属性测试
    - **Property 6: 出牌不变量**
    - 验证手牌数量减 1、弃牌正确、手牌不再包含该牌
    - **验证: 需求 5.3**

  - [x] 4.4 实现补牌逻辑（含越界保护）
    - 在 `src/engine/draw-discard.ts` 中实现 drawSupplement(wall, position)
    - position='second_last' 取倒数第 2 张，position='last' 取倒数第 1 张
    - 当牌墙长度不足索引位置时，降级取最后一张牌，严禁抛出越界异常
    - _需求: 7.4, 7.5, 7.6_

  - [ ]* 4.5 编写补牌位置正确性与越界保护属性测试
    - **Property 9: 补牌位置正确性与越界保护**
    - 验证各种杠类型的补牌位置、牌墙长度减 1、越界降级行为
    - 专项 Edge Case：牌墙仅剩 1 张时触发明杠补牌，断言返回该唯一剩余牌而非 undefined
    - **验证: 需求 7.4, 7.5, 7.6**

- [x] 5. 碰杠操作
  - [x] 5.1 实现碰牌与杠牌条件判断
    - 创建 `src/engine/meld-actions.ts`，实现 canPeng、canMingGang、canAnGang、canBuGang
    - _需求: 6.1, 7.1, 7.2, 7.3_

  - [ ]* 5.2 编写碰杠条件判断属性测试
    - **Property 7: 碰杠条件判断正确性**
    - 验证各条件函数的充要条件（仅聚焦单一玩家操作的合法性，不测试多玩家优先级竞争）
    - **验证: 需求 6.1, 7.1, 7.2, 7.3**

  - [x] 5.3 实现碰牌与杠牌执行逻辑
    - 在 `src/engine/meld-actions.ts` 中实现 executePeng、executeMingGang、executeAnGang、executeBuGang
    - 碰牌后要求出牌，杠牌后触发补牌流程
    - _需求: 6.2, 6.3, 7.1, 7.2, 7.3, 7.7_

  - [ ]* 5.4 编写碰牌执行不变量属性测试
    - **Property 8: 碰牌执行不变量**
    - 验证手牌减 2、meld 包含 3 张同牌、牌总量守恒
    - **验证: 需求 6.2**

- [x] 6. 胡牌校验与规则模块
  - [x] 6.1 实现胡牌校验逻辑
    - 创建 `src/engine/win-checker.ts`，实现标准胡牌牌型检测（N 组面子 + 1 雀头）和七对子检测
    - 仅允许自摸，不要求缺门
    - _需求: 8.1, 8.2, 8.4, 8.5_

  - [x] 6.2 编写胡牌校验正确性属性测试
    - **Property 10: 胡牌校验正确性**
    - 验证七对子、标准牌型返回 true，非法牌型返回 false
    - **验证: 需求 8.1, 8.2, 8.5**

  - [x] 6.3 实现 RuleProvider 与分数计算
    - 创建 `src/engine/rule-provider.ts`，实现默认 RuleProvider
    - 创建 `src/engine/score-calculator.ts`，实现杠分记录（延迟结算）和胡牌结算逻辑
    - 明杠/补杠：被杠者欠 5 分；暗杠：其他三位各欠 5 分
    - 胡牌时统一结算杠分 + 胡牌分（其他三位各扣 5 分）
    - 流局时 gangRecords 原子清零，Score 不变
    - _需求: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 16.1, 16.2, 16.3_

  - [ ]* 6.4 编写杠分计算正确性属性测试
    - **Property 11: 杠分计算正确性**
    - 验证各类杠分记录的零和性
    - **验证: 需求 9.1, 9.2, 9.3**

  - [ ]* 6.5 编写胡牌结算正确性属性测试
    - **Property 12: 胡牌结算正确性**
    - 验证累计杠分 + 胡牌分的最终分数变动总和为零
    - **验证: 需求 9.4**

  - [ ]* 6.6 编写流局杠分原子清零属性测试
    - **Property 13: 流局杠分原子清零**
    - 验证 DRAW 阶段 gangRecords 清零、Score 不变
    - 通过模拟 Redis 持久化层验证：DRAW 转换后写入 Redis 的快照中 gangRecords 为空数组，players.score 与转换前一致
    - **验证: 需求 9.5**

  - [ ]* 6.7 编写规则配置生效属性测试
    - **Property 20: 规则配置生效**
    - 验证 RuleConfig 配置对引擎行为的影响
    - **验证: 需求 16.2**

- [x] 7. Mock_Wall 与牌面格式化
  - [x] 7.1 实现 Mock_Wall 接口
    - 创建 `src/engine/mock-wall.ts`，支持全量注入和尾部牌序注入两种模式
    - 全量注入：完全替代洗牌结果
    - 尾部注入：仅覆盖牌墙尾部指定位置的牌，其余按 seed 洗牌
    - 通过环境变量控制，生产环境自动禁用
    - _需求: 17.1, 17.2, 17.3_

  - [ ]* 7.2 编写 Mock_Wall 牌序一致属性测试
    - **Property 21: Mock_Wall 牌序一致**
    - 验证全量注入和尾部注入模式下的牌序正确性
    - **验证: 需求 17.2**

  - [x] 7.3 实现牌面格式化函数
    - 创建 `src/engine/tile-formatter.ts`，将 Tile 转换为可读中文字符串（如"一万"、"东风"、"红中"）
    - _需求: 15.2_

  - [ ]* 7.4 编写牌面格式化属性测试
    - **Property 18: 牌面格式化**
    - 验证格式化结果包含花色和数值、不同牌产生不同结果
    - **验证: 需求 15.2**

- [x] 8. 状态机实现
  - [x] 8.1 实现 StateMachine 核心
    - 创建 `src/engine/state-machine.ts`，实现 transition(state, action) 和 getValidActions(state)
    - 覆盖所有阶段转换：DEALING→TURN→AWAITING→TURN/WIN/DRAW
    - 庄家首先行动，出牌后进入 AWAITING，碰/杠/过的处理
    - 自摸胡牌进入 WIN，牌墙为空进入 DRAW
    - 杠上开花、海底捞月的特殊判定
    - consecutiveGangCount 管理当前回合连续杠次数，在下一位玩家回合开始或当前玩家出牌完成时重置为 0
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 8.3, 8.6, 8.7_

  - [x] 8.2 编写状态机转换正确性属性测试
    - **Property 4: 状态机转换正确性**
    - 验证各阶段转换规则的正确性
    - **验证: 需求 4.3, 4.4, 4.5, 4.6, 4.7**

  - [x] 8.3 实现操作日志记录
    - 在状态机 transition 中记录每次操作到 actionLog
    - 包含 timestamp、playerIndex、action、tileId 等信息
    - _需求: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 8.4 编写操作日志完整性属性测试
    - **Property 19: 操作日志完整性**
    - 验证日志条目数递增、时间戳递增、内容正确
    - **验证: 需求 2.2**

- [x] 9. 第二阶段检查点
  - 确保所有引擎模块的单元测试和属性测试通过。如有问题请向用户确认。

### 第三阶段：联网与状态同步

- [x] 10. 房间管理
  - [x] 10.1 实现 RoomManager
    - 创建 `src/server/room-manager.ts`，实现 createRoom、joinRoom、leaveRoom、setReady
    - 座位按加入顺序分配（东南西北）
    - 满 4 人后拒绝加入
    - _需求: 10.1, 10.2, 10.3, 10.4_

  - [ ]* 10.2 编写座位分配正确性属性测试
    - **Property 14: 座位分配正确性**
    - 验证按加入顺序分配座位，不受玩家 ID 影响
    - **验证: 需求 10.4**

  - [ ]* 10.3 编写房间满员拒绝属性测试
    - **Property 22: 房间满员拒绝**
    - 验证第 5 名玩家加入被拒绝
    - **验证: 需求 10.3**

  - [x] 10.4 实现掷骰子定庄与庄家继承
    - 在 RoomManager 中实现 Dice_Roll 流程（唯一最大值定庄，相同则重掷）
    - 胡牌者当下一局庄家，流局庄不变
    - _需求: 10.5, 10.6, 10.7, 10.8, 10.9_

  - [ ]* 10.5 编写掷骰子定庄属性测试
    - **Property 15: 掷骰子定庄**
    - 验证唯一最大值定庄、相同最大值触发重掷
    - **验证: 需求 10.6, 10.7**

  - [x] 10.6 实现投票解散
    - 在 RoomManager 中实现 initiateVoteDissolve、voteDissolve
    - 3/4 同意则解散不计分，不足则继续，30 秒超时视为不同意
    - _需求: 12.1, 12.2, 12.3, 12.4_

  - [ ]* 10.7 编写投票解散逻辑属性测试
    - **Property 16: 投票解散逻辑**
    - 验证同意人数 >= 3 时解散，否则继续
    - **验证: 需求 12.2, 12.3**

- [x] 11. GameController 与 Socket.io 集成
  - [x] 11.1 实现 GameController
    - 创建 `src/server/game-controller.ts`
    - 实现 startGame：调用引擎发牌，初始化 GameState，写入 Redis
    - 实现 handlePlayerAction：校验操作合法性，调用状态机 transition，写入 Redis，广播状态
    - 实现 handleTimeout：TURN 超时自动摸打，AWAITING 超时自动过
    - 每次 transition 后同步写入 Redis
    - _需求: 4.2, 4.3, 5.1, 5.2, 13.1, 13.2, 13.3, 13.4, 14.1_

  - [x] 11.2 实现 Socket.io 服务端事件处理
    - 创建 `src/server/socket-handler.ts`
    - 绑定 ClientEvents 到 RoomManager 和 GameController
    - 实现 ServerEvents 广播逻辑
    - 实现状态更新推送（仅推送当前玩家可见信息，隐藏其他玩家手牌）
    - _需求: 15.8_

  - [x] 11.3 实现断线检测与暂停恢复
    - 在 socket-handler 中监听 disconnect 事件，5 秒内检测断线
    - 设置 isPaused=true，挂起所有 Turn_Timer，通知其他玩家，持久化状态
    - 无限期等待重连，重连后从 Redis 恢复完整状态，Turn_Timer 从剩余时间恢复或重新计时
    - _需求: 11.1, 11.2, 11.3, 11.4_

  - [x] 11.4 实现回合计时器
    - 创建 `src/server/turn-timer.ts`
    - TURN 阶段 30 秒计时，超时自动摸牌并打出最近摸到的牌（仅限当前回合）
    - AWAITING 阶段 15 秒计时，超时自动选择"过"
    - _需求: 13.1, 13.2, 13.3, 13.4_

  - [x] 11.5 实现服务重启后状态恢复
    - Game_Server 启动时从 Redis 读取所有活跃房间，恢复进行中的游戏状态
    - _需求: 14.3_

- [x] 12. 第三阶段检查点
  - 确保房间管理、Socket.io 通信、断线恢复、计时器等联网功能正常工作。如有问题请向用户确认。

### 第四阶段：文字版前端

- [x] 13. React 文字版 UI
  - [x] 13.1 实现游戏主界面组件
    - 创建 `src/app/game/page.tsx` 作为游戏页面
    - 创建 `src/components/GameBoard.tsx`：整体布局，显示四位玩家区域
    - 显示当前玩家手牌（文字列表格式，如 [一万, 二万, 三万...]）
    - 显示每位玩家的弃牌池内容
    - 显示牌墙剩余牌数
    - 显示每位玩家当前分数
    - _需求: 15.1, 15.2, 15.4, 15.5, 15.6_

  - [x] 13.2 实现操作按钮与交互
    - 创建 `src/components/ActionBar.tsx`
    - 显示 [碰]、[杠]、[胡]、[过] 按钮，仅在对应操作可执行时显示
    - 出牌交互：点击手牌中的牌执行出牌
    - _需求: 15.3_

  - [x] 13.3 实现 Socket.io 客户端连接与状态管理
    - 创建 `src/hooks/useSocket.ts`，封装 Socket.io 客户端连接
    - 创建 `src/hooks/useGameState.ts`，管理客户端游戏状态
    - 接收 ServerEvents 更新界面
    - _需求: 15.8_

  - [x] 13.4 实现房间大厅与断线提示
    - 创建 `src/components/Lobby.tsx`：房间创建/加入界面
    - 创建 `src/components/PauseOverlay.tsx`：断线暂停全屏遮罩，显示断线玩家信息和等待重连提示
    - _需求: 15.7_

- [x] 14. 最终检查点
  - 确保所有测试通过，前后端联调正常，docker-compose 可一键部署。如有问题请向用户确认。

### 第五阶段：功能增强与体验优化

- [x] 15. 游戏流程增强
  - [x] 15.1 实现自动准备
    - 玩家创建或加入房间时自动设为准备状态，可手动取消准备
    - _需求: 10.4, 10.5_

  - [x] 15.2 实现托管自动胡牌
    - handleTimeout 在 TURN 阶段先检查是否能胡牌，能胡则自动胡
    - _需求: 13.2_

  - [x] 15.3 实现自动开局
    - 胡牌/流局后 5 秒自动开始下一局，保留累计分数
    - 存在断线未重连玩家时取消自动开局，返回大厅
    - 胡牌者当庄，流局庄不变
    - _需求: 18.1, 18.2_

  - [x] 15.4 实现分值日志
    - RedisStore 新增 appendScoreLog / getScoreLog 方法
    - 每局结束时记录局数、时间戳、结果、胜者、各玩家分数变动和累计分数
    - 按房间分类存储，7 天 TTL
    - _需求: 18.3, 18.4, 18.5_

  - [x] 15.5 投票解散逻辑优化
    - 发起方自动同意，其余在线玩家全部同意才解散
    - 断线玩家默认同意
    - _需求: 12.1, 12.2, 12.3, 12.5_

- [x] 16. 前端体验优化
  - [x] 16.1 操作栏位置调整
    - ActionBar（倒计时 + 碰/杠/胡/过按钮）移至手牌上方，通过 GameBoard children 渲染
    - _需求: 15.3_

  - [x] 16.2 抓牌视觉提醒
    - 最近摸到的牌添加闪烁 + 上下抖动动画（CSS @keyframes tileBounce），循环 3 次约 4.5 秒
    - 金色边框 + 金色文字高亮区分
    - _需求: 19.1, 19.2_

  - [x] 16.3 补杠/暗杠 tileId 传递修复
    - useGameState 返回 gangOptions（含 type 和 tileId），ActionBar 点击时正确传递 tileId
    - _需求: 7.2, 7.3_

  - [x] 16.4 胡牌结算页面修复
    - 从 gameState.players 的 score 字段直接读取分数展示，不依赖未实现的 game:win 事件
    - _需求: 15.6_

  - [x] 16.5 碰/杠 fromPlayer 记录修复
    - executePeng / executeMingGang 新增 fromPlayer 参数，修复补杠杠分结算目标丢失
    - _需求: 6.2, 7.1, 9.3_

- [x] 17. 托管与断线机制完善
  - [x] 17.1 断线托管即时出牌
    - broadcastGameState 检测断线玩家 TURN 时通过 handleAutoPlay 立即触发自动出牌
    - broadcastGameState 检测断线玩家 AWAITING 可碰/杠时立即自动过
    - 断线玩家不启动倒计时，不参与超时判断
    - _需求: 11.4, 11.5_

  - [x] 17.2 超时托管一次性机制
    - handleTimeout 标记玩家到 timeoutAutoPlayerIds，自动出牌后立即移除
    - 下次回合重新给 30 秒倒计时
    - 玩家手动操作后从 timeoutAutoPlayerIds 移除，取消托管
    - _需求: 13.2, 13.5, 13.6_

  - [x] 17.3 TurnTimer 内置到 setupSocketHandlers
    - TurnTimer 在 setupSocketHandlers 内部创建，超时回调直接走 broadcastGameState 链路
    - 消除 index.ts 中的重复超时处理逻辑
    - _需求: 13.1_

- [x] 18. 房间加入与解散完善
  - [x] 18.1 断线补位加入
    - room:join 检测到游戏中房间有断线玩家时，替换断线玩家 ID 并恢复游戏状态
    - 无断线玩家时返回 room:error "房间已满，游戏进行中"
    - 房间不存在时返回 room:error "房间不存在"
    - _需求: 10.10, 10.11_

  - [x] 18.2 投票解散清理与积分保留
    - 解散时从 Redis 读取积分日志，随 room:dissolved 事件发送给客户端
    - 解散后 RoomManager 删除房间，不可再加入
    - 清理 turnTimer 和 roundCounters
    - _需求: 12.6, 12.7_

  - [x] 18.3 发起方投票提示
    - 发起投票的玩家看到"已发起投票解散，等待其他玩家响应"
    - _需求: 12.8_

  - [x] 18.4 积分日志大厅展示
    - ScorePanel 组件移至左下角，仅显示积分变动（delta），不显示汇总
    - 大厅页面在无游戏时也显示历史积分日志
    - useGameState 在 room:dissolved 时保留 scoreLog 不清空
    - _需求: 18.6, 18.7_

  - [x] 18.5 倒计时显示优化
    - ActionBar 仅在 remainingSeconds > 0 或有操作按钮时显示
    - 非玩家回合 remainingSeconds 返回 0，ActionBar 隐藏
    - 出牌后立即清除倒计时（onStateUpdate 清零）
    - 断线不影响当前出牌人的倒计时（仅在 phase/player/turn 变化时重置）
    - _需求: 13.7, 15.3_

  - [x] 18.6 投票拒绝通知
    - 投票被拒绝时服务端广播 room:vote-dissolve-rejected 事件
    - 客户端收到后关闭投票提示对话框
    - _需求: 12.3_

  - [x] 18.7 积分日志座位标识
    - ScoreLogEntry 记录时保存座位标签（东南西北），大厅展示时使用座位而非临时 socket ID
    - _需求: 18.6_

- [x] 19. 移动端适配与交互优化
  - [x] 19.1 H5 移动端响应式布局
    - 添加 viewport meta 标签（禁止缩放）
    - 添加 768px / 480px 断点的媒体查询，缩小字体、间距、牌面尺寸
    - 压缩中间区域空闲面积，使用 minmax 约束 grid 列宽
    - 使用 100dvh 动态视口高度
    - _需求: 20.1, 20.2, 20.3, 20.4, 20.5_

  - [x] 19.2 出牌二次确认
    - GameBoard 新增 selectedTileId 状态，第一次点击选中（红色边框+跳动），第二次点击确认出牌
    - 点击不同牌切换选中，状态变化时自动清除选中
    - HandDisplay 新增 selectedTileId prop，tile-selected CSS 类
    - _需求: 21.1, 21.2, 21.3, 21.4_

- [x] 20. UI 架构重构
  - [x] 20.1 牌桌中心化布局
    - 放弃 Grid 列表布局，改用中心化牌桌布局（上/左/右/下环绕）
    - 弃牌区改为 Grid 每行 6 张，模拟真实麻将摆放
    - 使用 100dvh 填满屏幕，消除纵向滚动
    - _需求: 22.1, 22.2_

  - [x] 20.2 抽象 Tile 组件
    - 创建 `src/components/Tile.tsx`，支持 sm/md/lg 尺寸
    - 预留 background-image 接口用于未来图形化
    - 实现选中/跳动/阴影效果
    - 删除旧的 HandDisplay、PlayerArea、DiscardPool 组件
    - _需求: 22.3_

  - [x] 20.3 状态图标化
    - 移除"托管"、"弃牌"等冗余文字
    - 使用 🤖/🕒/🔴 图标表示状态
    - 对手信息精简为紧凑状态卡片
    - _需求: 22.4, 22.5_

  - [x] 20.4 音频服务接口
    - 创建 `src/services/audioService.ts`
    - 在选牌、出牌等关键动作处埋点
    - 当前为 stub 实现，预留音频文件路径接口
    - _需求: 22.6_

  - [x] 20.5 房间号输入验证
    - 限制 6 位大写字母+数字，自动过滤非法字符
    - 长度不足时禁用加入按钮
    - _需求: 23.1, 23.2, 23.3_

  - [x] 20.6 积分面板可展开收起
    - ScorePanel 添加展开/收起按钮
    - 不遮挡手牌区域
    - _需求: 18.6_

- [x] 21. v1.2.1 稳定性修复
  - [x] 21.1 标题更名
    - 全局标题从"中国麻将在线"改为"在线麻将"
    - _需求: 15.1_

  - [x] 21.2 退出房间功能
    - Lobby 新增"退出房间"按钮
    - 点击后断开 Socket 并清除状态，返回首页大厅
    - useMahjongSocket 新增 leaveRoom 方法
    - _需求: 10.1_

  - [x] 21.3 积分日志房间号前缀
    - ScoreLogEntry 新增 roomId 字段
    - ScorePanel 每条记录前显示 [房间号] 前缀
    - _需求: 18.6_

  - [x] 21.4 房间加入错误处理优化
    - 加入按钮仅在 length < 6 时置灰
    - length === 6 但房间无效时弹出错误提示（不置灰按钮）
    - 不再提前设置 localRoomId，等 room:sync 确认后再设置
    - _需求: 23.1, 23.2_

  - [x] 21.5 移动端 ErrorBoundary
    - 创建 ErrorBoundary 组件，捕获 client-side exception
    - 显示"页面异常"恢复 UI，提供刷新按钮
    - 包裹在 RootLayout 中
    - _需求: 20.5_

  - [x] 21.6 Socket 自动重连同步
    - useGameState 监听 socket connect 事件
    - 重连后自动 re-join 上次所在房间
    - 服务端 room:join 的断线补位逻辑处理恢复
    - _需求: 11.3_

- [x] 22. v1.3.0 UI 2.5D 重构
  - [x] 22.1 2.5D 环形牌桌布局
    - mj-table 使用 grid-template-rows: auto 1fr auto 三段式
    - mj-felt 使用 grid 将四位玩家分布在东南西北象限
    - 底部（自己）占最大宽度，左右纵向排列，顶部精简
    - 绿色径向渐变模拟牌桌毡面
    - _需求: 22.1_

  - [x] 22.2 矩阵式弃牌区
    - 每位玩家独立弃牌 Grid（顶/底 6 列，左/右 3 列）
    - 弃牌紧贴各自区域，向心结构
    - _需求: 22.2_

  - [x] 22.3 Tile 组件视觉升级
    - 象牙白底色 + 阴影，模拟实体牌质感
    - 选中态：红色边框 + 上浮 + 持续弹跳动画
    - 新摸牌态：金色边框 + 弹跳
    - clamp() 响应式尺寸，14 张牌不超出视口
    - _需求: 22.3, 需求 5 (Task 5)_

  - [x] 22.4 z-index 层级管理
    - 手牌区 z-20，积分面板 z-40（低于手牌交互区）
    - 覆盖层 z-90+
    - 积分面板移动端自动收起不遮挡
    - _需求: 22 (Task 3)_

## 说明

- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 每个任务引用了对应的需求编号，确保需求可追溯
- 属性测试严格对应 design.md 中定义的 22 项 Property
- 检查点任务用于阶段性验证，确保增量开发的正确性
