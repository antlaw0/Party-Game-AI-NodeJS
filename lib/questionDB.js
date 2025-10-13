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
    used INTEGER DEFAULT 0,
    rating INTEGER DEFAULT 0
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


// Initialize DB on load

module.exports = {
  getRandomUnusedQuestion,
  resetUsedQuestions
};
