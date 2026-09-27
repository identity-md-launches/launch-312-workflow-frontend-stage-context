import { BaseError, ContractFunctionRevertedError, createWalletClient, custom, formatUnits, hexToString, maxUint256, parseUnits, stringToHex, type Address, type Hex } from 'viem';
import type { Reader, Runtime, Wallet } from './config';

export type Campaign = { id: bigint; creator: Address; goal: bigint; deadline: bigint; title: Hex; total: bigint; claimed: boolean; pledge: bigint };
export type Snapshot = { campaigns: Campaign[]; count: bigint; escrowed: bigint; balance?: bigint; allowance?: bigint;
  decimals: number; tokenAddress: Address; block: bigint; timestamp: bigint; loadedAt: number };
export const PAGE_SIZE = 6n;
export type Action = { kind: 'create'; goal: bigint; deadline: bigint; title: Hex } |
  { kind: 'approve' | 'pledge' | 'unpledge'; id: bigint; amount: bigint } |
  { kind: 'refund' | 'claim'; id: bigint };

export async function readSnapshot(runtime: Runtime, client: Reader, account: Address | undefined, page: number): Promise<Snapshot> {
  if (await client.getChainId() !== runtime.chain.id) throw Error('RPC returned the wrong network. Refresh to retry.');
  const block = await client.getBlock();
  const blockNumber = block.number;
  const codes = await Promise.all(runtime.deployment.contracts.map(contract => client.getCode({ address: contract.address, blockNumber })));
  if (codes.some(code => !code || code === '0x')) throw Error('Deployed contract code is missing. Actions are disabled.');
  const readApp = (functionName: string, args?: readonly unknown[]) => client.readContract({ ...runtime.app, functionName, args, blockNumber });
  const tokenAddress = await readApp('token') as Address;
  if (tokenAddress.toLowerCase() !== runtime.token.address.toLowerCase()) throw Error('Campaign currency does not match the attested KICK contract. Actions are disabled.');
  // All currency reads and approvals use the application's immutable token() result.
  const readToken = (functionName: string, args?: readonly unknown[]) => client.readContract({ address: tokenAddress, abi: runtime.token.abi, functionName, args, blockNumber });
  const [count, escrowed, decimals, balance, allowance] = await Promise.all([
    readApp('campaignCount'), readApp('totalEscrowed'), readToken('decimals'),
    account ? readToken('balanceOf', [account]) : undefined,
    account ? readToken('allowance', [account, runtime.app.address]) : undefined,
  ]) as [bigint, bigint, number, bigint | undefined, bigint | undefined];
  if (decimals !== 18) throw Error('KICK decimals differ from the approved deployment.');
  const last = count - BigInt(page) * PAGE_SIZE;
  const ids = Array.from({ length: Number(last > PAGE_SIZE ? PAGE_SIZE : last > 0n ? last : 0n) }, (_, i) => last - BigInt(i));
  const campaigns = await Promise.all(ids.map(async id => {
    const [campaign, pledge] = await Promise.all([readApp('campaign', [id]), account ? readApp('pledgeOf', [id, account]) : 0n]);
    return { ...(campaign as Omit<Campaign, 'id' | 'pledge'>), id, pledge: pledge as bigint };
  }));
  return { campaigns, count, escrowed, decimals, balance, allowance, tokenAddress, block: blockNumber, timestamp: block.timestamp, loadedAt: Date.now() };
}
export function amount(value: string, decimals: number): bigint {
  if (!new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${decimals}})?$`).test(value)) throw Error(`Enter a positive KICK amount with up to ${decimals} decimals.`);
  const parsed = parseUnits(value, decimals);
  if (parsed <= 0n || parsed > maxUint256) throw Error('Enter a positive amount within the token limit.');
  return parsed;
}
export function titleBytes(title: string): Hex {
  if (!title.trim() || new TextEncoder().encode(title.trim()).length > 32) throw Error('Use a title of 1–32 UTF-8 bytes. Shorten emoji or accented text if needed.');
  return stringToHex(title.trim(), { size: 32 });
}
export function campaignTitle(campaign: Campaign) {
  try { return hexToString(campaign.title, { size: 32 }).replace(/\0/g, '').trim() || `Campaign #${campaign.id}`; }
  catch { return `Campaign #${campaign.id}`; }
}
export function units(value: bigint | undefined, decimals = 18) {
  return value === undefined ? '—' : formatUnits(value, decimals);
}
export function status(campaign: Campaign, now: bigint) {
  if (campaign.claimed) return 'Claimed';
  if (now < campaign.deadline) return 'Open';
  return campaign.total >= campaign.goal ? 'Funded' : 'Failed';
}
export function errorMessage(error: unknown): string {
  const rejected = (e: unknown, depth = 0): boolean => depth < 8 && typeof e === 'object' && e !== null &&
    (('code' in e && e.code === 4001) || ('cause' in e && rejected(e.cause, depth + 1)));
  if (rejected(error)) return 'Request declined in your wallet. Nothing was submitted. You can try again.';
  if (error instanceof BaseError) {
    const revert = error.walk(e => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError;
    if (revert?.data?.errorName) return `${revert.data.errorName}: the contract rejected this action. Refresh the campaign and check its deadline, balance and allowance.`;
    return `${error.shortMessage} Refresh and try again.`;
  }
  return error instanceof Error ? error.message : 'Unable to complete the request. Refresh and try again.';
}
export async function switchNetwork(runtime: Runtime, wallet: Wallet) {
  const params: [{ chainId: string }] = [{ chainId: runtime.deployment.walletAddChain.chainId }];
  try { await wallet.request({ method: 'wallet_switchEthereumChain', params }); }
  catch (error) {
    const text = `${JSON.stringify(error)} ${error instanceof Error ? error.message : ''}`;
    if (!/4902|unknown chain|unrecognized chain|chain.+not.+(added|configured)/i.test(text)) throw error;
    await wallet.request({ method: 'wallet_addEthereumChain', params: [runtime.deployment.walletAddChain] });
    await wallet.request({ method: 'wallet_switchEthereumChain', params });
  }
}
export async function submitAction(runtime: Runtime, reader: Reader, wallet: Wallet, account: Address, action: Action, report: (message: string, hash?: Hex, pending?: boolean) => void) {
  const assertWallet = async () => {
    const [chain, accounts] = await Promise.all([wallet.request({ method: 'eth_chainId' }), wallet.request({ method: 'eth_accounts' })]);
    if (Number(BigInt(chain)) !== runtime.chain.id || accounts[0]?.toLowerCase() !== account.toLowerCase()) throw Error('Wallet account or network changed. Refresh before trying again.');
  };
  await assertWallet();
  // Reverify chain, deployed code, immutable token, balance and allowance just before signing.
  const fresh = await readSnapshot(runtime, reader, account, 0);
  if (action.kind === 'create') {
    if (action.deadline < fresh.timestamp + 3600n || action.deadline > fresh.timestamp + 7776000n) throw Error('Choose a deadline from 1 hour to 90 days after the current block time.');
  }
  if (action.kind === 'approve' || action.kind === 'pledge') {
    if (action.amount > fresh.balance!) throw Error('Your KICK balance is too low. Choose a smaller pledge.');
    const campaign = await reader.readContract({ ...runtime.app, functionName: 'campaign', args: [action.id] }) as Campaign;
    if (fresh.timestamp >= campaign.deadline) throw Error('This campaign has ended. Refresh to see its settlement actions.');
    if (action.kind === 'pledge' && action.amount > fresh.allowance!) throw Error('Approve this KICK amount before pledging.');
  }
  const isApproval = action.kind === 'approve';
  const contract = isApproval ? { ...runtime.token, address: fresh.tokenAddress } : runtime.app;
  const args = action.kind === 'create' ? [action.goal, action.deadline, action.title] :
    action.kind === 'approve' ? [runtime.app.address, action.amount] :
    'amount' in action ? [action.id, action.amount] : [action.id];
  report('Checking the transaction…');
  const { request } = await reader.simulateContract({ address: contract.address, abi: [...runtime.app.abi, ...runtime.token.abi], functionName: action.kind, args, account });
  await assertWallet();
  report('Confirm the transaction in your wallet.');
  const signer = createWalletClient({ chain: runtime.chain, transport: custom(wallet) });
  const hash = await signer.writeContract(request);
  report('Transaction submitted. Waiting for confirmation…', hash, true);
  let receipt;
  let replacementReason = '';
  let currentHash = hash;
  try {
    receipt = await reader.waitForTransactionReceipt({ hash, timeout: 120_000, onReplaced: replacement => {
      replacementReason = replacement.reason;
      currentHash = replacement.transaction.hash;
      report('Replacement transaction detected. Waiting for confirmation…', currentHash, true);
    } });
  } catch (error) {
    report('Confirmation could not be completed. Check this transaction in the explorer before submitting another.', currentHash, true);
    throw error;
  }
  if (receipt.status !== 'success') {
    report('Transaction reverted. No campaign change was made.', receipt.transactionHash);
    throw Error('The transaction reverted. Refresh the campaign before trying again.');
  }
  report(replacementReason === 'cancelled' || replacementReason === 'replaced' ? 'Replacement confirmed. Check the explorer and refreshed campaign state.' : action.kind === 'approve' ? 'Approval confirmed. You can now pledge KICK.' : 'Transaction confirmed. Campaign balances are refreshing.', receipt.transactionHash);
}
