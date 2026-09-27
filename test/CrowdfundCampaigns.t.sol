// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {CrowdfundCampaigns} from "../src/CrowdfundCampaigns.sol";

contract CrowdfundCampaignsTest is Test {
    LaunchToken private token;
    CrowdfundCampaigns private app;
    address private constant CREATOR = address(0xC0FFEE);
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant STRANGER = address(0xBAD);
    uint256 private constant FUNDS = 1_000_000 ether;
    bytes32 private constant TITLE = bytes32("A Sepolia pledge game");

    event Created(uint256 indexed id, address indexed creator, uint256 goal, uint256 deadline, bytes32 title);
    event Pledged(uint256 indexed id, address indexed backer, uint256 amount, uint256 total);
    event Unpledged(uint256 indexed id, address indexed backer, uint256 amount, uint256 total);
    event Claimed(uint256 indexed id, address indexed creator, uint256 amount);
    event Refunded(uint256 indexed id, address indexed backer, uint256 amount);

    function setUp() public {
        vm.warp(10 days);
        token = new LaunchToken();
        app = new CrowdfundCampaigns(address(token));
        address[3] memory actors = [CREATOR, ALICE, BOB];
        for (uint256 i; i < actors.length; ++i) {
            token.transfer(actors[i], FUNDS);
            vm.prank(actors[i]);
            token.approve(address(app), type(uint256).max);
        }
    }

    function test_constructorNeedsOnlyTokenAndNoFunding() public view {
        assertEq(address(app.token()), address(token));
        assertEq(token.balanceOf(address(app)), 0);
        assertEq(app.totalEscrowed(), 0);
        assertEq(app.campaignCount(), 0);
    }

    function test_constructorRejectsZeroAndNonContractToken() public {
        vm.expectRevert(CrowdfundCampaigns.InvalidToken.selector);
        new CrowdfundCampaigns(address(0));
        vm.expectRevert(CrowdfundCampaigns.InvalidToken.selector);
        new CrowdfundCampaigns(ALICE);
    }

    function test_createStoresMetadataAndUsesSequentialIds() public {
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        vm.expectEmit(true, true, false, true, address(app));
        emit Created(1, CREATOR, 1 ether, deadline, TITLE);
        assertEq(_create(1 ether, 1 hours), 1);
        CrowdfundCampaigns.Campaign memory c = app.campaign(1);
        assertEq(c.creator, CREATOR);
        assertEq(c.goal, 1 ether);
        assertEq(c.deadline, deadline);
        assertEq(c.title, TITLE);
        assertEq(c.total, 0);
        assertFalse(c.claimed);
        assertEq(_create(2 ether, 90 days), 2);
        assertEq(app.campaignCount(), 2);
    }

    function test_createRejectsInvalidGoalAndDeadline() public {
        vm.expectRevert(CrowdfundCampaigns.InvalidGoal.selector);
        app.create(1 ether - 1, vm.getBlockTimestamp() + 1 hours, TITLE);
        vm.expectRevert(CrowdfundCampaigns.InvalidDeadline.selector);
        app.create(1 ether, vm.getBlockTimestamp() + 1 hours - 1, TITLE);
        vm.expectRevert(CrowdfundCampaigns.InvalidDeadline.selector);
        app.create(1 ether, vm.getBlockTimestamp() + 90 days + 1, TITLE);
        vm.expectRevert(CrowdfundCampaigns.InvalidDeadline.selector);
        app.create(1 ether, vm.getBlockTimestamp() - 1, TITLE);
        assertEq(app.campaignCount(), 0);
    }

    function test_emptyTitleAndVeryLargeGoalAreAllowed() public {
        uint256 id = app.create(type(uint256).max, vm.getBlockTimestamp() + 1 hours, bytes32(0));
        assertEq(app.campaign(id).goal, type(uint256).max);
    }

    function test_unknownIdsRevertEverywhere() public {
        _create(1 ether, 1 hours);
        uint256[3] memory ids = [uint256(0), uint256(2), type(uint256).max];
        for (uint256 i; i < ids.length; ++i) {
            vm.expectRevert(CrowdfundCampaigns.CampaignNotFound.selector);
            app.pledge(ids[i], 1);
            vm.expectRevert(CrowdfundCampaigns.CampaignNotFound.selector);
            app.unpledge(ids[i], 1);
            vm.expectRevert(CrowdfundCampaigns.CampaignNotFound.selector);
            app.claim(ids[i]);
            vm.expectRevert(CrowdfundCampaigns.CampaignNotFound.selector);
            app.refund(ids[i]);
            vm.expectRevert(CrowdfundCampaigns.CampaignNotFound.selector);
            app.campaign(ids[i]);
            vm.expectRevert(CrowdfundCampaigns.CampaignNotFound.selector);
            app.pledgeOf(ids[i], ALICE);
        }
    }

    function test_pledgesAccumulateAndAllowOverfunding() public {
        uint256 id = _create(10 ether, 1 hours);
        vm.expectEmit(true, true, false, true, address(app));
        emit Pledged(id, ALICE, 10 ether, 10 ether);
        _pledge(ALICE, id, 10 ether);
        _pledge(ALICE, id, 1);
        _pledge(BOB, id, 5 ether);
        assertEq(app.pledgeOf(id, ALICE), 10 ether + 1);
        assertEq(app.pledgeOf(id, BOB), 5 ether);
        assertEq(app.campaign(id).total, 15 ether + 1);
        _assertEscrow(15 ether + 1);
    }

    function test_pledgeRequiresPositiveAmountAndApproval() public {
        uint256 id = _create(10 ether, 1 hours);
        vm.expectRevert(CrowdfundCampaigns.InvalidAmount.selector);
        app.pledge(id, 0);
        vm.prank(ALICE);
        token.approve(address(app), 2);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(app), 2, 3));
        vm.prank(ALICE);
        app.pledge(id, 3);
        assertEq(app.pledgeOf(id, ALICE), 0);
        assertEq(app.campaign(id).total, 0);
        _assertEscrow(0);
        _pledge(ALICE, id, 2);
        assertEq(token.allowance(ALICE, address(app)), 0);
    }

    function test_insufficientBalanceRollsBackPledge() public {
        uint256 id = _create(10 ether, 1 hours);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, ALICE, FUNDS, FUNDS + 1));
        vm.prank(ALICE);
        app.pledge(id, FUNDS + 1);
        assertEq(app.pledgeOf(id, ALICE), 0);
        assertEq(app.campaign(id).total, 0);
        _assertEscrow(0);
    }

    function test_partialAndFullUnpledgePayOnlyCallingBacker() public {
        uint256 id = _create(10 ether, 1 hours);
        _pledge(ALICE, id, 5 ether);
        _pledge(BOB, id, 1 ether);
        vm.expectEmit(true, true, false, true, address(app));
        emit Unpledged(id, ALICE, 2 ether, 4 ether);
        vm.prank(ALICE);
        app.unpledge(id, 2 ether);
        assertEq(app.pledgeOf(id, ALICE), 3 ether);
        assertEq(token.balanceOf(ALICE), FUNDS - 3 ether);
        vm.prank(ALICE);
        app.unpledge(id, 3 ether);
        assertEq(app.pledgeOf(id, ALICE), 0);
        assertEq(app.pledgeOf(id, BOB), 1 ether);
        assertEq(app.campaign(id).total, 1 ether);
        _assertEscrow(1 ether);
        vm.expectRevert(CrowdfundCampaigns.InsufficientPledge.selector);
        vm.prank(ALICE);
        app.unpledge(id, 1);
    }

    function test_unpledgeRejectsZeroAndOtherBackersFunds() public {
        uint256 id = _create(10 ether, 1 hours);
        _pledge(ALICE, id, 5 ether);
        vm.expectRevert(CrowdfundCampaigns.InvalidAmount.selector);
        vm.prank(ALICE);
        app.unpledge(id, 0);
        vm.expectRevert(CrowdfundCampaigns.InsufficientPledge.selector);
        vm.prank(ALICE);
        app.unpledge(id, 5 ether + 1);
        vm.expectRevert(CrowdfundCampaigns.InsufficientPledge.selector);
        vm.prank(BOB);
        app.unpledge(id, 1);
        _assertEscrow(5 ether);
    }

    function test_goalLockRacePledgeFirstInSameBlock() public {
        uint256 id = _create(10 ether, 1 hours);
        _pledge(ALICE, id, 9 ether);
        uint256 blockBefore = block.number;
        _pledge(BOB, id, 1 ether);
        vm.expectRevert(CrowdfundCampaigns.GoalReached.selector);
        vm.prank(ALICE);
        app.unpledge(id, 1);
        assertEq(block.number, blockBefore);
        assertEq(app.campaign(id).total, 10 ether);
    }

    function test_goalLockRaceUnpledgeFirstInSameBlock() public {
        uint256 id = _create(10 ether, 1 hours);
        _pledge(ALICE, id, 9 ether);
        uint256 blockBefore = block.number;
        vm.prank(ALICE);
        app.unpledge(id, 2 ether);
        _pledge(BOB, id, 1 ether);
        assertEq(app.campaign(id).total, 8 ether);
        _pledge(BOB, id, 2 ether);
        vm.expectRevert(CrowdfundCampaigns.GoalReached.selector);
        vm.prank(BOB);
        app.unpledge(id, 1);
        assertEq(block.number, blockBefore);
    }

    function test_pledgeAndUnpledgeBoundary() public {
        uint256 id = _create(10 ether, 1 hours);
        uint256 deadline = app.campaign(id).deadline;
        vm.warp(deadline - 1);
        _pledge(ALICE, id, 2 ether);
        vm.prank(ALICE);
        app.unpledge(id, 1 ether);
        vm.warp(deadline);
        vm.expectRevert(CrowdfundCampaigns.CampaignEnded.selector);
        vm.prank(ALICE);
        app.pledge(id, 1);
        vm.expectRevert(CrowdfundCampaigns.CampaignEnded.selector);
        vm.prank(ALICE);
        app.unpledge(id, 1);
    }

    function test_anyoneClaimsWholeOverfundedTotalToCreatorAtDeadline() public {
        uint256 id = _create(10 ether, 1 hours);
        _pledge(ALICE, id, 10 ether);
        _pledge(BOB, id, 7 ether + 1);
        vm.warp(app.campaign(id).deadline - 1);
        vm.expectRevert(CrowdfundCampaigns.CampaignStillOpen.selector);
        app.claim(id);
        vm.warp(vm.getBlockTimestamp() + 1);
        vm.expectEmit(true, true, false, true, address(app));
        emit Claimed(id, CREATOR, 17 ether + 1);
        vm.prank(STRANGER);
        app.claim(id);
        assertEq(token.balanceOf(CREATOR), FUNDS + 17 ether + 1);
        assertEq(token.balanceOf(STRANGER), 0);
        assertTrue(app.campaign(id).claimed);
        assertEq(app.campaign(id).total, 17 ether + 1);
        assertEq(app.pledgeOf(id, ALICE), 10 ether);
        _assertEscrow(0);
        vm.expectRevert(CrowdfundCampaigns.AlreadyClaimed.selector);
        app.claim(id);
        vm.expectRevert(CrowdfundCampaigns.GoalReached.selector);
        vm.prank(ALICE);
        app.refund(id);
    }

    function test_refundAtDeadlineAndDoubleRefundReverts() public {
        uint256 id = _create(10 ether, 1 hours);
        _pledge(ALICE, id, 3 ether);
        _pledge(BOB, id, 4 ether);
        vm.warp(app.campaign(id).deadline - 1);
        vm.expectRevert(CrowdfundCampaigns.CampaignStillOpen.selector);
        vm.prank(ALICE);
        app.refund(id);
        vm.warp(vm.getBlockTimestamp() + 1);
        vm.expectEmit(true, true, false, true, address(app));
        emit Refunded(id, ALICE, 3 ether);
        vm.prank(ALICE);
        app.refund(id);
        assertEq(token.balanceOf(ALICE), FUNDS);
        assertEq(app.pledgeOf(id, ALICE), 0);
        assertEq(app.pledgeOf(id, BOB), 4 ether);
        _assertEscrow(4 ether);
        vm.expectRevert(CrowdfundCampaigns.NothingToRefund.selector);
        vm.prank(ALICE);
        app.refund(id);
        vm.expectRevert(CrowdfundCampaigns.GoalNotReached.selector);
        app.claim(id);
        vm.prank(BOB);
        app.refund(id);
        assertEq(app.campaign(id).total, 7 ether);
        _assertEscrow(0);
    }

    function test_fundedCannotRefundBeforeOrAfterClaim() public {
        uint256 id = _create(1 ether, 1 hours);
        _pledge(ALICE, id, 1 ether);
        vm.warp(app.campaign(id).deadline);
        vm.expectRevert(CrowdfundCampaigns.GoalReached.selector);
        vm.prank(ALICE);
        app.refund(id);
        app.claim(id);
        vm.expectRevert(CrowdfundCampaigns.GoalReached.selector);
        vm.prank(ALICE);
        app.refund(id);
    }

    function test_emptyCampaignExpiresWithNothingToMove() public {
        uint256 id = _create(1 ether, 1 hours);
        vm.warp(app.campaign(id).deadline);
        vm.expectRevert(CrowdfundCampaigns.GoalNotReached.selector);
        app.claim(id);
        vm.expectRevert(CrowdfundCampaigns.NothingToRefund.selector);
        vm.prank(ALICE);
        app.refund(id);
        assertEq(app.campaign(id).total, 0);
        _assertEscrow(0);
    }

    function test_refundHasNoExpiryAndCannotBeRedirected() public {
        uint256 id = _create(10 ether, 1 hours);
        _pledge(ALICE, id, 1 ether);
        vm.warp(app.campaign(id).deadline + 365 days);
        vm.expectRevert(CrowdfundCampaigns.NothingToRefund.selector);
        vm.prank(STRANGER);
        app.refund(id);
        vm.prank(ALICE);
        app.refund(id);
        assertEq(token.balanceOf(ALICE), FUNDS);
        assertEq(token.balanceOf(STRANGER), 0);
    }

    function test_creatorCanTopUpOwnGoal() public {
        uint256 id = _create(10 ether, 1 hours);
        _pledge(ALICE, id, 8 ether);
        _pledge(CREATOR, id, 2 ether);
        vm.warp(app.campaign(id).deadline);
        app.claim(id);
        assertEq(token.balanceOf(CREATOR), FUNDS + 8 ether);
    }

    function test_campaignIdsIsolatePledgesClaimsAndRefunds() public {
        uint256 funded = _create(10 ether, 1 hours);
        vm.prank(BOB);
        uint256 failed = app.create(100 ether, vm.getBlockTimestamp() + 1 hours, TITLE);
        _pledge(ALICE, funded, 12 ether);
        _pledge(ALICE, failed, 3 ether);
        _pledge(BOB, failed, 4 ether);
        vm.warp(app.campaign(funded).deadline);
        app.claim(funded);
        assertEq(app.pledgeOf(failed, ALICE), 3 ether);
        assertEq(app.pledgeOf(failed, BOB), 4 ether);
        _assertEscrow(7 ether);
        vm.prank(ALICE);
        app.refund(failed);
        assertEq(app.pledgeOf(funded, ALICE), 12 ether);
        assertEq(app.pledgeOf(failed, BOB), 4 ether);
        _assertEscrow(4 ether);
        vm.expectRevert(CrowdfundCampaigns.GoalReached.selector);
        vm.prank(ALICE);
        app.refund(funded);
        vm.expectRevert(CrowdfundCampaigns.GoalNotReached.selector);
        app.claim(failed);
        vm.prank(BOB);
        app.refund(failed);
        _assertEscrow(0);
        assertEq(token.balanceOf(CREATOR), FUNDS + 12 ether);
        assertEq(token.balanceOf(ALICE), FUNDS - 12 ether);
        assertEq(token.balanceOf(BOB), FUNDS);
    }

    function test_directDonationsDoNotFundCampaignOrBecomeClaimable() public {
        uint256 id = _create(10 ether, 1 hours);
        _pledge(ALICE, id, 1 ether);
        token.transfer(address(app), 100 ether);
        assertEq(app.totalEscrowed(), 1 ether);
        assertEq(app.campaign(id).total, 1 ether);
        vm.warp(app.campaign(id).deadline);
        vm.prank(ALICE);
        app.refund(id);
        assertEq(app.totalEscrowed(), 0);
        assertEq(token.balanceOf(address(app)), 100 ether);
    }

    function test_noEthEntryPointsOrFallback() public {
        vm.deal(address(this), 3 ether);
        (bool success,) = address(app).call{value: 1 ether}("");
        assertFalse(success);
        (success,) = address(app).call{value: 1 ether}(
            abi.encodeCall(app.create, (1 ether, vm.getBlockTimestamp() + 1 hours, TITLE))
        );
        assertFalse(success);
        (success,) = address(app).call(hex"deadbeef");
        assertFalse(success);
        assertEq(address(app).balance, 0);
    }

    function testFuzz_roundingFreeRefundAccounting(uint256 pledgeAmount, uint256 withdrawAmount) public {
        pledgeAmount = bound(pledgeAmount, 1, FUNDS);
        withdrawAmount = bound(withdrawAmount, 0, pledgeAmount);
        uint256 id = _create(FUNDS + 1, 1 hours);
        _pledge(ALICE, id, pledgeAmount);
        if (withdrawAmount > 0) {
            vm.prank(ALICE);
            app.unpledge(id, withdrawAmount);
        }
        assertEq(app.pledgeOf(id, ALICE), pledgeAmount - withdrawAmount);
        _assertEscrow(pledgeAmount - withdrawAmount);
        vm.warp(app.campaign(id).deadline);
        if (pledgeAmount > withdrawAmount) {
            vm.prank(ALICE);
            app.refund(id);
        }
        assertEq(token.balanceOf(ALICE), FUNDS);
        _assertEscrow(0);
    }

    function testFuzz_claimConservesEveryMinorUnit(uint256 a, uint256 b) public {
        a = bound(a, 1 ether, FUNDS);
        b = bound(b, 1, FUNDS);
        uint256 id = _create(1 ether, 1 hours);
        _pledge(ALICE, id, a);
        _pledge(BOB, id, b);
        vm.warp(app.campaign(id).deadline);
        vm.prank(STRANGER);
        app.claim(id);
        assertEq(token.balanceOf(CREATOR), FUNDS + a + b);
        assertEq(token.balanceOf(ALICE) + token.balanceOf(BOB) + token.balanceOf(CREATOR), 3 * FUNDS);
        _assertEscrow(0);
    }

    function _create(uint256 goal, uint256 duration) private returns (uint256) {
        vm.prank(CREATOR);
        return app.create(goal, vm.getBlockTimestamp() + duration, TITLE);
    }

    function _pledge(address backer, uint256 id, uint256 amount) private {
        vm.prank(backer);
        app.pledge(id, amount);
    }

    function _assertEscrow(uint256 expected) private view {
        assertEq(token.balanceOf(address(app)), expected);
        assertEq(app.totalEscrowed(), expected);
    }
}
