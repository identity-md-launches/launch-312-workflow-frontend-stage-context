import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { keccak256, stringToHex } from 'viem';
import { canonical } from '../src/canonical.ts';

const root = resolve(import.meta.dirname, '../..');
const read = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const manifest = await read('dist/imd-deployment.json');
const deployment = await read('web/config/deployment.json');
const network = await read('web/config/network.json');
for (const key of ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash']) assert.deepEqual(manifest[key], deployment[key]);
assert.deepEqual(manifest.network, network.network);
assert.deepEqual(manifest.walletAddChain, network.walletAddChain);
assert.deepEqual(manifest.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })), deployment.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })));
const files = (await readdir(resolve(root, 'dist'), { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => resolve(entry.parentPath, entry.name).slice(resolve(root, 'dist').length + 1)).filter(path => path !== 'imd-deployment.json').sort();
assert.deepEqual(manifest.assets.map(asset => asset.path).sort(), files);
assert(files.includes('index.html') && files.length <= 128);
let bytes = 0;
for (const asset of manifest.assets) {
  assert(!asset.path.startsWith('/') && !asset.path.includes('..') && !asset.path.includes(':'));
  const content = await readFile(resolve(root, 'dist', asset.path));
  bytes += content.length;
  assert(content.length <= 8388608);
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.equal(createHash('sha256').update(content).digest('hex'), asset.sha256);
}
for (const contract of manifest.contracts) {
  assert(files.includes(contract.abiPath));
  assert.equal(keccak256(stringToHex(canonical(await read(`dist/${contract.abiPath}`)))).slice(2), contract.abiHash);
}
assert(bytes < 8 * 1024 * 1024);
const html = await readFile(resolve(root, 'dist/index.html'), 'utf8');
assert(!/(?:src|href)="\/(?!\/)/.test(html));
console.log(`PASS: exact deployment/network binding; ${files.length} inventoried assets; every SHA-256 and ABI Keccak verified; ${bytes} asset bytes; relative HTML assets.`);
