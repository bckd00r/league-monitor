// Simple test server to verify network connectivity
// Run on Mac: node test-server.js

const { WebSocketServer } = require('ws');
const os = require('os');

const PORT = 8080;

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const wss = new WebSocketServer({ 
  port: PORT,
  host: '0.0.0.0'
});

wss.on('listening', () => {
  const localIP = getLocalIP();
  console.log('\n✅ WebSocket Test Server Started');
  console.log('================================');
  console.log(`Port: ${PORT}`);
  console.log(`Host: 0.0.0.0 (all interfaces)`);
  console.log(`\nConnect from Windows using:`);
  console.log(`  ws://${localIP}:${PORT}`);
  console.log('\nWaiting for connections...\n');
});

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`✅ Client connected from: ${ip}`);
  
  ws.send(JSON.stringify({
    message: 'Welcome! Connection successful.',
    timestamp: new Date().toISOString(),
    serverIP: getLocalIP()
  }));
  
  ws.on('message', (data) => {
    console.log(`📨 Received: ${data}`);
    ws.send(JSON.stringify({
      echo: data.toString(),
      timestamp: new Date().toISOString()
    }));
  });
  
  ws.on('close', () => {
    console.log(`❌ Client disconnected: ${ip}`);
  });
});

wss.on('error', (error) => {
  console.error('❌ Server error:', error);
});

console.log('\nStarting WebSocket test server...');
console.log('Press Ctrl+C to stop\n');

process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  wss.close();
  process.exit(0);
});
