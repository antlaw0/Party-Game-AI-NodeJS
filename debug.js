// debug.js
// Central debug utility

const config = require("./debugConfig");

// Format timestamps nicely
function getTimestamp() {
  return new Date().toISOString().replace("T", " ").split(".")[0];
}

// Factory: create a debug function bound to a file name
function makeDebugger(fileName) {
  return function debug(category, message) {
    if (!config.debugEnabled) return;

    const categoryEnabled = config.categories[category] ?? false;
    const fileEnabled = config.files[fileName] ?? false;

    if (categoryEnabled && fileEnabled) {
      console.log(
        `[${getTimestamp()}] [${fileName}] [${category}] ${message}`
      );
    }
  };
}

module.exports = { makeDebugger };
