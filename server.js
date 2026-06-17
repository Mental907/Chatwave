const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Serve static files (aapki HTML file)
app.use(express.static(path.join(__dirname, '.')));

// Online users ka queue
let waitingUsers = [];
let activeChats = new Map(); // socketId -> partnerSocketId

// Online users count broadcast
function broadcastOnlineCount() {
  const count = io.engine.clientsCount;
  io.emit('online_count', count);
}

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  let userProfile = null;
  let partnerId = null;

  // Update profile
  socket.on('update_profile', (profile) => {
    userProfile = { ...profile, socketId: socket.id };
    console.log('📝 Profile updated:', userProfile.name);
    broadcastOnlineCount();
  });

  // Find match
  socket.on('find_match', (profile) => {
    userProfile = { ...profile, socketId: socket.id };
    console.log('🔍 Finding match for:', userProfile.name);

    // Pehle se waiting users mein se koi matching partner dhundein
    let matchedIndex = -1;

    for (let i = 0; i < waitingUsers.length; i++) {
      const waiter = waitingUsers[i];
      if (waiter.socketId === socket.id) continue;

      // Preference match check karein
      const waiterPrefersMe = waiter.prefer === 'both' || waiter.prefer === userProfile.gender;
      const iPreferWaiter = userProfile.prefer === 'both' || userProfile.prefer === waiter.gender;

      if (waiterPrefersMe && iPreferWaiter) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex !== -1) {
      // Partner mil gaya!
      const partner = waitingUsers[matchedIndex];
      waitingUsers.splice(matchedIndex, 1);

      const partnerSocket = io.sockets.sockets.get(partner.socketId);
      if (partnerSocket) {
        // Dono ko match notification bhejein
        const myData = {
          socketId: socket.id,
          name: userProfile.name,
          age: userProfile.age,
          gender: userProfile.gender,
          country: userProfile.country
        };

        const partnerData = {
          socketId: partner.socketId,
          name: partner.name,
          age: partner.age,
          gender: partner.gender,
          country: partner.country
        };

        socket.emit('matched', partnerData);
        partnerSocket.emit('matched', myData);

        // Active chats mein store karein
        activeChats.set(socket.id, partner.socketId);
        activeChats.set(partner.socketId, socket.id);

        // Purane messages bhejein (abhi empty)
        socket.emit('previous_messages', []);
        partnerSocket.emit('previous_messages', []);

        console.log('💞 Matched:', userProfile.name, '<->', partner.name);
      }
    } else {
      // Partner nahi mila, queue mein daalein
      const alreadyWaiting = waitingUsers.find(u => u.socketId === socket.id);
      if (!alreadyWaiting) {
        waitingUsers.push({
          socketId: socket.id,
          name: userProfile.name,
          age: userProfile.age,
          gender: userProfile.gender,
          country: userProfile.country,
          prefer: userProfile.prefer
        });
        console.log('⏳ Added to waiting queue:', userProfile.name);
      }
    }
  });

  // Cancel match
  socket.on('cancel_match', () => {
    // Waiting queue se hatao
    waitingUsers = waitingUsers.filter(u => u.socketId !== socket.id);
    socket.emit('match_cancelled');
    console.log('❌ Match cancelled by:', userProfile?.name);
  });

  // Send message
  socket.on('send_message', (data) => {
    partnerId = activeChats.get(socket.id);
    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit('message', {
          ...data,
          name: userProfile?.name || 'Stranger'
        });
      }
    }
  });

  // Typing indicators
  socket.on('typing', () => {
    partnerId = activeChats.get(socket.id);
    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit('typing', userProfile?.name || 'Someone');
      }
    }
  });

  socket.on('stop_typing', () => {
    partnerId = activeChats.get(socket.id);
    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit('stop_typing');
      }
    }
  });

  // Skip
  socket.on('skip', () => {
    partnerId = activeChats.get(socket.id);
    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit('partner_disconnected');
      }
      activeChats.delete(partnerId);
      activeChats.delete(socket.id);
    }

    // Waiting queue se hatao aur dobara daalein
    waitingUsers = waitingUsers.filter(u => u.socketId !== socket.id);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);

    // Partner ko inform karein
    partnerId = activeChats.get(socket.id);
    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit('partner_disconnected');
      }
      activeChats.delete(partnerId);
      activeChats.delete(socket.id);
    }

    // Waiting queue se hatao
    waitingUsers = waitingUsers.filter(u => u.socketId !== socket.id);

    broadcastOnlineCount();
  });

  broadcastOnlineCount();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║     🌊 ChatWave Server Running       ║
║     http://localhost:${PORT}           ║
╚══════════════════════════════════════╝
  `);
});