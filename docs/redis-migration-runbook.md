# Redis 计分数据迁移、备份恢复与发布步骤

2026-10-23；对应 [PR #1](https://github.com/AyuG/MaJiang/pull/1)。**隔离演练已完成，生产操作尚未执行、尚未授权。** 下列运维命令是批准窗口内的步骤模板；需要先核对实际部署目录、容器、版本、认证和数据路径。测试样例数据不是生产备份。

## 演练证据

执行方式（只使用脚本自行启动的临时实例，不读取 `REDIS_URL`）：

```bash
MJ_REDIS_SERVER=/absolute/path/to/redis-server npm run test:redis
```

本次二进制为已校验官方 SHA256 的 Redis 7.2.6，来源及校验值见 [复审报告](redis-score-verification.md)。新增 `tests/redis/persistence-migration.test.ts` 的 4 项测试使用真实 GameController 写入：

| 检查点 | 局号 / 结果 | 四家 delta | 四家 total |
| --- | --- | --- | --- |
| 首局自摸 | 1 / WIN | `[15,-5,-5,-5]` | `[15,-5,-5,-5]` |
| 罚分流局，待结算杠清除 | 2 / DRAW | `[-15,5,5,5]` | `[0,0,0,0]` |
| AOF 启用后的新自摸局 | 3 / WIN | `[15,-5,-5,-5]` | `[15,-5,-5,-5]` |

- 在线启用 AOF，等待首次重写完成，再 `CONFIG REWRITE`；第 3 局只在迁移后写入。SIGKILL 后重启仍有 3 局，配置为 `appendonly yes` / `appendfsync always`，应用恢复补记不重复，玩家连接置为离线。
- 第 2 局 RDB 备份 SHA256 校验后，在全新实例恢复，快照、历史、房间信息、恢复登记、键数量、积分基线和绝对过期时间均相同；再转 AOF 并强制重启仍一致。源实例第 3 局不会出现在旧备份里，明确验证恢复点边界。
- AOF 备份包含 manifest、base、incremental 全部文件，逐文件 SHA256 相同。在没有 dump.rdb 的全新目录启动，能恢复 base 之后新增的第 3 局，原始过期时间保持不变。
- 错误顺序对照：已有第 2 局 dump.rdb，只把启动配置改成 AOF 后重启，读到空数据。该项通过表示风险成功复现，不能作为安全迁移步骤。

所有比较均验证每局四家 delta 和为零、前局 total + 本局 delta = 本局 total、最后快照分数与历史一致；并非只检查 Redis 能启动。备份期间无应用写入，禁用自动 AOF 重写、等待重写结束，复制后恢复原参数。测试目录和进程结束后清理。

## 1. 确定窗口、版本和回退材料

先完成 PR 审阅和合并批准；生产发布及 Redis 变更需单独确认。记录当前应用提交/镜像摘要、Redis 镜像摘要、实际 compose 配置、数据卷和可恢复备份。`redis:7-alpine` 是可变标签；本次不同时升级 Redis，也不把本机测试的 7.2.6 当成生产版本建议。

当前仓库没有维护模式，终局会自动续局。不能依赖一个不存在的“暂停新局”按钮。窗口开始后停止入口及游戏服务，阻止所有应用/机器人/重连写入；保留 Redis 运行以生成一致检查点。未完成局保持原局面，不伪造流局；若要求只保留完成局，须事先安排玩家结束，并核实停止时的实际快照。

以下以仓库的 compose 服务名为例；命令只能在已核对的部署目录执行。认证信息通过已有安全渠道提供，不写入文档或命令历史。

```bash
docker compose stop game-server
docker compose exec -T redis redis-cli INFO server
docker compose exec -T redis redis-cli INFO persistence
docker compose exec -T redis redis-cli CONFIG GET dir dbfilename appenddirname appendfilename appendonly appendfsync save auto-aof-rewrite-percentage no-appendfsync-on-rewrite
docker compose exec -T redis redis-cli DBSIZE
docker compose exec -T redis redis-cli SMEMBERS rooms:active
```

用 SCAN 收集所有 `game:*`、`room:*`、`score:*`、`log:*`，包括已解散房间；不能只备份 active 集合。检查点清单记录：时间、版本、房间、局号、phase、玩家 ID、累计分、roundStartScores、每条历史的结果/胜者/delta/total、日志条数、绝对过期时间。例：对每个已发现房间，将下列读取结果保存到独立目录（`ROOM_ID` 替换为实际已核对的房间号）：

```bash
docker compose exec -T redis redis-cli --json GET game:ROOM_ID
docker compose exec -T redis redis-cli --json HGETALL room:ROOM_ID
docker compose exec -T redis redis-cli --json LRANGE score:ROOM_ID 0 -1
docker compose exec -T redis redis-cli PEXPIRETIME score:ROOM_ID
```

旧错误日志或缺失基线必须记录为例外，禁止为通过核对而重写。全库备份负责保留所有键；业务清单负责发现数据本身的历史错误。不要在含正式数据的实例上运行测试命令或 FLUSHDB。

## 2. 先备份 RDB 并验证恢复

应用写入已停止后，记录 `rdb_saves`，请求一次新的备份：

```bash
docker compose exec -T redis redis-cli BGSAVE
docker compose exec -T redis redis-cli INFO persistence
```

等本次 `rdb_saves` 增加、`rdb_bgsave_in_progress=0`、`rdb_last_bgsave_status=ok` 后复制实际 `dir/dbfilename`。不能只看到旧的 `ok` 就认为新备份已完成。小型隔离测试使用 SAVE；正式窗口使用 BGSAVE 并等待成功。使用新建的、带时间戳的备份目录，避免覆盖已有备份。示例仅在核对路径确实为 `/data/dump.rdb` 后成立：

```bash
docker compose cp redis:/data/dump.rdb /absolute/new-backup-directory/dump.rdb
shasum -a 256 /absolute/new-backup-directory/dump.rdb
```

把 RDB、SHA256、检查点清单和部署配置复制到独立存储。恢复时使用全新数据目录，`appendonly no`，不放入任何旧 AOF；启动隔离 Redis，核对全部业务清单与键/过期时间。保留原备份不变。只有启动成功不足以验收。生产规模、实际镜像和实际备份恢复尚需在授权窗口核验，本次合成数据演练不能替代它。

## 3. 在线转换，然后固化启动配置

继续保持应用停写。以下 `always` 是本次演练采用的候选策略，正式采用前需核实存储空间和写入延迟：

```bash
docker compose exec -T redis redis-cli CONFIG SET appendfsync always
docker compose exec -T redis redis-cli CONFIG SET appendonly yes
docker compose exec -T redis redis-cli INFO persistence
```

必须等 `aof_enabled=1`、`aof_rewrite_in_progress=0`、`aof_rewrite_scheduled=0`、`aof_last_bgrewrite_status=ok`、`aof_last_write_status=ok`，再核对检查点。失败或超时则保持停写、保留原数据，不进入重启步骤。保留现有 RDB 策略，不顺便关闭快照。`no-appendfsync-on-rewrite` 也应保持 `no`，否则重写期间可能削弱刷盘保证。

**仓库 compose 没有挂载 redis.conf。** 没有配置文件启动的 Redis，不能依靠 `CONFIG REWRITE` 持久化参数。演练的配置文件重启路径已验证，但正式环境必须二选一落地并审阅实际差异：

- 已有可写配置文件：更新持久化参数或执行 `CONFIG REWRITE`，核对文件及容器重建后挂载仍有效；命令行参数不能与之冲突。
- 仓库当前无配置文件方式：在线转换成功后，再在实际部署 compose 的 redis 服务中加入启动参数。候选片段如下，保留原镜像、数据卷及实际已有安全配置；不要先改片段就直接重启。

```yaml
services:
  redis:
    command: ["redis-server", "--appendonly", "yes", "--appendfsync", "always"]
```

本 PR 没有改动部署 compose；此片段未执行。用 `docker compose config` 审阅展开结果并记录版本，确认没有指向空数据卷或覆盖已有参数。`everysec` 不是同等保证的性能优化，选择它意味着明确接受故障时约一秒的数据损失窗口。

## 4. 备份完整 AOF 并再次冷恢复

记录原 `auto-aof-rewrite-percentage`，设置为 0，禁止人工触发 BGREWRITEAOF，并等待当前/排队重写结束。应用仍停写：

```bash
docker compose exec -T redis redis-cli CONFIG GET auto-aof-rewrite-percentage
docker compose exec -T redis redis-cli CONFIG SET auto-aof-rewrite-percentage 0
docker compose exec -T redis redis-cli INFO persistence
```

复制实际 `dir/appenddirname` 整个目录，包含 manifest 及其引用的全部 base/incremental 文件；不能只复制一个 `.aof`。例如已核对为默认目录时：

```bash
docker compose cp redis:/data/appendonlydir /absolute/new-backup-directory/appendonlydir
```

记录每个文件的相对路径、大小和 SHA256，核验传输后的文件；连同参数清单、RDB、业务清单归档。无论复制成功与否，恢复原重写百分比；不要把 0 遗留在最终启动配置。若备份过程中实例意外重启，当前复制结果作废，重新检查参数和重写状态后从头复制。

把完整 AOF 复制到新隔离目录，使用相同文件名配置和 `appendonly yes` 冷启动。对照业务清单，确认 base 之后的新增历史也在，并且没有加载截断/修复警告；发现任何缺失都停止验收。不在原备份上执行 `redis-check-aof --fix`。

## 5. 受控重启、应用发布与验收

确认前述检查点及备份可恢复、实际启动配置已经审阅后，在批准窗口重启/重建 Redis，始终保留同一个已核对的数据卷。核对实际 `appendonly`、`appendfsync`、持久化状态、所有房间和积分清单，再启动经批准的应用镜像。勿用本机 SIGKILL 演练方式操作生产实例。

验收须包括：原局号与基线不变、重连只恢复真实在线玩家、终局历史不重复、首牌罚分流局保留 `[-15,5,5,5]`、新房间从零开始、多人胡牌/杠分正确。记录新版本起始房间及上线时间；监控写入错误、延迟、AOF 重写失败和磁盘余量。新局数据另行批准归档，在 7 天 TTL 前保存。

## 6. 回滚边界与操作

- **尚未开放应用写入**：保持服务停止；保留故障实例原数据和日志。在新目录/新卷恢复已验收检查点，按 RDB 或 AOF 对应启动模式加载，核对清单后再切换。不要覆盖原卷，也不要在 RDB 回退目录混入失败迁移产生的 AOF。若重新开放写入，仍需符合已批准的耐久性策略；仅启动 RDB 不等于恢复了“不丢已确认积分”的目标。
- **已经新增对局**：停止写入，先备份当前 RDB/AOF 和最新业务清单。旧检查点不含之后的确认积分，不能无损回退到旧备份。优先保留最新数据进行前向修复；若确需恢复旧检查点，须明确缺失的房间/局号和获准的数据损失范围，原备份与事故数据全部保留。
- **应用版本回滚**：旧版存在已知计分和历史缺陷。回滚不自动代表可以继续收集可信样本；先在最新数据副本验证兼容性，必要时维持停服。不要为兼容旧版本删除 roundStartScores 或改写历史。

RDB/AOF 的恢复均保留绝对过期时间，不会重新获得 7 天有效期。恢复时已经过期的日志仍会消失；灾备不能替代长期归档。

## 未验证项

本轮只演练合成的 4 人、3 局数据；没有读取真实备份或生产参数。Docker 守护进程不可用，未演练容器重建、实际卷挂载和容器文件权限；没有做生产规模的性能测试、主机断电、磁盘损坏/写满或主从切换。`always` 的实际性能和磁盘保证需在目标环境验证。单服务队列不构成多实例并行推进同一局的支持。

迁移顺序、刷盘及 Redis 7 多文件备份依据：[Redis 官方持久化文档](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)。本项目使用 Redis 7，不套用 Redis 8.10 的 BACKUP 命令。
