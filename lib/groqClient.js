// lib/groqClient.js
// Placeholder Groq client. Replace generatePrompt with real API call to Groq later.

function generatePrompt(session, roundNumber) {
  // For now return a deterministic placeholder prompt.
  // Later: call Groq API and return the generated prompt string.
  return Promise.resolve(
    `Round ${roundNumber}: Finish this prompt — What's the funniest thing about ${session.name || "life"}?`
  );
}

module.exports = { generatePrompt };
