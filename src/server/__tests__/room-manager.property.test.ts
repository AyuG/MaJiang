import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { RoomManager } from '@/server/room-manager';
import type { SeatPosition } from '@/server/room-manager';

/**
 * Feature: chinese-mahjong-online, Property 14: 座位分配正确性
 *
 * Players join in order → seats assigned east, south, west, north.
 * Seat assignment depends only on join order, not player ID.
 *
 * **Validates: Requirements 10.4**
 */
describe('Property 14: 座位分配正确性', () => {
  const expectedSeats: SeatPosition[] = ['east', 'south', 'west', 'north'];

  it('should assign seats in order east→south→west→north regardless of player ID', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 4, maxLength: 4 }),
        (playerIds) => {
          const mgr = new RoomManager();
          const roomId = mgr.createRoom(playerIds[0]);
          for (let i = 1; i < 4; i++) {
            mgr.joinRoom(roomId, playerIds[i]);
          }

          const room = mgr.getRoom(roomId)!;
          expect(room.players).toHaveLength(4);

          for (let i = 0; i < 4; i++) {
            expect(room.players[i].id).toBe(playerIds[i]);
            expect(room.players[i].seat).toBe(expectedSeats[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should assign seats based on join order, not alphabetical or any other ID ordering', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 4, maxLength: 4 }),
        (playerIds) => {
          const mgr = new RoomManager();
          const roomId = mgr.createRoom(playerIds[0]);
          for (let i = 1; i < 4; i++) {
            mgr.joinRoom(roomId, playerIds[i]);
          }

          const room = mgr.getRoom(roomId)!;
          // First player always gets east, second south, etc.
          for (let i = 0; i < 4; i++) {
            expect(room.players[i].seat).toBe(expectedSeats[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: chinese-mahjong-online, Property 15: 掷骰子定庄
 *
 * Unique max → that player is dealer.
 * Tied max → re-roll among tied players until unique winner.
 *
 * **Validates: Requirements 10.6, 10.7**
 */
describe('Property 15: 掷骰子定庄', () => {
  it('should select the player with the unique highest roll as dealer', () => {
    fc.assert(
      fc.property(
        // Generate 4 dice rolls where there IS a unique max
        fc.tuple(
          fc.integer({ min: 1, max: 6 }),
          fc.integer({ min: 1, max: 6 }),
          fc.integer({ min: 1, max: 6 }),
          fc.integer({ min: 1, max: 6 }),
        ).filter((rolls) => {
          const max = Math.max(...rolls);
          return rolls.filter((r) => r === max).length === 1;
        }),
        (rolls) => {
          let callIndex = 0;
          const mgr = new RoomManager(() => {
            // Map dice value 1-6 to random range [0, 1)
            const val = rolls[callIndex % 4];
            callIndex++;
            return (val - 1) / 6; // e.g. val=1 → 0.0, val=6 → 5/6
          });

          const roomId = mgr.createRoom('p0');
          mgr.joinRoom(roomId, 'p1');
          mgr.joinRoom(roomId, 'p2');
          mgr.joinRoom(roomId, 'p3');

          const result = mgr.rollDice(roomId);

          const maxVal = Math.max(...rolls);
          const expectedDealer = rolls.indexOf(maxVal);

          expect(result.dealerIndex).toBe(expectedDealer);
          expect(result.rolls[expectedDealer]).toBe(maxVal);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should re-roll among tied players until a unique winner emerges', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }), // which player ultimately wins
        (winnerIndex) => {
          // Simulate: first round all roll 6 (4-way tie), second round winner rolls 6, others roll 1
          let round = 0;
          let callInRound = 0;
          const mgr = new RoomManager(() => {
            if (round === 0) {
              // All roll 6 → tie
              callInRound++;
              if (callInRound === 4) {
                round = 1;
                callInRound = 0;
              }
              return 5 / 6; // → dice value 6
            }
            // Round 1: winner gets 6, others get 1
            const currentIdx = callInRound;
            callInRound++;
            if (currentIdx === winnerIndex) {
              return 5 / 6; // → 6
            }
            return 0; // → 1
          });

          const roomId = mgr.createRoom('p0');
          mgr.joinRoom(roomId, 'p1');
          mgr.joinRoom(roomId, 'p2');
          mgr.joinRoom(roomId, 'p3');

          const result = mgr.rollDice(roomId);
          expect(result.dealerIndex).toBe(winnerIndex);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: chinese-mahjong-online, Property 16: 投票解散逻辑
 *
 * 3+ agree → dissolved.
 * <3 agree → not dissolved.
 *
 * **Validates: Requirements 12.2, 12.3**
 */
describe('Property 16: 投票解散逻辑', () => {
  it('should dissolve when 3 or more players agree, not dissolve otherwise', () => {
    fc.assert(
      fc.property(
        // Generate 3 boolean votes for non-initiator players
        fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()),
        (otherVotes) => {
          const mgr = new RoomManager();
          const roomId = mgr.createRoom('p0');
          mgr.joinRoom(roomId, 'p1');
          mgr.joinRoom(roomId, 'p2');
          mgr.joinRoom(roomId, 'p3');

          // p0 initiates (auto-agrees)
          mgr.initiateVoteDissolve(roomId, 'p0');

          // Count expected agrees: p0 always true + others
          const agreeCount = 1 + otherVotes.filter((v) => v).length;

          // Vote one by one, collecting the last result
          let lastResult = mgr.voteDissolve(roomId, 'p1', otherVotes[0]);

          // Early termination may have already resolved the vote
          if (!lastResult.dissolved) {
            // Check if vote is still active before continuing
            try {
              lastResult = mgr.voteDissolve(roomId, 'p2', otherVotes[1]);
            } catch {
              // Vote already resolved (impossible to reach 3)
              expect(agreeCount).toBeLessThan(3);
              return;
            }
          }

          if (!lastResult.dissolved) {
            try {
              lastResult = mgr.voteDissolve(roomId, 'p3', otherVotes[2]);
            } catch {
              expect(agreeCount).toBeLessThan(3);
              return;
            }
          }

          if (agreeCount >= 3) {
            expect(lastResult.dissolved).toBe(true);
          } else {
            expect(lastResult.dissolved).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should count unvoted players as disagree after timeout', () => {
    fc.assert(
      fc.property(
        // 0 or 1 non-initiator voters (to avoid early resolution cleaning up state)
        fc.integer({ min: 0, max: 1 }),
        fc.boolean(),
        (voterCount, voteValue) => {
          const mgr = new RoomManager();
          const roomId = mgr.createRoom('p0');
          mgr.joinRoom(roomId, 'p1');
          mgr.joinRoom(roomId, 'p2');
          mgr.joinRoom(roomId, 'p3');

          mgr.initiateVoteDissolve(roomId, 'p0');

          // Only some players vote (at most 1 to avoid early resolution)
          const voters = ['p1'].slice(0, voterCount);
          for (const voter of voters) {
            mgr.voteDissolve(roomId, voter, voteValue);
          }

          // Resolve after timeout — unvoted = disagree
          const result = mgr.resolveVoteTimeout(roomId);

          // Agrees: p0 (initiator) + voted-true players
          const agreeCount = 1 + (voterCount > 0 && voteValue ? 1 : 0);

          // With at most 2 agrees (initiator + 1 voter), never reaches 3
          expect(agreeCount).toBeLessThan(3);
          expect(result.dissolved).toBe(false);

          // Verify unvoted players are marked as disagree
          for (const p of ['p1', 'p2', 'p3']) {
            if (!voters.includes(p)) {
              expect(result.votes[p]).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: chinese-mahjong-online, Property 22: 房间满员拒绝
 *
 * 5th player joining a full room throws error.
 *
 * **Validates: Requirements 10.3**
 */
describe('Property 22: 房间满员拒绝', () => {
  it('should reject the 5th player from joining a full room', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 5, maxLength: 5 }),
        (playerIds) => {
          const mgr = new RoomManager();
          const roomId = mgr.createRoom(playerIds[0]);
          mgr.joinRoom(roomId, playerIds[1]);
          mgr.joinRoom(roomId, playerIds[2]);
          mgr.joinRoom(roomId, playerIds[3]);

          // Room should have 4 players
          const roomBefore = mgr.getRoom(roomId)!;
          expect(roomBefore.players).toHaveLength(4);

          // 5th player should be rejected
          expect(() => mgr.joinRoom(roomId, playerIds[4])).toThrow('Room is full');

          // Room still has exactly 4 players
          const roomAfter = mgr.getRoom(roomId)!;
          expect(roomAfter.players).toHaveLength(4);

          // The 5th player is not in the room
          expect(roomAfter.players.some((p) => p.id === playerIds[4])).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
