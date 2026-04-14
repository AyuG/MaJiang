import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { GangRecord, RuleConfig } from '@/types';
import {
  recordGangScore,
  settleWin,
  settleDraw,
} from '@/engine/score-calculator';
import { createDefaultRuleProvider } from '@/engine/rule-provider';

// --- Helpers ---

const PLAYER_COUNT = 4;

const arbPlayerIndex = fc.integer({ min: 0, max: PLAYER_COUNT - 1 });

const arbGangType = fc.constantFrom<'ming' | 'an' | 'bu'>('ming', 'an', 'bu');

function arbTargetIndex(gangIdx: number): fc.Arbitrary<number> {
  const others = [0, 1, 2, 3].filter((i) => i !== gangIdx);
  return fc.constantFrom(...others);
}

interface GangOp {
  type: 'ming' | 'an' | 'bu';
  gangIdx: number;
  targetIdx: number | undefined;
}

const arbGangOp: fc.Arbitrary<GangOp> = arbPlayerIndex.chain((gangIdx) =>
  arbGangType.chain((type): fc.Arbitrary<GangOp> => {
    if (type === 'an') {
      return fc.constant({ type, gangIdx, targetIdx: undefined });
    }
    return arbTargetIndex(gangIdx).map((targetIdx) => ({ type, gangIdx, targetIdx }));
  }),
);

const defaultConfig: RuleConfig = {
  allowDianPao: false,
  requireQueMen: false,
  gangScore: 5,
  winScore: 5,
};

describe('Property 11: 杠分计算正确性', () => {
  it('ming gang: target pays gangScore to gang player, sum is zero', () => {
    fc.assert(
      fc.property(
        arbPlayerIndex.chain((gangIdx) =>
          arbTargetIndex(gangIdx).map((targetIdx) => ({ gangIdx, targetIdx })),
        ),
        ({ gangIdx, targetIdx }) => {
          const record = recordGangScore('ming', gangIdx, targetIdx);
          expect(record.type).toBe('ming');
          expect(record.gangPlayerIndex).toBe(gangIdx);
          expect(record.targetPlayerIndex).toBe(targetIdx);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('bu gang: target pays gangScore to gang player, sum is zero', () => {
    fc.assert(
      fc.property(
        arbPlayerIndex.chain((gangIdx) =>
          arbTargetIndex(gangIdx).map((targetIdx) => ({ gangIdx, targetIdx })),
        ),
        ({ gangIdx, targetIdx }) => {
          const record = recordGangScore('bu', gangIdx, targetIdx);
          expect(record.type).toBe('bu');
          expect(record.gangPlayerIndex).toBe(gangIdx);
          expect(record.targetPlayerIndex).toBe(targetIdx);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('an gang: other 3 players each pay gangScore, sum is zero', () => {
    fc.assert(
      fc.property(arbPlayerIndex, (gangIdx) => {
        const record = recordGangScore('an', gangIdx);
        expect(record.type).toBe('an');
        expect(record.gangPlayerIndex).toBe(gangIdx);
        expect(record.targetPlayerIndex).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('settleWin with gang records produces zero-sum score changes', () => {
    fc.assert(
      fc.property(
        fc.array(arbGangOp, { minLength: 0, maxLength: 5 }),
        arbPlayerIndex,
        (gangOps, winnerIdx) => {
          const gangRecords: GangRecord[] = gangOps.map((op) =>
            recordGangScore(op.type, op.gangIdx, op.targetIdx),
          );
          const changes = settleWin(gangRecords, winnerIdx, PLAYER_COUNT, defaultConfig);
          const totalDelta = changes.reduce((sum, c) => sum + c.delta, 0);
          expect(totalDelta).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('Property 12: 胡牌结算正确性', () => {
  it('winner receives accumulated gang score + winScore * 3, total is zero-sum', () => {
    fc.assert(
      fc.property(
        fc.array(arbGangOp, { minLength: 0, maxLength: 8 }),
        arbPlayerIndex,
        (gangOps, winnerIdx) => {
          const gangRecords: GangRecord[] = gangOps.map((op) =>
            recordGangScore(op.type, op.gangIdx, op.targetIdx),
          );
          const changes = settleWin(gangRecords, winnerIdx, PLAYER_COUNT, defaultConfig);
          const totalDelta = changes.reduce((sum, c) => sum + c.delta, 0);
          expect(totalDelta).toBe(0);
          for (const change of changes) {
            expect(change.playerIndex).toBeGreaterThanOrEqual(0);
            expect(change.playerIndex).toBeLessThan(PLAYER_COUNT);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 13: 流局杠分原子清零', () => {
  it('settleDraw returns empty ScoreChange[] and clears gangRecords', () => {
    fc.assert(
      fc.property(
        fc.array(arbGangOp, { minLength: 1, maxLength: 8 }),
        (gangOps) => {
          const gangRecords: GangRecord[] = gangOps.map((op) =>
            recordGangScore(op.type, op.gangIdx, op.targetIdx),
          );
          const changes = settleDraw(gangRecords);
          expect(changes).toEqual([]);
          expect(gangRecords).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('simulated Redis persistence: after DRAW, gangRecords empty and scores unchanged', () => {
    fc.assert(
      fc.property(
        fc.array(arbGangOp, { minLength: 0, maxLength: 5 }),
        fc.array(fc.integer({ min: -100, max: 100 }), { minLength: 4, maxLength: 4 }),
        (gangOps, playerScores) => {
          const gangRecords: GangRecord[] = gangOps.map((op) =>
            recordGangScore(op.type, op.gangIdx, op.targetIdx),
          );
          const scoresBefore = [...playerScores];
          const changes = settleDraw(gangRecords);
          const scoresAfter = [...scoresBefore];
          for (const change of changes) {
            scoresAfter[change.playerIndex] += change.delta;
          }
          expect(gangRecords).toHaveLength(0);
          expect(scoresAfter).toEqual(scoresBefore);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 20: 规则配置生效', () => {
  it('when allowDianPao=false, dianPao is not allowed', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const provider = createDefaultRuleProvider();
        expect(provider.config.allowDianPao).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('different gangScore values produce correct amounts in settlement', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        arbPlayerIndex,
        (gangScore, winScore, winnerIdx) => {
          const targetIdx = (winnerIdx + 1) % PLAYER_COUNT;
          const config: RuleConfig = { allowDianPao: false, requireQueMen: false, gangScore, winScore };
          const mingRecord = recordGangScore('ming', winnerIdx, targetIdx);
          const mingChanges = settleWin([mingRecord], winnerIdx, PLAYER_COUNT, config);
          expect(mingChanges.reduce((sum, c) => sum + c.delta, 0)).toBe(0);
          const winnerDelta = mingChanges.filter((c) => c.playerIndex === winnerIdx).reduce((sum, c) => sum + c.delta, 0);
          expect(winnerDelta).toBe(gangScore + winScore * 3);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('an gang with custom gangScore: gang player receives gangScore * 3', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        arbPlayerIndex,
        (gangScore, winScore, gangIdx) => {
          const config: RuleConfig = { allowDianPao: false, requireQueMen: false, gangScore, winScore };
          const anRecord = recordGangScore('an', gangIdx);
          const changes = settleWin([anRecord], gangIdx, PLAYER_COUNT, config);
          expect(changes.reduce((sum, c) => sum + c.delta, 0)).toBe(0);
          const gangPlayerDelta = changes.filter((c) => c.playerIndex === gangIdx).reduce((sum, c) => sum + c.delta, 0);
          expect(gangPlayerDelta).toBe(gangScore * 3 + winScore * 3);
        },
      ),
      { numRuns: 100 },
    );
  });
});
