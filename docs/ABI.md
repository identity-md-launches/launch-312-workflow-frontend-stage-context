# Contract interfaces

The adjacent ABI JSON files are raw arrays emitted by `forge inspect ... abi --json` with Solidity 0.8.26. They include constructors, functions, custom errors and events. Neither constructor accepts ETH. All state-changing functions are nonpayable; there are no receive/fallback functions or initializer calls.

## LaunchToken

`constructor()` mints exactly `1000000000000000000000000000` units to its deployer. `name() = "Kickoff"`, `symbol() = "KICK"`, `decimals() = 18`. Standard ERC-20 functions are `totalSupply()`, `balanceOf(address)`, `allowance(address,address)`, `approve(address,uint256)`, `transfer(address,uint256)` and `transferFrom(address,address,uint256)`. The three mutators return `bool`; balances, supply and allowance return `uint256`. Infinite allowance (`uint256.max`) is not decremented. Zero transfers are allowed, transfers to zero revert, and no public mint/burn/admin function exists.

Events: `Transfer(address indexed from, address indexed to, uint256 value)` and `Approval(address indexed owner, address indexed spender, uint256 value)`. OpenZeppelin v5 does not emit Approval when transferFrom spends an allowance; clients should read `allowance()` again after payments. Errors follow ERC-6093 and appear in the JSON.

## CrowdfundCampaigns

`constructor(address token_)` accepts the previously deployed LaunchToken address (`$token`). It stores that address immutably without moving any supply. Constants are `MIN_GOAL() = 10^18`, `MIN_DURATION() = 3600`, `MAX_DURATION() = 7776000`; each returns `uint256`.

| Signature | Return | Meaning |
| --- | --- | --- |
| `token()` | `address` | Immutable working currency |
| `campaignCount()` | `uint256` | Number of IDs; enumerate 1 through count |
| `totalEscrowed()` | `uint256` | Aggregate unpaid liabilities, excluding donations |
| `campaign(uint256 id)` | `Campaign` tuple | Stored campaign; unknown ID reverts |
| `pledgeOf(uint256 id, address backer)` | `uint256` | Backer's remaining contribution (historical after claim); unknown ID reverts |
| `create(uint256 goal, uint256 deadline, bytes32 title)` | `uint256 id` | Creator is caller; goal and deadline bounds apply |
| `pledge(uint256 id, uint256 amount)` | None | SafeERC20 transferFrom, requires approval |
| `unpledge(uint256 id, uint256 amount)` | None | Partial/full withdrawal before deadline and below goal |
| `claim(uint256 id)` | None | Permissionless successful settlement to creator |
| `refund(uint256 id)` | None | Full failed-campaign refund to caller |

`Campaign` tuple order and ABI types:

| Field | Type | Semantics |
| --- | --- | --- |
| `creator` | `address` | Immutable entitled claimant |
| `goal` | `uint256` | Target in 18-decimal KICK minor units |
| `deadline` | `uint256` | Absolute Unix time in seconds |
| `title` | `bytes32` | Opaque title bytes, no required encoding or nonempty constraint |
| `total` | `uint256` | Net pledge total, retained after settlement |
| `claimed` | `bool` | Successful payout already completed |

Events:

```solidity
event Created(uint256 indexed id, address indexed creator, uint256 goal, uint256 deadline, bytes32 title);
event Pledged(uint256 indexed id, address indexed backer, uint256 amount, uint256 total);
event Unpledged(uint256 indexed id, address indexed backer, uint256 amount, uint256 total);
event Claimed(uint256 indexed id, address indexed creator, uint256 amount);
event Refunded(uint256 indexed id, address indexed backer, uint256 amount);
```

`total` in Pledged and Unpledged is the new campaign total. Created returns the ID via both return data and an event. Transactions on chain should recover the ID from Created. Claimed names the entitled creator regardless of transaction caller; Refunded names the calling backer. No event is emitted merely because a deadline passes: derive Open/Funded/Failed from the current block timestamp and stored fields.

Application errors are argument-free:

| Error | Meaning |
| --- | --- |
| `InvalidToken` | Constructor address has no code |
| `InvalidGoal` | Goal is less than one KICK |
| `InvalidDeadline` | Outside the inclusive 1-hour to 90-day creation interval |
| `CampaignNotFound` | ID is zero or greater than campaignCount |
| `InvalidAmount` | Pledge/unpledge amount is zero |
| `CampaignEnded` | Pledge/unpledge at or after deadline |
| `CampaignStillOpen` | Claim/refund before deadline |
| `GoalReached` | Unpledge/refund forbidden because total is at least goal |
| `GoalNotReached` | Claim forbidden because total is below goal |
| `InsufficientPledge` | Unpledge exceeds caller's pledge |
| `AlreadyClaimed` | Successful payout already occurred |
| `NothingToRefund` | Caller has no remaining failed-campaign pledge |
| `InexactTransfer` | Incoming token balance increase differs from amount |

The ABI also includes `ReentrancyGuardReentrantCall`, `SafeERC20FailedOperation(address)`, and internal Address library errors. KICK errors such as `ERC20InsufficientAllowance` or `ERC20InsufficientBalance` may bubble from external token calls; decode those with LaunchToken's ABI. Failed calls roll back both accounting and token transfers. A page should refresh views after a revert rather than assuming a single fixed error precedence.
