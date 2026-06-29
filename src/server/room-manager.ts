/**
 * RoomManager — in-memory room management for Chinese Mahjong Online.
 *
 * Handles room creation, joining, leaving, readiness, dice-roll dealer
 * selection, dealer inheritance, and vote-dissolve logic.
 */

import type { RoomPermission, RoomRole } from '@/types';

export type SeatPosition = 'east' | 'south' | 'west' | 'north';

export interface RoomPlayer {
  id: string;
  seat: SeatPosition;
  isReady: boolean;
  isConnected: boolean;
  role: RoomRole;
}

export interface RoomState {
  roomId: string;
  players: RoomPlayer[];
  ownerId: string; // first player (east seat) is the room owner
  status: 'waiting' | 'playing' | 'finished';
  dealerIndex: number;
  createdAt: number;
}

export interface DiceResult {
  rolls: number[]; // 4 values, one per player
  dealerIndex: number;
}

export interface VoteState {
  initiator: string;
  votes: Map<string, boolean>;
  startedAt: number;
}

export interface VoteResult {
  dissolved: boolean;
  votes: Record<string, boolean>;
}

const SEAT_ORDER: SeatPosition[] = ['east', 'south', 'west', 'north'];
const VOTE_TIMEOUT_MS = 30_000;
const ROLE_PERMISSIONS: Record<RoomRole, RoomPermission[]> = {
  owner: ['start_game', 'kick_player', 'manage_roles', 'dissolve_room'],
  admin: ['start_game', 'kick_player'],
  member: [],
};

export class RoomManager {
  private rooms = new Map<string, RoomState>();
  private voteStates = new Map<string, VoteState>();

  // Allow injecting a random function for testing dice rolls
  private randomFn: () => number;

  constructor(randomFn?: () => number) {
    this.randomFn = randomFn ?? (() => Math.random());
  }

  // ── Task 10.1: Core room management ──────────────────

  createRoom(playerId: string): string {
    const roomId = generateRoomId(this.rooms);
    const room: RoomState = {
      roomId,
      players: [{ id: playerId, seat: 'east', isReady: false, isConnected: true, role: 'owner' }],
      ownerId: playerId,
      status: 'waiting',
      dealerIndex: 0,
      createdAt: Date.now(),
    };
    this.rooms.set(roomId, room);
    return roomId;
  }

  /** Create a room with pre-assigned players (used by "新房" feature) */
  createRoomWithPlayers(players: Array<{ id: string; seat: SeatPosition }>): string {
    const roomId = generateRoomId(this.rooms);
    const room: RoomState = {
      roomId,
      players: players.map((p, index) => ({
        id: p.id,
        seat: p.seat,
        isReady: false,
        isConnected: true,
        role: index === 0 ? 'owner' : 'member',
      })),
      ownerId: players[0]?.id ?? '',
      status: 'waiting',
      dealerIndex: 0,
      createdAt: Date.now(),
    };
    this.rooms.set(roomId, room);
    return roomId;
  }

  joinRoom(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    if (room.players.length >= 4) throw new Error('Room is full');
    if (room.players.some((p) => p.id === playerId)) {
      throw new Error('Player already in room');
    }
    const seat = SEAT_ORDER[room.players.length];
    room.players.push({ id: playerId, seat, isReady: false, isConnected: true, role: 'member' });
  }

  leaveRoom(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.players = room.players.filter((p) => p.id !== playerId);
    if (room.players.length === 0) {
      this.rooms.delete(roomId);
    } else if (room.ownerId === playerId) {
      this.transferOwnership(room);
    }
  }

  setReady(roomId: string, playerId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new Error('Player not in room');
    player.isReady = true;
    return room.players.length === 4 && room.players.every((p) => p.isReady);
  }

  getRoom(roomId: string): RoomState | null {
    return this.rooms.get(roomId) ?? null;
  }

  /** Toggle ready off — player can switch between ready/unready */
  setUnready(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new Error('Player not in room');
    player.isReady = false;
  }

  /** Kick a player from the room. Owner can kick anyone except self; admins can kick members. */
  kickPlayer(roomId: string, requesterId: string, targetId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    if (!this.canKick(room, requesterId, targetId)) throw new Error('No permission to kick this player');
    room.players = room.players.filter((p) => p.id !== targetId);
  }

  /** Owner dissolves the room entirely */
  dissolveRoom(roomId: string, ownerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    if (room.ownerId !== ownerId) throw new Error('Only the room owner can dissolve the room');
    this.rooms.delete(roomId);
    this.voteStates.delete(roomId);
  }

  setPlayerRole(roomId: string, requesterId: string, targetId: string, role: Exclude<RoomRole, 'owner'>): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    if (!this.hasPermission(roomId, requesterId, 'manage_roles')) {
      throw new Error('Only the room owner can manage roles');
    }
    if (targetId === room.ownerId) throw new Error('Cannot change owner role');
    const target = room.players.find((p) => p.id === targetId);
    if (!target) throw new Error('Player not in room');
    target.role = role;
  }

  canStartGame(roomId: string, playerId: string): boolean {
    return this.hasPermission(roomId, playerId, 'start_game');
  }

  hasPermission(roomId: string, playerId: string, permission: RoomPermission): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return false;
    return ROLE_PERMISSIONS[player.role].includes(permission);
  }

  getPermissions(role: RoomRole): RoomPermission[] {
    return [...ROLE_PERMISSIONS[role]];
  }

  /** Mark a player as disconnected in the lobby (before game starts) */
  setPlayerDisconnected(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.find((p) => p.id === playerId);
    if (player) {
      player.isConnected = false;
      player.isReady = false;
    }
  }

  /** Mark a player as reconnected */
  setPlayerConnected(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.find((p) => p.id === playerId);
    if (player) {
      player.isConnected = true;
    }
  }

  /** Get all rooms for lobby list */
  getAllRooms(): RoomState[] {
    return Array.from(this.rooms.values());
  }

  /** Remove disconnected player from room after timeout */
  removeDisconnectedPlayer(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.players = room.players.filter((p) => p.id !== playerId);
    if (room.players.length === 0) {
      this.rooms.delete(roomId);
    } else if (room.ownerId === playerId) {
      // Transfer ownership to next player
      this.transferOwnership(room);
    }
  }

  replacePlayer(roomId: string, oldPlayerId: string, newPlayerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    if (room.players.some((p) => p.id === newPlayerId)) {
      throw new Error('Player already in room');
    }
    const player = room.players.find((p) => p.id === oldPlayerId);
    if (!player) throw new Error('Player not in room');
    player.id = newPlayerId;
    player.isConnected = true;
    if (room.ownerId === oldPlayerId) {
      room.ownerId = newPlayerId;
      player.role = 'owner';
    }
  }

  // ── Task 10.4: Dice roll and dealer inheritance ──────

  /**
   * Roll dice for all 4 players. Highest unique roll becomes dealer.
   * If there's a tie for highest, those players re-roll until a unique winner.
   * Maximum 9 rounds of re-rolls to prevent infinite loops.
   */
  rollDice(roomId: string): DiceResult {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    if (room.players.length !== 4) throw new Error('Need exactly 4 players');

    const MAX_ROUNDS = 9;

    // Initial roll for all 4 players
    let candidateIndices = [0, 1, 2, 3];
    const finalRolls = [0, 0, 0, 0];
    let round = 0;

    while (candidateIndices.length > 1 && round < MAX_ROUNDS) {
      const rolls: { index: number; value: number }[] = candidateIndices.map((i) => ({
        index: i,
        value: Math.floor(this.randomFn() * 6) + 1,
      }));

      // Record rolls
      for (const r of rolls) {
        finalRolls[r.index] = r.value;
      }

      const maxVal = Math.max(...rolls.map((r) => r.value));
      const maxRollers = rolls.filter((r) => r.value === maxVal);

      if (maxRollers.length === 1) {
        // Unique winner
        const dealerIndex = maxRollers[0].index;
        room.dealerIndex = dealerIndex;
        return { rolls: finalRolls, dealerIndex };
      }

      // Tie — re-roll among tied players only
      candidateIndices = maxRollers.map((r) => r.index);
      round++;
    }

    // Fallback: if we hit max rounds or only one candidate, pick the first candidate
    const dealerIndex = candidateIndices[0];
    room.dealerIndex = dealerIndex;
    return { rolls: finalRolls, dealerIndex };
  }

  /**
   * Set the next dealer after a game ends.
   * winnerIndex: index of the winner (becomes dealer), or null for draw (dealer stays).
   */
  setNextDealer(roomId: string, winnerIndex: number | null): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    if (winnerIndex !== null) {
      room.dealerIndex = winnerIndex;
    }
    // null → draw, dealer stays the same
  }

  // ── Task 10.6: Vote dissolve ─────────────────────────

  initiateVoteDissolve(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    if (!room.players.some((p) => p.id === playerId)) {
      throw new Error('Player not in room');
    }

    const votes = new Map<string, boolean>();
    // Initiator automatically agrees
    votes.set(playerId, true);
    // Disconnected players default to agree
    for (const p of room.players) {
      if (!p.isConnected) {
        votes.set(p.id, true);
      }
    }

    this.voteStates.set(roomId, {
      initiator: playerId,
      votes,
      startedAt: Date.now(),
    });
  }

  voteDissolve(roomId: string, playerId: string, agree: boolean): VoteResult {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);

    const voteState = this.voteStates.get(roomId);
    if (!voteState) throw new Error('No active vote');

    voteState.votes.set(playerId, agree);

    // Check timeout: unvoted players count as disagree
    const now = Date.now();
    const timedOut = now - voteState.startedAt >= VOTE_TIMEOUT_MS;

    // Build final votes map
    // Disconnected players who haven't explicitly voted default to agree
    const allVotes: Record<string, boolean> = {};
    for (const p of room.players) {
      if (voteState.votes.has(p.id)) {
        allVotes[p.id] = voteState.votes.get(p.id)!;
      } else if (!p.isConnected) {
        allVotes[p.id] = true; // disconnected → agree
      } else if (timedOut) {
        allVotes[p.id] = false; // timeout → disagree
      }
    }

    const agreeCount = Object.values(allVotes).filter((v) => v).length;
    const totalVoted = Object.keys(allVotes).length;

    // Dissolve requires: all players except initiator agree
    // (initiator already agreed, disconnected default agree)
    const allDecided = totalVoted === room.players.length;
    const anyDisagree = Object.values(allVotes).some((v) => !v);

    if (allDecided && !anyDisagree) {
      // Everyone agreed (or defaulted to agree)
      this.voteStates.delete(roomId);
      this.rooms.delete(roomId);
      return { dissolved: true, votes: allVotes };
    }

    if (allDecided || anyDisagree) {
      // Someone disagreed or all voted — resolve
      this.voteStates.delete(roomId);
      return { dissolved: !anyDisagree, votes: allVotes };
    }

    // Still pending
    return { dissolved: false, votes: allVotes };
  }

  /**
   * Check if a vote is already fully resolved (all players have voted or defaulted).
   * Returns VoteResult if resolved, null if still pending.
   */
  checkVoteResolved(roomId: string): VoteResult | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const voteState = this.voteStates.get(roomId);
    if (!voteState) return null;

    // Build votes including disconnected defaults
    const allVotes: Record<string, boolean> = {};
    for (const p of room.players) {
      if (voteState.votes.has(p.id)) {
        allVotes[p.id] = voteState.votes.get(p.id)!;
      } else if (!p.isConnected) {
        allVotes[p.id] = true; // disconnected → agree
      } else {
        // Online player hasn't voted yet → still pending
        return null;
      }
    }

    const anyDisagree = Object.values(allVotes).some((v) => !v);
    this.voteStates.delete(roomId);

    if (!anyDisagree) {
      this.rooms.delete(roomId);
    }

    return { dissolved: !anyDisagree, votes: allVotes };
  }

  /**
   * Resolve a vote after timeout.
   * Disconnected players default to agree, unvoted online players default to disagree.
   */
  resolveVoteTimeout(roomId: string): VoteResult {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);

    const voteState = this.voteStates.get(roomId);
    if (!voteState) throw new Error('No active vote');

    const allVotes: Record<string, boolean> = {};
    for (const p of room.players) {
      if (voteState.votes.has(p.id)) {
        allVotes[p.id] = voteState.votes.get(p.id)!;
      } else if (!p.isConnected) {
        allVotes[p.id] = true; // disconnected → agree
      } else {
        allVotes[p.id] = false; // timeout → disagree
      }
    }

    const anyDisagree = Object.values(allVotes).some((v) => !v);
    this.voteStates.delete(roomId);

    if (!anyDisagree) {
      this.rooms.delete(roomId);
    }

    return {
      dissolved: !anyDisagree,
      votes: allVotes,
    };
  }

  // ── Recovery: restore room from persisted state ──────

  /**
   * Restore a room from persisted GameState on server restart.
   * Rebuilds the in-memory RoomState without going through the
   * normal create/join flow.
   */
  restoreRoom(
    roomId: string,
    data: {
      players: Array<{ id: string; isConnected: boolean; isReady: boolean }>;
      dealerIndex: number;
      status: 'waiting' | 'playing' | 'finished';
    },
  ): void {
    if (this.rooms.has(roomId)) return;

    const room: RoomState = {
      roomId,
      players: data.players.map((p, i) => ({
        id: p.id,
        seat: SEAT_ORDER[i],
        isReady: p.isReady,
        isConnected: p.isConnected,
        role: i === 0 ? 'owner' : 'member',
      })),
      ownerId: data.players[0]?.id ?? '',
      status: data.status,
      dealerIndex: data.dealerIndex,
      createdAt: Date.now(),
    };
    this.rooms.set(roomId, room);
  }

  private canKick(room: RoomState, requesterId: string, targetId: string): boolean {
    if (requesterId === targetId) return false;
    const requester = room.players.find((p) => p.id === requesterId);
    const target = room.players.find((p) => p.id === targetId);
    if (!requester || !target) return false;
    if (!ROLE_PERMISSIONS[requester.role].includes('kick_player')) return false;
    if (requester.role === 'owner') return target.role !== 'owner';
    return requester.role === 'admin' && target.role === 'member';
  }

  private transferOwnership(room: RoomState): void {
    const nextOwner = room.players[0];
    if (!nextOwner) return;
    room.ownerId = nextOwner.id;
    room.players = room.players.map((p) => ({
      ...p,
      role: p.id === nextOwner.id ? 'owner' : p.role === 'owner' ? 'member' : p.role,
    }));
  }
}

/** Generate a unique 4-char room ID with collision check */
function generateRoomId(existingRooms: Map<string, any>): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt++) {
    let id = '';
    for (let i = 0; i < 4; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!existingRooms.has(id)) return id;
  }
  // Fallback: 5 chars if 4-char space exhausted
  let id = '';
  for (let i = 0; i < 5; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
