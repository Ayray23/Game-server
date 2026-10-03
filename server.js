const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.get('/health', (_req, res) => res.json({ ok: true, service: 'game-server' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || '*', methods: ['GET', 'POST'] },
});

const rooms = new Map();
const MAX_PLAYERS = 2;
const emptyBoard = () => Array(9).fill(null);

function makeRoom(id) {
  return {
    id,
    players: [],
    board: emptyBoard(),
    currentTurn: 'X',
    status: 'waiting',
    winner: null,
    draw: false,
    messages: [],
  };
}

function publicState(room) {
  return {
    roomId: room.id,
    players: room.players.map((p) => ({ id: p.id, name: p.name, symbol: p.symbol })),
    board: room.board,
    currentTurn: room.currentTurn,
    status: room.status,
    winner: room.winner,
    draw: room.draw,
  };
}

function winnerFor(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

function broadcastState(room) {
  io.to(room.id).emit('game-state', publicState(room));
}

function findRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.id === socketId)) return room;
  }
  return null;
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ roomId, name }) => {
    const id = String(roomId || '').trim().toUpperCase();
    const playerName = String(name || 'Player 1').trim().slice(0, 20) || 'Player 1';

    if (!/^[A-Z0-9]{4,8}$/.test(id)) {
      return socket.emit('errorMessage', 'Room code must be 4-8 letters/numbers.');
    }
    if (rooms.has(id)) return socket.emit('errorMessage', 'That room already exists.');

    const room = makeRoom(id);
    room.players.push({ id: socket.id, name: playerName, symbol: 'X' });
    rooms.set(id, room);
    socket.join(id);
    socket.emit('roomCreated', { roomId: id, symbol: 'X' });
    broadcastState(room);
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    const id = String(roomId || '').trim().toUpperCase();
    const room = rooms.get(id);
    const playerName = String(name || 'Player 2').trim().slice(0, 20) || 'Player 2';

    if (!room) return socket.emit('errorMessage', 'Room not found. Check the code.');
    if (room.players.length >= MAX_PLAYERS) return socket.emit('errorMessage', 'Room is full.');
    if (room.status === 'finished') return socket.emit('errorMessage', 'That game has finished.');

    room.players.push({ id: socket.id, name: playerName, symbol: 'O' });
    room.status = 'playing';
    socket.join(id);
    socket.emit('roomJoined', { roomId: id, symbol: 'O' });
    broadcastState(room);
  });

  socket.on('make-move', ({ roomId, index }) => {
    const room = rooms.get(String(roomId || '').toUpperCase());
    if (!room || room.status !== 'playing') return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.symbol !== room.currentTurn) return;
    if (!Number.isInteger(index) || index < 0 || index > 8 || room.board[index]) return;

    room.board[index] = player.symbol;
    const winner = winnerFor(room.board);

    if (winner) {
      room.winner = winner;
      room.status = 'finished';
    } else if (room.board.every(Boolean)) {
      room.draw = true;
      room.status = 'finished';
    } else {
      room.currentTurn = room.currentTurn === 'X' ? 'O' : 'X';
    }

    broadcastState(room);
  });

  socket.on('rematch', ({ roomId }) => {
    const room = rooms.get(String(roomId || '').toUpperCase());
    if (!room || room.players.length < 2) return;
    room.board = emptyBoard();
    room.currentTurn = 'X';
    room.status = 'playing';
    room.winner = null;
    room.draw = false;
    broadcastState(room);
  });

  socket.on('chat-message', ({ roomId, text: messageText }) => {
    const room = rooms.get(String(roomId || '').toUpperCase());
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    const message = String(messageText || '').trim().slice(0, 300);
    if (!player || !message) return;

    const payload = {
      id: Date.now() + Math.random(),
      name: player.name,
      symbol: player.symbol,
      text: message,
      at: new Date().toISOString(),
    };
    room.messages.push(payload);
    if (room.messages.length > 50) room.messages.shift();
    io.to(room.id).emit('chat-message', payload);
  });

  socket.on('disconnect', () => {
    const room = findRoomBySocket(socket.id);
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== socket.id);
    if (room.players.length === 0) {
      rooms.delete(room.id);
    } else {
      room.status = 'waiting';
      room.board = emptyBoard();
      room.currentTurn = 'X';
      room.winner = null;
      room.draw = false;
      io.to(room.id).emit('playerLeft');
      broadcastState(room);
    }
  });
});

const PORT = Number(process.env.PORT) || 5000;
server.listen(PORT, () => console.log(`Game server listening on port ${PORT}`));
