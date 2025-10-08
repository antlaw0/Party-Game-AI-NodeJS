// lib/questionDB.js
const Database = require('better-sqlite3');
const path = require('path');

// Open (or create) DB file in project root
const db = new Database(path.join(__dirname, '../data/questions.db'));

// Create table if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    used INTEGER DEFAULT 0
  )
`);

// Helper: get random unused question
function getRandomUnusedQuestion() {
  const unused = db.prepare('SELECT * FROM questions WHERE used = 0 ORDER BY RANDOM() LIMIT 1').get();
  if (!unused) {
    console.warn('No unused questions left; resetting all to unused.');
    resetUsedQuestions();
    return getRandomUnusedQuestion(); // try again
  }

  // Mark as used
  db.prepare('UPDATE questions SET used = 1 WHERE id = ?').run(unused.id);
  return unused.text;
}

// Helper: reset all to unused (for new sessions)
function resetUsedQuestions() {
  db.prepare('UPDATE questions SET used = 0').run();
}

// Optional: seed DB with starter questions if empty
function seedQuestions() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM questions').get().c;
  if (count === 0) {
    const insert = db.prepare('INSERT INTO questions (text) VALUES (?)');
    const sampleQuestions = [
      "What's the worst thing to say during a job interview?",
      "If animals could talk, which would be the rudest?",
      "What's the real reason aliens haven't contacted Earth?",
      "What would be the worst flavor for toothpaste?",
      "What would be a terrible slogan for a funeral home?"
    ];
    const insertMany = db.transaction((questions) => {
      for (const q of questions) insert.run(q);
    });
    insertMany(sampleQuestions);
    console.log(`Seeded ${sampleQuestions.length} starter questions.`);
  }
}

// Initialize DB on load
seedQuestions();

module.exports = {
  getRandomUnusedQuestion,
  resetUsedQuestions
};
