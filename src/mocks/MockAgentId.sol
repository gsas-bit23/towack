// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice TESTNET/TEST ONLY. Soulbound mock Agent ID: one per address, non-transferable.
/// Anyone can self-register on testnet; the owner can register others.
contract MockAgentId {
    address public immutable owner;
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    event Registered(address indexed who);

    constructor() {
        owner = msg.sender;
    }

    function register() external {
        _register(msg.sender);
    }

    function registerFor(address who) external {
        require(msg.sender == owner, "owner");
        _register(who);
    }

    function _register(address who) internal {
        require(balanceOf[who] == 0, "has id");
        balanceOf[who] = 1;
        ++totalSupply;
        emit Registered(who);
    }
}
