// debug.js - Centralized debug logging
// Set DEBUG to false before production/publishing to disable all console output
const DEBUG = false;

// Create global debug object for use in other scripts
window.debug = {
  log: (...args) => {
    if (DEBUG) console.log(...args);
  },
  error: (...args) => {
    if (DEBUG) console.error(...args);
  },
  warn: (...args) => {
    if (DEBUG) console.warn(...args);
  }
};
