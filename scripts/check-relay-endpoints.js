#!/usr/bin/env node
// Simple sanity-check script for relay server endpoints
const base = process.env.RELAY_BASE || 'http://localhost:8080';

async function chk(path, opts) {
  try {
    const res = await fetch(base + path, opts);
    const text = await res.text();
    console.log(path, res.status, text.slice(0, 200));
  } catch (e) {
    console.error('ERR', path, e.message || e);
  }
}

(async () => {
  await chk('/health');
  await chk('/sessions');
  // create a session
  await chk('/create-session', { method: 'POST' });
  console.log('Sanity check finished');
})();
