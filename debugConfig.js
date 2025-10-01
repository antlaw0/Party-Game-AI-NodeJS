// debugConfig.js
// Manage what debug messages are shown across the project

module.exports = {
  debugEnabled: true, // Master switch for all debugging

  // Enable/disable by category
  categories: {
    network: true,
    game: true,
    ai: true,
    db: false
  },

  // Enable/disable by file (must match the identifier used in makeDebugger)
  files: {
    "routes/lobbyRoutes": true,
    "lib/gameManager": true,
    "lib/groqClient": true,
    "lib/utils": false
  }
};
