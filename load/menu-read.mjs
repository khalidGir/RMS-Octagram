#!/usr/bin/env node
/**
 * Public menu read load ramp against a staging/production API.
 *
 * Usage:
 *   node load/menu-read.mjs [baseUrl] [menuPath]
 *   node load/menu-read.mjs https://100.57.8.66.nip.io /api/v1/public/restaurants/main-branch/menu
 *
 * Stages: 10/25/50 VUs x 15s, 100 VUs x 10s (keep-alive, closed-loop).
 * Reports rps and p50/p95/p99 latency per stage. Read-only GET traffic.
 */
import https from 'node:https';
import { performance } from 'node:perf_hooks';

const baseUrl = process.argv[2] ?? 'https://100.57.8.66.nip.io';
const menuPath = process.argv[3] ?? '/api/v1/public/restaurants/main-branch/menu';
const stages = [
  { vu: 10, secs: 15 },
  { vu: 25, secs: 15 },
  { vu: 50, secs: 15 },
  { vu: 100, secs: 10 },
];

const agent = new https.Agent({ keepAlive: true, maxSockets: 100 });
const target = new URL(menuPath, baseUrl);

function once() {
  return new Promise((resolve) => {
    const start = performance.now();
    const req = https.request(
      {
        agent,
        hostname: target.hostname,
        path: target.pathname,
        method: 'GET',
        headers: { accept: 'application/json' },
        timeout: 30_000,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () =>
          resolve({ ms: performance.now() - start, status: res.statusCode }),
        );
      },
    );
    req.on('error', () => resolve({ ms: performance.now() - start, status: 0 }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ms: performance.now() - start, status: 0 });
    });
    req.end();
  });
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function runStage({ vu, secs }) {
  const samples = [];
  const deadline = Date.now() + secs * 1000;
  const workers = Array.from({ length: vu }, async () => {
    while (Date.now() < deadline) samples.push(await once());
  });
  const t0 = performance.now();
  await Promise.all(workers);
  const elapsedSec = (performance.now() - t0) / 1000;
  const latencies = samples.map((s) => s.ms).sort((a, b) => a - b);
  const errors = samples.filter((s) => s.status !== 200).length;
  return {
    vu,
    secs,
    requests: samples.length,
    rps: +(samples.length / elapsedSec).toFixed(1),
    p50: +percentile(latencies, 50).toFixed(0),
    p95: +percentile(latencies, 95).toFixed(0),
    p99: +percentile(latencies, 99).toFixed(0),
    max: +(latencies.at(-1) ?? 0).toFixed(0),
    non200: errors,
  };
}

const results = [];
for (const stage of stages) {
  process.stderr.write(`stage: ${stage.vu} VUs x ${stage.secs}s ...\n`);
  const row = await runStage(stage);
  results.push(row);
  process.stderr.write(`${JSON.stringify(row)}\n`);
}
console.log(JSON.stringify({ target: target.href, results }, null, 2));
