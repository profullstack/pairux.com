// Use createRequire to ensure proper module resolution
const { createRequire } = require('node:module');
const electronPath = require.resolve('electron');
console.log('Electron path:', electronPath);

// Try direct process binding if available
if (process.type === 'browser') {
  console.log('Running in Electron main process');
  // Access electron via process._linkedBinding if available
  try {
    const electron = process._linkedBinding ? process._linkedBinding('electron_common_features') : null;
    console.log('Electron binding:', electron);
  } catch (e) {
    console.log('No electron binding:', e.message);
  }
} else {
  console.log('process.type:', process.type);
}

// Try the standard import
const electron = require('electron');
console.log('electron type:', typeof electron);
console.log('electron value:', String(electron).substring(0, 100));
