// Build a publishable / shareable release of dsh-task-cost from the workspace
// source. The source package.json is already publish-ready; this script stages
// the runtime files, swaps in the user-facing README, and can pack a tarball
// installable via `dsh plugin --profile web add <tgz>`.
//
// Usage:
//   node scripts/build-release.mjs                                  # stage only
//   node scripts/build-release.mjs --pack                           # stage + tarball
//   node scripts/build-release.mjs --name <name> --version <ver>    # publish under another name
//   node scripts/build-release.mjs --repo https://github.com/<you>/dsh-task-cost --pack

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const has = (name) => args.includes(name);

const source = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
const name = flag('--name') ?? source.name;
const version = flag('--version') ?? source.version;
const repo = flag('--repo');
const outDir = join(pluginDir, flag('--out') ?? 'dist');

if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) {
  throw new Error(`invalid package name: ${name}`);
}

const stage = join(outDir, 'stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

/** Copy one source-relative file into the stage, keeping its relative path. */
function copy(relativePath, as = relativePath) {
  const from = join(pluginDir, relativePath);
  if (!existsSync(from)) throw new Error(`missing release file: ${relativePath}`);
  const to = join(stage, as);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'LICENSE']) copy(file);
for (const file of readdirSync(join(pluginDir, 'locale'))) copy(join('locale', file));

// The shipped README is the user-facing one, not the development notes.
writeFileSync(join(stage, 'README.md'), readFileSync(join(pluginDir, 'docs', 'README.dist.md'), 'utf8'));

// Rewrite the bundle row name and the browser module id when publishing under
// another package name; both must equal the npm package name.
const patch = readFileSync(join(pluginDir, 'cordis.patch.yml'), 'utf8').replace(
  /^(\s*name:\s*)(\S+)$/m,
  `$1${name}`,
);
if (!patch.includes(`name: ${name}`)) throw new Error('could not rewrite the bundle row name');
writeFileSync(join(stage, 'cordis.patch.yml'), patch);

const client = readFileSync(join(pluginDir, 'client.js'), 'utf8').replace(
  /id: 'dsh-task-cost'/,
  `id: '${name}'`,
);
if (!client.includes(`id: '${name}'`)) throw new Error('could not rewrite the browser module id');
writeFileSync(join(stage, 'client.js'), client);

const manifest = {
  ...source,
  name,
  version,
  files: ['index.js', 'client.js', 'cordis.patch.yml', 'locale/*.json', 'icon.svg', 'README.md', 'LICENSE'],
};
delete manifest.private;
delete manifest.devDependencies;
if (repo !== undefined) {
  const base = repo.replace(/\.git$/, '');
  manifest.repository = { type: 'git', url: `git+${base}.git` };
  manifest.homepage = `${base}#readme`;
  manifest.bugs = { url: `${base}/issues` };
}
writeFileSync(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Sanity checks before packing: every declared file resolves, and the row and
// the browser module id agree with the published name.
const pkg = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'));
if (pkg.name !== name || pkg.version !== version) throw new Error('manifest name/version mismatch');
for (const entry of pkg.files) {
  if (entry.includes('*')) {
    if (!existsSync(join(stage, dirname(entry)))) throw new Error(`declared directory missing: ${dirname(entry)}`);
  } else if (!existsSync(join(stage, entry))) {
    throw new Error(`declared file missing: ${entry}`);
  }
}

const summary = {
  stage,
  name,
  version,
  bytes: 0,
  files: [],
};
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      summary.files.push(relative(stage, full).replace(/\\/g, '/'));
      summary.bytes += statSync(full).size;
    }
  }
};
walk(stage);

if (has('--pack')) {
  const log = execFileSync('npm', ['pack', '--silent'], { cwd: stage, encoding: 'utf8', shell: true }).trim();
  const tarball = join(stage, log.split(/\r?\n/).filter(Boolean).pop());
  const hash = createHash('sha256').update(readFileSync(tarball)).digest('hex');
  const finalTarball = join(outDir, `${name.replace('/', '-').replace('@', '')}-${version}.tgz`);
  copyFileSync(tarball, finalTarball);
  summary.tarball = finalTarball;
  summary.tarballBytes = statSync(finalTarball).size;
  summary.sha256 = hash;
}

console.log(JSON.stringify(summary, null, 2));
