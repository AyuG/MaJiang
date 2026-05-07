# AGENTS.md — chinese-mahjong-online

## Dev commands

| Command | What |
|---|---|
| `npm run dev` | Next.js dev server **without** Socket.IO |
| `npm run dev:server` | **Full** game server (Next.js + Socket.IO) via `tsx src/server/index.ts` |
| `npm test` | `vitest run` |
| `npm run test:watch` | `vitest` (watch mode) |
| `npm run lint` | `next lint` |
| `docker-compose up` | Full deployment (game server + Redis) |

**Always use `dev:server`** for local play. `npm run dev` alone serves the Next frontend but won't handle socket events unless the custom server is running separately.

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

- **Only zi mo** (self-draw win). No dian pao. Configured via `RuleConfig.allowDianPao = false`.
- **Fixed scoring**: winScore=5, gangScore=5. Zero-sum settlement.
- **136-tile set** (wan/tiao/tong 1-9 + feng 1-4 + zi 1-3, ×4 each).
- **MockWall** (`src/engine/mock-wall.ts`) — only active outside production. Two modes: `full` (replace entire wall) and `tail` (replace last N tiles). `GameController` takes optional `MockWallConfig` in constructor.
- **Seat assignment**: Join order → 东/南/西/北. Dealer determined by dice roll (highest unique). Winner stays dealer, draw keeps dealer.
- **Timer**: 30s TURN, 15s AWAITING. `TurnTimer` supports suspend/resume for disconnect.
- **Vote dissolve**: 30s timeout. Initiator auto-agrees. Disconnected players default agree. Unvoted online players = disagree at timeout.
- **Recovery**: On server start, `recoverActiveGames()` reads Redis `rooms:active` set, restores `RoomManager` in-memory state from persisted `GameState`.
- **Auth**: No login. Persistent player ID stored in `localStorage` as `mj_player_id`, passed via Socket.IO `auth.playerId`. Nickname in `localStorage` as `mj_nickname`, passed via `auth.nickname`.
- **Scoring/Gang records**: Accumulated during game, settled only on win. On draw (流局), gang records are cleared (zero-sum preserved).

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
- **Disconnected players** get auto-played (smart discard, auto-pass, auto-hu). Marked with 🤖 icon. Turn timer is not started for them — auto-play fires immediately with 100ms delay to avoid sync recursion.
