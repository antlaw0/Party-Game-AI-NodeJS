// constants.js
// Centralized constants used across the project

module.exports = {
  SERVER_PORT: 3000,

  SOCKET_NAMESPACE: "/game",

  // External API endpoints
  GROQ_API_URL: "https://api.groq.com/v1/chat/completions",

  // Game names and identifiers
  GAMES: {
    DRAW: "DrawIt",
    QUIZ: "QuickQuiz",
    STORY: "StoryBuilder"
  }
};
