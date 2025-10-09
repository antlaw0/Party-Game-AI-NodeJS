// lib/groqClient.js
const GROQ_API_KEY = process.env.GROQ_PARTYWEBGAME_API_KEY;
const GROQ_CHAT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const ai_model = "llama-3.3-70b-versatile";

const questionablesPrompt = `
You are an AI prompt generator for a game similar to Quiplash.
Generate a single creative and funny prompt question for players to answer.
Prompts should be varied, humorous, and open-ended — not repetitive or factual.
Examples:
* What would the worst super power be?
* A bad first line for your award acceptance speech
* A bad thing to say to a cashier while paying for an item
* Pants would be a whole lot better if they <BLANK>.
`;

if (!GROQ_API_KEY) {
  console.error("Missing GROQ_PARTYWEBGAME_API_KEY in environment");
}

async function generatePrompt() {
  try {
    const resp = await fetch(GROQ_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: ai_model,
        messages: [
          { role: "system", content: questionablesPrompt },
          { role: "user", content: "Generate one new funny prompt question." }
        ],
        max_tokens: 50,
        temperature: 1.0
      })
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Groq HTTP error", resp.status, txt);
      return "What's something you'd never want your boss to say on a Zoom call?";
    }

    const data = await resp.json();
    const msg = data?.choices?.[0]?.message?.content;

    return msg ? msg.trim().split('\n')[0] : 
      "If animals could talk, which one would be the most sarcastic?";
  } catch (err) {
    console.error("Groq fetch error:", err);
    return "The most unusual thing to find under your bed.";
  }
}

module.exports = { generatePrompt };
