// Verify the running DSH web Host serves this plugin's *current* client bundle.
//
// The module route only answers exact `/plugins/??<id>/client.js&rev=<sha1>`
// URLs published at composition time, where <id> is the package name. A 200 with
// byte-identical source (modulo the sourceMappingURL trailer) proves the plugin is
// composed into the live client module graph and the served code is what is on disk.
//
// Usage: node verify-live.mjs [baseUrl]

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3080';
const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const clientPath = join(packageDir, 'client.js');

const HASH_REVISION_LENGTH = 12;
function framedHash(domain, parts) {
  const hash = createHash('sha1').update(domain).update('\0');
  for (const part of parts) hash.update(`${String(Buffer.byteLength(part))}:`).update(part);
  return hash.digest('hex').slice(0, HASH_REVISION_LENGTH);
}

const stat = statSync(clientPath);
const rev = framedHash('plugin-artifact', [String(stat.mtimeMs), String(stat.ctimeMs), String(stat.size)]);
const url = `${baseUrl}/plugins/??${pkg.name}/client.js&rev=${rev}`;
const response = await fetch(url);
const served = await response.text();
const withoutMap = served.split('//# sourceMappingURL=')[0];
// The combo writer terminates the bundle with `;` and appends its
// sourceMappingURL comment; neither belongs to the source bytes on disk.
const normalize = (text) => text.replace(/[\s;]+$/, '');
const source = readFileSync(clientPath, 'utf8');
const moduleId = /id:\s*'([^']+)'/.exec(source)?.[1];
const report = {
  packageName: pkg.name,
  clientPath,
  baseline: { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, size: stat.size },
  rev,
  url,
  status: response.status,
  servedBytes: Buffer.byteLength(served),
  sourceBytes: stat.size,
  contentMatches: normalize(withoutMap) === normalize(source),
  bundleDeclaresItsOwnPackageName: moduleId === pkg.name,
};
console.log(JSON.stringify(report, null, 2));
process.exit(response.status === 200 && report.contentMatches && report.bundleDeclaresItsOwnPackageName ? 0 : 1);
