'use client';

import { useState } from 'react';
import type { RoomSyncData } from '@/types';

interface LobbyProps {
  isConnected: boolean;
  roomId: string | null;
  roomSync: RoomSyncData | null;
  myId: string;
  roomError?: string | null;
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
  onReady: () => void;
  onUnready: () => void;
  onKick: (targetId: string) => void;
  onDissolve: () => void;
  onStart: () => void;
}

const SEAT_LABELS: Record<string, string> = {
  east: '东', south: '南', west: '西', north: '北',
};

export function Lobby({
  isConnected, roomId, roomSync, myId, roomError,
  onCreateRoom, onJoinRoom, onReady, onUnready, onKick, onDissolve, onStart,
}: LobbyProps) {
  const [inputRoomId, setInputRoomId] = useState('');

  // Room ID: 6 chars, uppercase A-Z (no I/O) + 2-9
  const ROOM_ID_REGEX = /^[A-HJKLMNP-Z2-9]{0,6}$/;
  const isValidRoomId = inputRoomId.length === 6 && ROOM_ID_REGEX.test(inputRoomId);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().replace(/[^A-HJKLMNP-Z2-9]/g, '').slice(0, 6);
    setInputRoomId(val);
  };

  const isOwner = roomSync?.ownerId === myId;
  const myPlayer = roomSync?.players.find((p) => p.id === myId);
  const iAmReady = myPlayer?.isReady ?? false;
  const allReady = (roomSync?.players.length === 4) && roomSync.players.every((p) => p.isReady);

  return (
    <div className="lobby">
      <h2>大厅</h2>
      <div className="connection-status">
        {isConnected ? '🟢 已连接' : '🔴 未连接'}
      </div>

      {!roomId ? (
        <div className="lobby-actions">
          <button className="lobby-btn" onClick={onCreateRoom} disabled={!isConnected}>创建房间</button>
          <div className="join-section">
            <input type="text" placeholder="6位房间号" value={inputRoomId}
              onChange={handleInputChange} className="room-input" maxLength={6} />
            <button className="lobby-btn" onClick={() => onJoinRoom(inputRoomId)}
              disabled={!isConnected || !isValidRoomId}>加入房间</button>
          </div>
          {roomError && <div style={{ color: '#ff6b6b', fontSize: '0.9rem', marginTop: '0.5rem' }}>⚠ {roomError}</div>}
        </div>
      ) : (
        <div className="room-info">
          <div className="room-id-display">房间号: {roomId}</div>
          <div className="player-list">
            <div className="player-list-title">玩家 ({roomSync?.players.length ?? 0}/4)</div>
            {[0, 1, 2, 3].map((i) => {
              const p = roomSync?.players[i];
              const isMe = p?.id === myId;
              const isPlayerOwner = p?.id === roomSync?.ownerId;
              const seatKey = p?.seat ?? ['east','south','west','north'][i];
              return (
                <div key={i} className={`player-slot${isMe ? ' player-slot-self' : ''}`}>
                  {SEAT_LABELS[seatKey]}:{' '}
                  {p ? (
                    <>
                      {isMe ? '你' : p.id.slice(0, 8)}
                      {isPlayerOwner && ' 👑'}
                      {!p.isConnected && ' 🔴断线'}
                      {p.isConnected && p.isReady && ' ✅已准备'}
                      {p.isConnected && !p.isReady && ' ⏳等待中'}
                      {isOwner && !isMe && p.isConnected && (
                        <button className="kick-btn" onClick={() => onKick(p.id)}>踢出</button>
                      )}
                    </>
                  ) : (
                    <span className="empty-slot">空位</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="lobby-btn-group">
            {!iAmReady ? (
              <button className="lobby-btn ready-btn" onClick={onReady}>准备</button>
            ) : (
              <button className="lobby-btn unready-btn" onClick={onUnready}>取消准备</button>
            )}
            {isOwner && allReady && (
              <button className="lobby-btn start-btn" onClick={onStart}>开始游戏</button>
            )}
            {isOwner && (
              <button className="lobby-btn dissolve-owner-btn" onClick={onDissolve}>解散房间</button>
            )}
          </div>

          {(roomSync?.players.length ?? 0) < 4 && (
            <div className="waiting-hint">需要 {4 - (roomSync?.players.length ?? 0)} 名玩家加入</div>
          )}
          {(roomSync?.players.length === 4) && !allReady && (
            <div className="waiting-hint">等待所有玩家准备...</div>
          )}
        </div>
      )}
    </div>
  );
}
