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
// === Sandbox Route ===
app.use(express.json());


// === In-memory session (currently only one session allowed) ===
let currentSession = null;

// === Utilities ===
function generateJoinCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
} // end of generateJoinCode()

// Centralized player state updater
function updatePlayerStatus(session, playerId, status) {
  if (!session || !session.playerStates[playerId]) return;
  session.playerStates[playerId].status = status;
} // end of updatePlayerStatus()

// Broadcast player states to all in the session
function broadcastPlayerStates(session) {
  if (!session) return;
  const states = session.players.map(p => ({
    name: p.name,
    status: session.playerStates[p.id]?.status || 'Unknown',
    connected: !!io.sockets.sockets.get(p.id)
  }));
  io.to(session.joinCode).emit('updatePlayerStates', states);
} // end of broadcastPlayerStates()

// Get all connected players
function getConnectedPlayers(session) {
  return session.players.filter(p => io.sockets.sockets.get(p.id));
} // end of getConnectedPlayers()

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
  }); // end of socket.on('createGame')

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
  }); // end of socket.on('joinGame')

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
  }); // end of socket.on('startGame')

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
  }); // end of socket.on('submitAnswer')

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
  }); // end of socket.on('submitVote')

  // --- Next Round (Leader only) ---
  socket.on('nextRound', async () => {
    try {
      if (!currentSession) return;
      if (socket.id !== currentSession.leaderId) return;

      currentSession.currentRound++;

      // If all rounds complete → Final Results
      if (currentSession.currentRound > currentSession.numRounds) {
        console.log('Game complete, sending final results');
        io.to(currentSession.joinCode).emit('finalResults', {
          players: currentSession.players
        });
        currentSession = null;
        return;
      }

      // Reset round data
      currentSession.answers = {};
      currentSession.votes = {};
      currentSession.answerStage = true;
      currentSession.votingStage = false;

      // New question
      let prompt;
      try {
        prompt = await generatePrompt("questionables");
        if (!prompt || prompt.startsWith("Default prompt")) prompt = getRandomUnusedQuestion();
      } catch (err) {
        console.error("Groq error:", err);
        prompt = getRandomUnusedQuestion();
      }
      currentSession.prompt = prompt;

      // Update player statuses
      currentSession.players.forEach(p => updatePlayerStatus(currentSession, p.id, 'Answering'));
      broadcastPlayerStates(currentSession);

      io.to(currentSession.joinCode).emit('newQuestion', {
        round: currentSession.currentRound,
        prompt: currentSession.prompt
      });
    } catch (err) {
      console.error('Error in nextRound:', err);
    }
  }); // end of socket.on('nextRound')

  // --- Regenerate Question (Leader only) ---
  socket.on('regenerate_question', async (roomCode) => {
    try {
      if (!currentSession) return;
      if (socket.id !== currentSession.leaderId) return;

      console.log(`Leader requested new question for room ${roomCode}`);

      let newPrompt;
      try {
        newPrompt = await generatePrompt("questionables");
        if (!newPrompt || newPrompt.startsWith("Default prompt")) {
          newPrompt = getRandomUnusedQuestion();
        }
      } catch (err) {
        console.error("Groq error:", err);
        newPrompt = getRandomUnusedQuestion();
      }

      currentSession.prompt = newPrompt;

      io.to(currentSession.joinCode).emit('newQuestion', {
        round: currentSession.currentRound,
        prompt: currentSession.prompt
      });

    } catch (err) {
      console.error('Error regenerating question:', err);
      socket.emit('error_message', 'Failed to regenerate question.');
    }
  }); // end of socket.on('regenerate_question')

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
  }); // end of socket.on('disconnect')

}); // end of io.on('connection')

app.post('/sandbox-groq', async (req, res) => {
  const { prompt, temperature, max_tokens } = req.body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: true, message: "Missing or invalid prompt." });
  }

  const tempValue = typeof temperature === 'number' ? temperature : 1.0;
  const maxTokensValue = typeof max_tokens === 'number' ? max_tokens : 150;

  const GROQ_API_KEY = process.env.GROQ_PARTYWEBGAME_API_KEY;
  const GROQ_CHAT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
  const ai_model = "llama-3.3-70b-versatile";

  const startTime = Date.now();

  try {
    const response = await fetch(GROQ_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: ai_model,
        messages: [{ role: "user", content: prompt }],
        temperature: tempValue,
        max_tokens: maxTokensValue
      }),
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Groq Sandbox Error:", errorText);
      return res.status(response.status).json({
        error: true,
        message: `Groq API Error (${response.status})`,
        details: errorText
      });
    }

    const data = await response.json();

    res.json({
      text: data?.choices?.[0]?.message?.content?.trim() || "(No content returned)",
      raw: data,
      usage: data?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      duration_ms: duration
    });

  } catch (err) {
    console.error("Groq Sandbox Exception:", err);
    res.status(500).json({
      error: true,
      message: "Internal error calling Groq API",
      details: err.message
    });
  }
});

// --- Start server ---
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
