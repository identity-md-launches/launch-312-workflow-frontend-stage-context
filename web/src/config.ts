import { createPublicClient, custom, defineChain, fallback, http, isAddress, keccak256, stringToHex, type Abi, type Address, type EIP1193Provider, type Transport } from 'viem';
import { canonical } from './canonical';

export type Contract = { name: string; address: Address; abiHash: string; abiPath: string; abi: Abi };
export type Deployment = {
  version: number; launchId: string; chainId: number; sourceCommit: string; attestationHash: string;
  contracts: Contract[]; assets: { path: string; sha256: string }[];
  network: { chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number }; faucets: string[];
    uniswapV4: Record<string, Address> };
  walletAddChain: { chainId: string; chainName: string; rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] };
};
export type Runtime = { deployment: Deployment; app: Contract; token: Contract; chain: ReturnType<typeof defineChain> };
export type Wallet = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
declare global { interface Window { ethereum?: Wallet } }

function relative(path: string) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').includes('..')) throw Error('Unsafe ABI path');
  return path;
}
export async function loadRuntime(): Promise<Runtime> {
  const response = await fetch(`${import.meta.env.BASE_URL}imd-deployment.json`, { cache: 'no-cache' });
  if (!response.ok) throw Error('Deployment configuration is unavailable. Reload to retry.');
  const deployment: Deployment = await response.json();
  if (deployment.version !== 1 || deployment.chainId !== deployment.network.chainId ||
    Number(BigInt(deployment.walletAddChain.chainId)) !== deployment.chainId || !deployment.network.rpcUrls.length ||
    !/^[a-f0-9]{64}$/.test(deployment.attestationHash)) throw Error('Deployment configuration is invalid.');
  deployment.contracts = await Promise.all(deployment.contracts.map(async contract => {
    if (!isAddress(contract.address)) throw Error('Invalid deployed address');
    const response = await fetch(`${import.meta.env.BASE_URL}${relative(contract.abiPath)}`);
    if (!response.ok) throw Error(`Unable to load ${contract.name} ABI. Reload to retry.`);
    const abi: Abi = await response.json();
    if (!Array.isArray(abi) || keccak256(stringToHex(canonical(abi))).slice(2) !== contract.abiHash) throw Error(`${contract.name} ABI verification failed. Actions are disabled.`);
    return { ...contract, abi };
  }));
  const app = deployment.contracts.find(item => item.name === 'CrowdfundCampaigns');
  const token = deployment.contracts.find(item => item.name === 'LaunchToken');
  if (!app || !token) throw Error('Required contracts are missing.');
  const chain = defineChain({ id: deployment.chainId, name: deployment.network.name,
    nativeCurrency: deployment.network.nativeCurrency,
    rpcUrls: { default: { http: deployment.network.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: deployment.network.explorer } },
    testnet: deployment.network.testnet });
  return { deployment, app, token, chain };
}
export function publicClient(runtime: Runtime, wallet?: Wallet, walletChain?: number) {
  const transports: Transport[] = runtime.deployment.network.rpcUrls.map(url => http(url, { timeout: 7000, retryCount: 0, batch: true }));
  if (wallet && walletChain === runtime.chain.id) transports.push(custom(wallet, { retryCount: 0 }));
  return createPublicClient({ chain: runtime.chain, transport: fallback(transports, { retryCount: 0 }) });
}
export type Reader = ReturnType<typeof publicClient>;
