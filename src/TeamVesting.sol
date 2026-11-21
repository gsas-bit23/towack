// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TokenBound} from "./TokenBound.sol";

/// @title TeamVesting
/// @notice 50M TWAK. Vesting START = contract deploy timestamp (documented choice; not listing).
/// Nothing vests during the 1-year cliff. After the cliff, tokens vest linearly in whole days over
/// 4 years (1460 days), fully vested at start + 365d + 1460d (~5 years). No listing unlock, no owner,
/// no revocation. Beneficiary is immutable; anyone may trigger `release()` (tokens only go to it).
contract TeamVesting is TokenBound {
    using SafeERC20 for IERC20;

    uint256 public constant TOTAL = 50_000_000e18;
    uint256 public constant CLIFF = 365 days;
    uint256 public constant VESTING_DAYS = 1460; // 4 years, daily steps

    address public immutable beneficiary;
    uint256 public immutable start;
    uint256 public released;

    event Released(uint256 amount);

    constructor(address beneficiary_) {
        require(beneficiary_ != address(0), "beneficiary");
        beneficiary = beneficiary_;
        start = block.timestamp;
    }

    function _expectedAllocation() internal pure override returns (uint256) {
        return TOTAL;
    }

    function bindToken(address token_) external {
        _bindToken(token_);
    }

    function cliffEnd() public view returns (uint256) {
        return start + CLIFF;
    }

    function vestedAmount(uint256 timestamp) public view returns (uint256) {
        if (timestamp < cliffEnd()) return 0;
        uint256 daysElapsed = (timestamp - cliffEnd()) / 1 days;
        if (daysElapsed >= VESTING_DAYS) return TOTAL;
        return TOTAL * daysElapsed / VESTING_DAYS;
    }

    function releasable() public view returns (uint256) {
        return vestedAmount(block.timestamp) - released;
    }

    function release() external whenBound {
        uint256 amt = releasable();
        require(amt > 0, "nothing");
        released += amt;
        token.safeTransfer(beneficiary, amt);
        emit Released(amt);
    }
}
