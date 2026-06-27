#!/usr/bin/env node
/*
 * quake-frag-finder.js — find the real per-player FRAG memory address by watching
 * which RAM byte increases by 1 each time you get a frag (Cheat-Engine style).
 *
 * Why: GameShark-derived addresses don't line up with mupen64plus_next's live RAM.
 * This reads RetroArch's RAM directly and narrows candidates as you play.
 *
 * SETUP
 *   1. In the GoldenPie app: switch to Quake II, press Deploy, start a deathmatch.
 *      (The app already enables RetroArch network commands on UDP 55355.)
 *   2. In a SECOND terminal:  node quake-frag-finder.js
 *
 * USAGE (type these at the  finder>  prompt)
 *   scan            Take the first snapshot of the whole region (candidates = everything).
 *   inc             Keep only bytes that INCREASED since the last snapshot. Run this
 *                   right AFTER you get one frag. Repeat: frag, inc, frag, inc...
 *   same            Keep only bytes that did NOT change (run after a moment of no frags
 *                   to kill noise/timers).
 *   dec             Keep only bytes that decreased.
 *   eq <n>          Keep only bytes whose current value == n.
 *   list            Print the surviving candidate addresses (when few remain).
 *   region <s> <e>  Set scan region (hex, no 0x). Default 80100000 80200000.
 *                   Full N64 RAM (8MB, Quake needs the Expansion Pak): 80000000 80800000
 *   reset           Forget candidates and re-scan the region.
 *   quit
 *
 * GOAL: after 2-4 frags you should be down to a handful of addresses. The one that
 * goes up by exactly your frag count is Player 1's frag byte. Tell Claude that address.
 */

const dgram = require('dgram');
const readline = require('readline');

const PORT = 55355;
const HOST = '127.0.0.1';
const CHUNK = 256;            // bytes per READ_CORE_MEMORY request
const READ_TIMEOUT = 1500;    // ms per request

let region = { start: 0x80100000, end: 0x80200000 };
let snapshot = null;          // Uint8Array over the region
let candidates = null;        // Set<address> ; null === "all addresses in region"

const sock = dgram.createSocket('udp4');
sock.on('error', (e) => console.error('UDP error:', e.message));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'finder> ' });

function hex(n) { return n.toString(16).toUpperCase(); }

// Read `count` bytes starting at absolute address `addr`. Returns int[] (length may be < count on error).
function readChunk(addr, count) {
  return new Promise((resolve) => {
    const cmd = `READ_CORE_MEMORY ${hex(addr)} ${count}`;
    const timer = setTimeout(() => { sock.removeListener('message', onMsg); resolve([]); }, READ_TIMEOUT);
    function onMsg(msg) {
      const parts = msg.toString().trim().split(/\s+/);
      // "READ_CORE_MEMORY <addr> <b0> <b1> ..."  (or an error like "-1")
      if (parts[0] !== 'READ_CORE_MEMORY') return; // not ours; keep waiting
      clearTimeout(timer);
      sock.removeListener('message', onMsg);
      const bytes = parts.slice(2).map(h => parseInt(h, 16)).filter(v => !Number.isNaN(v));
      resolve(bytes);
    }
    sock.on('message', onMsg);
    sock.send(cmd, PORT, HOST, (err) => { if (err) { clearTimeout(timer); sock.removeListener('message', onMsg); resolve([]); } });
  });
}

async function scanRegion() {
  const size = region.end - region.start;
  const buf = new Uint8Array(size);
  let ok = 0;
  process.stdout.write(`Scanning 0x${hex(region.start)}–0x${hex(region.end)} (${(size/1024).toFixed(0)} KB)... `);
  for (let off = 0; off < size; off += CHUNK) {
    const n = Math.min(CHUNK, size - off);
    const bytes = await readChunk(region.start + off, n);
    for (let i = 0; i < bytes.length && i < n; i++) { buf[off + i] = bytes[i] & 0xff; ok++; }
    if ((off / CHUNK) % 64 === 0) process.stdout.write('.');
  }
  process.stdout.write(` done (${ok}/${size} bytes read)\n`);
  return buf;
}

function candidateList() {
  if (candidates === null) {
    return null; // all
  }
  return [...candidates];
}

async function filter(kind, arg) {
  if (!snapshot) { console.log('Run "scan" first.'); return; }
  const next = await scanRegion();
  const keep = new Set();
  const iterate = (cb) => {
    if (candidates === null) {
      for (let off = 0; off < next.length; off++) cb(region.start + off, off);
    } else {
      for (const addr of candidates) { const off = addr - region.start; if (off >= 0 && off < next.length) cb(addr, off); }
    }
  };
  iterate((addr, off) => {
    const o = snapshot[off], n = next[off];
    let ok = false;
    if (kind === 'inc') ok = n > o;
    else if (kind === 'dec') ok = n < o;
    else if (kind === 'same') ok = n === o;
    else if (kind === 'changed') ok = n !== o;
    else if (kind === 'eq') ok = n === arg;
    if (ok) keep.add(addr);
  });
  candidates = keep;
  snapshot = next;
  console.log(`Candidates: ${keep.size}`);
  if (keep.size > 0 && keep.size <= 40) printCandidates();
  else if (keep.size > 40) console.log('(too many to list — get another frag and run "inc" again, or "same" to drop noise)');
}

function printCandidates() {
  const list = candidateList();
  if (list === null) { console.log('All addresses are candidates — run a filter first.'); return; }
  list.sort((a, b) => a - b);
  for (const addr of list) console.log(`   0x${hex(addr)} = ${snapshot[addr - region.start]}`);
}

console.log('Quake frag finder. Make sure Quake II is running (Deploy in the app) and you are IN a deathmatch.');
console.log(`Region: 0x${hex(region.start)}–0x${hex(region.end)}.  Type "scan", then frag + "inc" repeatedly. "quit" to exit.\n`);
rl.prompt();

rl.on('line', async (line) => {
  const [cmd, a, b] = line.trim().split(/\s+/);
  try {
    switch ((cmd || '').toLowerCase()) {
      case 'scan':
      case 'reset':
        candidates = null;
        snapshot = await scanRegion();
        console.log('Baseline captured. Now get ONE frag and type "inc".');
        break;
      case 'inc': await filter('inc'); break;
      case 'dec': await filter('dec'); break;
      case 'same': await filter('same'); break;
      case 'changed': await filter('changed'); break;
      case 'eq': await filter('eq', parseInt(a, 10)); break;
      case 'list': printCandidates(); break;
      case 'region':
        if (a && b) { region = { start: parseInt(a, 16), end: parseInt(b, 16) }; snapshot = null; candidates = null; console.log(`Region set to 0x${hex(region.start)}–0x${hex(region.end)}. Run "scan".`); }
        else console.log('usage: region <startHex> <endHex>   e.g. region 80000000 80800000');
        break;
      case 'quit': case 'exit': sock.close(); rl.close(); return;
      case '': break;
      default: console.log('commands: scan, inc, dec, same, changed, eq <n>, list, region <s> <e>, reset, quit');
    }
  } catch (e) { console.error('Error:', e.message); }
  rl.prompt();
});

rl.on('close', () => { try { sock.close(); } catch (_) {} process.exit(0); });
