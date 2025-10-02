// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { generatePrompt } = require('./lib/groqClient.js');
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public'))); // for your main static files
app.use(express.static(__dirname));
app.use('/lib', express.static(path.join(__dirname, 'lib'))); // exposes /lib folder

// === In-memory session ===
let currentSession = null;

// Utility function to generate 4-letter join code
function generateJoinCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.get('/questionables', (req, res) => {
  res.sendFile(__dirname + '/questionables.html');
});

// === Socket.io ===
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  // Create Game
  socket.on('createGame', async ({ playerName, numRounds }) => {
    if (currentSession) {
      socket.emit('errorMsg', 'Only one game session can be active at once during beta testing.');
      return;
    }

    const joinCode = generateJoinCode();
    currentSession = {
      joinCode,
      leaderId: socket.id,
      numRounds: numRounds || 3,
      currentRound: 1,
      players: [{ id: socket.id, name: playerName + " (game leader)", score: 0 }],
      answers: {},
      votes: {},
      prompt: await generatePrompt("questionables")
    };

    socket.join(joinCode);
    socket.emit('gameCreated', { joinCode, players: currentSession.players });
  });

  // Join Game
socket.on('joinGame', ({ playerName, joinCode }) => {
  if (!currentSession || joinCode !== currentSession.joinCode) {
    socket.emit('errorMsg', 'Invalid game code.');
    return;
  }

  const player = { id: socket.id, name: playerName, score: 0 };
  currentSession.players.push(player);
  socket.join(joinCode);

  // Update everyone in lobby, including the new player
  io.to(joinCode).emit('updateLobby', currentSession.players);

  // Also send confirmation to the joining player
  socket.emit('gameJoined', { joinCode, players: currentSession.players });
});

  // Start Game (leader only)
  socket.on('startGame', () => {
    if (!currentSession || socket.id !== currentSession.leaderId) return;

    io.to(currentSession.joinCode).emit('newQuestion', {
      round: currentSession.currentRound,
      prompt: currentSession.prompt
    });
  });

  // Submit Answer
  socket.on('submitAnswer', ({ answer }) => {
    if (!currentSession) return;
    currentSession.answers[socket.id] = answer;

    // Check if all players have answered
    if (Object.keys(currentSession.answers).length === currentSession.players.length) {
      // Send answers to voting phase
      io.to(currentSession.joinCode).emit('startVoting', {
        prompt: currentSession.prompt,
        answers: Object.values(currentSession.answers)
      });
    } else {
      socket.emit('waitingForPlayers');
    }
  });

  // Submit Vote
  socket.on('submitVote', ({ answer }) => {
    if (!currentSession) return;
    if (!currentSession.votes) currentSession.votes = {};

    currentSession.votes[socket.id] = answer;

    // Check if all players voted
    if (Object.keys(currentSession.votes).length === currentSession.players.length) {
      // Calculate results
      const results = {};
      Object.values(currentSession.votes).forEach(a => {
        if (!results[a]) results[a] = 0;
        results[a]++;
      });

      currentSession.players.forEach(p => {
        const playerAnswer = currentSession.answers[p.id];
        if (results[playerAnswer]) {
          p.score += results[playerAnswer]; // 1 vote = 1 point
        }
      });

      io.to(currentSession.joinCode).emit('roundResults', {
        prompt: currentSession.prompt,
        answers: currentSession.players.map(p => ({
          name: p.name,
          answer: currentSession.answers[p.id],
          votes: results[currentSession.answers[p.id]] || 0
        })).sort((a, b) => b.votes - a.votes),
        round: currentSession.currentRound,
        totalRounds: currentSession.numRounds
      });

      currentSession.votes = {};
    } else {
      socket.emit('waitingForVotes');
    }
  });

  // Continue Game (leader only)
  socket.on('continueGame', async () => {
    if (!currentSession || socket.id !== currentSession.leaderId) return;

    if (currentSession.currentRound < currentSession.numRounds) {
      currentSession.currentRound++;
      const prompt = await generatePrompt("questionables");
      currentSession.answers = {};
      currentSession.prompt = prompt;

      io.to(currentSession.joinCode).emit('newQuestion', {
        round: currentSession.currentRound,
        prompt
      });
    } else {
      const finalScores = currentSession.players
        .map(p => ({ name: p.name, score: p.score }))
        .sort((a, b) => b.score - a.score);

      io.to(currentSession.joinCode).emit('finalResults', { finalScores });

      // Reset session for next game
      currentSession = null;
    }
  });

  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    if (!currentSession) return;

    currentSession.players = currentSession.players.filter(p => p.id !== socket.id);

    if (socket.id === currentSession.leaderId) {
      io.to(currentSession.joinCode).emit('errorMsg', 'Leader left, game ended.');
      currentSession = null;
    } else {
      io.to(currentSession.joinCode).emit('updateLobby', currentSession.players);
    }
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
