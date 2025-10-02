// lib/groqClient.js

// Use built-in fetch (Node 18+)
const GROQ_API_KEY = process.env.GROQ_PARTYWEBGAME_API_KEY;
const GROQ_CHAT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const ai_model = "llama-3.3-70b-versatile"

// If no key, that’s critical
if (!GROQ_API_KEY) {
  console.error("Missing GROQ_PARTYWEBGAME_API_KEY in environment");
  // You may want to let it run with fallback, or throw error
}

// Generates a prompt (chat style) via Groq
async function generatePrompt(gameName) {
  // For now, we treat it as a “single message” chat
  const userMessage = {
    role: "user",
    content: `Generate a funny single prompt suitable for a Quiplash-style game called "${gameName}".`
  };

  try {
    const resp = await fetch(GROQ_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: ai_model,  // or another model you have access to
        messages: [ userMessage ],
        max_tokens: 50,
        temperature: 1.0
      })
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Groq HTTP error", resp.status, txt);
      return "Default prompt (Groq failed)";
    }

    const data = await resp.json();
    // data.choices is expected to be an array
    if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
      const msg = data.choices[0].message;
      if (msg && msg.content) {
        return msg.content;
      }
    }
    console.error("Groq response missing expected structure:", data);
    return "Default prompt (Groq returned unexpected)";
  } catch (err) {
    console.error("Groq fetch error:", err);
    return "Default prompt (Groq fetch failed)";
  }
}

module.exports = { generatePrompt };
