#!/usr/bin/env node

const dgram = require('dgram');
const readline = require('readline');

const RETROARCH_CMD_PORT = 55355;
let memoryClient = null;
let scanResults = new Map(); // address -> value
let previousScan = new Map();

// N64 game memory range - focused on player data area
const SCAN_START = 0x80000000;
const SCAN_END = 0x80800000;  // End after player 4 data
const SCAN_STEP = 4; // Check every 4 bytes (32-bit values)

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🔍 GoldenPie Memory Scanner');
console.log('==========================');
console.log('Commands:');
console.log('  scan <value>     - Initial scan for addresses containing <value>');
console.log('  filter <value>   - Filter previous results to addresses now containing <value>');
console.log('  list             - Show current scan results');
console.log('  quit             - Exit scanner');
console.log('');

function createMemoryClient() {
  if (!memoryClient) {
    memoryClient = dgram.createSocket('udp4');
  }
  return memoryClient;
}

function readMemory(address) {
  return new Promise((resolve, reject) => {
    const client = createMemoryClient();
    const command = `READ_CORE_MEMORY ${address.toString(16).toUpperCase()} 1`;

    const timeout = setTimeout(() => {
      reject(new Error('Timeout'));
    }, 100);

    const messageHandler = (msg) => {
      clearTimeout(timeout);
      client.removeListener('message', messageHandler);

      const response = msg.toString().trim();
      const parts = response.split(' ');
      if (parts.length >= 3) {
        const value = parseInt(parts[2], 16);
        resolve(value);
      } else {
        resolve(null);
      }
    };

    client.on('message', messageHandler);

    client.send(command, RETROARCH_CMD_PORT, '127.0.0.1', (err) => {
      if (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

async function performInitialScan(targetValue) {
  console.log(`🔍 Scanning memory range 0x${SCAN_START.toString(16)} - 0x${SCAN_END.toString(16)} for value ${targetValue}...`);
  console.log('This may take a few minutes...');

  scanResults.clear();
  let scanned = 0;
  const total = (SCAN_END - SCAN_START) / SCAN_STEP;

  // Process in batches for better performance
  const BATCH_SIZE = 10;
  for (let batchStart = SCAN_START; batchStart < SCAN_END; batchStart += BATCH_SIZE * SCAN_STEP) {
    const promises = [];
    for (let i = 0; i < BATCH_SIZE && (batchStart + i * SCAN_STEP) < SCAN_END; i++) {
      const address = batchStart + i * SCAN_STEP;
      promises.push(
        readMemory(address)
          .then(value => ({ address, value, success: true }))
          .catch(() => ({ address, value: null, success: false }))
      );
    }

    const results = await Promise.all(promises);
    for (const result of results) {
      if (result.success && result.value === targetValue) {
        scanResults.set(result.address, result.value);
      }

      scanned++;
      if (scanned % 100 === 0) {
        const progress = ((scanned / total) * 100).toFixed(1);
        process.stdout.write(`\r📊 Progress: ${progress}% (Found: ${scanResults.size})`);
      }
    }
  }

  console.log(`\n✅ Initial scan complete! Found ${scanResults.size} addresses with value ${targetValue}`);

  if (scanResults.size > 0 && scanResults.size <= 50) {
    console.log('\n📍 Found addresses:');
    for (const [address, value] of scanResults) {
      console.log(`  0x${address.toString(16).toUpperCase()}: ${value}`);
    }
  } else if (scanResults.size > 50) {
    console.log(`\n📍 Found ${scanResults.size} addresses (too many to display)`);
  }
}

async function filterScan(targetValue) {
  if (scanResults.size === 0) {
    console.log('❌ No previous scan results to filter. Run "scan <value>" first.');
    return;
  }

  console.log(`🔍 Filtering ${scanResults.size} addresses for new value ${targetValue}...`);

  const filteredResults = new Map();
  let checked = 0;
  const addresses = Array.from(scanResults.keys());

  // Process addresses in batches for better performance
  const BATCH_SIZE = 10;
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);
    const promises = batch.map(address =>
      readMemory(address)
        .then(value => ({ address, value, success: true }))
        .catch(() => ({ address, value: null, success: false }))
    );

    const results = await Promise.all(promises);
    for (const result of results) {
      if (result.success && result.value === targetValue) {
        filteredResults.set(result.address, result.value);
      }

      checked++;
      if (checked % 10 === 0 || checked === addresses.length) {
        process.stdout.write(`\r📊 Checked: ${checked}/${scanResults.size} (Matches: ${filteredResults.size})`);
      }
    }
  }

  scanResults = filteredResults;
  console.log(`\n✅ Filter complete! ${scanResults.size} addresses now contain value ${targetValue}`);

  if (scanResults.size > 0 && scanResults.size <= 20) {
    console.log('\n📍 Remaining addresses:');
    for (const [address, value] of scanResults) {
      console.log(`  0x${address.toString(16).toUpperCase()}: ${value}`);
    }
  }

  if (scanResults.size <= 10) {
    console.log('\n🎯 Great! You\'re down to a manageable number of addresses.');
    console.log('Keep playing and use "filter <value>" as the number changes.');
  }
}

function listResults() {
  if (scanResults.size === 0) {
    console.log('📭 No scan results available.');
    return;
  }

  console.log(`📍 Current scan results (${scanResults.size} addresses):`);

  if (scanResults.size <= 50) {
    for (const [address, value] of scanResults) {
      console.log(`  0x${address.toString(16).toUpperCase()}: ${value}`);
    }
  } else {
    console.log('  (Too many to display - use filter command to narrow down)');
  }
}

async function processCommand(input) {
  const parts = input.trim().split(' ');
  const command = parts[0].toLowerCase();
  const value = parseInt(parts[1]);

  switch (command) {
    case 'scan':
      if (isNaN(value)) {
        console.log('❌ Usage: scan <value>');
        break;
      }
      await performInitialScan(value);
      break;

    case 'filter':
      if (isNaN(value)) {
        console.log('❌ Usage: filter <value>');
        break;
      }
      await filterScan(value);
      break;

    case 'list':
      listResults();
      break;

    case 'quit':
    case 'exit':
      console.log('👋 Goodbye!');
      if (memoryClient) {
        memoryClient.close();
      }
      rl.close();
      process.exit(0);
      break;

    default:
      console.log('❌ Unknown command. Available: scan, filter, list, quit');
  }
}

function promptUser() {
  rl.question('memory-scanner> ', async (input) => {
    if (input.trim()) {
      await processCommand(input);
    }
    setTimeout(promptUser, 100); // Small delay before next prompt
  });
}

console.log('🚀 Make sure RetroArch is running with network commands enabled!');
console.log('');
promptUser();