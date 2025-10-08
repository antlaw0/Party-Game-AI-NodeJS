// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { generatePrompt } = require('./lib/groqClient.js');
const path = require("path");
const { getRandomUnusedQuestion, resetUsedQuestions } = require('./lib/questionDB.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// === Serve static files ===
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
app.use('/lib', express.static(path.join(__dirname, 'lib')));

// === In-memory session (currently only one session allowed) ===
let currentSession = null;

// === Utilities ===
function generateJoinCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// Centralized player state updater
function updatePlayerStatus(session, playerId, status) {
  if (!session || !session.playerStates[playerId]) return;
  session.playerStates[playerId].status = status;
}

// Broadcast player states to all in the session
function broadcastPlayerStates(session) {
  if (!session) return;
  const states = session.players.map(p => ({
    name: p.name,
    status: session.playerStates[p.id]?.status || 'Unknown',
    connected: !!io.sockets.sockets.get(p.id)
  }));
  io.to(session.joinCode).emit('updatePlayerStates', states);
}

// Get all connected players
function getConnectedPlayers(session) {
  return session.players.filter(p => io.sockets.sockets.get(p.id));
}

// === Routes ===
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
app.get('/questionables', (req, res) => res.sendFile(__dirname + '/questionables.html'));

// === Socket.io ===
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  // --- Create Game ---
  socket.on('createGame', async ({ playerName, numRounds }) => {
    if (currentSession) {
      socket.emit('errorMsg', 'Only one game session allowed during beta testing.');
      return;
    }

    const joinCode = generateJoinCode();
    resetUsedQuestions();

    let prompt;
    try {
      prompt = await generatePrompt("questionables");
      if (!prompt || prompt.startsWith("Default prompt")) prompt = getRandomUnusedQuestion();
    } catch (err) {
      console.error("Groq error:", err);
      prompt = getRandomUnusedQuestion();
    }

    currentSession = {
      joinCode,
      leaderId: socket.id,
      numRounds: numRounds || 3,
      currentRound: 1,
      players: [{ id: socket.id, name: playerName + " (game leader)", score: 0 }],
      answers: {},
      votes: {},
      prompt,
      answerStage: true,
      votingStage: false,
      playerStates: {}
    };

    // Initialize player states
    currentSession.players.forEach(p => {
      currentSession.playerStates[p.id] = { status: 'In Lobby', connected: true };
    });

    socket.join(joinCode);
    socket.emit('gameCreated', { joinCode, players: currentSession.players });
    broadcastPlayerStates(currentSession);
  });

  // --- Join Game ---
  socket.on('joinGame', ({ playerName, joinCode }) => {
    if (!currentSession || joinCode !== currentSession.joinCode) {
      socket.emit('errorMsg', 'Invalid game code.');
      return;
    }

    const player = { id: socket.id, name: playerName, score: 0 };
    currentSession.players.push(player);
    currentSession.playerStates[socket.id] = { status: 'In Lobby', connected: true };
    socket.join(joinCode);

    io.to(joinCode).emit('updateLobby', currentSession.players);
    broadcastPlayerStates(currentSession);
    socket.emit('gameJoined', { joinCode, players: currentSession.players });
  });

  // --- Start Game (Leader only) ---
  socket.on('startGame', () => {
    if (!currentSession || socket.id !== currentSession.leaderId) return;

    // Set all players to "Answering"
    currentSession.players.forEach(p => updatePlayerStatus(currentSession, p.id, 'Answering'));
    broadcastPlayerStates(currentSession);

    io.to(currentSession.joinCode).emit('newQuestion', {
      round: currentSession.currentRound,
      prompt: currentSession.prompt
    });
  });

  // --- Submit Answer ---
  socket.on('submitAnswer', ({ answer }) => {
    if (!currentSession) return;

    currentSession.answers[socket.id] = answer;
    updatePlayerStatus(currentSession, socket.id, 'Waiting for others to Answer');
    broadcastPlayerStates(currentSession);

    const connectedPlayers = getConnectedPlayers(currentSession);
    const allAnswered = connectedPlayers.every(p => currentSession.answers[p.id]);

    if (allAnswered) {
      currentSession.answerStage = false;
      currentSession.votingStage = true;
      io.to(currentSession.joinCode).emit('startVoting', {
        prompt: currentSession.prompt,
        answers: Object.values(currentSession.answers)
      });
      // Set all players to Voting
      connectedPlayers.forEach(p => updatePlayerStatus(currentSession, p.id, 'Voting'));
      broadcastPlayerStates(currentSession);
    } else {
      socket.emit('waitingForPlayers');
    }
  });

  // --- Submit Vote ---
  socket.on('submitVote', ({ answer }) => {
    if (!currentSession) return;

    currentSession.votes[socket.id] = answer;
    updatePlayerStatus(currentSession, socket.id, 'Waiting for others to Vote');
    broadcastPlayerStates(currentSession);

    const connectedPlayers = getConnectedPlayers(currentSession);
    const allVoted = connectedPlayers.every(p => currentSession.votes[p.id]);

    if (allVoted) {
      // Count votes
      const results = {};
      Object.values(currentSession.votes).forEach(a => results[a] = (results[a] || 0) + 1);

      // Update player scores
      currentSession.players.forEach(p => {
        const ans = currentSession.answers[p.id];
        if (results[ans]) p.score += results[ans];
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

      // Reset stages
      currentSession.votes = {};
      currentSession.answerStage = false;
      currentSession.votingStage = false;

      broadcastPlayerStates(currentSession);
    } else {
      socket.emit('waitingForVotes');
    }
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    if (!currentSession) return;

    if (socket.id === currentSession.leaderId) {
      io.to(currentSession.joinCode).emit('errorMsg', 'Leader left, game ended.');
      currentSession = null;
    } else {
      broadcastPlayerStates(currentSession);
    }
  });
});

// --- Start server ---
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
