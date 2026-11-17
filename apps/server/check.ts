import { buildApp } from './src/app.js';
const app = await buildApp().catch(e => { console.error('BUILD FAILED:', e.message, e.stack); process.exit(1); });
console.log('BUILD OK');
await app.close();