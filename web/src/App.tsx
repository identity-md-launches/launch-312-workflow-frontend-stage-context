import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { type Address, type Hex } from 'viem';
import { loadRuntime, publicClient, type Runtime, type Wallet } from './config';
import { amount, campaignTitle, errorMessage, PAGE_SIZE, readSnapshot, status, submitAction, switchNetwork, titleBytes, units, type Action, type Campaign, type Snapshot } from './contracts';

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
function localDate(date: Date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function dateLabel(timestamp: bigint) { return new Date(Number(timestamp) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }

export function App() {
  const [runtime, setRuntime] = useState<Runtime>();
  const [configError, setConfigError] = useState('');
  const [account, setAccount] = useState<Address>();
  const [chain, setChain] = useState<number>();
  const [wallet, setWallet] = useState<Wallet>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [readError, setReadError] = useState('');
  const [walletError, setWalletError] = useState('');
  const [walletBusy, setWalletBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [transaction, setTransaction] = useState<{ message: string; hash?: Hex; error?: string; pending?: boolean }>({ message: '' });
  const requestId = useRef(0);
  const lock = useRef(false);

  useEffect(() => { loadRuntime().then(setRuntime).catch(e => setConfigError(errorMessage(e))); }, []);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 5000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (transaction.message) document.getElementById('transaction-status')?.scrollIntoView({ block: 'nearest' });
  }, [transaction.message, transaction.error]);
  const refresh = useCallback(async () => {
    if (!runtime) return;
    const id = ++requestId.current;
    setReading(true);
    try {
      const result = await readSnapshot(runtime, publicClient(runtime, wallet, chain), account, page);
      if (id === requestId.current) { setSnapshot(result); setReadError(''); setClock(Date.now()); }
    } catch (e) { if (id === requestId.current) { setReadError(errorMessage(e)); setSnapshot(undefined); } }
    finally { if (id === requestId.current) setReading(false); }
  }, [runtime, account, chain, wallet, page]);
  useEffect(() => {
    setSnapshot(undefined);
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await refresh();
      if (active) timer = setTimeout(() => void poll(), 20_000);
    }
    void poll();
    return () => { active = false; clearTimeout(timer); ++requestId.current; };
  }, [refresh]);
  useEffect(() => {
    if (!wallet) return;
    const accountsChanged = (...args: unknown[]) => {
      ++requestId.current; setSnapshot(undefined); setWalletError('');
      setAccount((args[0] as Address[])[0]);
    };
    const chainChanged = (...args: unknown[]) => { ++requestId.current; setSnapshot(undefined); setChain(Number(BigInt(args[0] as string))); };
    const disconnected = () => { ++requestId.current; setSnapshot(undefined); setAccount(undefined); setChain(undefined); };
    wallet.on?.('accountsChanged', accountsChanged); wallet.on?.('chainChanged', chainChanged); wallet.on?.('disconnect', disconnected);
    return () => {
      wallet.removeListener?.('accountsChanged', accountsChanged); wallet.removeListener?.('chainChanged', chainChanged); wallet.removeListener?.('disconnect', disconnected);
    };
  }, [wallet]);

  async function connect() {
    setWalletError(''); setWalletBusy(true);
    try {
      const provider = window.ethereum;
      if (!provider) throw Error('No browser wallet found. Open this page in a wallet browser or install an Ethereum browser wallet, then try again.');
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const chainId = await provider.request({ method: 'eth_chainId' });
      setWallet(provider); setAccount(accounts[0]); setChain(Number(BigInt(chainId)));
      if (!accounts[0]) throw Error('No account was shared. Select an account in your wallet and reconnect.');
    } catch (e) { setWalletError(errorMessage(e)); }
    finally { setWalletBusy(false); }
  }
  async function switchChain() {
    if (!runtime || !wallet) return;
    setWalletError(''); setWalletBusy(true);
    try { await switchNetwork(runtime, wallet); setChain(Number(BigInt(await wallet.request({ method: 'eth_chainId' })))); }
    catch (e) { setWalletError(errorMessage(e)); }
    finally { setWalletBusy(false); }
  }
  const wrongChain = !!account && !!runtime && chain !== runtime.chain.id;
  const stale = !snapshot || clock - snapshot.loadedAt > 60_000;
  const ready = !!account && !wrongChain && !stale && !busy && !walletBusy && !transaction.pending;
  const gate = !account ? 'Connect your wallet to take part.' : wrongChain ? `Switch to ${runtime?.chain.name} to use campaign actions.` : stale ? 'Waiting for verified contract reads. Refresh to retry.' : busy || transaction.pending ? 'Finish the current transaction first.' : '';
  const now = snapshot ? snapshot.timestamp + BigInt(Math.max(0, Math.floor((clock - snapshot.loadedAt) / 1000))) : 0n;
  async function transact(action: Action) {
    if (!ready || !runtime || !wallet || !account || lock.current) return;
    lock.current = true; setBusy(true); setTransaction({ message: 'Checking contract state…' });
    try {
      await submitAction(runtime, publicClient(runtime, wallet, chain), wallet, account, action,
        (message, hash, pending) => setTransaction({ message, hash, pending }));
    } catch (e) { setTransaction(previous => ({ ...previous, message: previous.hash ? previous.message : 'Transaction not submitted.', error: errorMessage(e) })); }
    finally { lock.current = false; setBusy(false); await refresh(); }
  }

  async function checkConfirmation() {
    if (!runtime || !transaction.hash) return;
    setBusy(true);
    try {
      const receipt = await publicClient(runtime, wallet, chain).getTransactionReceipt({ hash: transaction.hash });
      setTransaction({ message: receipt.status === 'success' ? 'Transaction confirmed. Check the refreshed campaign state.' : 'Transaction reverted. No campaign change was made.', hash: receipt.transactionHash });
      await refresh();
    } catch { setTransaction(previous => ({ ...previous, error: 'A receipt is not available yet. Check the explorer and retry confirmation.' })); }
    finally { setBusy(false); }
  }

  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="header shell">
      <a className="wordmark" href="#main" aria-label="Kickoff home"><span className="brand-symbol" aria-hidden="true">k<span>↗</span></span>kickoff<span className="wordmark-period">.</span></a>
      <div className="header-end"><span className="network-tag"><span aria-hidden="true">◈</span> {runtime?.chain.name ?? 'Test network'} <span className="tag-suffix">playground</span></span>
        <a className="text-link" href="#how-it-works">How it works <span aria-hidden="true">↗</span></a></div>
    </header>
    <main id="main" className="shell" tabIndex={-1}>
      <section className="hero" aria-labelledby="hero-title">
        <div><p className="eyebrow">A little goes together</p><h1 id="hero-title">Small pledges.<br /><span>Shared momentum.</span></h1>
          <p className="hero-copy">Set a goal. Gather a little support. See what happens when everyone kicks in.</p>
          <a className="hero-link" href="#campaigns">Explore the campaigns <span aria-hidden="true">↘</span></a>
        </div>
        <div className="hero-note"><div className="note-mark" aria-hidden="true">↗</div><p className="eyebrow">Big on experiments. <br />Small on stakes.</p><p>A test-KICK pledge game on Sepolia. Campaigns promise you <strong>nothing off-chain</strong>. Test tokens only.</p></div>
      </section>

      <section className="wallet-panel" aria-label="Wallet and live contract state">
        <div className="wallet-info"><span className="label">Your wallet</span>{account ? <a className="account" href={`${runtime?.deployment.network.explorer}/address/${account}`} target="_blank" rel="noreferrer" title={account}>{short(account)} ↗</a> : <strong>Make yourself part of it.</strong>}
          <span className="small muted">{account ? (wrongChain ? 'Wrong network' : `${runtime?.chain.name} connected`) : 'Connect to see your KICK and join a campaign.'}</span></div>
        <dl className="wallet-numbers"><div><dt>KICK balance</dt><dd>{units(snapshot?.balance, snapshot?.decimals)}</dd></div><div><dt>Campaign allowance</dt><dd>{units(snapshot?.allowance, snapshot?.decimals)} <span className="unit">KICK</span></dd></div></dl>
        {!account ? <button className="primary" disabled={walletBusy || !runtime} onClick={connect}>{walletBusy ? 'Connecting…' : 'Connect wallet'} <span aria-hidden="true">↗</span></button> : wrongChain ? <button className="primary" disabled={walletBusy} onClick={switchChain}>{walletBusy ? 'Switching…' : `Switch to ${runtime?.chain.name}`}</button> : <button className="quiet" disabled={busy} onClick={() => { ++requestId.current; setAccount(undefined); setWallet(undefined); setChain(undefined); setSnapshot(undefined); }}>Disconnect</button>}
      </section>
      <div role="alert" className={walletError ? 'notice error' : ''}>{walletError}</div>
      {wrongChain && <p className="notice">Your wallet is on another network. Switch to {runtime?.chain.name} before approving or sending a transaction.</p>}
      {configError && <div className="notice error" role="alert">{configError} <button onClick={() => location.reload()}>Reload page</button></div>}
      <div id="transaction-status"><div className={transaction.message ? 'notice transaction' : ''} role="status" aria-live="polite">{transaction.message}{transaction.hash && <a href={`${runtime?.deployment.network.explorer}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}</div>
      <div className={transaction.error ? 'notice error' : ''} role="alert">{transaction.error}</div>
      {transaction.pending && !busy && <button onClick={() => void checkConfirmation()}>Check confirmation</button>}</div>

      <div className="workspace">
        <section id="campaigns" aria-labelledby="campaigns-title">
          <div className="section-heading"><div><p className="eyebrow">The collective effort</p><h2 id="campaigns-title">Campaigns <span className="count">{snapshot?.count.toString() ?? '—'}</span></h2></div><button className="quiet refresh" disabled={reading || !runtime} onClick={() => void refresh()}>{reading ? 'Reading…' : 'Refresh'} <span aria-hidden="true">↻</span></button></div>
          <p className="section-caption">All-or-nothing goals. A little room for big ideas.</p>
          {readError && <div className="notice error" role="alert"><strong>Live reads unavailable.</strong><p>{readError}</p><p>Actions stay disabled until the deployment can be verified.</p></div>}
          {!snapshot && !readError && <div className="empty"><span className="empty-mark" aria-hidden="true">···</span><h3>Reading the chain</h3><p>Checking the deployment and loading campaigns.</p></div>}
          {snapshot && snapshot.campaigns.length === 0 && <div className="empty"><span className="empty-mark" aria-hidden="true">↗</span><h3>{snapshot.count === 0n ? 'Every first pledge starts somewhere.' : 'No campaigns on this page.'}</h3><p>{snapshot.count === 0n ? 'Start a campaign, choose a KICK goal, and invite a little collective momentum.' : 'Return to newer campaigns to keep exploring.'}</p><a href="#create">Create the first spark <span aria-hidden="true">↗</span></a></div>}
          <div className="campaign-list">{snapshot?.campaigns.map(campaign => <CampaignCard key={`${account ?? 'guest'}-${campaign.id}`} campaign={campaign} snapshot={snapshot} runtime={runtime!} now={now} ready={ready} gate={gate} onAction={transact} />)}</div>
          {snapshot && snapshot.count > PAGE_SIZE && <nav className="pagination" aria-label="Campaign pages"><button disabled={page === 0 || reading} onClick={() => setPage(page - 1)}>← Newer</button><span>Page {page + 1} of {((snapshot.count + PAGE_SIZE - 1n) / PAGE_SIZE).toString()}</span><button disabled={BigInt(page + 1) * PAGE_SIZE >= snapshot.count || reading} onClick={() => setPage(page + 1)}>Older →</button></nav>}
          {snapshot && <p className="read-status"><span aria-hidden="true">●</span> Read from block {snapshot.block.toString()} · Refreshes every 20 seconds<br /><span>Contract escrow: {units(snapshot.escrowed, snapshot.decimals)} KICK</span></p>}
        </section>
        <aside id="create" className="create-panel" aria-labelledby="create-title"><span className="panel-index">01 / Start something</span><h2 id="create-title">Give it a goal.</h2><p>One campaign. A shared target.<br />The rest is up to your backers.</p><CreateForm ready={ready} gate={gate} now={now} decimals={snapshot?.decimals ?? 18} onAction={transact} /><p className="fine-print">Creating a campaign costs Sepolia gas, not KICK. Creators can pledge to their own campaign to top up the goal.</p></aside>
      </div>

      <section id="how-it-works" className="how" aria-labelledby="how-title"><div className="section-heading"><h2 id="how-title">A simple pact.</h2><span className="eyebrow">No admin. Just the rules.</span></div><div className="rules-grid">
        <div><span className="rule-number">01</span><h3>Get a little KICK.</h3><p>KICK comes from swapping Sepolia ETH in the factory-seeded launch pool. Use a compatible external Uniswap v4 interface; this page has no swap.</p></div>
        <div><span className="rule-number">02</span><h3>Approve. Then pledge.</h3><p>Approve the campaign contract to spend your chosen KICK amount, then pledge. Before the deadline, unpledge while the campaign is below its goal. At the goal, pledges lock. Over-funding is welcome.</p></div>
        <div><span className="rule-number">03</span><h3>Reach the finish line.</h3><p>After the deadline, anyone can claim a funded campaign’s full total for its creator. If it falls short, each backer can refund their own pledge. Empty campaigns simply expire.</p></div>
      </div></section>
      {runtime && <details className="deployment-details"><summary>Deployment & token details <span aria-hidden="true">↗</span></summary><p>All payments use KICK. The campaign contract never accepts ETH. Sepolia ETH only pays network fees here.</p><dl>{runtime.deployment.contracts.map(contract => <div key={contract.name}><dt>{contract.name}</dt><dd><a href={`${runtime.deployment.network.explorer}/address/${contract.address}`} target="_blank" rel="noreferrer">{contract.address} ↗</a></dd></div>)}<div><dt>Currency from campaign.token()</dt><dd>{snapshot?.tokenAddress ?? 'Waiting for verification'}</dd></div><div><dt>Connected wallet</dt><dd>{account ?? 'Not connected'}</dd><dt>Deployed source</dt><dd>{runtime.deployment.sourceCommit}</dd></div></dl><a href="./imd-deployment.json">View deployment manifest</a></details>}
    </main><footer className="footer shell"><span className="wordmark">kickoff.</span><p>Built for a little collective momentum.</p><span>Sepolia test toy · No off-chain promises</span></footer>
  </>;
}

type CardProps = { campaign: Campaign; snapshot: Snapshot; runtime: Runtime; now: bigint; ready: boolean; gate: string; onAction: (action: Action) => Promise<void> };
function CampaignCard({ campaign: c, snapshot, runtime, now, ready, gate, onAction }: CardProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const state = status(c, now);
  const open = state === 'Open';
  const locked = c.total >= c.goal;
  const percent = c.goal ? Number(c.total * 10000n / c.goal) / 100 : 0;
  let entered: bigint | undefined;
  try { entered = amount(value, snapshot.decimals); } catch { /* Validate next to the field on action. */ }
  const approved = entered !== undefined && snapshot.allowance !== undefined && snapshot.allowance >= entered;
  const id = `amount-${c.id}`;
  async function payment(kind: 'approve' | 'pledge' | 'unpledge') {
    setError('');
    try {
      const parsed = amount(value, snapshot.decimals);
      if (kind === 'unpledge' && parsed > c.pledge) throw Error('Enter an amount no greater than your pledge.');
      if (kind !== 'unpledge' && parsed > (snapshot.balance ?? 0n)) throw Error('Your KICK balance is too low. Enter a smaller amount.');
      if (kind === 'pledge' && parsed > (snapshot.allowance ?? 0n)) throw Error('Approve this KICK amount first.');
      await onAction({ kind, id: c.id, amount: parsed });
    } catch (e) { setError(errorMessage(e)); document.getElementById(id)?.focus(); }
  }
  return <article className="campaign-card" aria-labelledby={`title-${c.id}`}>
    <div className="card-top"><span className="eyebrow">Campaign / {c.id.toString().padStart(2, '0')}</span><span className={`badge ${state.toLowerCase()}`}>{state === 'Open' && locked ? 'Open · goal reached' : state}</span></div>
    <h3 id={`title-${c.id}`}><bdi>{campaignTitle(c)}</bdi></h3>
    <p className="creator">Started by <a href={`${runtime.deployment.network.explorer}/address/${c.creator}`} target="_blank" rel="noreferrer" title={c.creator}>{short(c.creator)} ↗</a></p>
    <div className="funding"><strong>{units(c.total, snapshot.decimals)} <span>KICK</span></strong><span>of {units(c.goal, snapshot.decimals)} KICK</span></div>
    <progress max={100} value={Math.min(percent, 100)} aria-label={`${campaignTitle(c)} funding progress`}>{percent}%</progress>
    <div className="card-meta"><span>{percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}% funded</span><span>{open ? 'Ends' : 'Ended'} <time dateTime={new Date(Number(c.deadline) * 1000).toISOString()}>{dateLabel(c.deadline)}</time></span></div>
    <details className="campaign-actions"><summary>View pledge & actions <span aria-hidden="true">＋</span></summary><div className="action-content">
      <p className="pledge-value">{c.claimed ? 'Your historical pledge' : 'Your pledge'} <strong>{snapshot.balance === undefined ? '—' : units(c.pledge, snapshot.decimals)} KICK</strong></p>
      {gate && <p className="small muted">{gate}</p>}
      {open ? <>
        <label htmlFor={id}>Amount in KICK</label><input id={id} name={id} inputMode="decimal" autoComplete="off" placeholder="e.g. 25" value={value} onChange={e => { setValue(e.target.value); setError(''); }} aria-invalid={!!error} aria-describedby={`${id}-error ${id}-help`} />
        <p id={`${id}-error`} className="field-error" role="alert">{error}</p>
        <p id={`${id}-help`} className="small muted">Approval lets CrowdfundCampaigns spend only the amount entered. Pledging transfers that KICK into campaign escrow.</p>
        <div className="action-buttons"><button disabled={!ready || approved} onClick={() => void payment('approve')}>{approved ? '1. Approval ready ✓' : '1. Approve KICK'}</button><button className="action-primary" disabled={!ready || !approved} onClick={() => void payment('pledge')}>2. Pledge KICK ↗</button></div>
        <div className="unpledge-row"><button className="quiet" disabled={!ready || locked || c.pledge === 0n} onClick={() => void payment('unpledge')}>Unpledge KICK</button><p className="small muted">{locked ? 'Goal reached. Pledges are locked.' : 'Take back the entered amount before the goal is reached.'}</p></div>
      </> : state === 'Funded' ? <><p className="small">The full {units(c.total)} KICK goes to the creator. Anyone can trigger this one-time payout.</p><button disabled={!ready} onClick={() => void onAction({ kind: 'claim', id: c.id })}>Claim for creator ↗</button></> : state === 'Failed' ? <><p className="small">{snapshot.balance === undefined ? 'Connect your wallet to check for a refundable pledge.' : c.pledge > 0n ? `Return your full ${units(c.pledge)} KICK pledge to your wallet.` : 'No refundable pledge for this wallet. A failed campaign with no pledges has nothing to move.'}</p><button disabled={!ready || c.pledge === 0n} onClick={() => void onAction({ kind: 'refund', id: c.id })}>Refund my pledge ↗</button></> : <p className="small">The creator has received this campaign’s full total. No further action is available.</p>}
    </div></details>
  </article>;
}

function CreateForm({ ready, gate, now, decimals, onAction }: { ready: boolean; gate: string; now: bigint; decimals: number; onAction: (action: Action) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [deadline, setDeadline] = useState(localDate(new Date(Date.now() + 7 * 86400000)));
  const [error, setError] = useState<{ field: string; text: string }>();
  async function create(event: FormEvent) {
    event.preventDefault(); setError(undefined);
    if (!ready) return;
    let field = 'campaign-title';
    try {
      const bytes = titleBytes(title);
      field = 'campaign-goal'; const parsed = amount(goal, decimals);
      if (parsed < 10n ** BigInt(decimals)) throw Error('Set a goal of at least 1 KICK.');
      field = 'campaign-deadline';
      const date = new Date(deadline).getTime();
      if (!Number.isFinite(date)) throw Error('Choose a valid date and time.');
      const seconds = BigInt(Math.floor(date / 1000));
      if (seconds < now + 3600n || seconds > now + 7776000n) throw Error('Choose a deadline between 1 hour and 90 days from the current block time.');
      await onAction({ kind: 'create', goal: parsed, deadline: seconds, title: bytes });
    } catch (e) { setError({ field, text: errorMessage(e) }); document.getElementById(field)?.focus(); }
  }
  const errors = (field: string) => <p id={`${field}-error`} role="alert" className="field-error">{error?.field === field ? error.text : ''}</p>;
  return <form onSubmit={create} noValidate>
    <label htmlFor="campaign-title">Campaign title</label><input id="campaign-title" name="title" placeholder="A small idea with a big goal" value={title} onChange={e => setTitle(e.target.value)} aria-invalid={error?.field === 'campaign-title'} aria-describedby="title-hint campaign-title-error" />
    <p id="title-hint" className="input-hint">Up to 32 UTF-8 bytes. Keep it short.</p>{errors('campaign-title')}
    <label htmlFor="campaign-goal">Funding goal <span>KICK</span></label><input id="campaign-goal" name="goal" inputMode="decimal" autoComplete="off" placeholder="e.g. 1,000 (enter 1000)" value={goal} onChange={e => setGoal(e.target.value)} aria-invalid={error?.field === 'campaign-goal'} aria-describedby="goal-hint campaign-goal-error" /><p id="goal-hint" className="input-hint">Minimum 1 KICK. Over-funding is allowed.</p>{errors('campaign-goal')}
    <label htmlFor="campaign-deadline">Deadline <span>your local time</span></label><input id="campaign-deadline" name="deadline" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} aria-invalid={error?.field === 'campaign-deadline'} aria-describedby="deadline-hint campaign-deadline-error" /><p id="deadline-hint" className="input-hint">Between 1 hour and 90 days from now.</p>{errors('campaign-deadline')}
    {gate && <p className="small form-gate">{gate}</p>}<button className="create-button" type="submit" disabled={!ready}>Create campaign <span aria-hidden="true">↗</span></button>
  </form>;
}
