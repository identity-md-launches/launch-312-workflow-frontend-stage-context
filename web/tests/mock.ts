import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeFunctionData, encodeErrorResult, encodeFunctionResult, parseEther, stringToHex, toHex, type Abi, type Address, type Hex } from 'viem';
import type { Page } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
export const deployment = JSON.parse(readFileSync(resolve(root, 'dist/imd-deployment.json'), 'utf8'));
export const app = deployment.contracts.find((c: { name: string }) => c.name === 'CrowdfundCampaigns');
export const token = deployment.contracts.find((c: { name: string }) => c.name === 'LaunchToken');
export const appAbi: Abi = JSON.parse(readFileSync(resolve(root, 'dist', app.abiPath), 'utf8'));
export const tokenAbi: Abi = JSON.parse(readFileSync(resolve(root, 'dist', token.abiPath), 'utf8'));
export const ACCOUNT: Address = '0x1000000000000000000000000000000000000001';
export const CREATOR: Address = '0x2000000000000000000000000000000000000002';
export const HASH = `0x${'ab'.repeat(32)}` as Hex;
type Rpc = { method: string; params?: unknown[]; id?: number };
type StoredCampaign = { creator: Address; goal: bigint; deadline: bigint; title: Hex; total: bigint; claimed: boolean };

export class MockChain {
  now = BigInt(Math.floor(Date.now() / 1000));
  chain = deployment.walletAddChain.chainId;
  account: Address = ACCOUNT;
  connected = false;
  missingChain = false;
  addedChain = false;
  reject = false;
  failRpc = false;
  missingCode = false;
  badToken = false;
  revert = '';
  delay = 0;
  balance = parseEther('2500');
  allowance = 0n;
  calls: Rpc[] = [];
  sent: { functionName: string; args: readonly unknown[]; to: string }[] = [];
  receipts = new Map<string, Record<string, unknown>>();
  campaigns: StoredCampaign[] = [
    { creator: CREATOR, goal: parseEther('1000'), deadline: this.now + 604800n, title: stringToHex('A tiny community library', { size: 32 }), total: parseEther('640'), claimed: false },
    { creator: CREATOR, goal: parseEther('1000'), deadline: this.now + 86400n, title: stringToHex('A seed for the neighbourhood', { size: 32 }), total: parseEther('1200'), claimed: false },
    { creator: CREATOR, goal: parseEther('500'), deadline: this.now - 3600n, title: stringToHex('Make room for more ideas', { size: 32 }), total: parseEther('525'), claimed: false },
    { creator: CREATOR, goal: parseEther('200'), deadline: this.now - 3600n, title: stringToHex('The little weekend experiment', { size: 32 }), total: parseEther('40'), claimed: false },
  ];
  pledges = new Map<bigint, bigint>([[1n, parseEther('50')], [2n, parseEther('30')], [4n, parseEther('10')]]);
  block() { return { number: '0xb40000', hash: HASH, parentHash: HASH, nonce: '0x0000000000000000', sha3Uncles: HASH, logsBloom: `0x${'00'.repeat(256)}`, transactionsRoot: HASH, stateRoot: HASH, receiptsRoot: HASH, miner: CREATOR, difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', size: '0x100', gasLimit: '0x1c9c380', gasUsed: '0x5208', timestamp: toHex(this.now), transactions: [], uncles: [], baseFeePerGas: '0x1' }; }
  async handle(rpc: Rpc, wallet = false): Promise<unknown> {
    this.calls.push(rpc);
    const params = rpc.params ?? [];
    if (wallet && this.reject && ['eth_requestAccounts', 'eth_sendTransaction', 'wallet_switchEthereumChain'].includes(rpc.method)) throw { code: 4001, message: 'User rejected the request' };
    switch (rpc.method) {
      case 'eth_chainId': return wallet ? this.chain : deployment.walletAddChain.chainId;
      case 'eth_requestAccounts': this.connected = true; return [this.account];
      case 'eth_accounts': return this.connected ? [this.account] : [];
      case 'wallet_switchEthereumChain': if (this.missingChain && !this.addedChain) throw { code: 4902, message: 'Unknown chain' }; this.chain = (params[0] as { chainId: string }).chainId; return null;
      case 'wallet_addEthereumChain': this.addedChain = true; return null;
      case 'eth_getCode': return this.missingCode ? '0x' : '0x60006000';
      case 'eth_getBlockByNumber': return this.block();
      case 'eth_blockNumber': return '0xb40000';
      case 'eth_estimateGas': return '0x186a0';
      case 'eth_gasPrice': return '0x1';
      case 'eth_getTransactionCount': return '0x0';
      case 'eth_getTransactionReceipt': return this.receipts.get(params[0] as string) ?? null;
      case 'eth_call': return this.contract(params[0] as { to: string; data: Hex }, false);
      case 'eth_sendTransaction': {
        const tx = params[0] as { to: string; data: Hex };
        this.contract(tx, true);
        const hash = toHex(this.sent.length, { size: 32 });
        this.receipts.set(hash, { transactionHash: hash, transactionIndex: '0x0', blockHash: HASH, blockNumber: '0xb40000', from: this.account, to: tx.to, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', contractAddress: null, logs: [], logsBloom: `0x${'00'.repeat(256)}`, status: '0x1', effectiveGasPrice: '0x1', type: '0x2' });
        return hash;
      }
      default: throw { code: -32601, message: `Unhandled mock RPC ${rpc.method}` };
    }
  }
  contract(tx: { to: string; data: Hex }, mutate: boolean) {
    const isToken = tx.to.toLowerCase() === token.address.toLowerCase();
    const abi = isToken ? tokenAbi : appAbi;
    const decoded = decodeFunctionData({ abi, data: tx.data });
    const args = decoded.args ?? [];
    const c = this.campaigns[Number(args[0]) - 1];
    const id = args[0] as bigint;
    const value = args[1] as bigint;
    const write = ['approve', 'create', 'pledge', 'unpledge', 'claim', 'refund'].includes(decoded.functionName);
    if (write && this.revert) throw { code: 3, message: 'execution reverted', data: encodeErrorResult({ abi: appAbi, errorName: this.revert }) };
    let result: unknown;
    switch (decoded.functionName) {
      case 'token': result = this.badToken ? CREATOR : token.address; break;
      case 'campaignCount': result = BigInt(this.campaigns.length); break;
      case 'totalEscrowed': result = this.campaigns.reduce((sum, campaign) => sum + (campaign.claimed ? 0n : campaign.total), 0n); break;
      case 'decimals': result = 18; break;
      case 'balanceOf': result = this.account === ACCOUNT ? this.balance : 0n; break;
      case 'allowance': result = this.account === ACCOUNT ? this.allowance : 0n; break;
      case 'campaign': result = c; break;
      case 'pledgeOf': result = this.account === ACCOUNT ? this.pledges.get(id) ?? 0n : 0n; break;
      case 'approve': result = true; if (mutate) this.allowance = value; break;
      case 'create': result = BigInt(this.campaigns.length + 1); if (mutate) this.campaigns.push({ creator: this.account, goal: args[0] as bigint, deadline: value, title: args[2] as Hex, total: 0n, claimed: false }); break;
      case 'pledge': if (mutate) { c.total += value; this.balance -= value; this.allowance -= value; this.pledges.set(id, (this.pledges.get(id) ?? 0n) + value); } break;
      case 'unpledge': if (mutate) { c.total -= value; this.balance += value; this.pledges.set(id, (this.pledges.get(id) ?? 0n) - value); } break;
      case 'claim': if (mutate) c.claimed = true; break;
      case 'refund': if (mutate) { this.balance += this.pledges.get(id) ?? 0n; this.pledges.set(id, 0n); } break;
      default: throw Error(`Unhandled mock contract call: ${decoded.functionName}`);
    }
    if (mutate) this.sent.push({ functionName: decoded.functionName, args, to: tx.to });
    return encodeFunctionResult({ abi, functionName: decoded.functionName, result });
  }
}

export async function mock(page: Page, chain = new MockChain(), injectWallet = true) {
  await page.route(url => deployment.network.rpcUrls.some((rpc: string) => url.href.startsWith(rpc)), async route => {
    if (chain.delay) await new Promise(resolve => setTimeout(resolve, chain.delay));
    if (chain.failRpc) { await route.abort('failed'); return; }
    const requests: Rpc | Rpc[] = route.request().postDataJSON();
    const run = async (rpc: Rpc) => {
      try { return { jsonrpc: '2.0', id: rpc.id, result: await chain.handle(rpc) }; }
      catch (error) { return { jsonrpc: '2.0', id: rpc.id, error }; }
    };
    const response = Array.isArray(requests) ? await Promise.all(requests.map(run)) : await run(requests);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  if (injectWallet) {
    await page.exposeFunction('__walletRequest', async (rpc: Rpc) => {
      try { return { result: await chain.handle(rpc, true) }; }
      catch (error) { return { error }; }
    });
    await page.addInitScript(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      Object.assign(window, {
        ethereum: {
          request: async (rpc: unknown) => {
            const response = await (window as unknown as { __walletRequest: (rpc: unknown) => Promise<{ result: unknown; error?: unknown }> }).__walletRequest(rpc);
            if (response.error) throw response.error;
            return response.result;
          },
          on: (event: string, fn: (...args: unknown[]) => void) => { (listeners[event] ??= []).push(fn); },
          removeListener: (event: string, fn: (...args: unknown[]) => void) => { listeners[event] = (listeners[event] ?? []).filter(listener => listener !== fn); },
        },
        __emit: (event: string, value: unknown) => listeners[event]?.forEach(fn => fn(value)),
      });
    });
  }
  return chain;
}
