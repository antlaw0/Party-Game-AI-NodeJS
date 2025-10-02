// lib/groqClient.js

// Groq API key from environment variables
const GROQ_API_KEY = process.env.GROQ_PARTYWEBGAME_API_KEY;

// Groq API endpoint
const GROQ_API_URL = "https://api.groq.ai/v1/generate";

/**
 * Generates a prompt for a game using Groq HTTP API.
 * @param {string} gameName - The name of the game (currently only "questionables").
 * @returns {Promise<string>} - AI-generated prompt.
 */
async function generatePrompt(gameName) {
  if (gameName === "questionables") {
    try {
      const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          prompt: "Generate a funny or interesting question suitable for a Quiplash-style game.",
          max_tokens: 50
        })
      });

      if (!response.ok) {
        console.error("Groq API error:", response.status, await response.text());
        return "Default prompt if AI fails.";
      }

      const data = await response.json();

      // Adjust according to Groq’s actual response structure
      return data.output_text || data.text || "Default prompt if AI fails.";
    } catch (err) {
      console.error("Groq generatePrompt error:", err);
      return "Default prompt if AI fails.";
    }
  }

  return "Default prompt for unknown game.";
}

// Export function for server.js
module.exports = { generatePrompt };
