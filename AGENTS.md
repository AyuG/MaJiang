# AGENTS.md — chinese-mahjong-online

## Dev commands

| Command | What |
|---|---|
| `npm run dev` | Next.js dev server **without** Socket.IO (not recommended for development) |
| `npm run dev:server` | **Full** game server (Next.js + Socket.IO) via `tsx src/server/index.ts` |
| `npm test` | `vitest run` |
| `npm run test:watch` | `vitest` (watch mode) |
| `npm run lint` | `next lint` |
| `docker-compose up` | Full deployment (game server + Redis) |

**Always use `dev:server`** for local play. `npm run dev` alone serves the Next frontend but won't handle socket events.

## Architecture

- **`src/engine/`** — Pure, side-effect-free game logic. State machine `transition(state, action)` is a pure function: `(GameState, GameAction) => GameState`. No I/O, no imports from `server/` or `store/`.
- **`src/server/`** — Custom HTTP server (Not a Next.js API route). Entrypoint `src/server/index.ts` creates an HTTP server, mounts Next.js handler + Socket.IO, wires `GameController` + `RoomManager` + `RedisStore` + `TurnTimer`.
- **`src/store/`** — `RedisStore` wraps ioredis. Accepts an optional Redis client (inject `ioredis-mock` in tests via constructor arg).
- **`src/types/`** — All shared types (`GameState`, `GameAction`, `GamePhase`, `ClientEvents`, `ServerEvents`, etc.).
- **`src/hooks/`** — React hooks: `useSocket` (singleton Socket.IO client), `useGameState` (event listeners + timer), `useMahjongSocket` (composed API for pages).
- **`@/`** path alias → `src/` (configured in `tsconfig.json` + `vitest.config.ts`).

## Testing

- **`vitest`** + **`fast-check`** for property-based tests.
- Engine tests: `src/engine/__tests__/*.property.test.ts` — pure, no setup needed.
- Server tests: `src/server/__tests__/*.test.ts` — use `ioredis-mock`, create real Socket.IO server on random port.
- Redis tests: `src/store/redis-store.test.ts` — use `ioredis-mock`.
- Run focused: `npx vitest run src/engine/__tests__/state-machine.property.test.ts`
- No CI pipeline exists. No pre-commit hooks.

## Key design decisions

- **Only zi mo** (self-draw win). No dian pao. Configured via `RuleConfig.allowDianPao = false`. **Future**: Will be configurable.
- **Fixed scoring**: winScore=5, gangScore=5. Zero-sum settlement. **Future**: Will support 番种 (fan) calculation.
- **136-tile set** (wan/tiao/tong 1-9 + feng 1-4 + zi 1-3, ×4 each).
- **MockWall** (`src/engine/mock-wall.ts`) — only active outside production. Two modes: `full` (replace entire wall) and `tail` (replace last N tiles). `GameController` takes optional `MockWallConfig` in constructor.
- **Seat assignment**: Join order → 东/南/西/北. Dealer determined by dice roll (highest unique). Winner stays dealer, draw keeps dealer.
- **Timer**: 30s TURN, 15s AWAITING. `TurnTimer` supports suspend/resume for disconnect.
- **Vote dissolve**: 30s timeout. Initiator auto-agrees. Disconnected players default agree. Unvoted online players = disagree at timeout.
- **Recovery**: On server start, `recoverActiveGames()` reads Redis `rooms:active` set, restores `RoomManager` in-memory state from persisted `GameState`.
- **Auth**: No login. Player ID is now **server-generated** (prefix `srv_`). Client can send existing ID via Socket.IO `auth.playerId`, server returns final ID via `player:identity` event. ID stored in `localStorage` as `mj_player_id`. Nickname in `localStorage` as `mj_nickname`, passed via `auth.nickname`.
- **Scoring/Gang records**: Gang records are settled only on win; draw clears pending gangs only. First-discard penalties apply immediately and survive draws. Persist roundStartScores; each score-log delta is final total minus this baseline, never the cumulative score itself.
- **Disconnected players** get auto-played (smart discard, auto-pass, auto-hu). Marked with 🤖 icon. Turn timer is not started for them — auto-play fires immediately with 100ms delay to avoid sync recursion.
- **Auto-play limit**: Maximum 10 consecutive auto-plays to prevent infinite loops when multiple players are disconnected.

## Game Rules

### 胡牌规则 (Win Conditions)
- **七对子 (Seven Pairs)**: Exactly 14 tiles forming 7 pairs. **No melds allowed** (龙七对 not supported).
- **Standard Win**: N sets of 3 (triplets or sequences) + 1 pair.

### 杠牌补牌规则 (Gang Supplement Draw)
- **明杠 (Ming Gang)**: First gang in a round takes from second-to-last position. Subsequent gangs take from last position.
- **暗杠 (An Gang)**: Always takes from last position.
- **补杠 (Bu Gang)**: Always takes from last position.

### 特殊规则: 庄家首牌四家同出
If all 4 players discard the same tile on their first turn (dealer discards first, then all 3 non-dealers match):
- Dealer pays 5 points to each non-dealer (total -15).
- Non-dealers each receive 5 points.
- Apply immediately and at most once per round, including if the same discard ends in a draw.
- Only each player's first discard counts, using actionLog (claimed tiles disappear from discardPool). Later discards do not count.
- Draw clears pending gang records only; it never reverses this penalty.

### 掷骰子定庄 (Dice Roll for Dealer)
- All 4 players roll dice (1-6).
- Highest unique roll becomes dealer.
- If tied for highest, tied players re-roll until a unique winner.
- Maximum 9 rounds of re-rolls (fallback to first candidate if limit reached).

## Docker

- `Dockerfile`: Multi-stage build (deps → builder → runner). Production runs via `tsx src/server/index.ts` (not the compiled Next.js standalone server).
- `docker-compose.yml`: Game server on port 80:3000, Redis 7-alpine with named volume.
- Environment: `REDIS_URL`, `HOSTNAME`, `PORT`, `NODE_ENV`.

## Conventions

- **Imports**: Always use `@/` alias (never relative `../../`).
- **Event naming**: Client→Server events prefixed `room:` or `game:` (e.g. `room:create`, `game:discard`). Server→Client events similarly.
- **Types**: Socket.IO event contracts defined in `src/types/events.ts` as `ClientEvents` and `ServerEvents`.
- **State machine phases**: `DEALING` → `TURN` → `AWAITING` → `WIN` | `DRAW`.
- **Client game state** (`ClientGameState`) hides other players' hands. Only `myHand` is sent to each player individually.

## Socket Events Reference

### Client → Server Events (`ClientEvents`)

| Event | Parameters | Description |
|-------|------------|-------------|
| `room:create` | () | Create a new room |
| `room:join` | (roomId: string) | Join an existing room |
| `room:ready` | () | Mark self as ready |
| `room:unready` | () | Mark self as not ready |
| `room:kick` | (targetId: string) | Kick a player (requires permission) |
| `room:set-role` | (targetId: string, role: 'admin' \| 'member') | Change player role (owner only) |
| `room:dissolve` | () | Dissolve room (owner only) |
| `room:start` | () | Start game (requires all 4 ready) |
| `room:change-nickname` | (name: string) | Change display nickname |
| `room:vote-dissolve` | () | Initiate vote dissolve |
| `room:vote-dissolve-reply` | (agree: boolean) | Respond to vote dissolve |
| `room:new-game` | () | Create new room with same players |
| `game:discard` | (tileId: number) | Discard a tile |
| `game:peng` | () | Execute peng (碰) |
| `game:gang` | (type: 'ming' \| 'an' \| 'bu', tileId?: number) | Execute gang (杠) |
| `game:hu` | () | Declare hu (胡) |
| `game:pass` | () | Pass on peng/gang opportunity |

### Server → Client Events (`ServerEvents`)

| Event | Parameters | Description |
|-------|------------|-------------|
| `player:identity` | `{ playerId: string; nickname: string }` | Server sends player identity (on new connection) |
| `room:list` | `RoomListItem[]` | Room list (on connect and when rooms change) |
| `room:created` | (roomId: string) | Room created successfully |
| `room:joined` | ({ id: string, seat: number }) | Joined room successfully |
| `room:player-ready` | (playerId: string) | Player marked ready |
| `room:player-unready` | (playerId: string) | Player marked unready |
| `room:sync` | (RoomSyncData) | Full room state sync |
| `room:kicked` | (targetId: string) | Player was kicked |
| `room:error` | (message: string) | Error message |
| `room:vote-dissolve-request` | (initiator: string) | Vote dissolve initiated |
| `room:vote-dissolve-rejected` | () | Vote dissolve rejected |
| `room:dissolved` | ({ roomId, scoreHistory? }) | Room dissolved |
| `room:new-game-created` | (roomId: string) | New game room created |
| `game:dice-result` | ({ rolls, dealerIndex }) | Dice roll result |
| `game:started` | (ClientGameState) | Game started |
| `game:state-update` | (ClientGameState) | Game state updated |
| `game:paused` | (disconnectedPlayer: string) | Game paused (player disconnected) |
| `game:resumed` | () | Game resumed |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `HOSTNAME` | `0.0.0.0` | Server hostname |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Log level |

## Production Deployment

```bash
# Build and run with Docker
docker-compose up -d

# Or build manually
docker build -t mahjong-server .
docker run -p 3000:3000 -e REDIS_URL=redis://redis:6379 mahjong-server
```

## Future Enhancements

- [ ] Configurable rules (dian pao, 番种 scoring)
- [x] Server-generated player IDs
- [x] Room list in lobby
- [x] Theme switching (CSS variables)
- [ ] More integration tests
- [ ] API documentation generation
