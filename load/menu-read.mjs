#!/usr/bin/env node
/**
 * Public menu read load ramp. Read-only GET traffic, one run per invocation.
 *
 * Usage:
 *   node load/menu-read.mjs <full-url>
 *   node load/menu-read.mjs "https://100.57.8.66.nip.io/api/v1/public/restaurants/main-branch/menu?locale=en"
 *
 * The target URL is required; its port and query string are preserved.
 * Stages: 10/25/50 VUs x 15s, 100 VUs x 10s (keep-alive, closed-loop).
 * Reports rps and p50/p95/p99 latency per stage.
 * Exits 1 if any transport error or non-200 response occurs, 2 on usage errors.
 */
import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';

const targetArg = process.argv[2];
if (!targetArg) {
  console.error('usage: node load/menu-read.mjs <full-url>');
  process.exit(2);
}
let target;
try {
  target = new URL(targetArg);
} catch {
  console.error(`invalid URL: ${targetArg}`);
  process.exit(2);
}
if (target.protocol !== 'http:' && target.protocol !== 'https:') {
  console.error(`unsupported protocol: ${target.protocol} (use http: or https:)`);
  process.exit(2);
}

const mod = target.protocol === 'https:' ? https : http;
const requestPath = `${target.pathname}${target.search}`;
const agent = new mod.Agent({ keepAlive: true, maxSockets: 100 });

const stages = [
  { vu: 10, secs: 15 },
  { vu: 25, secs: 15 },
  { vu: 50, secs: 15 },
  { vu: 100, secs: 10 },
];

function once() {
  return new Promise((resolve) => {
    const start = performance.now();
    const req = mod.request(
      {
        agent,
        hostname: target.hostname,
        port: target.port || undefined,
        path: requestPath,
        method: 'GET',
        headers: { accept: 'application/json' },
        timeout: 30_000,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ ms: performance.now() - start, status: res.statusCode }));
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
  const failures = samples.filter((s) => s.status !== 200);
  return {
    vu,
    secs,
    requests: samples.length,
    rps: +(samples.length / elapsedSec).toFixed(1),
    p50: +percentile(latencies, 50).toFixed(0),
    p95: +percentile(latencies, 95).toFixed(0),
    p99: +percentile(latencies, 99).toFixed(0),
    max: +(latencies.at(-1) ?? 0).toFixed(0),
    non200: failures.length,
    transportErrors: failures.filter((s) => s.status === 0).length,
  };
}

const results = [];
for (const stage of stages) {
  process.stderr.write(`stage: ${stage.vu} VUs x ${stage.secs}s ...\n`);
  const row = await runStage(stage);
  results.push(row);
  process.stderr.write(`${JSON.stringify(row)}\n`);
}

const totals = results.reduce(
  (acc, r) => ({
    requests: acc.requests + r.requests,
    non200: acc.non200 + r.non200,
    transportErrors: acc.transportErrors + r.transportErrors,
  }),
  { requests: 0, non200: 0, transportErrors: 0 },
);
console.log(JSON.stringify({ target: target.href, requestPath, results, totals }, null, 2));

if (totals.non200 > 0) {
  console.error(
    `FAIL: ${totals.non200} non-200 response(s) (${totals.transportErrors} transport error(s))`,
  );
  process.exit(1);
}
