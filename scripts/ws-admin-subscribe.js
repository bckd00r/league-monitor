#!/usr/bin/env node
// Simple admin WS client for relay server, prints events
import WebSocket from 'ws';
const base = process.env.RELAY_BASE || 'ws://localhost:8080';

const ws = new WebSocket(base);

ws.onopen = () => {
  console.log('connected, subscribing...');
  ws.send(JSON.stringify({ type: 'ADMIN_SUBSCRIBE' }));
};

ws.onmessage = (ev) => {
  try {
    const msg = JSON.parse(ev.data.toString());
    console.log('MSG', msg.type, msg.payload || '');
  } catch (e) {
    console.error('parse error', e);
  }
};

ws.onclose = () => console.log('closed')
