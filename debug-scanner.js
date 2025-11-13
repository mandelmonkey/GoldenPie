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

function readMemory(address) {
  return new Promise((resolve, reject) => {
    const udpClient = createClient();
    const command = `READ_CORE_MEMORY ${address.toString(16).toUpperCase()} 1`;

    const timeout = setTimeout(() => {
      reject(new Error('Timeout'));
    }, 100);

    const messageHandler = (msg) => {
      clearTimeout(timeout);
      udpClient.removeListener('message', messageHandler);

      const response = msg.toString().trim();
      const parts = response.split(' ');
      if (parts.length >= 3) {
        const value = parseInt(parts[2], 16);
        resolve(value);
      } else {
        resolve(null);
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

async function debugKnownAddress() {
  console.log('🔍 Debug Scanner - Testing Known Address');
  console.log('=====================================');

  const killAddress = 0x80079F0C; // Player 1 kills from config

  try {
    console.log(`Reading kill address 0x${killAddress.toString(16).toUpperCase()}...`);
    const value = await readMemory(killAddress);
    console.log(`Current kill count: ${value}`);

    console.log('\nNow testing some nearby addresses for comparison:');
    for (let offset = -20; offset <= 20; offset += 4) {
      const testAddr = killAddress + offset;
      try {
        const testValue = await readMemory(testAddr);
        const addrHex = testAddr.toString(16).toUpperCase();
        console.log(`0x${addrHex}: ${testValue}`);
      } catch (error) {
        // Skip failed reads
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
  }

  if (client) {
    client.close();
  }
  process.exit(0);
}

debugKnownAddress();