// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAgentId} from "./interfaces/IAgentId.sol";
import {IPancakeRouter02} from "./interfaces/IPancakeV2.sol";
import {RebateDistributor} from "./RebateDistributor.sol";

/// @title TowackRouter
/// @notice TWAK/BNB swaps through PancakeSwap v2. Open to ANY wallet; trader rebates are Agent ID-only.
///  - 1% fee on the BNB leg (input for buys, output for sells), charged on every trade.
///  - Fee split: 50% rebate share (RebateDistributor), 30% Draw V2 / lottery treasury, 20% dev.
///    Agent ID holders: the 50% share is forwarded with a fee record (`recordFee`), so they earn the
///    epoch's TWAK + BNB rebate pro-rata to fees paid. Non-Agent wallets: no fee record (no TWAK
///    dilution, nothing to claim); their 50% share is sent as an unattributed BNB boost
///    (`depositBoost`) to the current epoch, shared by that epoch's Agent traders. The 30/20 shares
///    accrue here and are pushed by the permissionless `flushFees()` (so a reverting recipient can never
///    block swaps).
///  - Approvals: users approve this router for the exact sell amount; this router approves Pancake for
///    exactly `amountIn` per swap and resets to 0 afterwards. There is no unlimited-approval helper.
///  - Leash-style per-Agent-ID daily limit on BNB-leg notional, set by the user on-chain. Lowering a
///    limit takes effect immediately; raising it takes effect after LIMIT_RAISE_DELAY, so a compromised
///    agent key cannot instantly lift its own leash. Default (never set) = unlimited.
///    Agent IDs are soulbound, so the limit is keyed by holder address.
/// No owner; all parameters are immutable.
contract TowackRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 100; // 1%
    uint256 public constant BPS = 10_000;
    uint256 public constant REBATE_SHARE_BPS = 5_000;
    uint256 public constant LOTTERY_SHARE_BPS = 3_000;
    // dev share = remainder (20%)
    uint256 public constant LIMIT_RAISE_DELAY = 1 days;
    uint256 public constant UNLIMITED = type(uint256).max;

    IERC20 public immutable token;
    IPancakeRouter02 public immutable pancake;
    address public immutable wbnb;
    IAgentId public immutable agentId;
    RebateDistributor public immutable rebates;
    address public immutable lotteryTreasury;
    address public immutable dev;

    struct Leash {
        uint256 limit; // 0 = never set (unlimited)
        uint256 pendingLimit;
        uint64 pendingAt;
        uint64 day;
        uint256 spent;
    }

    mapping(address => Leash) public leashOf;

    // volume / fee stats
    mapping(address => uint256) public volumeOf; // BNB-leg notional
    mapping(address => uint256) public feesPaidOf;
    uint256 public totalVolume;
    uint256 public totalFees;

    uint256 public pendingLottery;
    uint256 public pendingDev;

    error DailyLimitExceeded(uint256 wouldSpend, uint256 limit);
    error InsufficientOutput(uint256 out, uint256 min);
    error ZeroAmount();
    error BadLimit();

    event Bought(address indexed trader, uint256 bnbIn, uint256 fee, uint256 tokensOut);
    event Sold(address indexed trader, uint256 tokensIn, uint256 bnbOutGross, uint256 fee);
    event LimitSet(address indexed trader, uint256 limit, uint256 effectiveAt);
    event FeesFlushed(uint256 lottery, uint256 dev);

    constructor(
        address token_,
        address pancake_,
        address agentId_,
        address rebates_,
        address lotteryTreasury_,
        address dev_
    ) {
        require(
            token_ != address(0) && pancake_ != address(0) && agentId_ != address(0) && rebates_ != address(0)
                && lotteryTreasury_ != address(0) && dev_ != address(0),
            "zero addr"
        );
        token = IERC20(token_);
        pancake = IPancakeRouter02(pancake_);
        wbnb = IPancakeRouter02(pancake_).WETH();
        agentId = IAgentId(agentId_);
        rebates = RebateDistributor(rebates_);
        lotteryTreasury = lotteryTreasury_;
        dev = dev_;
    }

    // ================================================================= leash
    /// @notice Set your daily BNB-leg limit (wei). Use UNLIMITED to remove. Decreases are immediate;
    /// increases activate after LIMIT_RAISE_DELAY.
    function setDailyLimit(uint256 newLimit) external {
        if (newLimit == 0) revert BadLimit(); // use 1 wei to effectively freeze
        Leash storage l = leashOf[msg.sender];
        _applyPending(l);
        uint256 cur = l.limit == 0 ? UNLIMITED : l.limit;
        if (newLimit <= cur) {
            l.limit = newLimit;
            l.pendingLimit = 0;
            l.pendingAt = 0;
            emit LimitSet(msg.sender, newLimit, block.timestamp);
        } else {
            l.pendingLimit = newLimit;
            l.pendingAt = uint64(block.timestamp + LIMIT_RAISE_DELAY);
            emit LimitSet(msg.sender, newLimit, l.pendingAt);
        }
    }

    function effectiveLimit(address user) public view returns (uint256) {
        Leash memory l = leashOf[user];
        uint256 lim = l.limit;
        if (l.pendingAt != 0 && block.timestamp >= l.pendingAt) lim = l.pendingLimit;
        return lim == 0 ? UNLIMITED : lim;
    }

    function spentToday(address user) public view returns (uint256) {
        Leash memory l = leashOf[user];
        return l.day == block.timestamp / 1 days ? l.spent : 0;
    }

    function _applyPending(Leash storage l) internal {
        if (l.pendingAt != 0 && block.timestamp >= l.pendingAt) {
            l.limit = l.pendingLimit;
            l.pendingLimit = 0;
            l.pendingAt = 0;
        }
    }

    function _spend(address user, uint256 amount) internal {
        Leash storage l = leashOf[user];
        _applyPending(l);
        uint64 today = uint64(block.timestamp / 1 days);
        if (l.day != today) {
            l.day = today;
            l.spent = 0;
        }
        uint256 lim = l.limit == 0 ? UNLIMITED : l.limit;
        uint256 next = l.spent + amount;
        if (next > lim) revert DailyLimitExceeded(next, lim);
        l.spent = next;
    }

    // ================================================================= swaps
    /// @notice Buy TWAK with BNB. 1% of msg.value is taken as fee before swapping.
    function buy(uint256 minTokensOut, uint256 deadline) external payable nonReentrant returns (uint256 out) {
        if (msg.value == 0) revert ZeroAmount();
        _spend(msg.sender, msg.value);
        uint256 fee = msg.value * FEE_BPS / BPS;
        uint256 net = msg.value - fee;

        address[] memory path = new address[](2);
        path[0] = wbnb;
        path[1] = address(token);
        uint256 before = token.balanceOf(msg.sender);
        pancake.swapExactETHForTokensSupportingFeeOnTransferTokens{value: net}(minTokensOut, path, msg.sender, deadline);
        out = token.balanceOf(msg.sender) - before;
        if (out < minTokensOut) revert InsufficientOutput(out, minTokensOut);

        _takeFee(msg.sender, msg.value, fee);
        emit Bought(msg.sender, msg.value, fee, out);
    }

    /// @notice Sell exactly `amountIn` TWAK for BNB. Requires an exact (or larger) allowance to this
    /// router; 1% of the BNB output is taken as fee.
    function sell(uint256 amountIn, uint256 minBnbOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 netOut)
    {
        if (amountIn == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amountIn);
        token.forceApprove(address(pancake), amountIn); // exact approval

        address[] memory path = new address[](2);
        path[0] = address(token);
        path[1] = wbnb;
        uint256 before = address(this).balance;
        // Gross min = net min grossed-up by the fee, rounded up.
        uint256 grossMin = (minBnbOut * BPS + (BPS - FEE_BPS) - 1) / (BPS - FEE_BPS);
        pancake.swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn, grossMin, path, address(this), deadline);
        if (token.allowance(address(this), address(pancake)) != 0) token.forceApprove(address(pancake), 0);

        uint256 gross = address(this).balance - before;
        _spend(msg.sender, gross);
        uint256 fee = gross * FEE_BPS / BPS;
        netOut = gross - fee;
        if (netOut < minBnbOut) revert InsufficientOutput(netOut, minBnbOut);

        _takeFee(msg.sender, gross, fee);
        (bool ok,) = msg.sender.call{value: netOut}("");
        require(ok, "bnb");
        emit Sold(msg.sender, amountIn, gross, fee);
    }

    function _takeFee(address trader, uint256 notional, uint256 fee) internal {
        volumeOf[trader] += notional;
        feesPaidOf[trader] += fee;
        totalVolume += notional;
        totalFees += fee;

        uint256 toRebate = fee * REBATE_SHARE_BPS / BPS;
        uint256 toLottery = fee * LOTTERY_SHARE_BPS / BPS;
        pendingLottery += toLottery;
        pendingDev += fee - toRebate - toLottery;
        if (agentId.balanceOf(trader) > 0) {
            rebates.recordFee{value: toRebate}(trader, fee);
        } else {
            // Non-Agent: no rebate eligibility; half the fee still boosts this epoch's BNB pot.
            rebates.depositBoost{value: toRebate}();
        }
    }

    /// @notice Push accrued lottery/dev fees to their fixed recipients. Permissionless.
    function flushFees() external nonReentrant {
        uint256 l = pendingLottery;
        uint256 d = pendingDev;
        pendingLottery = 0;
        pendingDev = 0;
        if (l > 0) {
            (bool ok,) = lotteryTreasury.call{value: l}("");
            require(ok, "lottery");
        }
        if (d > 0) {
            (bool ok2,) = dev.call{value: d}("");
            require(ok2, "dev");
        }
        emit FeesFlushed(l, d);
    }

    /// @notice Push only accrued Draw V2 / lottery fees (isolated from `dev` so a reverting dev wallet
    /// can never trap lottery funds). Permissionless.
    function flushLottery() external nonReentrant {
        uint256 l = pendingLottery;
        pendingLottery = 0;
        if (l > 0) {
            (bool ok,) = lotteryTreasury.call{value: l}("");
            require(ok, "lottery");
        }
        emit FeesFlushed(l, 0);
    }

    /// @notice Push only accrued dev fees (isolated from `lotteryTreasury`). Permissionless.
    function flushDev() external nonReentrant {
        uint256 d = pendingDev;
        pendingDev = 0;
        if (d > 0) {
            (bool ok,) = dev.call{value: d}("");
            require(ok, "dev");
        }
        emit FeesFlushed(0, d);
    }

    /// @dev Accept BNB only from Pancake (sell proceeds).
    receive() external payable {
        require(msg.sender == address(pancake), "only pancake");
    }
}
