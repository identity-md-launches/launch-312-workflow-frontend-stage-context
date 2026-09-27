# Frontend validation

Worker report for the Kickoff frontend, 2026-09-27. These checks are self-reported evidence, not independent certification. The implementation and static export are complete for the approved one-page scope. **Repository staging/commit is blocked:** `git add -- web dist docs` returned `Unable to create .../.git/index.lock: Read-only file system`. The source/export/evidence are present in the working tree for the submission publisher; no successful root-repository commit is claimed.

## Scope and decisions

- Built Vite/React/TypeScript with viem, no backend or indexer. Includes wallet connection, chain switching/addition, live campaign views, create, approval, pledge, unpledge, claim and refund.
- Read the complete approved workflow, both deployment/network inputs, implementation source, pinned ABI exports and both supplied protected Solidity test files. Solidity and protected/root configuration remain unchanged; frontend work does not rerun or claim the Solidity security tests.
- Followed the workflow's explicit **no in-page swap** requirement. Generic swap guidance does not override it. The app's approval is KICK allowance for CrowdfundCampaigns; no Uniswap/Permit2 approval is sent. The exact vetted Uniswap configuration is retained in the runtime manifest.
- Read Better Interface's contents/workflow, core principles of all six domains and documentation method. Applied it during implementation and reviewed the rendered export afterwards. Attribution is in `docs/DESIGN.md`.
- Root `DESIGN.md` conflicts with the overriding write scope; delivered `docs/DESIGN.md`. The only new ignore file is the explicitly budgeted `web/.gitignore`.
- Browser tool navigation was attempted, but its required `chromium-1246/chrome-linux64/chrome` executable was absent. Used installed Playwright Chromium 140.0.7339.186 from `/tmp/kickoff-browsers` instead. Tests start/stop their own preview in one bounded process. Real screenshots were inspected locally, including the final corrected text-enlargement state.

## Executed checks

All commands run from `web/` unless specified. Node v24.9.0, npm 11.6.0, Playwright 1.55.1.

| Command/check | Result |
| --- | --- |
| `npm ci --cache /tmp/kickoff-npm-cache --no-audit --no-fund` | Passed using committed lockfile; no dependency archive/registry vendoring |
| `npm run typecheck` (also invoked by every build) | Passed after final source changes |
| `npm run build` | Passed; relative-base root export generated and manifest emitted last |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/kickoff-browsers npm test` | Nine production-export interaction tests passed |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/kickoff-browsers npm run test:live` | One real-RPC Chromium test passed; no real wallet connection/signature/transaction |
| `npm run verify:export` | Passed exact configuration binding, full file inventory, SHA-256 and canonical ABI Keccak checks |
| `npm run check:live` | All three supplied RPCs passed chain ID, code and immutable-token checks |
| `git diff --check` (repository root) | Passed; protected tracked files unchanged |

The final export has six inventoried assets (HTML, CSS, two JS chunks, two ABIs), plus its manifest. `docs/evidence/submission-size.json` records final export bytes and a bounded submission-size audit. The export is roughly 0.5 MB, far below both the 8 MiB submission ceiling and the publication HTTP-response budget. No remote images/fonts/scripts are required.

The ABI provenance checks matched:

| Contract | Canonical Keccak, no `0x` |
| --- | --- |
| LaunchToken | `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee` |
| CrowdfundCampaigns | `b4b9a9acacacbcc0ecf339e3e5abfc449551761916590aba31dff567e6516aa4` |

Both raw arrays match `git show 8c62b2dcbd9e299a5733ae3e3cdf8744c905b937:docs/abi/<Contract>.json` byte-for-byte. The final manifest copies that deployed source commit, launch ID, attestation hash and exact contract set. `web/config/network.json` and the runtime `network` block are deeply equal to the supplied input, with identical key/value ordering and no changed values.

## Interaction coverage

`web/tests/interactions.spec.ts` tests the built page at `/preview/` using a mocked EIP-1193 wallet and JSON-RPC responses. The production build contains no mock code.

1. Disconnected state, missing-wallet guidance, disabled writes, empty campaign state and recovery from unavailable RPCs.
2. Wrong network, error 4902, exact `wallet_addEthereumChain` payload and a second switch attempt.
3. Approval to the immutable KICK token with the exact campaign spender and `25.000000000000000001` KICK; pledge disabled beforehand, enabled after allowance refresh, and disabled again after consumption. Exact balance updates and partial unpledge; unpledge lock at/above goal.
4. Creation validates UTF-8 byte count, too many decimals, minimum goal and deadline; submits decoded expected arguments and displays the newly read campaign.
5. Claim/refund at the exact deadline; permissionless claim identifies the creator as recipient; failed refund affects only the selected caller pledge; refreshed state blocks double claim/refund controls.
6. Connection/signature rejection, contract simulation revert and invalid/insufficient amounts never send a transaction.
7. Account/network changes clear prior balances and disable wrong-chain actions; disconnect disables writes.
8. Missing deployed code, immutable-token mismatch and tampered ABI disable signing.
9. Subpath assets, responsive reflow, 200% text enlargement, reduced-motion styles, keyboard connection/disclosure, visible skip-link focus, rendered contrast measurements and axe audit.

The mock receipt/state tests verify frontend encoding, gating, signing sequence and rendering. They do not independently prove Solidity behavior or actual fund movement. Tests initially found only a checksum-case mismatch in an address assertion; comparing address values case-insensitively fixed the test without changing the transaction destination.

Live read evidence: `docs/evidence/live-check.json` confirms chain **11155111**, 1,722 bytes of LaunchToken code, 3,756 bytes of CrowdfundCampaigns code, correct `token()` and zero campaigns/escrow at block **11791460**. `docs/evidence/live-browser.json` captures the later final browser read block and actual requested resources. Browser live reads succeeded without page exceptions, local resource failures or failed RPC requests.

## Six-domain review

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native controls/labels/disclosures, coherent headings, skip link, inline errors/focus, disabled prerequisites, live status. Keyboard exercised connect and disclosure; focus screenshot inspected. axe reported zero violations across its selected WCAG A/AA rules. No physical screen-reader session or every-control manual keyboard walkthrough. |
| Layout | Checked | Final screenshots at 1440, 820, 375 and 320 CSS pixels; no document/body horizontal overflow. 200% root-text enlargement now collapses the workspace through its container query. Native browser zoom, RTL and translated content not tested. |
| Writing | Checked | Approval versus pledge, KICK versus gas, payout recipient, exact refund scope, locked/failed/claimed states, actionable errors and persistent no-off-chain-promises message reviewed against ABI/workflow. No localization is offered. |
| Typography | Checked | Descending headings, 16px fields, tabular numeric values, full amount precision, wrapping and enlarged-text screenshots inspected. Platform-specific font fallback/physical-device rendering not verified. |
| Colors | Checked | Eight identified rendered pairs measured; all above 4.5:1 (lowest 5.16:1). Roles centralized in CSS; statuses have text. axe leaves three contrast nodes for manual review; measurements supplement but do not certify every state/forced-color pair. |
| UI | Checked | Default, disabled, empty, loading, error, approval, pledged and settled states exercised. Restrained transitions and reduced-motion behavior checked. No dialogs, media, staged animations or dark theme apply. Hover/press appearances were source-reviewed; animation-panel slow playback was not performed. |

## Findings, repairs and rechecks

| Severity / source | Finding and correction | Recheck |
| --- | --- | --- |
| Medium — `web/src/style.css:68`, `:144` | At 200% root-text size, a fixed-pixel sidebar clipped the deadline value; simply enlarging that column crowded campaign controls. Converted columns/logo to rem and added a named-container query to stack the workspace relative to text size. | Final `text-200.png` visually inspected; regression asserts a wide form at 200%, and all four normal widths still pass. |
| Medium — `web/src/App.tsx:30`, `:98`, `:138` | Transaction feedback lived above long campaign lists; failed requests could leave “Confirm” as the status. Bring the stable feedback region into view and replace the pre-sign status with “Transaction not submitted” on error. | Primary actions, rejection and simulation-failure tests passed after correction. |
| Medium — `web/src/App.tsx:43` | A fixed polling interval could supersede slow fallback reads before errors reached the UI. Schedule the next automatic read only after the previous read completes; preserve generation checks for account/page changes. | RPC-failure/recovery and account-change tests passed; prolonged outage timing was source-reviewed. |
| Low — `web/src/App.tsx:126` | Mobile hid a line break in the note and joined adjacent sentences. Added an explicit space. | Final mobile screenshot inspected. |
| Low — `web/src/App.tsx:204` | Disconnected failed-campaign copy could imply a known zero pledge. It now asks to connect before checking refundable pledges. | Final source review and disconnected-state regression pass. |

Build portability issue repaired separately: aligned axe's peer `playwright-core` with Playwright 1.55.1 through the lockfile override so the browser test types agree. Final clean `npm ci` and typecheck passed.

## Evidence and remaining limitations

- `docs/evidence/interactions.json`: final nine-test report, including durations and assertions' outcomes.
- `docs/evidence/accessibility.json` and `browser-review.json`: audit results, measured pairs, viewport widths, page/resource errors.
- `width-1440.png`, `width-820.png`, `width-375.png`, `width-320.png`: **mock campaign data**, real rendered production UI. These are not live campaigns.
- `live-desktop.png`, `live-mobile.png`: real deployment's empty state; `desktop-empty.png` is the mocked missing-wallet recovery case. `keyboard-focus.png` and `text-200.png` show the inspected focus/enlargement states.
- No live transactions, wallet private keys, funded-wallet approvals, actual extension dialogs, swaps or contract redeployments were used. Real receipt replacements/timeouts, mempool races, reorgs, public-RPC outages over long periods, pagination beyond the fixture size, cross-browser engines and physical devices remain untested. Receipt polling/timeout handling exists but is not represented as a live-chain test.
- No published URL, CID, pinning, naming or control-plane publication check is claimed. Those are subsequent publisher steps.
- All useful source, lockfile, runtime ABI/config assets and evidence remain inside the allowed paths. The only incomplete operational step is the root Git commit, prevented by the worker's read-only `.git`; no approval escalation was available or requested.
