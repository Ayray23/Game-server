// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const rooms = {}; // Stores roomId => { players: [socket.id, ...] }

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('createRoom', (roomId) => {
    if (rooms[roomId]) {
      socket.emit('errorMessage', 'Room already exists');
      return;
    }
    rooms[roomId] = { players: [socket.id] };
    socket.join(roomId);
    socket.emit('roomCreated', roomId);
    console.log(`Room created: ${roomId}`);
  });

  socket.on('joinRoom', (roomId) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('errorMessage', 'Room not found');
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('errorMessage', 'Room is full');
      return;
    }
    room.players.push(socket.id);
    socket.join(roomId);
    socket.emit('roomJoined', roomId);
    io.to(roomId).emit('startGame', room.players);
    console.log(`Player joined room: ${roomId}`);
  });

  socket.on('makeMove', ({ roomId, index, player }) => {
    socket.to(roomId).emit('opponentMove', { index, player });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.players.includes(socket.id)) {
        room.players = room.players.filter(id => id !== socket.id);
        io.to(roomId).emit('playerLeft');
        if (room.players.length === 0) delete rooms[roomId];
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));