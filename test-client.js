// Simple test client to verify network connectivity
// Run on Windows: node test-client.js

const WebSocket = require('ws');

const SERVER_URL = 'ws://192.168.100.62:8080'; // Change to your Mac's IP

console.log('\n🔌 WebSocket Test Client');
console.log('========================');
console.log(`Connecting to: ${SERVER_URL}\n`);

const ws = new WebSocket(SERVER_URL);

ws.on('open', () => {
  console.log('✅ CONNECTION SUCCESSFUL!');
  console.log('Sending test message...\n');
  
  ws.send(JSON.stringify({
    test: 'Hello from Windows PC',
    timestamp: new Date().toISOString()
  }));
  
  setTimeout(() => {
    console.log('\nTest completed. Closing connection...');
    ws.close();
  }, 3000);
});

ws.on('message', (data) => {
  console.log('📨 Received from server:');
  try {
    const parsed = JSON.parse(data);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(data.toString());
  }
  console.log('');
});

ws.on('error', (error) => {
  console.error('\n❌ CONNECTION FAILED!');
  console.error('Error:', error.message);
  console.error('\nPossible issues:');
  console.error('1. Mac firewall is blocking port 8080');
  console.error('2. Incorrect IP address (check Mac IP with: ifconfig)');
  console.error('3. Not on same network');
  console.error('4. Server not running on Mac');
  console.error('\nTroubleshooting:');
  console.error('- Ping Mac from Windows: ping 192.168.100.62');
  console.error('- Check Mac firewall settings');
  console.error('- Verify server is running on Mac');
});

ws.on('close', () => {
  console.log('🔌 Connection closed\n');
  process.exit(0);
});

setTimeout(() => {
  if (ws.readyState !== WebSocket.OPEN) {
    console.error('\n⏱️  Connection timeout (30s)');
    console.error('Server did not respond\n');
    process.exit(1);
  }
}, 30000);
