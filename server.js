const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:5174",
  "https://game-app-eight-lilac.vercel.app"
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

let players = {};
let currentTurn = 'X';
let board = Array(9).fill(null);

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  if (!players.X) {
    players.X = socket.id;
    socket.emit('player-assigned', 'X');
  } else if (!players.O) {
    players.O = socket.id;
    socket.emit('player-assigned', 'O');
  } else {
    socket.emit('room-full');
    return;
  }

  socket.emit('game-state', { board, currentTurn });

  socket.on('make-move', (index) => {
    if (board[index] || socket.id !== players[currentTurn]) return;

    board[index] = currentTurn;
    currentTurn = currentTurn === 'X' ? 'O' : 'X';

    io.emit('game-state', { board, currentTurn });
  });

  socket.on('reset-game', () => {
    board = Array(9).fill(null);
    currentTurn = 'X';
    io.emit('game-state', { board, currentTurn });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    if (players.X === socket.id) delete players.X;
    if (players.O === socket.id) delete players.O;

    board = Array(9).fill(null);
    currentTurn = 'X';
    io.emit('game-state', { board, currentTurn });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});