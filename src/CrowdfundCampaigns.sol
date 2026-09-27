// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice All-or-nothing crowdfunding in test KICK on Sepolia; no off-chain promises or admin powers.
/// @dev Deploy with the canonical LaunchToken. There are no initialization calls or initial funding requirements.
contract CrowdfundCampaigns is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Campaign {
        address creator;
        uint256 goal;
        uint256 deadline;
        bytes32 title;
        // Net pledges while open; retained as a historical total after settlement.
        uint256 total;
        bool claimed;
    }

    uint256 public constant MIN_GOAL = 1 ether; // One KICK, in its 18-decimal minor units.
    uint256 public constant MIN_DURATION = 1 hours;
    uint256 public constant MAX_DURATION = 90 days;

    IERC20 public immutable token;
    uint256 public campaignCount;
    /// @notice All unpaid campaign liabilities, excluding unsolicited token transfers.
    uint256 public totalEscrowed;

    mapping(uint256 id => Campaign) private _campaigns;
    mapping(uint256 id => mapping(address backer => uint256 amount)) private _pledges;

    error InvalidToken();
    error InvalidGoal();
    error InvalidDeadline();
    error CampaignNotFound();
    error InvalidAmount();
    error CampaignEnded();
    error CampaignStillOpen();
    error GoalReached();
    error GoalNotReached();
    error InsufficientPledge();
    error AlreadyClaimed();
    error NothingToRefund();
    error InexactTransfer();

    event Created(uint256 indexed id, address indexed creator, uint256 goal, uint256 deadline, bytes32 title);
    event Pledged(uint256 indexed id, address indexed backer, uint256 amount, uint256 total);
    event Unpledged(uint256 indexed id, address indexed backer, uint256 amount, uint256 total);
    event Claimed(uint256 indexed id, address indexed creator, uint256 amount);
    event Refunded(uint256 indexed id, address indexed backer, uint256 amount);

    constructor(address token_) {
        if (token_.code.length == 0) revert InvalidToken();
        token = IERC20(token_);
    }

    /// @notice Create a campaign. Titles may be empty; deadlines are absolute Unix seconds.
    function create(uint256 goal, uint256 deadline, bytes32 title) external nonReentrant returns (uint256 id) {
        if (goal < MIN_GOAL) revert InvalidGoal();
        if (deadline < block.timestamp + MIN_DURATION || deadline > block.timestamp + MAX_DURATION) {
            revert InvalidDeadline();
        }
        id = ++campaignCount;
        _campaigns[id] = Campaign(msg.sender, goal, deadline, title, 0, false);
        emit Created(id, msg.sender, goal, deadline, title);
    }

    /// @notice Pledge any positive number of minor units, including after the goal is reached.
    /// @dev Requires prior ERC-20 approval. Exact receipt is checked before credit becomes final.
    function pledge(uint256 id, uint256 amount) external nonReentrant {
        Campaign storage c = _getCampaign(id);
        if (block.timestamp >= c.deadline) revert CampaignEnded();
        if (amount == 0) revert InvalidAmount();

        uint256 balanceBefore = token.balanceOf(address(this));
        _pledges[id][msg.sender] += amount;
        c.total += amount;
        totalEscrowed += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) != balanceBefore + amount) revert InexactTransfer();
        emit Pledged(id, msg.sender, amount, c.total);
    }

    /// @notice Withdraw part or all of your pledge before the deadline, only below the goal.
    function unpledge(uint256 id, uint256 amount) external nonReentrant {
        Campaign storage c = _getCampaign(id);
        if (block.timestamp >= c.deadline) revert CampaignEnded();
        if (c.total >= c.goal) revert GoalReached();
        if (amount == 0) revert InvalidAmount();
        if (amount > _pledges[id][msg.sender]) revert InsufficientPledge();

        _pledges[id][msg.sender] -= amount;
        c.total -= amount;
        totalEscrowed -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Unpledged(id, msg.sender, amount, c.total);
    }

    /// @notice Anyone can settle a funded campaign, but only its creator receives the funds.
    function claim(uint256 id) external nonReentrant {
        Campaign storage c = _getCampaign(id);
        if (block.timestamp < c.deadline) revert CampaignStillOpen();
        if (c.total < c.goal) revert GoalNotReached();
        if (c.claimed) revert AlreadyClaimed();

        c.claimed = true;
        totalEscrowed -= c.total;
        token.safeTransfer(c.creator, c.total);
        emit Claimed(id, c.creator, c.total);
    }

    /// @notice Refund the caller's entire remaining pledge in an expired, failed campaign.
    function refund(uint256 id) external nonReentrant {
        Campaign storage c = _getCampaign(id);
        if (block.timestamp < c.deadline) revert CampaignStillOpen();
        if (c.total >= c.goal) revert GoalReached();
        uint256 amount = _pledges[id][msg.sender];
        if (amount == 0) revert NothingToRefund();

        _pledges[id][msg.sender] = 0;
        totalEscrowed -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Refunded(id, msg.sender, amount);
    }

    /// @notice Return campaign metadata, net pledged total and settlement flag; unknown ids revert.
    function campaign(uint256 id) external view returns (Campaign memory) {
        return _getCampaign(id);
    }

    /// @notice Remaining pledge, or historical contribution after a successful claim.
    /// @dev A claimed campaign has no remaining liability even if this view is nonzero.
    function pledgeOf(uint256 id, address backer) external view returns (uint256) {
        _getCampaign(id);
        return _pledges[id][backer];
    }

    function _getCampaign(uint256 id) private view returns (Campaign storage c) {
        if (id == 0 || id > campaignCount) revert CampaignNotFound();
        return _campaigns[id];
    }
}
