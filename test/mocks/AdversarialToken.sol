// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only token that exercises SafeERC20 and external-call boundaries.
contract AdversarialToken is ERC20 {
    enum Mode {
        Normal,
        FalseReturn,
        RevertTransfer,
        NoReturn,
        ShortTransfer,
        NoTransfer
    }

    Mode public incomingMode;
    Mode public outgoingMode;
    address public callbackTarget;
    bytes public callbackData;
    bool public onIncoming;
    bool public onOutgoing;
    bool public callbackSucceeded;
    bytes public callbackResult;
    uint256 public callbackCount;

    error TransferBlocked();

    constructor() ERC20("Adversarial test token", "TEST") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function setModes(Mode incoming, Mode outgoing) external {
        incomingMode = incoming;
        outgoingMode = outgoing;
    }

    function arm(address target, bytes calldata data, bool incoming, bool outgoing) external {
        callbackTarget = target;
        callbackData = data;
        onIncoming = incoming;
        onOutgoing = outgoing;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        Mode mode = incomingMode;
        if (mode == Mode.FalseReturn) return false;
        if (mode == Mode.RevertTransfer) revert TransferBlocked();
        if (mode == Mode.NoTransfer) return true;
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, mode == Mode.ShortTransfer ? amount - 1 : amount);
        if (onIncoming) _callback();
        if (mode == Mode.NoReturn) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        return true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        Mode mode = outgoingMode;
        if (mode == Mode.FalseReturn) return false;
        if (mode == Mode.RevertTransfer) revert TransferBlocked();
        if (mode == Mode.NoTransfer) return true;
        _transfer(msg.sender, to, mode == Mode.ShortTransfer ? amount - 1 : amount);
        if (onOutgoing) _callback();
        if (mode == Mode.NoReturn) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        return true;
    }

    function _callback() private {
        ++callbackCount;
        (callbackSucceeded, callbackResult) = callbackTarget.call(callbackData);
    }
}
