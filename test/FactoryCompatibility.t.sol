// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {CrowdfundCampaigns} from "../src/CrowdfundCampaigns.sol";

/// @dev Local constructor probe, not the protocol factory or a deployment script.
contract FactoryProbe {
    function deploy() external returns (LaunchToken token, CrowdfundCampaigns app) {
        token = new LaunchToken{salt: bytes32(uint256(1))}();
        app = new CrowdfundCampaigns{salt: bytes32(uint256(2))}(address(token));
    }
}

contract FactoryCompatibilityTest is Test {
    function test_factoryDeploymentPreservesSupplyAndRequiresNoInitialization() public {
        vm.chainId(11155111);
        FactoryProbe factory = new FactoryProbe();
        (LaunchToken token, CrowdfundCampaigns app) = factory.deploy();
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(factory)), 1e27);
        assertEq(token.balanceOf(address(app)), 0);
        assertEq(address(app.token()), address(token));
        // The creator is the runtime caller, never the factory that deployed the app.
        address creator = address(0xC0FFEE);
        vm.prank(creator);
        uint256 id = app.create(1 ether, block.timestamp + 1 hours, bytes32("Ready"));
        assertEq(app.campaign(id).creator, creator);
        assertEq(token.balanceOf(address(factory)), 1e27);
        _checkRuntime(address(token));
        _checkRuntime(address(app));
    }

    function _checkRuntime(address target) private view {
        bytes memory code = target.code;
        assertGt(code.length, 0);
        assertLe(code.length, 24_576);
        for (uint256 i; i < code.length; ++i) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
                continue;
            }
            assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff, "forbidden opcode");
        }
    }
}
