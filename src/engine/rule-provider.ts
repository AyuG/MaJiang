import type { RuleConfig, RuleProvider } from '@/types';
import { canWin } from '@/engine/win-checker';
import { settleWin } from '@/engine/score-calculator';

/**
 * Create the default RuleProvider with standard configuration:
 * - allowDianPao: false (only zi mo)
 * - requireQueMen: false
 * - gangScore: 5
 * - winScore: 5
 */
export function createDefaultRuleProvider(): RuleProvider {
  const config: RuleConfig = {
    allowDianPao: false,
    requireQueMen: false,
    gangScore: 5,
    winScore: 5,
  };

  return {
    config,
    winChecker: { canWin },
    scoreCalculator: {
      calcGangScore: () => {
        // Gang scores are accumulated as GangRecord during the game
        // and settled together with win score via settleWin.
        return [];
      },
      calcWinScore: (winner, others) => {
        // Delegate to settleWin with empty gangRecords for pure win score.
        const winnerIndex = 0;
        return settleWin([], winnerIndex, others.length + 1, config);
      },
    },
  };
}
