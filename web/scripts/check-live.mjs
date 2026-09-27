import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, http } from 'viem';

const root = resolve(import.meta.dirname, '../..');
const deployment = JSON.parse(await readFile(resolve(root, 'dist/imd-deployment.json'), 'utf8'));
const results = { checkedAt: new Date().toISOString(), purpose: 'Read-only RPC verification; no transaction or signature requested', chainId: deployment.chainId, attempts: [] };
for (const url of deployment.network.rpcUrls) {
  const client = createPublicClient({ transport: http(url, { timeout: 12000, retryCount: 0 }) });
  try {
    const chainId = await client.getChainId();
    if (chainId !== deployment.chainId) throw Error('RPC chain mismatch');
    const block = await client.getBlock();
    const contracts = await Promise.all(deployment.contracts.map(async contract => {
      const code = await client.getCode({ address: contract.address, blockNumber: block.number });
      if (!code || code === '0x') throw Error(`Missing code at ${contract.name}`);
      return { name: contract.name, address: contract.address, runtimeBytes: (code.length - 2) / 2 };
    }));
    const app = deployment.contracts.find(contract => contract.name === 'CrowdfundCampaigns');
    const abi = JSON.parse(await readFile(resolve(root, 'dist', app.abiPath), 'utf8'));
    const read = functionName => client.readContract({ address: app.address, abi, functionName, blockNumber: block.number });
    const [token, count, escrowed] = await Promise.all([read('token'), read('campaignCount'), read('totalEscrowed')]);
    if (token.toLowerCase() !== deployment.contracts.find(contract => contract.name === 'LaunchToken').address.toLowerCase()) throw Error('Immutable token mismatch');
    results.attempts.push({ url, status: 'passed', chainId, block: block.number.toString(), blockTimestamp: block.timestamp.toString(), contracts, token, campaignCount: count.toString(), totalEscrowed: escrowed.toString() });
  } catch (error) { results.attempts.push({ url, status: 'unavailable', error: error.shortMessage || error.message }); }
}
await writeFile(resolve(root, 'docs/evidence/live-check.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
if (!results.attempts.some(attempt => attempt.status === 'passed')) process.exitCode = 1;
