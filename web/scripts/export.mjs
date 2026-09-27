import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { keccak256, stringToHex } from 'viem';
import { canonical } from '../src/canonical.ts';

const root = resolve(import.meta.dirname, '../..');
const handoff = JSON.parse(await readFile(resolve(root, 'web/config/deployment.json'), 'utf8'));
const network = JSON.parse(await readFile(resolve(root, 'web/config/network.json'), 'utf8'));
const prepare = process.argv.includes('--prepare');
const out = resolve(root, prepare ? 'web/public' : 'dist');
if (prepare) await rm(out, { recursive: true, force: true });
await mkdir(resolve(out, 'abi'), { recursive: true });
if (handoff.chainId !== network.network.chainId || Number(BigInt(network.walletAddChain.chainId)) !== handoff.chainId) throw Error('Network mismatch');
const contracts = [];
for (const contract of handoff.contracts) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(contract.name)) throw Error('Invalid contract name');
  const path = `docs/abi/${contract.name}.json`;
  const pinned = execFileSync('git', ['show', `${handoff.sourceCommit}:${path}`], { cwd: root });
  const local = await readFile(resolve(root, path));
  if (!pinned.equals(local)) throw Error(`${path} differs from pinned source`);
  const abi = JSON.parse(pinned.toString());
  const hash = keccak256(stringToHex(canonical(abi))).slice(2);
  if (!Array.isArray(abi) || hash !== contract.abiHash) throw Error(`ABI hash mismatch: ${contract.name}: ${hash}`);
  const abiPath = `abi/${contract.name}.json`;
  await writeFile(resolve(out, abiPath), pinned);
  contracts.push({ name: contract.name, address: contract.address, abiHash: contract.abiHash, abiPath });
  console.log(`Verified pinned ABI ${contract.name}: ${hash}`);
}
async function files(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = prefix + entry.name;
    if (entry.isSymbolicLink()) throw Error('Symlinks are not export assets');
    if (entry.isDirectory()) result.push(...await files(resolve(dir, entry.name), path + '/'));
    else if (path !== 'imd-deployment.json') result.push(path);
  }
  return result.sort();
}
const assets = [];
let bytes = 0;
for (const path of await files(out)) {
  const content = await readFile(resolve(out, path));
  if (content.length > 8388608) throw Error(`Oversized asset: ${path}`);
  bytes += content.length;
  assets.push({ path, sha256: createHash('sha256').update(content).digest('hex') });
}
if (assets.length > 128 || bytes >= 8 * 1024 * 1024) throw Error('Export exceeds submission budget');
const manifest = { version: 1, launchId: handoff.launchId, chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit, attestationHash: handoff.attestationHash,
  contracts, assets, network: network.network, walletAddChain: network.walletAddChain };
await writeFile(resolve(out, 'imd-deployment.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Manifest generated after export: ${assets.length} assets, ${bytes} bytes`);
