// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CrowdfundCampaigns} from "../src/CrowdfundCampaigns.sol";
import {AdversarialToken} from "./mocks/AdversarialToken.sol";

contract TokenInteractionsTest is Test {
    AdversarialToken private token;
    CrowdfundCampaigns private app;
    address private constant CREATOR = address(0xC0FFEE);
    address private constant BACKER = address(0xB0B);

    function setUp() public {
        token = new AdversarialToken();
        app = new CrowdfundCampaigns(address(token));
        token.transfer(BACKER, 1_000 ether);
        vm.prank(BACKER);
        token.approve(address(app), type(uint256).max);
    }

    function test_falseOrRevertingTransferFromRollsBackAllAccounting() public {
        uint256 id = _create(10 ether);
        for (uint256 i = 1; i <= 2; ++i) {
            AdversarialToken.Mode mode = AdversarialToken.Mode(i);
            token.setModes(mode, AdversarialToken.Mode.Normal);
            _expectTransferFailure(mode);
            vm.prank(BACKER);
            app.pledge(id, 2 ether);
            assertEq(app.pledgeOf(id, BACKER), 0);
            assertEq(app.campaign(id).total, 0);
            assertEq(app.totalEscrowed(), 0);
            assertEq(token.balanceOf(address(app)), 0);
            assertEq(token.balanceOf(BACKER), 1_000 ether);
        }
        token.setModes(AdversarialToken.Mode.Normal, AdversarialToken.Mode.Normal);
        _pledge(id, 2 ether);
        assertEq(app.totalEscrowed(), 2 ether);
    }

    function test_shortOrPretendIncomingTransferCannotCreateUnbackedPledge() public {
        uint256 id = _create(10 ether);
        for (uint256 i = 4; i <= 5; ++i) {
            token.setModes(AdversarialToken.Mode(i), AdversarialToken.Mode.Normal);
            vm.expectRevert(CrowdfundCampaigns.InexactTransfer.selector);
            vm.prank(BACKER);
            app.pledge(id, 2 ether);
            assertEq(app.pledgeOf(id, BACKER), 0);
            assertEq(app.campaign(id).total, 0);
            assertEq(app.totalEscrowed(), 0);
            assertEq(token.balanceOf(address(app)), 0);
            assertEq(token.balanceOf(BACKER), 1_000 ether);
        }
    }

    function test_safeTransfersAcceptNoReturnDataOnEveryPaymentPath() public {
        token.setModes(AdversarialToken.Mode.NoReturn, AdversarialToken.Mode.NoReturn);
        uint256 funded = _create(1 ether);
        uint256 failed = _create(10 ether);
        _pledge(funded, 1 ether);
        _pledge(failed, 3 ether);
        vm.prank(BACKER);
        app.unpledge(failed, 1 ether);
        vm.warp(app.campaign(funded).deadline);
        app.claim(funded);
        vm.prank(BACKER);
        app.refund(failed);
        assertEq(token.balanceOf(CREATOR), 1 ether);
        assertEq(token.balanceOf(BACKER), 999 ether);
        assertEq(app.totalEscrowed(), 0);
        assertEq(token.balanceOf(address(app)), 0);
    }

    function test_failedClaimIsRetryableAndPreservesOtherCampaign() public {
        uint256 other = _create(100 ether);
        _pledge(other, 7 ether);
        uint256 id = _create(1 ether);
        _pledge(id, 2 ether);
        vm.warp(app.campaign(id).deadline);
        for (uint256 i = 1; i <= 2; ++i) {
            AdversarialToken.Mode mode = AdversarialToken.Mode(i);
            token.setModes(AdversarialToken.Mode.Normal, mode);
            _expectTransferFailure(mode);
            app.claim(id);
            assertFalse(app.campaign(id).claimed);
            assertEq(app.totalEscrowed(), 9 ether);
            assertEq(token.balanceOf(address(app)), 9 ether);
            assertEq(token.balanceOf(CREATOR), 0);
        }
        token.setModes(AdversarialToken.Mode.Normal, AdversarialToken.Mode.Normal);
        app.claim(id);
        assertEq(app.totalEscrowed(), 7 ether);
        assertEq(app.pledgeOf(other, BACKER), 7 ether);
        vm.prank(BACKER);
        app.refund(other);
        assertEq(app.totalEscrowed(), 0);
    }

    function test_failedRefundIsRetryable() public {
        uint256 id = _create(10 ether);
        _pledge(id, 2 ether);
        vm.warp(app.campaign(id).deadline);
        for (uint256 i = 1; i <= 2; ++i) {
            AdversarialToken.Mode mode = AdversarialToken.Mode(i);
            token.setModes(AdversarialToken.Mode.Normal, mode);
            _expectTransferFailure(mode);
            vm.prank(BACKER);
            app.refund(id);
            assertEq(app.pledgeOf(id, BACKER), 2 ether);
            assertEq(app.totalEscrowed(), 2 ether);
            assertEq(token.balanceOf(address(app)), 2 ether);
        }
        token.setModes(AdversarialToken.Mode.Normal, AdversarialToken.Mode.Normal);
        vm.prank(BACKER);
        app.refund(id);
        assertEq(token.balanceOf(BACKER), 1_000 ether);
        assertEq(app.totalEscrowed(), 0);
    }

    function test_failedUnpledgeIsRetryable() public {
        uint256 id = _create(10 ether);
        _pledge(id, 2 ether);
        for (uint256 i = 1; i <= 2; ++i) {
            AdversarialToken.Mode mode = AdversarialToken.Mode(i);
            token.setModes(AdversarialToken.Mode.Normal, mode);
            _expectTransferFailure(mode);
            vm.prank(BACKER);
            app.unpledge(id, 1 ether);
            assertEq(app.pledgeOf(id, BACKER), 2 ether);
            assertEq(app.campaign(id).total, 2 ether);
            assertEq(app.totalEscrowed(), 2 ether);
            assertEq(token.balanceOf(address(app)), 2 ether);
        }
        token.setModes(AdversarialToken.Mode.Normal, AdversarialToken.Mode.Normal);
        vm.prank(BACKER);
        app.unpledge(id, 1 ether);
        assertEq(app.pledgeOf(id, BACKER), 1 ether);
        assertEq(app.totalEscrowed(), 1 ether);
    }

    function test_reentrancyDuringPledgeRejectsEveryMutator() public {
        uint256 id = _create(10 ether);
        bytes[5] memory calls = _callbacks(id);
        for (uint256 i; i < calls.length; ++i) {
            token.arm(address(app), calls[i], true, false);
            _pledge(id, 1);
            _assertReentrancyBlocked();
            assertEq(app.pledgeOf(id, BACKER), i + 1);
            assertEq(app.totalEscrowed(), i + 1);
            assertEq(token.balanceOf(address(app)), i + 1);
        }
        assertEq(token.callbackCount(), 5);
        assertEq(app.campaignCount(), 1);
    }

    function test_reentrancyDuringUnpledgeRejectsEveryMutator() public {
        uint256 id = _create(10 ether);
        _pledge(id, 1 ether);
        bytes[5] memory calls = _callbacks(id);
        for (uint256 i; i < calls.length; ++i) {
            token.arm(address(app), calls[i], false, true);
            vm.prank(BACKER);
            app.unpledge(id, 1);
            _assertReentrancyBlocked();
        }
        assertEq(app.totalEscrowed(), 1 ether - 5);
        assertEq(token.balanceOf(address(app)), 1 ether - 5);
        assertEq(app.pledgeOf(id, BACKER), 1 ether - 5);
    }

    function test_reentrancyDuringClaimIncludingCrossCampaignClaim() public {
        uint256 other = _create(1 ether);
        _pledge(other, 1 ether);
        for (uint256 i; i < 6; ++i) {
            uint256 id = _create(1 ether);
            _pledge(id, 1 ether);
            bytes[5] memory calls = _callbacks(id);
            bytes memory data = i < 5 ? calls[i] : abi.encodeCall(app.claim, (other));
            token.arm(address(app), data, false, true);
            vm.warp(app.campaign(id).deadline);
            app.claim(id);
            _assertReentrancyBlocked();
            assertTrue(app.campaign(id).claimed);
            assertFalse(app.campaign(other).claimed);
        }
        assertEq(token.balanceOf(CREATOR), 6 ether);
        assertEq(app.totalEscrowed(), 1 ether);
        token.arm(address(0), "", false, false);
        app.claim(other);
        assertEq(app.totalEscrowed(), 0);
    }

    function test_reentrancyDuringRefundRejectsEveryMutator() public {
        for (uint256 i; i < 5; ++i) {
            uint256 id = _create(10 ether);
            _pledge(id, 1 ether);
            bytes[5] memory calls = _callbacks(id);
            token.arm(address(app), calls[i], false, true);
            vm.warp(app.campaign(id).deadline);
            vm.prank(BACKER);
            app.refund(id);
            _assertReentrancyBlocked();
            assertEq(app.pledgeOf(id, BACKER), 0);
            assertEq(app.totalEscrowed(), 0);
        }
        assertEq(token.balanceOf(BACKER), 1_000 ether);
        assertEq(token.balanceOf(address(app)), 0);
    }

    function _create(uint256 goal) private returns (uint256) {
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        vm.prank(CREATOR);
        return app.create(goal, deadline, bytes32("Test"));
    }

    function _pledge(uint256 id, uint256 amount) private {
        vm.prank(BACKER);
        app.pledge(id, amount);
    }

    function _expectTransferFailure(AdversarialToken.Mode mode) private {
        if (mode == AdversarialToken.Mode.FalseReturn) {
            vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        } else {
            vm.expectRevert(AdversarialToken.TransferBlocked.selector);
        }
    }

    function _callbacks(uint256 id) private view returns (bytes[5] memory calls) {
        calls[0] = abi.encodeCall(app.create, (1 ether, vm.getBlockTimestamp() + 90 days, bytes32(0)));
        calls[1] = abi.encodeCall(app.pledge, (id, 1));
        calls[2] = abi.encodeCall(app.unpledge, (id, 1));
        calls[3] = abi.encodeCall(app.claim, (id));
        calls[4] = abi.encodeCall(app.refund, (id));
    }

    function _assertReentrancyBlocked() private view {
        assertFalse(token.callbackSucceeded());
        assertEq(token.callbackResult(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
    }
}
