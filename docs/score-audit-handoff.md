# 麻将计分审查与复盘交接

首次审查：2026-10-22；真实 Redis 复审：2026-10-23（Asia/Shanghai）。基线：AyuG/MaJiang main，12b84aafa74e278e99403540e3d5628bd3d77230。修复分支：fix/round-score-history。未合并 main、未部署、未读取或修改生产数据。

## 业务口径

- 仅沿用本项目现有玩法。四位玩家本局首张弃牌同花色、同点数时，庄家立即 -15，其他三家各 +5，每局至多一次；后续弃牌不计入匹配。被碰杠移走的弃牌仍是已经发生过的弃牌。
- 流局仅清除尚未结算的杠分，不撤销首牌罚分。最后一张弃牌同时触发罚分和流局时，罚分也必须保留。
- 胡牌结算本局待结算杠分和自摸分，叠加已经发生的首牌罚分。四家本局净积分和为零。
- 每局 `delta = 结束累计分 - 本局开始前累计分`，`total = 结束累计分`。例如上一局累计 `[15,-5,-5,-5]`，本局只有首牌罚分，流局后 total 为 `[0,0,0,0]`，delta 应为 `[-15,5,5,5]`，不能记为全零。

## 已修复的问题

1. `finalizeRound` 原先把累计分同时填入 delta 与 total。现在 `roundStartScores` 随局面保存至 Redis、发送给客户端；首局从零开始，后续局继承累计分，按玩家 ID 计算分差。
2. 首牌匹配原先计数任意后续弃牌；现在依据 actionLog 判断每位玩家的首次弃牌，避免重复计入同一玩家以及被碰杠移走的弃牌。
3. 客户端原先在每次 TURN 更新时覆盖基线，会漏掉途中已生效的首牌罚分；现在统一使用服务器起始基线。胜者从 currentPlayerIndex 读取，不再选择累计分最高者。
4. 内存局号在重启后会归零，重复终局广播也会增加局号和安排多个续局。现在使用持久化 roundNumber，合并同房间的并发 finalize，忽略已进入下一局的重复 finalize；展示期只安排一个续局计时器。
5. 终局快照与历史在同一 Redis Lua 操作中提交，避免半个终局；同局相同记录不重复追加，冲突记录报错且不覆盖。
6. 起始快照与可恢复房间登记原子提交；恢复终局时尝试补写日志，单房间日志异常不阻止服务器启动。恢复时旧连接全部标记离线，重连保留基线、局号；展示期结束使用最新断线状态决定是否续局。解散时撤销恢复登记，但保留历史。
7. 替补沿用原座位的累计分和起始基线，并更新副子中的来源玩家 ID，避免后续补杠找不到付款方。终局展示期禁止替换已结算记录中的玩家。
8. 重连及解散时同步服务器历史，补齐客户端漏收的局，按房间和局号去重。重复手动开局请求不能重置正在进行的房间；“新房”从第 1 局和零分开始。
9. 需求、设计、任务说明和 AGENTS.md 明确流局保留首牌罚分；界面移除“本局不计分”，历史列标为“本局分差”。

10. 同房间动作、超时、断线/重连、替补、续局和关闭共用顺序队列；移除 socket 层的二次状态覆盖。超时携带并校验玩家、阶段、局号及 turnCount，避免过期回调误操作。

## 变更文件

| 范围 | 文件 |
| --- | --- |
| 规则文档 | `AGENTS.md`、`.kiro/specs/chinese-mahjong-online/requirements.md`、`design.md`、`tasks.md` |
| 引擎 | `src/engine/state-machine.ts`、`src/engine/score-calculator.ts` |
| 控制、恢复、持久化 | `src/server/game-controller.ts`、`socket-handler.ts`、`recovery.ts`、`index.ts`、`turn-timer.ts`、`src/store/redis-store.ts` |
| 类型与事件 | `src/types/game.ts`、`events.ts`、`index.ts` |
| 客户端 | `src/hooks/useGameState.ts`、`src/hooks/score-history.ts`、`src/components/ScorePanel.tsx`、`src/app/page.tsx` |
| 新增测试 | `src/engine/__tests__/first-discard-scoring.test.ts`、`src/server/__tests__/round-score-history.test.ts`、`src/server/__tests__/score-recovery-socket.test.ts`、`src/hooks/__tests__/score-history.test.ts`、`src/server/__tests__/turn-timer.test.ts`、`tests/redis/score-durability.test.ts`、`tests/redis/persistence-migration.test.ts`、`tests/redis/crash-worker.ts`、`src/server/__tests__/helpers/isolated-redis.ts` |
| 真实 Redis 测试入口 | `vitest.redis.config.ts`、`package.json` 的 `test:redis` |
| 交接与复审 | `docs/score-audit-handoff.md`、`docs/redis-score-verification.md`、`docs/redis-migration-runbook.md` |

## 验证

- `npm test`：20 个测试文件、138 项测试通过，较 main 新增 33 项。涵盖四个庄位、首张/后续弃牌、五条流局路径、罚分与流局同一步、多人明/暗/补杠加胡牌、跨局分差、断线恢复、旧存档基线、并发重复记录、冲突记录、新房及真实 Socket.IO 重连。
- 真实 Redis：21 项通过（15 项专项 + 4 项迁移/备份恢复演练 + 2 项与常规套件重叠的 Socket.IO 测试），详见 [复审报告](redis-score-verification.md)。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过（Next.js 16.2.9）。
- `npm run lint -- --ignore-pattern 'mahjong-master/**'`：通过。原始 `npm run lint` 会扫描本机 Git 已忽略的 `mahjong-master/` 旧参考项目并报错；没有修改参考项目或为了通过检查而削弱仓库 lint 规则。
- `git diff --check`：通过。
- 安装依赖使用现有锁文件，未修改依赖版本。常规测试使用 ioredis-mock；新增专项使用临时 Unix socket Redis 7.2.6，真实 Socket.IO 仅监听本机临时端口。未连接生产 Redis。全套测试需要允许本机端口监听；沙箱内首次运行因 EPERM 失败，放行本机测试后通过。
- 保留现有工具警告：Vite CJS 弃用提示、旧集成测试中的 ioredis-mock listener 警告；不影响测试通过。

## 剩余限制与分析准入

- 修复不会自动改写已有错误日志。修复前的 delta、重复局号、客户端缓存以及可能已误触发的罚分不能直接作为可信训练样本。只有确认同房间、同玩家连续累计分完整时，才可离线从 total 差值重建；重建也不能修正引擎曾经错误计分的事实。建议批准发布后从新房间开始采集，并记录版本及房间号。
- 旧存档缺少 roundStartScores 时：首局使用零；后续局从上一局同玩家 total 恢复。前局缺失、已过期或身份无法对应时拒绝猜测 delta，需要人工核对或新建房间。旧存档已经写入的冲突终局记录也不会被静默覆盖。
- 日志仍沿用房间级 7 天 TTL；要做长期分析，必须在过期前导出到独立归档。本次未新增导出服务、训练软件或更改保留策略。
- 替补继承座位分数是现有行为。发生替补的局不能直接解释为单个自然人的整局表现，应在个人能力分析中排除或单独标记。
- 中途解散的未完成局不伪装成流局，不纳入“每完成一局平均净积分”的分母。已生效罚分仍在最后局面里，但没有完整终局日志；此类记录需要另行定义截断样本口径。
- 终局已原子提交，单实例并发已顺序处理；真实 Redis 提交前/后中断、确认丢失、AOF 重启已验证。多实例推进同一局、主机断电和磁盘故障不在已验证范围。
- 上线前仍需审批 Redis 持久化迁移：仓库 compose 未开启 AOF，默认 RDB 对照测试已复现已确认积分丢失；AOF always 组通过。生产实际配置未读取，不能直接宣称生产具备同样保证。隔离迁移和 RDB/AOF 备份恢复已通过，逐项核对分差、累计分及原始过期时间；发布/迁移/回滚步骤见 [运行手册](redis-migration-runbook.md)。容器部署及实际生产备份恢复尚未验证，旧备份恢复不保留其检查点之后的对局。
- 服务重启后，自动续局仍需玩家重连触发。没有改造整个计时器恢复架构；本次保证恢复使用原局号与积分基线，并补写可恢复终局。

## 给 ChatGPT 的后续复盘摘要

优化目标仍为长期平均每局净积分最大化。统计时使用每局 delta，不使用累计 total；所有完成局都进入分母，包括零分流局和非零罚分流局。自摸与各类杠分按当前固定 5 分规则，首牌罚分立即生效且在流局保留。数据优先取修复版本的新房间服务端历史，按房间/局号去重，检查四家 delta 和为零及累计分连续性。不要从累计分最高者推断胜者。旧数据、替补局、断线漏失以及中途解散样本需单独处理。隔离持久化迁移和备份恢复演练已完成，但不代表生产已具备相同保证。下一步先审阅 PR 和运行手册，确认合并及生产窗口，再核查实际配置、真实备份恢复和上线验收，之后另行授权采集与长期归档；本次未部署，也未开始训练方案或训练软件开发。
