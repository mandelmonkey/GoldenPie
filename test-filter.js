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

async function testFilter() {
  console.log('🔍 Testing Filter Logic with Known Address');
  console.log('=========================================');

  const killAddress = 0x80079F0C; // We know this has value 1

  // Simulate what the scanner does
  console.log('Step 1: Read current value at kill address...');
  try {
    const currentValue = await readMemory(killAddress);
    console.log(`Kill address 0x${killAddress.toString(16).toUpperCase()} = ${currentValue}`);

    // Simulate the filter logic
    console.log('\nStep 2: Testing filter logic...');
    console.log(`If we filter for value ${currentValue}:`);

    const testValue = await readMemory(killAddress);
    console.log(`Re-read value: ${testValue}`);
    console.log(`Does ${testValue} === ${currentValue}? ${testValue === currentValue}`);

    if (testValue === currentValue) {
      console.log('✅ Filter would keep this address');
    } else {
      console.log('❌ Filter would remove this address');
    }

    // Test with different value
    console.log(`\nIf we filter for value ${currentValue + 1}:`);
    console.log(`Does ${testValue} === ${currentValue + 1}? ${testValue === (currentValue + 1)}`);

  } catch (error) {
    console.error('Error:', error.message);
  }

  if (client) {
    client.close();
  }
  process.exit(0);
}

testFilter();