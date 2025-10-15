// lib/questionDB.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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

// Helper: check if questions table is empty
function isQuestionsTableEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM questions').get().count;
  return count === 0;
}

// Helper: populate questions table from prompts.txt
function populateQuestionsFromFile() {
  const dataDir = path.join(__dirname, '../data');
  const promptsPath = path.join(dataDir, 'prompts.txt');

  if (!fs.existsSync(promptsPath)) {
    console.error(`prompts.txt not found at: ${promptsPath}`);
    return;
  }

  const fileContent = fs.readFileSync(promptsPath, 'utf-8');
  const lines = fileContent.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);

  if (lines.length === 0) {
    console.warn('prompts.txt is empty — no questions inserted.');
    return;
  }

  const insert = db.prepare('INSERT INTO questions (text) VALUES (?)');
  const insertMany = db.transaction((prompts) => {
    for (const text of prompts) {
      insert.run(text);
    }
  });

  insertMany(lines);
  console.log(`Populated ${lines.length} questions from prompts.txt`);
}

// --- Initialization ---
if (isQuestionsTableEmpty()) {
  console.log('Questions table empty — populating from prompts.txt...');
  populateQuestionsFromFile();
} else {
  console.log('Questions table already populated.');
}

module.exports = {
  getRandomUnusedQuestion,
  resetUsedQuestions
};
