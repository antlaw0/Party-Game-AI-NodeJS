// lib/gameManager.js
// Single in-memory session manager (beta: only one session allowed)

const { makeDebugger } = require("../debug");
const debug = makeDebugger("lib/gameManager");
const groqClient = require("./groqClient");

let session = null; // single session for beta

function _makePlayer(socketId, name, isLeader = false) {
  return { socketId, name, score: 0, isLeader };
}

function createSession(leaderSocketId, leaderName, rounds = 3) {
  if (session) {
    debug("game", "Attempt to create a session but one already exists");
    return { error: "SESSION_EXISTS" };
  }

  const code = _generateCode();
  session = {
    code,
    name: "Questionables",
    rounds: Math.max(1, parseInt(rounds, 10) || 3),
    currentRound: 1,
    leaderSocketId,
    state: "lobby",
    players: [_makePlayer(leaderSocketId, leaderName, true)],
    answers: {},   // socketId -> answer text
    votes: {},     // ownerSocketId -> voteCount
    votesByPlayer: {} // voterSocketId -> ownerSocketId
  };

  debug("game", `Created session ${code} by ${leaderName} (${leaderSocketId})`);
  return { session };
}

function _generateCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let c = "";
  for (let i = 0; i < 4; i++) c += letters[Math.floor(Math.random() * letters.length)];
  return c;
}

function getSession() {
  return session;
}

function joinSession(socketId, name, code) {
  if (!session) {
    debug("game", "Join attempt but no session exists");
    return { error: "NO_SESSION" };
  }
  if (code !== session.code) {
    debug("game", `Join attempt with invalid code ${code}`);
    return { error: "INVALID_CODE" };
  }
  if (session.players.find(p => p.socketId === socketId)) {
    debug("game", `Socket ${socketId} already in session`);
    return { session };
  }
  session.players.push(_makePlayer(socketId, name, false));
  debug("game", `Player ${name} (${socketId}) joined session ${code}`);
  return { session };
}

function leaveSession(socketId) {
  if (!session) return;

  const idx = session.players.findIndex(p => p.socketId === socketId);
  if (idx !== -1) {
    const removed = session.players.splice(idx, 1)[0];
    debug("game", `Player ${removed.name} (${socketId}) left session`);
  }

  // If leader left and players remain, promote first player to leader
  if (session && session.players.length > 0) {
    const leaderStillThere = session.players.some(p => p.socketId === session.leaderSocketId);
    if (!leaderStillThere) {
      session.leaderSocketId = session.players[0].socketId;
      session.players[0].isLeader = true;
      debug("game", `New leader assigned: ${session.players[0].name}`);
    }
  }

  // if no players remain, clear session
  if (session && session.players.length === 0) {
    debug("game", `No players left. Clearing session ${session.code}`);
    session = null;
  }
}

function getLobbyData() {
  if (!session) return null;
  return {
    code: session.code,
    name: session.name,
    rounds: session.rounds,
    currentRound: session.currentRound,
    players: session.players.map(p => ({ socketId: p.socketId, name: p.name, score: p.score, isLeader: p.isLeader }))
  };
}

async function startRound(leaderSocketId) {
  if (!session) return { error: "NO_SESSION" };
  if (session.leaderSocketId !== leaderSocketId) return { error: "NOT_LEADER" };
  if (session.state !== "lobby" && session.state !== "results") return { error: "INVALID_STATE" };

  session.state = "question";
  session.answers = {};
  session.votes = {};
  session.votesByPlayer = {};

  // generate prompt via groq client
  const prompt = await groqClient.generatePrompt(session, session.currentRound);
  session.currentQuestion = prompt;
  debug("ai", `Generated prompt for round ${session.currentRound}: ${prompt}`);

  return { prompt, round: session.currentRound };
}

function submitAnswer(socketId, answerText) {
  if (!session) return { error: "NO_SESSION" };
  if (session.state !== "question") return { error: "INVALID_STATE" };

  session.answers[socketId] = String(answerText || "").trim();
  debug("game", `Answer submitted by ${socketId}: ${session.answers[socketId]}`);

  const answeredCount = Object.keys(session.answers).length;
  if (answeredCount >= session.players.length) {
    // proceed to voting
    session.state = "voting";
    // prepare votes structure
    session.votes = {};
    session.players.forEach(p => { session.votes[p.socketId] = 0; });
    debug("game", "All answers submitted — transitioning to voting");
    return { allSubmitted: true, votingOptions: _buildVotingOptions() };
  }

  return { allSubmitted: false };
}

function _buildVotingOptions() {
  // Return array of { ownerId, text } in random order
  const items = Object.entries(session.answers).map(([ownerId, text]) => ({ ownerId, text }));
  // Shuffle
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function submitVote(voterSocketId, ownerSocketId) {
  if (!session) return { error: "NO_SESSION" };
  if (session.state !== "voting") return { error: "INVALID_STATE" };
  if (!session.votes.hasOwnProperty(ownerSocketId)) return { error: "INVALID_OWNER" };

  // prevent double voting from same voter
  if (session.votesByPlayer[voterSocketId]) {
    debug("game", `Voter ${voterSocketId} attempted to vote twice`);
    return { error: "ALREADY_VOTED" };
  }

  session.votes[ownerSocketId] += 1;
  session.votesByPlayer[voterSocketId] = ownerSocketId;
  debug("game", `Voter ${voterSocketId} voted for ${ownerSocketId}`);

  const totalVotes = Object.keys(session.votesByPlayer).length;
  if (totalVotes >= session.players.length) {
    // all voted -> compute results and assign scores
    session.state = "results";

    // assign scores: each vote counts as 1 point
    session.players.forEach(p => {
      const count = session.votes[p.socketId] || 0;
      p.score += count;
    });

    const results = session.players
      .map(p => ({ name: p.name, socketId: p.socketId, votes: session.votes[p.socketId] || 0, score: p.score }))
      .sort((a, b) => b.votes - a.votes);

    debug("game", `Round results: ${JSON.stringify(results)}`);
    return { allVoted: true, results };
  }

  return { allVoted: false };
}

function continueGame(leaderSocketId) {
  if (!session) return { error: "NO_SESSION" };
  if (leaderSocketId !== session.leaderSocketId) return { error: "NOT_LEADER" };
  if (session.state !== "results") return { error: "INVALID_STATE" };

  session.currentRound += 1;
  if (session.currentRound > session.rounds) {
    // final results
    const finalScores = session.players
      .map(p => ({ name: p.name, socketId: p.socketId, score: p.score }))
      .sort((a, b) => b.score - a.score);

    // capture final and then clear session for new creation
    debug("game", `Final results: ${JSON.stringify(finalScores)}`);
    const payload = { finalScores };
    session = null; // clear for beta
    return { final: true, payload };
  } else {
    // continue to next round (go back to question)
    session.state = "question";
    session.answers = {};
    session.votes = {};
    session.votesByPlayer = {};

    debug("game", `Continuing to round ${session.currentRound}`);
    return { final: false, round: session.currentRound };
  }
}

module.exports = {
  createSession,
  joinSession,
  leaveSession,
  getLobbyData,
  startRound,
  submitAnswer,
  submitVote,
  continueGame,
  getSession
};
