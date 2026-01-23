console.log('paths:', module.paths);
const e = require('electron');
console.log('electron:', typeof e, e?.app ? 'has app' : 'no app');
