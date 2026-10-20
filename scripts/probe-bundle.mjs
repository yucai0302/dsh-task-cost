// Probe the running DSH web host's client module response table for one Loader
// entry id, without authentication. The route only serves exact
// `/plugins/??<id>/client.js&rev=<sha1>` URLs that the host published, so a 200
// proves the row is composed into the live client module graph.
//
// Usage: node probe-bundle.mjs <entryId> <absoluteClientJsPath> [baseUrl]

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';

const [entryId, clientPath, baseUrl = 'http://127.0.0.1:3080'] = process.argv.slice(2);
if (!entryId || !clientPath) {
  console.error('usage: node probe-bundle.mjs <entryId> <absoluteClientJsPath> [baseUrl]');
  process.exit(2);
}

const HASH_REVISION_LENGTH = 12;
function framedHash(domain, parts) {
  const hash = createHash('sha1').update(domain).update('\0');
  for (const part of parts) hash.update(`${String(Buffer.byteLength(part))}:`).update(part);
  return hash.digest('hex').slice(0, HASH_REVISION_LENGTH);
}
const stat = statSync(clientPath);
const rev = framedHash('plugin-artifact', [String(stat.mtimeMs), String(stat.ctimeMs), String(stat.size)]);
const url = `${baseUrl}/plugins/??${entryId}/client.js&rev=${rev}`;
const response = await fetch(url);
const body = await response.text();
console.log(JSON.stringify({
  entryId,
  clientPath,
  baseline: { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, size: stat.size },
  rev,
  url,
  status: response.status,
  contentType: response.headers.get('content-type'),
  bytes: Buffer.byteLength(body),
  head: body.slice(0, 120),
}, null, 2));
process.exit(response.status === 200 ? 0 : 1);
