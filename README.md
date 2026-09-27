# Kickoff (KICK)

Kickoff is a **Sepolia-only test toy** (chain ID `11155111`). A campaign is a test-KICK pledge game that promises backers **nothing off-chain**. A funded campaign pays its creator; it does not prove delivery, confer ownership, or guarantee a return.

This contribution delivers the contracts, vendored dependencies, Foundry tests and ABI exports for the contract stage. The separate manifest assignment supplies `launch.json`; an independent contributor reviews accepted source and the completed manifest. Publication, attestation, policy admission, factory deployment and the subsequent `lab-crowdfund` website are service/later-stage responsibilities. No live deployment is asserted here.

## Build and check

With Foundry and Solidity **0.8.26** installed:

```sh
forge build
forge test
forge fmt --check
```

All dependency sources are ordinary files under `lib/`; no install step, Git submodule, network, FFI or filesystem cheatcode permission is needed. `foundry.toml` pins the compiler version, Cancun target, optimization at 200 runs, and `bytecode_hash = "none"`. Tests use local contracts and explicit configuration, with no RPC, keys, environment variables or broadcasting. Dependency versions, archive checksums and licenses are documented in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).

## Contracts and deployment parameters

| Artifact | Source | Nonpayable constructor | Factory-stage arguments |
| --- | --- | --- | --- |
| LaunchToken | `src/LaunchToken.sol` | `constructor()` | `[]` |
| CrowdfundCampaigns | `src/CrowdfundCampaigns.sol` | `constructor(address token_)` | `["$token"]` |

Deploy LaunchToken first, then CrowdfundCampaigns referencing that exact token. LaunchToken is **Kickoff**, symbol **KICK**, 18 decimals, fixed supply **1,000,000,000 KICK = 10^27 minor units**. Its constructor mints everything to `msg.sender`, which is the project factory in production. There is no subsequent mint, burn entry point, owner, fee, blocklist, pause or upgrade mechanism. CrowdfundCampaigns never acquires or approves tokens in its constructor, requires no initial balance or initialization call, and has no owner or admin. The constructor rejects a zero/code-less token but cannot authenticate the token's identity: the manifest and independent review must verify `$token` resolves to LaunchToken.

The token address is immutable and exposed through `token()`. KICK is the only supported working currency; the system assumes this supplied, exact-transfer, non-rebasing LaunchToken. SafeERC20 checks token call results, and incoming transfers must increase custody by exactly the credited amount. This is not a general-purpose vault for arbitrary or malicious ERC-20s.

Services select the Sepolia factory and policy, publish source, bind signed artifacts, admit and deploy. Policy controls ownership where applicable, liquidity, rewards and effective opening price; none of those choices grant a role in these contracts. Actual deployed addresses, transaction hashes, deployment block and pool address must be published by those services after deployment. No constructor wallet or private key is needed from a contributor. The bytecode itself has no chain-ID gate; the deployment service and page must enforce Sepolia.

## Campaign behavior

All amounts are integer KICK minor units, without rounding, fees or interest. IDs begin at 1 and increase monotonically. There is no campaign deletion or metadata editing. `bytes32 title` may be empty; clients can use up to 32 bytes of UTF-8 and must display it as untrusted text.

| Operation | Conditions | Result |
| --- | --- | --- |
| `create(goal, deadline, title)` | Goal at least `10^18`; absolute deadline from now + 1 hour through now + 90 days, inclusive | Caller becomes creator; returns the new ID |
| `pledge(id, amount)` | Positive amount, before deadline, enough KICK and approval | Pulls exactly that amount using SafeERC20 and adds to the caller's pledge; repeated pledges and overfunding allowed |
| `unpledge(id, amount)` | Positive amount up to caller's pledge, before deadline, campaign total strictly below goal | Returns amount to that caller and reduces the pledge and total |
| `claim(id)` | At or after deadline, total at least goal, not already claimed | Any caller triggers one payment of the whole total to the creator |
| `refund(id)` | At or after deadline, total below goal, caller has an outstanding pledge | Returns that caller's full pledge once |

A campaign is Open while `timestamp < deadline`, including when already fully funded. At the exact deadline, pledging and unpledging stop. It is then Funded when `total >= goal`, otherwise Failed. A claimed Funded campaign has no further valid payment operations. A Failed campaign remains individually refundable without a time limit. A campaign with no pledges expires with no payment to make.

Once the goal is reached, unpledging locks. Transactions in the same block execute in order: an unpledge executed before the goal-reaching pledge can succeed, while one executed after it reverts. A creator **may pledge to their own campaign to top up to the goal**, which can lock other backers' pledges. There is no cancel, forced refund, extension, dispute resolution, keeper or privileged settlement path. Claiming is permissionless so an absent creator does not block payout; backers must submit their own refunds.

Every mutator uses a shared reentrancy guard. All payouts settle accounting before calling SafeERC20, always pay the entitled account, and revert atomically if a token transfer fails. A failed payout can be retried without losing the entitlement, and there is no queue that another campaign can block. Deadlines use the inclusion block's timestamp, not the time a transaction was signed.

## Accounting and funds

`campaign(id)` returns `(creator, goal, deadline, title, total, claimed)`. Its `total` is net pledges before the deadline, then remains historical after claims and refunds. `pledgeOf(id, backer)` decreases on unpledge, becomes zero on refund, and remains historical after a successful claim. A nonzero pledge on a claimed campaign is **not** refundable.

`totalEscrowed()` tracks actual unpaid liabilities across all campaigns. At every transaction boundary:

```text
totalEscrowed = sum(pledgeOf(id, backer) for every backer of every unclaimed campaign)
token.balanceOf(CrowdfundCampaigns) >= totalEscrowed
```

An unsolicited direct token transfer is surplus: it does not create a pledge, change a goal outcome, or become claimable. There is no sweep or rescue function; directly sent KICK and unsupported assets can be trapped. Use `approve` then `pledge`, never ERC-20 `transfer` to fund a campaign. The application has no payable function, receive or fallback, and rejects normal ETH transfers. The EVM can still force ETH to an address; forced ETH is not accounted for and cannot be withdrawn.

## ABI and later page integration

ABI exports and the integration reference are in [docs/ABI.md](docs/ABI.md), [LaunchToken.json](docs/abi/LaunchToken.json), and [CrowdfundCampaigns.json](docs/abi/CrowdfundCampaigns.json). Regenerate the exports after any interface change:

```sh
forge inspect src/LaunchToken.sol:LaunchToken abi --json > docs/abi/LaunchToken.json
forge inspect src/CrowdfundCampaigns.sol:CrowdfundCampaigns abi --json > docs/abi/CrowdfundCampaigns.json
```

The subsequent one-page `lab-crowdfund` site must use the deployed application address, read the KICK address from `token()`, and show the connected wallet's KICK balance and allowance. Backers obtain KICK by **swapping Sepolia ETH in the factory-seeded launch pool**; there is no in-page swap. Before pledging, present an Approve step targeting CrowdfundCampaigns and wait for sufficient confirmed allowance. Creating, unpledging, claiming and refunding do not need approval. Gas still requires Sepolia ETH.

Use `campaignCount()` and `campaign(id)` for paged campaign lists and progress/deadlines; use the five events for updates from the published deployment block, with no backend or indexer. Re-read views after confirmations and reorgs, and allow for races that make a previously valid action revert. Render overfunded totals accurately, cap only the visual bar, and distinguish `claimed` from merely Funded. The page must repeat the test-toy/no-off-chain-promises notice, support approval and all five campaign actions and export `dist/index.html`. Frontend work starts against the live deployment after the contract stage.

## Validation and review handoff

Tests cover fixed supply and ERC-20 permissions, factory-style CREATE2 construction, runtime size and forbidden opcodes, all campaign actions and events, both deadline boundaries, the goal lock in both same-block orderings, double claim/refund, exact minor-unit accounting, overfunding, empty campaigns, creator top-ups, cross-ID isolation and direct donations. Hostile-token tests exercise false/reverting/no-return calls, short receipt, payout rollback/retry, and same-function/cross-function reentrancy during all four token transfer paths. A stateful invariant compares multiple campaigns, four actors and randomized time/operations against an independent balance and pledge ledger (128 runs, 64 calls each). Arithmetic fuzz tests use 256 runs each.

These are implementer checks, not an independent security review. The later independent reviewer should reproduce attempts at claim/refund double payment, cross-ID leakage, same-block goal-lock races, rounding errors and reentrancy, then inspect the final manifest's concrete source and constructor linkage. Policy and signed-artifact linkage are service responsibilities. Any actual source, authorization, constructor or policy conflict remains a review finding. No independent review result or production readiness is asserted by this contribution.
