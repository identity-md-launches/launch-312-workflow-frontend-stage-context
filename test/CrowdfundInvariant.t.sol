// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {CrowdfundCampaigns} from "../src/CrowdfundCampaigns.sol";

/// @dev A bounded, independent ledger of successful actions. Handler decisions use this model,
/// so an unexpected revert or a disagreement with contract state fails the invariant campaign.
contract CampaignHandler is Test {
    struct Model {
        address creator;
        uint256 goal;
        uint256 deadline;
        uint256 total;
        bool claimed;
    }

    LaunchToken public immutable token;
    CrowdfundCampaigns public immutable app;
    address[4] public actors = [address(0xA11CE), address(0xB0B), address(0xCAFE), address(0xD00D)];
    mapping(address => uint256) public expectedBalance;
    mapping(uint256 => Model) public models;
    mapping(uint256 => mapping(address => uint256)) public expectedPledge;
    uint256 public count;
    uint256 public donations;

    constructor(LaunchToken token_, CrowdfundCampaigns app_) {
        token = token_;
        app = app_;
        for (uint256 i; i < actors.length; ++i) {
            expectedBalance[actors[i]] = 10_000 ether;
        }
    }

    function create(uint256 actorSeed, uint256 goalSeed, uint256 durationSeed) public {
        if (count >= 16) return;
        address creator = actors[actorSeed % actors.length];
        uint256 goal = bound(goalSeed, 1 ether, 1_000 ether);
        uint256 deadline = vm.getBlockTimestamp() + bound(durationSeed, 1 hours, 3 hours);
        vm.prank(creator);
        uint256 id = app.create(goal, deadline, bytes32("Invariant"));
        assertEq(id, ++count);
        models[id] = Model(creator, goal, deadline, 0, false);
    }

    function pledge(uint256 actorSeed, uint256 idSeed, uint256 amountSeed) external {
        uint256 id = 1 + idSeed % count;
        Model storage m = models[id];
        address actor = actors[actorSeed % actors.length];
        if (vm.getBlockTimestamp() >= m.deadline || expectedBalance[actor] == 0) return;
        uint256 amount = bound(amountSeed, 1, expectedBalance[actor]);
        vm.prank(actor);
        app.pledge(id, amount);
        expectedPledge[id][actor] += amount;
        expectedBalance[actor] -= amount;
        m.total += amount;
    }

    function unpledge(uint256 actorSeed, uint256 idSeed, uint256 amountSeed) external {
        uint256 id = 1 + idSeed % count;
        Model storage m = models[id];
        address actor = actors[actorSeed % actors.length];
        uint256 pledged = expectedPledge[id][actor];
        if (vm.getBlockTimestamp() >= m.deadline || m.total >= m.goal || pledged == 0) return;
        uint256 amount = bound(amountSeed, 1, pledged);
        vm.prank(actor);
        app.unpledge(id, amount);
        expectedPledge[id][actor] -= amount;
        expectedBalance[actor] += amount;
        m.total -= amount;
    }

    function claim(uint256 callerSeed, uint256 idSeed) external {
        uint256 id = 1 + idSeed % count;
        Model storage m = models[id];
        if (vm.getBlockTimestamp() < m.deadline || m.total < m.goal || m.claimed) return;
        vm.prank(actors[callerSeed % actors.length]);
        app.claim(id);
        expectedBalance[m.creator] += m.total;
        m.claimed = true;
    }

    function refund(uint256 actorSeed, uint256 idSeed) external {
        uint256 id = 1 + idSeed % count;
        Model storage m = models[id];
        address actor = actors[actorSeed % actors.length];
        uint256 amount = expectedPledge[id][actor];
        if (vm.getBlockTimestamp() < m.deadline || m.total >= m.goal || amount == 0) return;
        vm.prank(actor);
        app.refund(id);
        expectedBalance[actor] += amount;
        expectedPledge[id][actor] = 0;
    }

    function donate(uint256 actorSeed, uint256 amountSeed) external {
        address actor = actors[actorSeed % actors.length];
        uint256 amount = bound(amountSeed, 0, expectedBalance[actor]);
        vm.prank(actor);
        token.transfer(address(app), amount);
        expectedBalance[actor] -= amount;
        donations += amount;
    }

    function elapse(uint256 secondsSeed) external {
        vm.warp(vm.getBlockTimestamp() + bound(secondsSeed, 0, 1 hours + 1));
    }
}

contract CrowdfundInvariantTest is Test {
    LaunchToken private token;
    CrowdfundCampaigns private app;
    CampaignHandler private handler;

    function setUp() public {
        token = new LaunchToken();
        app = new CrowdfundCampaigns(address(token));
        handler = new CampaignHandler(token, app);
        for (uint256 i; i < 4; ++i) {
            address actor = handler.actors(i);
            token.transfer(actor, 10_000 ether);
            vm.prank(actor);
            token.approve(address(app), type(uint256).max);
        }
        handler.create(0, 10 ether, 1 hours);
        handler.create(1, 100 ether, 2 hours);
        handler.create(2, 1_000 ether, 3 hours);
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = handler.create.selector;
        selectors[1] = handler.pledge.selector;
        selectors[2] = handler.unpledge.selector;
        selectors[3] = handler.claim.selector;
        selectors[4] = handler.refund.selector;
        selectors[5] = handler.donate.selector;
        selectors[6] = handler.elapse.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
        targetContract(address(handler));
    }

    function invariant_balancesCoverAllUnpaidPledgesAndMatchIndependentLedger() public view {
        assertEq(app.campaignCount(), handler.count());
        uint256 liabilities;
        for (uint256 id = 1; id <= handler.count(); ++id) {
            CrowdfundCampaigns.Campaign memory c = app.campaign(id);
            (address creator, uint256 goal, uint256 deadline, uint256 total, bool claimed) = handler.models(id);
            assertEq(c.creator, creator);
            assertEq(c.goal, goal);
            assertEq(c.deadline, deadline);
            assertEq(c.total, total);
            assertEq(c.claimed, claimed);
            uint256 outstanding;
            for (uint256 i; i < 4; ++i) {
                address actor = handler.actors(i);
                uint256 pledged = app.pledgeOf(id, actor);
                assertEq(pledged, handler.expectedPledge(id, actor));
                outstanding += pledged;
            }
            if (!claimed) liabilities += outstanding;
        }
        assertEq(app.totalEscrowed(), liabilities);
        assertGe(token.balanceOf(address(app)), liabilities);
        assertEq(token.balanceOf(address(app)), liabilities + handler.donations());
        uint256 accounted = token.balanceOf(address(this)) + token.balanceOf(address(app));
        for (uint256 i; i < 4; ++i) {
            address actor = handler.actors(i);
            assertEq(token.balanceOf(actor), handler.expectedBalance(actor));
            accounted += token.balanceOf(actor);
        }
        assertEq(accounted, token.totalSupply());
        assertEq(token.totalSupply(), 1e27);
    }
}
