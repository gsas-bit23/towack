// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Set-once token binding. Allocation-holding contracts are deployed BEFORE the token
/// (the token mints to them in its constructor), so they learn the token address afterwards.
/// `bindToken` can be called exactly once, only by the deployer, and only if this contract already
/// holds exactly its expected allocation. After binding the deployer has no further power.
abstract contract TokenBound {
    error AlreadyBound();
    error NotDeployer();
    error BadAllocation(uint256 have, uint256 want);
    error NotBound();

    address public immutable deployer;
    IERC20 public token;

    event TokenBound_(address indexed token);

    constructor() {
        deployer = msg.sender;
    }

    function _expectedAllocation() internal view virtual returns (uint256);

    function _bindToken(address token_) internal {
        if (msg.sender != deployer) revert NotDeployer();
        if (address(token) != address(0)) revert AlreadyBound();
        uint256 bal = IERC20(token_).balanceOf(address(this));
        if (bal != _expectedAllocation()) revert BadAllocation(bal, _expectedAllocation());
        token = IERC20(token_);
        emit TokenBound_(token_);
    }

    modifier whenBound() {
        if (address(token) == address(0)) revert NotBound();
        _;
    }
}
