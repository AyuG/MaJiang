import type { Tile } from './tile';
import type { Meld, ScoreChange } from './game';

/** 规则配置 */
export interface RuleConfig {
  allowDianPao: boolean;     // 是否允许点炮胡
  requireQueMen: boolean;    // 是否要求缺门
  gangScore: number;         // 杠分
  winScore: number;          // 胡牌分
}

/** 胡牌校验器 */
export interface WinChecker {
  canWin(hand: Tile[], melds: Meld[]): boolean;
}

/** 分数计算器 */
export interface ScoreCalculator {
  calcGangScore(type: 'ming' | 'an' | 'bu', gangPlayer: string, targetPlayer: string | null): ScoreChange[];
  calcWinScore(winner: string, others: string[]): ScoreChange[];
}

/** 规则提供者 */
export interface RuleProvider {
  config: RuleConfig;
  winChecker: WinChecker;
  scoreCalculator: ScoreCalculator;
}
