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

async function testDeathPattern() {
  console.log('🔍 Testing Death Address Pattern');
  console.log('===============================');

  // Known addresses from config
  const addresses = {
    player1Kills: 0x80079F0C,
    player1Headshots: 0x80079ef4,
    player1DeathsGuess: 0x80079FB4, // Your guess from config
  };

  console.log('Current values:');
  for (const [name, addr] of Object.entries(addresses)) {
    try {
      const value = await readMemory(addr);
      console.log(`${name}: 0x${addr.toString(16).toUpperCase()} = ${value}`);
    } catch (error) {
      console.log(`${name}: 0x${addr.toString(16).toUpperCase()} = ERROR`);
    }
  }

  console.log('\nScanning wider range around kills address for any non-zero values...');
  const killsAddr = 0x80079F0C;

  for (let offset = -200; offset <= 200; offset += 4) {
    const testAddr = killsAddr + offset;
    try {
      const value = await readMemory(testAddr);
      if (value > 0) {
        const addrHex = testAddr.toString(16).toUpperCase();
        console.log(`0x${addrHex}: ${value} (offset: ${offset >= 0 ? '+' : ''}${offset})`);
      }
    } catch (error) {
      // Skip failed reads
    }
  }

  if (client) {
    client.close();
  }
  process.exit(0);
}

testDeathPattern();