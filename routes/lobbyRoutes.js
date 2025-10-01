// routes/lobbyRoutes.js
const express = require("express");
const router = express.Router();

const { makeDebugger } = require("../debug");
const debug = makeDebugger("routes/lobbyRoutes");

// Home page route
router.get("/", (req, res) => {
  debug("network", "GET / request received");
  res.send("<h1>Welcome to the Party Game Platform</h1>");
});

// Example game join route
router.get("/game/:code", (req, res) => {
  const { code } = req.params;
  debug("network", `GET /game/${code} request received`);
  res.send(`<h1>Joining game with code: ${code}</h1>`);
});

module.exports = router;
