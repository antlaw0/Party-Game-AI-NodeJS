// server.js
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const constants = require("./constants");
const { makeDebugger } = require("./debug");
const debug = makeDebugger("server");

const gameManager = require("./lib/gameManager");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from public
app.use(express.static(path.join(__dirname, "public")));

// Basic routes already handled by your static files
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const ns = io.of(constants.SOCKET_NAMESPACE);

ns.on("connection", (socket) => {
  debug("network", `Socket connected: ${socket.id}`);

  // Client creates a session
  socket.on("create_game", (payload) => {
    const { name, rounds } = payload || {};
    debug("network", `create_game from ${socket.id} name=${name} rounds=${rounds}`);
    const result = gameManager.createSession(socket.id, name, rounds);
    if (result.error) {
      socket.emit("error_message", { error: result.error });
      return;
    }
    const lobby = gameManager.getLobbyData();
    // Join the socket to a room for the single session so we can broadcast easily
    socket.join(lobby.code);
    ns.to(lobby.code).emit("session_created", lobby);
  });

  // Client joins an existing session
  socket.on("join_game", (payload) => {
    const { code, name } = payload || {};
    debug("network", `join_game from ${socket.id} name=${name} code=${code}`);
    const result = gameManager.joinSession(socket.id, name, code);
    if (result.error) {
      socket.emit("error_message", { error: result.error });
      return;
    }
    const lobby = gameManager.getLobbyData();
    socket.join(lobby.code);
    ns.to(lobby.code).emit("joined_session", lobby);
  });

  // Start game (leader only)
  socket.on("start_game", async () => {
    debug("network", `start_game from ${socket.id}`);
    const r = await gameManager.startRound(socket.id);
    if (r.error) {
      socket.emit("error_message", { error: r.error });
      return;
    }
    // broadcast new question to room
    const lobby = gameManager.getLobbyData();
    ns.to(lobby.code).emit("round_started", { prompt: r.prompt, round: r.round });
  });

  // Submit answer
  socket.on("submit_answer", (payload) => {
    const { answer } = payload || {};
    debug("network", `submit_answer from ${socket.id}: ${answer}`);
    const r = gameManager.submitAnswer(socket.id, answer);
    if (r.error) {
      socket.emit("error_message", { error: r.error });
      return;
    }
    const lobby = gameManager.getLobbyData();
    // ack to player
    socket.emit("answer_received", { ok: true });
    // If all submitted, broadcast voting start with anonymous options
    if (r.allSubmitted) {
      ns.to(lobby.code).emit("voting_start", { options: r.votingOptions });
    } else {
      ns.to(lobby.code).emit("player_submitted", { socketId: socket.id });
    }
  });

  // Submit vote
  socket.on("submit_vote", (payload) => {
    const { ownerId } = payload || {};
    debug("network", `submit_vote from ${socket.id} -> ${ownerId}`);
    const r = gameManager.submitVote(socket.id, ownerId);
    if (r.error) {
      socket.emit("error_message", { error: r.error });
      return;
    }
    socket.emit("vote_received", { ok: true });
    const lobby = gameManager.getLobbyData();
    if (r.allVoted) {
      // broadcast results
      ns.to(lobby.code).emit("round_results", { results: r.results, nextRound: gameManager.getSession() ? gameManager.getSession().currentRound : null });
    } else {
      ns.to(lobby.code).emit("player_voted", { socketId: socket.id });
    }
  });

  // Continue game (leader)
  socket.on("continue_game", () => {
    debug("network", `continue_game from ${socket.id}`);
    const r = gameManager.continueGame(socket.id);
    if (r.error) {
      socket.emit("error_message", { error: r.error });
      return;
    }
    if (r.final) {
      // send final results to everyone and clear session
      ns.emit("final_results", r.payload);
    } else {
      // start next round: generate prompt and broadcast
      (async () => {
        const s = gameManager.getSession();
        if (!s) return;
        const pr = await gameManager.startRound(s.leaderSocketId);
        const lobby = gameManager.getLobbyData();
        ns.to(lobby.code).emit("round_started", { prompt: pr.prompt, round: pr.round });
      })();
    }
  });

  // Handle disconnects
  socket.on("disconnect", () => {
    debug("network", `Socket disconnected: ${socket.id}`);
    // If socket belonged to a session, remove and notify others
    const sess = gameManager.getSession();
    if (sess) {
      gameManager.leaveSession(socket.id);
      const lobby = gameManager.getLobbyData();
      if (lobby) {
        ns.to(lobby.code).emit("player_left", { socketId: socket.id, lobby });
      } else {
        // session cleared
        ns.emit("session_ended", { reason: "leader_left_or_no_players" });
      }
    }
  });
});

server.listen(constants.SERVER_PORT, () => {
  debug("network", `Server running on http://localhost:${constants.SERVER_PORT}`);
});
