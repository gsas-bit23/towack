// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TokenBound} from "./TokenBound.sol";

/// @title RebateDistributor
/// @notice Streams the 10% (100M TWAK) trader-rebate allocation in weekly epochs, pro-rata to the
/// router FEES PAID by each trader in that epoch (not raw notional), plus a BNB boost equal to the 50%
/// fee share the router forwards here. Only traders active in an epoch earn for that epoch - there is
/// no sit-and-earn staking.
///
/// Wash-trading note: a round trip pays 1% on each BNB leg; the rebate only returns a share of a fixed
/// TWAK budget plus half of fees, so washing is only "profitable" if the TWAK budget for the epoch is
/// worth more than ~50% of the fees a washer pays, and every other trader dilutes them.
///
/// Epoch 0 starts at deploy. Epochs with zero fees (e.g. before listing) roll their TWAK and BNB
/// budgets into the next epoch, so nothing is stranded. No owner; parameters are constants.
contract RebateDistributor is TokenBound, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TOTAL_REBATES = 100_000_000e18;
    uint256 public constant EPOCH_LENGTH = 7 days;
    uint256 public constant NUM_EPOCHS = 104; // ~2 years of token emissions

    uint256 public immutable startTime;
    address public router;

    // per-epoch accounting
    mapping(uint256 => uint256) public totalFees;
    mapping(uint256 => mapping(address => uint256)) public feesOf;
    mapping(uint256 => uint256) public bnbDeposited;
    mapping(uint256 => uint256) public tokenBudget; // finalized
    mapping(uint256 => uint256) public bnbBudget; // finalized
    mapping(uint256 => mapping(address => bool)) public claimed;

    uint256 public finalizedEpochs; // epochs [0, finalizedEpochs) are finalized
    uint256 public carryTokens;
    uint256 public carryBnb;

    error OnlyRouter();
    error EpochNotFinished(uint256 epoch);

    event FeeRecorded(uint256 indexed epoch, address indexed trader, uint256 fee, uint256 bnbBoost);
    event Claimed(address indexed trader, uint256 indexed epoch, uint256 tokens, uint256 bnb);

    constructor() {
        startTime = block.timestamp;
    }

    function _expectedAllocation() internal pure override returns (uint256) {
        return TOTAL_REBATES;
    }

    function bind(address token_, address router_) external {
        _bindToken(token_);
        require(router_ != address(0), "router");
        router = router_;
    }

    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - startTime) / EPOCH_LENGTH;
    }

    /// @notice Token emission scheduled for epoch `e` (before roll-over).
    function baseEmission(uint256 e) public pure returns (uint256) {
        if (e >= NUM_EPOCHS) return 0;
        uint256 per = TOTAL_REBATES / NUM_EPOCHS;
        if (e == NUM_EPOCHS - 1) return TOTAL_REBATES - per * (NUM_EPOCHS - 1);
        return per;
    }

    /// @notice Called by the router on every swap. `msg.value` is the BNB boost share of the fee.
    function recordFee(address trader, uint256 fee) external payable {
        if (msg.sender != router) revert OnlyRouter();
        checkpoint();
        uint256 e = currentEpoch();
        totalFees[e] += fee;
        feesOf[e][trader] += fee;
        bnbDeposited[e] += msg.value;
        emit FeeRecorded(e, trader, fee, msg.value);
    }

    /// @notice Finalizes every finished epoch. Permissionless; also called by claim/recordFee.
    function checkpoint() public {
        uint256 cur = currentEpoch();
        uint256 e = finalizedEpochs;
        if (e >= cur) return;
        uint256 cT = carryTokens;
        uint256 cB = carryBnb;
        for (; e < cur; ++e) {
            uint256 t = baseEmission(e) + cT;
            uint256 b = bnbDeposited[e] + cB;
            if (totalFees[e] == 0) {
                (cT, cB) = (t, b);
            } else {
                tokenBudget[e] = t;
                bnbBudget[e] = b;
                (cT, cB) = (0, 0);
            }
        }
        finalizedEpochs = cur;
        carryTokens = cT;
        carryBnb = cB;
    }

    function claimable(address trader, uint256 e) public view returns (uint256 tokens, uint256 bnb) {
        if (e >= finalizedEpochs || claimed[e][trader]) return (0, 0);
        uint256 total = totalFees[e];
        if (total == 0) return (0, 0);
        uint256 f = feesOf[e][trader];
        tokens = tokenBudget[e] * f / total;
        bnb = bnbBudget[e] * f / total;
    }

    function claim(uint256[] calldata epochs) external nonReentrant whenBound {
        checkpoint();
        uint256 sumT;
        uint256 sumB;
        for (uint256 i; i < epochs.length; ++i) {
            uint256 e = epochs[i];
            if (e >= finalizedEpochs) revert EpochNotFinished(e);
            (uint256 t, uint256 b) = claimable(msg.sender, e);
            claimed[e][msg.sender] = true;
            sumT += t;
            sumB += b;
            emit Claimed(msg.sender, e, t, b);
        }
        if (sumT > 0) token.safeTransfer(msg.sender, sumT);
        if (sumB > 0) {
            (bool ok,) = msg.sender.call{value: sumB}("");
            require(ok, "bnb");
        }
    }
}
