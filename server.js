
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors()); // Allow frontend to connect

const server = http.createServer(app);

// Create the socket server
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173", // Frontend URL
    methods: ["GET", "POST"]
  }
});

let players = {};
let currentTurn = 'X';
let board = Array(9).fill(null);

// Handle socket connections
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Assign player
  if (!players.X) {
    players.X = socket.id;
    socket.emit('player-assigned', 'X');
  } else if (!players.O) {
    players.O = socket.id;
    socket.emit('player-assigned', 'O');
  } else {
    socket.emit('room-full');
  }

  // Send current game state
  socket.emit('game-state', { board, currentTurn });

  // Handle moves
  socket.on('make-move', (index) => {
    if (board[index] || socket.id !== players[currentTurn]) return;

    board[index] = currentTurn;
    currentTurn = currentTurn === 'X' ? 'O' : 'X';

    io.emit('game-state', { board, currentTurn });
  });

  // Reset game
  socket.on('reset-game', () => {
    board = Array(9).fill(null);
    currentTurn = 'X';
    io.emit('game-state', { board, currentTurn });
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    if (players.X === socket.id) delete players.X;
    if (players.O === socket.id) delete players.O;

    board = Array(9).fill(null);
    currentTurn = 'X';
    io.emit('game-state', { board, currentTurn });
  });
});

// Start server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});