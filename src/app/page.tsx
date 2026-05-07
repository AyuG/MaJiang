'use client';

import { useEffect, useState, useCallback } from 'react';
import { useMahjongSocket } from '@/hooks/useMahjongSocket';
import { GameBoard } from '@/components/GameBoard';
import { ActionBar } from '@/components/ActionBar';
import { Lobby } from '@/components/Lobby';
import { PauseOverlay } from '@/components/PauseOverlay';
import { ScorePanel } from '@/components/ScorePanel';
import type { RoomSyncData } from '@/types';

export default function Home() {
  const {
    socket,
    isConnected,
    playerId,
    nickname,
    gameState,
    roomId,
    availableActions,
    gangOptions,
    remainingSeconds,
    diceResult,
    scoreLog,
    createRoom,
    joinRoom,
    setReady,
    setUnready,
    kickPlayer,
    dissolveRoom,
    startGame,
    discard,
    peng,
    gang,
    hu,
    pass,
    voteDissolve,
    leaveRoom,
    changeNickname,
  } = useMahjongSocket();

  const handleLeaveRoom = useCallback(() => {
    setLocalRoomId(null);
    setRoomSync(null);
    leaveRoom();
  }, [leaveRoom]);

  const [localRoomId, setLocalRoomId] = useState<string | null>(null);
  const [roomSync, setRoomSync] = useState<RoomSyncData | null>(null);
  const [voteInitiator, setVoteInitiator] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);

  // Auto-join from invite link (?room=XXXXXX)
  useEffect(() => {
    if (!isConnected || localRoomId || roomId) return;
    const params = new URLSearchParams(window.location.search);
    const inviteRoom = params.get('room');
    if (inviteRoom && inviteRoom.length >= 4) {
      joinRoom(inviteRoom);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [isConnected, localRoomId, roomId, joinRoom]);

  useEffect(() => {
    if (!socket) return;

    const onCreated = (id: string) => setLocalRoomId(id);
    const onSync = (data: RoomSyncData) => {
      setRoomSync(data);
      setLocalRoomId(data.roomId); // confirm we're in this room
    };
    const onKicked = (targetId: string) => {
      if (targetId === socket.id) {
        setLocalRoomId(null);
        setRoomSync(null);
      }
    };
    const onDissolved = () => {
      setLocalRoomId(null);
      setRoomSync(null);
      setVoteInitiator(null);
    };
    const onVoteRequest = (initiator: string) => {
      setVoteInitiator(initiator);
    };
    const onRoomError = (msg: string) => {
      setRoomError(msg);
      setTimeout(() => setRoomError(null), 3000);
    };
    const onVoteRejected = () => {
      setVoteInitiator(null);
    };

    socket.on('room:created', onCreated);
    socket.on('room:sync', onSync);
    socket.on('room:kicked', onKicked);
    socket.on('room:dissolved', onDissolved);
    socket.on('room:vote-dissolve-request', onVoteRequest);
    socket.on('room:error', onRoomError);
    socket.on('room:vote-dissolve-rejected', onVoteRejected);

    return () => {
      socket.off('room:created', onCreated);
      socket.off('room:sync', onSync);
      socket.off('room:kicked', onKicked);
      socket.off('room:dissolved', onDissolved);
      socket.off('room:vote-dissolve-request', onVoteRequest);
      socket.off('room:error', onRoomError);
      socket.off('room:vote-dissolve-rejected', onVoteRejected);
    };
  }, [socket]);

  const handleJoinRoom = useCallback(
    (id: string) => {
      setRoomError(null);
      // Don't set localRoomId yet — wait for room:sync to confirm
      joinRoom(id);
    },
    [joinRoom],
  );

  const effectiveRoomId = roomId || localRoomId;
  const inGame = gameState && (gameState.phase === 'TURN' || gameState.phase === 'AWAITING');
  const gameOver = gameState && (gameState.phase === 'WIN' || gameState.phase === 'DRAW');
  const myPlayerId = playerId;

  if (gameOver && gameState) {
    // Derive score info from gameState players
    const players = gameState.players;
    const winner = gameState.phase === 'WIN'
      ? players.reduce((best, p) => (p.score > best.score ? p : best), players[0])
      : null;
    
    // Get nickname from roomSync for display
    const getPlayerDisplayName = (playerId: string) => {
      if (playerId === myPlayerId) return '你';
      const player = roomSync?.players.find(p => p.id === playerId);
      return player?.nickname || playerId.slice(0, 8);
    };

    return (
      <main>
        <div className="lobby">
          {gameState.phase === 'WIN' && (
            <>
              <h2>🎉 游戏结束</h2>
              {winner && <div style={{ fontSize: '1.2rem', color: '#ffd700', marginBottom: '0.5rem' }}>
                胜者: {getPlayerDisplayName(winner.id)}
              </div>}
              <div style={{ background: '#16213e', padding: '1rem', border: '1px solid #333', minWidth: '200px' }}>
                {players.map((p) => (
                  <div key={p.id} style={{ padding: '0.25rem 0', color: p.score > 0 ? '#4caf50' : p.score < 0 ? '#ff6b6b' : '#e0e0e0' }}>
                    {getPlayerDisplayName(p.id)}: {p.score > 0 ? '+' : ''}{p.score}
                  </div>
                ))}
              </div>
            </>
          )}
          {gameState.phase === 'DRAW' && (
            <>
              <h2>流局</h2>
              <div>本局不计分</div>
            </>
          )}
        </div>
      </main>
    );
  }

  if (inGame && gameState) {
    return (
      <main>
        <GameBoard
          gameState={gameState}
          myPlayerId={myPlayerId}
          roomId={effectiveRoomId ?? undefined}
          onTileClick={discard}
          onVoteDissolve={voteDissolve}
        >
          <ActionBar
            availableActions={availableActions}
            gangOptions={gangOptions}
            remainingSeconds={remainingSeconds}
            onPeng={peng}
            onGang={gang}
            onHu={hu}
            onPass={pass}
          />
        </GameBoard>
        {voteInitiator && voteInitiator !== myPlayerId && (
          <div className="vote-dialog">
            <div className="vote-content">
              <p>{roomSync?.players.find(p => p.id === voteInitiator)?.nickname || voteInitiator.slice(0, 8)} 发起投票解散</p>
              <div className="vote-buttons">
                <button className="lobby-btn" onClick={() => { socket?.emit('room:vote-dissolve-reply', true); setVoteInitiator(null); }}>同意</button>
                <button className="lobby-btn" onClick={() => { socket?.emit('room:vote-dissolve-reply', false); setVoteInitiator(null); }}>拒绝</button>
              </div>
            </div>
          </div>
        )}
        {voteInitiator && voteInitiator === myPlayerId && (
          <div className="vote-dialog">
            <div className="vote-content">
              <p>已发起投票解散，等待其他玩家响应...</p>
            </div>
          </div>
        )}
        {gameState.isPaused && <PauseOverlay gameState={gameState} />}
        <ScorePanel
          myPlayerId={myPlayerId}
          scoreLog={scoreLog}
        />
      </main>
    );
  }

  return (
    <main>
      <Lobby
        isConnected={isConnected}
        roomId={effectiveRoomId}
        roomSync={roomSync}
        myId={myPlayerId}
        myNickname={nickname}
        roomError={roomError}
        onCreateRoom={createRoom}
        onJoinRoom={handleJoinRoom}
        onReady={setReady}
        onUnready={setUnready}
        onKick={kickPlayer}
        onDissolve={dissolveRoom}
        onStart={startGame}
        onLeaveRoom={handleLeaveRoom}
        onChangeNickname={changeNickname}
      />
      {diceResult && !gameState && (
        <div className="dice-overlay">
          <div className="dice-content">
            <h2>🎲 掷骰子定庄</h2>
            <div className="dice-rolls">
              {['东', '南', '西', '北'].map((seat, i) => (
                <div key={i} className={`dice-player${i === diceResult.dealerIndex ? ' dice-winner' : ''}`}>
                  {seat}: {diceResult.rolls[i] || '-'} 点
                  {i === diceResult.dealerIndex && ' 👑庄家'}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {scoreLog.length > 0 && !gameState && (
        <ScorePanel
          myPlayerId={myPlayerId}
          scoreLog={scoreLog}
        />
      )}
    </main>
  );
}
