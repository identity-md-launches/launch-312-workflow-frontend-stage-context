# Kickoff frontend

A single static page for the deployed Sepolia **CrowdfundCampaigns** application and its **Kickoff (KICK)** currency. This is a **test-KICK pledge game that promises backers nothing off-chain**. Creators can pledge to their own campaign to top up the goal.

## Run and rebuild

Use Node 24 (tested; minimum 22.18 for native TypeScript stripping in build scripts) and npm. From `web/`:

```sh
npm ci
npm run dev
```

For the production files:

```sh
npm run typecheck
npm run build
npm run verify:export
npm run preview
```

`build` typechecks, runs Vite with `base: './'`, empties/replaces repository-root `dist/`, verifies pinned ABIs, copies them, and **then** writes `dist/imd-deployment.json`. Publish the complete `dist/` directory without rebuilding. No server, rewrite rule, indexer, external font, CDN script, environment secret or framework server is needed. Use HTTP(S), including a gateway subpath ending in `/`; browser `file://` cannot fetch the manifest. Hash anchors stay on the one page.

`dev` prepares an ignored `web/public/` directory containing generated ABIs/configuration. It is a development convenience, not a second deployment source. Neither it nor dependencies are submitted.

## Deployment source of truth

`config/deployment.json` and `config/network.json` preserve the supplied handoff and vetted network input. They are build inputs only. The application fetches **the exported `imd-deployment.json`** and its `contracts[].abiPath` JSON files at runtime; there is no compiled address, chain, RPC or ABI map.

`scripts/export.mjs` obtains `docs/abi/<Contract>.json` with `git show` at the handoff's `sourceCommit`, compares it byte-for-byte with the working tree ABI, and checks `keccak256(UTF8(canonicalJSON(abi)))` against each attested hash. Canonical JSON sorts object keys recursively and preserves array ordering. It never rebuilds or changes deployed Solidity. Keep the pinned Git commit available when rebuilding; a source-only archive without this history is insufficient for the provenance check.

The manifest retains the exact contract set, identifiers, addresses, ABI hashes and unchanged `network` object. Its `walletAddChain` extension retains the exact supplied wallet parameters. The export inventory includes every file except the manifest itself, including both ABIs and `index.html`, with lowercase SHA-256 hashes. Rebuild after **any** export change. `verify:export` independently checks the final inventory, hashes, paths, network equality, ABI bindings and limits. Configuration is public; no keys or private RPC credentials are required.

The app verifies ABI hashes again at runtime. Before actions are enabled, it verifies RPC chain ID, nonempty deployed code, the application's `token()` binding and token decimals. This is a consistency check; it is not independent signature verification of the launch attestation or a replacement for publication verification.

## Wallets, reads and transactions

- Supports EIP-1193 browser wallets exposed as `window.ethereum`, including compatible wallet browsers. Connection is explicit, with account/network/disconnect listeners. No WalletConnect project ID was provided, so no QR/WalletConnect service is configured.
- Wrong-network actions are disabled. Switching tries `wallet_switchEthereumChain`; unknown-chain errors offer `wallet_addEthereumChain` with the supplied parameters, then switch again. Rejection remains recoverable.
- Public RPC fallback follows the manifest's order. The connected wallet is a final read fallback only when it reports the correct chain. Wallet signatures stay with the wallet.
- Lists enumerate `campaignCount()`, `campaign(id)` and `pledgeOf(id, account)` in pages of six, newest first. Reads share one block number and use no backend/events index. Refresh runs 20 seconds after a read finishes; actions are disabled when the displayed snapshot is over 60 seconds old. Late responses from previous accounts/pages are discarded.
- Balance, allowance, escrow, progress, deadline, creator, contribution and settlement state come from the contracts. `token()` supplies the actual address for currency reads and approvals, checked against the attested LaunchToken. Amounts preserve all 18 decimals; invalid precision is rejected rather than rounded.
- Creation accepts a short UTF-8 bytes32 title, goal of at least 1 KICK and a local-time deadline 1 hour–90 days from chain time. Very close boundary deadlines can expire during wallet confirmation; the contract remains authoritative.
- Pledging has explicit **Approve KICK** and **Pledge KICK** steps. Approval sets only the entered amount for **CrowdfundCampaigns**. Existing sufficient allowance is shown as “Approval ready.” A pledge is disabled without sufficient allowance. Every submission rechecks chain/account/code/currency/balance/allowance and simulates before the wallet request. A third party reaching the goal or deadline after simulation may still cause a revert.
- Open campaigns accept over-funding. Unpledging is disabled at/above the goal, after the deadline, or with no pledge. After the deadline, funded campaigns expose permissionless claim **to the creator**; failed campaigns expose the caller's full refund. Claimed totals/pledges remain historical. Double settlement controls are unavailable after refreshed state.
- Transaction progress, errors and explorer links are retained and brought into view. Receipt timeouts keep further submissions disabled in that page session until **Check confirmation** obtains a receipt. Replacements are reported. After reloading a page, check the wallet/explorer before resubmitting an unresolved transaction.

The approved workflow explicitly says **no in-page swap**. KICK comes from swapping Sepolia ETH in the factory-seeded, hookless Uniswap v4 launch pool through a compatible external interface. Sepolia ETH pays gas here; the application never accepts ETH. The vetted Uniswap addresses remain unchanged in the manifest, but no swap, quote, router approval or Permit2 flow is executed. The only approval is the required KICK-to-CrowdfundCampaigns allowance.

## Validation

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/kickoff-browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/kickoff-browsers npm test
PLAYWRIGHT_BROWSERS_PATH=/tmp/kickoff-browsers npm run test:live
npm run check:live
```

Playwright manages a temporary HTTP server for the finished export at `/preview/` during each foreground test run, then closes it. The normal suite mocks JSON-RPC and an injected wallet without changing production code. `test:live` and `check:live` perform only public reads; they never connect a real wallet, sign or broadcast. The test suite captures production screenshots and compact JSON evidence under `docs/evidence/`; transient test output is in `test/scratch/`.

See [validation and limitations](../docs/FRONTEND_VALIDATION.md) and [the implemented design](../docs/DESIGN.md). Live funded-wallet transactions, real extension dialogs and publication checks are not claimed as tested.

## Delivery boundaries and size

Only `web/**`, `dist/**` and `docs/**` are delivery paths. The explicit ignore-file budget is **one file: `web/.gitignore`**, as allowed in the assignment; no root ignore/config/lockfile changes. Directory patterns exclude dependencies and caches at every nesting level under `web/`. No dependency registry, package archives, node_modules, submodules or browser binaries belong in the submission. Installed Chromium/npm cache are in `/tmp` on this worker.

The requested root `DESIGN.md` would violate the overriding path boundary; its content is delivered as `docs/DESIGN.md`. Export/source/evidence are all required and retained. The combined submission must remain below 8 MiB, including existing tracked content; see the final size evidence.
