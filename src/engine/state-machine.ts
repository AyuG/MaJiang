import type { GameState, GameAction, ActionLogEntry, GangRecord, RuleConfig } from '@/types';
import { deal } from '@/engine/deal';
import { draw, discard, drawSupplement } from '@/engine/draw-discard';
import {
  canPeng,
  canMingGang,
  canAnGang,
  canBuGang,
  executePeng,
  executeMingGang,
  executeAnGang,
  executeBuGang,
} from '@/engine/meld-actions';
import { canWin } from '@/engine/win-checker';
import { recordGangScore, settleWin, settleDraw } from '@/engine/score-calculator';
import { createDefaultRuleProvider } from '@/engine/rule-provider';

const defaultConfig: RuleConfig = createDefaultRuleProvider().config;

/** Append an action log entry, returning a new actionLog array */
function appendLog(
  actionLog: ActionLogEntry[],
  playerIndex: number,
  action: string,
  tileId?: number,
): ActionLogEntry[] {
  return [
    ...actionLog,
    {
      timestamp: Date.now(),
      playerIndex,
      action: action as ActionLogEntry['action'],
      tileId,
    },
  ];
}

/** Deep-clone players array for immutability */
function clonePlayers(state: GameState): GameState['players'] {
  return state.players.map((p) => ({
    ...p,
    hand: [...p.hand],
    melds: p.melds.map((m) => ({ ...m, tiles: [...m.tiles] })),
    discardPool: [...p.discardPool],
  }));
}

/**
 * Pure state machine transition function.
 * Takes a GameState and a GameAction, returns a new GameState.
 */
export function transition(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'deal':
      return handleDeal(state);
    case 'draw':
      return handleDraw(state);
    case 'discard':
      return handleDiscard(state, action.tileId);
    case 'peng':
      return handlePeng(state);
    case 'ming_gang':
      return handleMingGang(state);
    case 'an_gang':
      return handleAnGang(state, action.tileId);
    case 'bu_gang':
      return handleBuGang(state, action.tileId);
    case 'hu':
      return handleHu(state);
    case 'pass':
      return handlePass(state);
    default:
      return state;
  }
}

/** DEALING → TURN: deal tiles, set currentPlayer to dealer */
function handleDeal(state: GameState): GameState {
  if (state.phase !== 'DEALING') return state;

  const result = deal(state.wall);
  const players = clonePlayers(state);

  // Assign hands: deal() gives index 0 the dealer hand (14 tiles)
  // We need to map deal index 0 → dealerIndex
  for (let i = 0; i < 4; i++) {
    const dealOrder = (state.dealerIndex + i) % 4;
    players[dealOrder].hand = result.hands[i];
  }

  return {
    ...state,
    phase: 'TURN',
    players,
    wall: result.wall,
    currentPlayerIndex: state.dealerIndex,
    turnCount: 1,
    actionLog: appendLog(state.actionLog, state.dealerIndex, 'deal' as any),
  };
}

/** TURN: draw a tile from the wall */
function handleDraw(state: GameState): GameState {
  if (state.phase !== 'TURN') return state;
  if (state.wall.length === 0) return state;

  const { tile, wall } = draw(state.wall);
  const players = clonePlayers(state);
  players[state.currentPlayerIndex].hand.push(tile);

  return {
    ...state,
    players,
    wall,
    lastDrawnTileId: tile.id,
    actionLog: appendLog(state.actionLog, state.currentPlayerIndex, 'draw', tile.id),
  };
}

/** TURN: discard a tile. If wall is empty after discard and no other players can act → DRAW */
function handleDiscard(state: GameState, tileId: number): GameState {
  if (state.phase !== 'TURN' && state.phase !== 'AWAITING') return state;

  const pi = state.currentPlayerIndex;
  const players = clonePlayers(state);
  const { hand, discarded } = discard(players[pi].hand, tileId);
  players[pi].hand = hand;
  players[pi].discardPool.push(discarded);

  const newState: GameState = {
    ...state,
    players,
    lastDiscard: { tile: discarded, playerIndex: pi },
    lastDrawnTileId: null, // clear after discard
    consecutiveGangCount: 0,
    turnCount: state.turnCount + 1,
    actionLog: appendLog(state.actionLog, pi, 'discard', tileId),
  };

  // ── Dealer first discard: four-same penalty tracking ──
  // If dealer just discarded their first tile, record it
  let dealerFirstDiscard = newState.dealerFirstDiscard ?? state.dealerFirstDiscard;
  let dealerFirstMatchCount = newState.dealerFirstMatchCount ?? state.dealerFirstMatchCount;

  if (pi === state.dealerIndex && state.dealerFirstDiscard === null && state.turnCount <= 1) {
    // Dealer's first discard this round
    dealerFirstDiscard = { suit: discarded.suit, value: discarded.value };
    dealerFirstMatchCount = 0;
  } else if (dealerFirstDiscard !== null && pi !== state.dealerIndex) {
    // Non-dealer discarding — check if it matches dealer's first discard
    if (discarded.suit === dealerFirstDiscard.suit && discarded.value === dealerFirstDiscard.value) {
      dealerFirstMatchCount++;
      // If all 3 non-dealers matched, apply penalty: dealer pays 5 to each
      if (dealerFirstMatchCount >= 3) {
        players[state.dealerIndex].score -= 15;
        for (let i = 0; i < 4; i++) {
          if (i !== state.dealerIndex) {
            players[i].score += 5;
          }
        }
        dealerFirstDiscard = null; // settled, clear tracking
        dealerFirstMatchCount = 0;
      }
    } else {
      // Mismatch — cancel tracking
      dealerFirstDiscard = null;
      dealerFirstMatchCount = 0;
    }
  }

  newState.dealerFirstDiscard = dealerFirstDiscard;
  newState.dealerFirstMatchCount = dealerFirstMatchCount;

  // Check if other players can peng or ming_gang the discard
  const hasResponse = checkOtherPlayersCanAct(newState, pi, discarded);

  if (hasResponse) {
    return { ...newState, phase: 'AWAITING' };
  }

  // No one can act
  if (newState.wall.length === 0) {
    // Wall empty → DRAW
    const gangRecords = [...state.gangRecords];
    settleDraw(gangRecords);
    return {
      ...newState,
      phase: 'DRAW',
      gangRecords,
    };
  }

  // Move to next player's TURN with auto-draw
  const nextPlayer = (pi + 1) % 4;
  const { tile, wall } = draw(newState.wall);
  const nextPlayers = clonePlayers(newState);
  nextPlayers[nextPlayer].hand.push(tile);
  return {
    ...newState,
    phase: 'TURN',
    players: nextPlayers,
    wall,
    currentPlayerIndex: nextPlayer,
    consecutiveGangCount: 0,
    lastDiscard: { tile: discarded, playerIndex: pi },
    lastDrawnTileId: tile.id,
  };
}

/** Check if any other player can peng or ming_gang the discarded tile */
function checkOtherPlayersCanAct(state: GameState, discardPlayerIndex: number, discarded: import('@/types').Tile): boolean {
  for (let i = 0; i < 4; i++) {
    if (i === discardPlayerIndex) continue;
    if (canPeng(state.players[i].hand, discarded)) return true;
    if (canMingGang(state.players[i].hand, discarded)) return true;
  }
  return false;
}

/** AWAITING: handle peng */
function handlePeng(state: GameState): GameState {
  if (state.phase !== 'AWAITING' || !state.lastDiscard) return state;

  const discarded = state.lastDiscard.tile;
  const discardPlayer = state.lastDiscard.playerIndex;

  // Find the player who can peng (first one found in order after discard player)
  let pengPlayer = -1;
  for (let offset = 1; offset < 4; offset++) {
    const i = (discardPlayer + offset) % 4;
    if (canPeng(state.players[i].hand, discarded)) {
      pengPlayer = i;
      break;
    }
  }
  if (pengPlayer === -1) return state;

  const players = clonePlayers(state);
  const { hand, meld } = executePeng(players[pengPlayer].hand, discarded, state.players[discardPlayer].id);
  players[pengPlayer].hand = hand;
  players[pengPlayer].melds.push(meld);

  // Remove the discarded tile from the discard player's pool
  const dpPool = players[discardPlayer].discardPool;
  const lastIdx = dpPool.findIndex((t) => t.id === discarded.id);
  if (lastIdx !== -1) {
    players[discardPlayer].discardPool = [
      ...dpPool.slice(0, lastIdx),
      ...dpPool.slice(lastIdx + 1),
    ];
  }

  return {
    ...state,
    phase: 'TURN', // peng player must now discard
    players,
    currentPlayerIndex: pengPlayer,
    consecutiveGangCount: 0,
    lastDiscard: null,
    actionLog: appendLog(state.actionLog, pengPlayer, 'peng', discarded.id),
  };
}

/** AWAITING: handle ming_gang */
function handleMingGang(state: GameState): GameState {
  if (state.phase !== 'AWAITING' || !state.lastDiscard) return state;

  const discarded = state.lastDiscard.tile;
  const discardPlayer = state.lastDiscard.playerIndex;

  // Find the player who can ming_gang
  let gangPlayer = -1;
  for (let offset = 1; offset < 4; offset++) {
    const i = (discardPlayer + offset) % 4;
    if (canMingGang(state.players[i].hand, discarded)) {
      gangPlayer = i;
      break;
    }
  }
  if (gangPlayer === -1) return state;

  const players = clonePlayers(state);
  const { hand, meld } = executeMingGang(players[gangPlayer].hand, discarded, state.players[discardPlayer].id);
  players[gangPlayer].hand = hand;
  players[gangPlayer].melds.push(meld);

  // Remove the discarded tile from the discard player's pool
  const dpPool = players[discardPlayer].discardPool;
  const lastIdx = dpPool.findIndex((t) => t.id === discarded.id);
  if (lastIdx !== -1) {
    players[discardPlayer].discardPool = [
      ...dpPool.slice(0, lastIdx),
      ...dpPool.slice(lastIdx + 1),
    ];
  }

  // Record gang score
  const gangRecord = recordGangScore('ming', gangPlayer, discardPlayer);
  const gangRecords = [...state.gangRecords, gangRecord];

  // Supplement draw position
  const position: 'last' | 'second_last' =
    state.consecutiveGangCount === 0 ? 'second_last' : 'last';

  if (state.wall.length === 0) {
    // No tiles to draw, go to DRAW
    const clearedRecords = [...gangRecords];
    settleDraw(clearedRecords);
    return {
      ...state,
      phase: 'DRAW',
      players,
      currentPlayerIndex: gangPlayer,
      gangRecords: clearedRecords,
      lastDiscard: null,
      actionLog: appendLog(state.actionLog, gangPlayer, 'ming_gang', discarded.id),
    };
  }

  const supplement = drawSupplement(state.wall, position);
  players[gangPlayer].hand.push(supplement.tile);

  const newState: GameState = {
    ...state,
    phase: 'TURN',
    players,
    wall: supplement.wall,
    currentPlayerIndex: gangPlayer,
    consecutiveGangCount: state.consecutiveGangCount + 1,
    gangRecords,
    lastDiscard: null,
    actionLog: appendLog(state.actionLog, gangPlayer, 'ming_gang', discarded.id),
  };

  return newState;
}

/** TURN: handle an_gang */
function handleAnGang(state: GameState, tileId: number): GameState {
  if (state.phase !== 'TURN') return state;

  const pi = state.currentPlayerIndex;
  const players = clonePlayers(state);
  const tile = players[pi].hand.find((t) => t.id === tileId);
  if (!tile) return state;

  const { hand, meld } = executeAnGang(players[pi].hand, tile);
  players[pi].hand = hand;
  players[pi].melds.push(meld);

  // Record gang score
  const gangRecord = recordGangScore('an', pi);
  const gangRecords = [...state.gangRecords, gangRecord];

  // Supplement draw: an_gang always takes 'last'
  const position: 'last' | 'second_last' = 'last';

  if (state.wall.length === 0) {
    const clearedRecords = [...gangRecords];
    settleDraw(clearedRecords);
    return {
      ...state,
      phase: 'DRAW',
      players,
      gangRecords: clearedRecords,
      actionLog: appendLog(state.actionLog, pi, 'an_gang', tileId),
    };
  }

  const supplement = drawSupplement(state.wall, position);
  players[pi].hand.push(supplement.tile);

  return {
    ...state,
    phase: 'TURN',
    players,
    wall: supplement.wall,
    consecutiveGangCount: state.consecutiveGangCount + 1,
    gangRecords,
    actionLog: appendLog(state.actionLog, pi, 'an_gang', tileId),
  };
}

/** TURN: handle bu_gang */
function handleBuGang(state: GameState, tileId: number): GameState {
  if (state.phase !== 'TURN') return state;

  const pi = state.currentPlayerIndex;
  const players = clonePlayers(state);
  const tile = players[pi].hand.find((t) => t.id === tileId);
  if (!tile) return state;

  const buGangInfo = canBuGang(players[pi].hand, players[pi].melds);
  if (!buGangInfo || buGangInfo.tile.id !== tileId) return state;

  const { hand, melds } = executeBuGang(
    players[pi].hand,
    players[pi].melds,
    buGangInfo.tile,
    buGangInfo.meldIndex,
  );
  players[pi].hand = hand;
  players[pi].melds = melds;

  // Record gang score — bu_gang target is the original peng source
  // For simplicity, use the previous player as target (same as ming_gang logic)
  const originalMeld = state.players[pi].melds[buGangInfo.meldIndex];
  const targetPlayer = originalMeld.fromPlayer;
  const gangRecord = recordGangScore(
    'bu',
    pi,
    targetPlayer !== undefined ? state.players.findIndex((p) => p.id === targetPlayer) : undefined,
  );
  const gangRecords = [...state.gangRecords, gangRecord];

  // Supplement draw: bu_gang takes 'last'
  const position: 'last' | 'second_last' = 'last';

  if (state.wall.length === 0) {
    const clearedRecords = [...gangRecords];
    settleDraw(clearedRecords);
    return {
      ...state,
      phase: 'DRAW',
      players,
      gangRecords: clearedRecords,
      actionLog: appendLog(state.actionLog, pi, 'bu_gang', tileId),
    };
  }

  const supplement = drawSupplement(state.wall, position);
  players[pi].hand.push(supplement.tile);

  return {
    ...state,
    phase: 'TURN',
    players,
    wall: supplement.wall,
    consecutiveGangCount: state.consecutiveGangCount + 1,
    gangRecords,
    actionLog: appendLog(state.actionLog, pi, 'bu_gang', tileId),
  };
}

/** TURN: handle hu (zi mo / gang shang kai hua / hai di lao yue) */
function handleHu(state: GameState): GameState {
  if (state.phase !== 'TURN') return state;

  const pi = state.currentPlayerIndex;
  const player = state.players[pi];

  if (!canWin(player.hand, player.melds)) return state;

  const players = clonePlayers(state);

  // Settle scores
  const scoreChanges = settleWin(
    [...state.gangRecords],
    pi,
    4,
    defaultConfig,
  );

  for (const change of scoreChanges) {
    players[change.playerIndex].score += change.delta;
  }

  return {
    ...state,
    phase: 'WIN',
    players,
    gangRecords: [], // cleared after settlement
    actionLog: appendLog(state.actionLog, pi, 'hu'),
  };
}

/** AWAITING: handle pass — all players pass, move to next player's TURN */
function handlePass(state: GameState): GameState {
  if (state.phase !== 'AWAITING') return state;

  const discardPlayer = state.lastDiscard?.playerIndex ?? state.currentPlayerIndex;
  const nextPlayer = (discardPlayer + 1) % 4;

  // If wall is empty → DRAW
  if (state.wall.length === 0) {
    const gangRecords = [...state.gangRecords];
    settleDraw(gangRecords);
    return {
      ...state,
      phase: 'DRAW',
      currentPlayerIndex: nextPlayer,
      consecutiveGangCount: 0,
      gangRecords,
      lastDiscard: null,
      actionLog: appendLog(state.actionLog, discardPlayer, 'pass'),
    };
  }

  // Draw a tile for the next player
  const { tile, wall } = draw(state.wall);
  const players = clonePlayers(state);
  players[nextPlayer].hand.push(tile);

  return {
    ...state,
    phase: 'TURN',
    players,
    wall,
    currentPlayerIndex: nextPlayer,
    consecutiveGangCount: 0,
    lastDiscard: null,
    lastDrawnTileId: tile.id,
    actionLog: appendLog(state.actionLog, nextPlayer, 'pass'),
  };
}

/**
 * Get valid actions for the current game state.
 */
export function getValidActions(state: GameState): GameAction[] {
  const actions: GameAction[] = [];

  switch (state.phase) {
    case 'DEALING':
      actions.push({ type: 'deal' });
      break;

    case 'TURN': {
      const pi = state.currentPlayerIndex;
      const player = state.players[pi];
      const handSize = player.hand.length;

      // If player has 14 tiles (or 11/8/5/2 after melds), they need to discard or can hu/gang
      const expectedHandForDiscard = 14 - player.melds.length * 3;
      const hasDrawn = handSize === expectedHandForDiscard;

      if (hasDrawn) {
        // Can hu?
        if (canWin(player.hand, player.melds)) {
          actions.push({ type: 'hu' });
        }

        // Can an_gang?
        const anGangTile = canAnGang(player.hand);
        if (anGangTile) {
          actions.push({ type: 'an_gang', tileId: anGangTile.id });
        }

        // Can bu_gang?
        const buGangInfo = canBuGang(player.hand, player.melds);
        if (buGangInfo) {
          actions.push({ type: 'bu_gang', tileId: buGangInfo.tile.id });
        }

        // Must discard
        for (const tile of player.hand) {
          actions.push({ type: 'discard', tileId: tile.id });
        }
      } else if (state.wall.length > 0) {
        // Need to draw first
        actions.push({ type: 'draw' });
      } else {
        // Wall empty, must discard if has tiles
        if (handSize > 0) {
          for (const tile of player.hand) {
            actions.push({ type: 'discard', tileId: tile.id });
          }
        }
      }
      break;
    }

    case 'AWAITING': {
      if (!state.lastDiscard) {
        actions.push({ type: 'pass' });
        break;
      }

      const discarded = state.lastDiscard.tile;
      const discardPlayer = state.lastDiscard.playerIndex;

      // Check each other player for peng/ming_gang
      // A player with 3 matching tiles can both peng and ming_gang — list both
      for (let offset = 1; offset < 4; offset++) {
        const i = (discardPlayer + offset) % 4;
        const hand = state.players[i].hand;

        // ming_gang takes priority display but both should be available
        if (canMingGang(hand, discarded)) {
          if (!actions.some((a) => a.type === 'ming_gang')) {
            actions.push({ type: 'ming_gang' });
          }
        }
        if (canPeng(hand, discarded)) {
          if (!actions.some((a) => a.type === 'peng')) {
            actions.push({ type: 'peng' });
          }
        }
      }

      actions.push({ type: 'pass' });
      break;
    }

    default:
      break;
  }

  return actions;
}
