#!/usr/bin/env node

const dgram = require('dgram');

const RETROARCH_CMD_PORT = 55355;
let client = null;

function createClient() {
  if (!client) {
    client = dgram.createSocket('udp4');
  }
  return client;
}

function readMemory(address, bytes = 1) {
  return new Promise((resolve, reject) => {
    const udpClient = createClient();
    const command = `READ_CORE_MEMORY ${address.toString(16).toUpperCase()} ${bytes}`;
    console.log(`Sending command: ${command}`);

    const timeout = setTimeout(() => {
      reject(new Error('Timeout'));
    }, 1000);

    const messageHandler = (msg) => {
      clearTimeout(timeout);
      udpClient.removeListener('message', messageHandler);

      const response = msg.toString().trim();
      console.log(`Raw response: ${response}`);
      const parts = response.split(' ');

      if (parts.length >= 3) {
        console.log(`Hex value: ${parts[2]}`);
        const value = parseInt(parts[2], 16);
        console.log(`Decimal value: ${value}`);
        resolve({ hex: parts[2], decimal: value, raw: response });
      } else {
        resolve({ error: 'Invalid response', raw: response });
      }
    };

    udpClient.on('message', messageHandler);

    udpClient.send(command, RETROARCH_CMD_PORT, '127.0.0.1', (err) => {
      if (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

async function testFormats() {
  console.log('Testing memory read formats...');
  console.log('Make sure you have at least 1 kill first!\n');

  const killAddress = 0x80079F0C; // Player 1 kills from your config

  try {
    console.log('=== Testing 1 byte read ===');
    const result1 = await readMemory(killAddress, 1);
    console.log('Result:', result1);

    console.log('\n=== Testing 2 byte read ===');
    const result2 = await readMemory(killAddress, 2);
    console.log('Result:', result2);

    console.log('\n=== Testing 4 byte read ===');
    const result4 = await readMemory(killAddress, 4);
    console.log('Result:', result4);

  } catch (error) {
    console.error('Error:', error.message);
  }

  if (client) {
    client.close();
  }
  process.exit(0);
}

testFormats();