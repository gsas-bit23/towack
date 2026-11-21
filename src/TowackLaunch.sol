// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAgentId} from "./interfaces/IAgentId.sol";
import {IPancakePair, IWBNB} from "./interfaces/IPancakeV2.sol";
import {VRFConsumerV25} from "./VRFConsumerV25.sol";
import {TokenBound} from "./TokenBound.sol";
import {SwapOrNot} from "./libraries/SwapOrNot.sol";
import {TowackToken} from "./TowackToken.sol";

/// @title TowackLaunch
/// @notice Public mint + Draw V1 + PancakeSwap v2 listing, in one ownerless contract.
///
/// Flow:
///  1. mint(): 0.1 BNB -> 80,000 TWAK instantly. One per Agent ID holder, cap 5000.
///  2. closeMint(): anyone, after `mintEnd` or at sellout. Burns unsold mint tokens and makes ONE
///     Chainlink VRF v2.5 request.
///  3. VRF callback stores a single seed (nothing else).
///  4. finalizeDraw(): anyone. Fixes slot counts (scaled with floor(N*slots/5000) if undersold), burns
///     the unused token-bonus reserve, seeds the TWAK/WBNB pair at the mint price (800,000 TWAK/BNB),
///     burns unused LP tokens, sends remaining BNB to the Draw V2 treasury, opens trading.
///  5. claim(): each minter pulls their BNB refund and/or token bonus. A minter's slot in each table is
///     `SwapOrNot.permute(minterIndex, N, seed_table)` - a bijection, so the fixed slot counts are
///     honoured exactly and payouts are solvent by construction.
///
/// There is no owner. No function can move mint proceeds, prize pots or LP anywhere except to the
/// fixed destinations above.
contract TowackLaunch is VRFConsumerV25, TokenBound, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants
    uint256 public constant MINT_PRICE = 0.1 ether;
    uint256 public constant TOKENS_PER_MINT = 80_000e18;
    uint256 public constant MAX_MINTS = 5000;

    uint256 public constant LP_TOKENS_PER_BNB = 800_000; // listing price == mint price
    uint256 public constant MAX_LP_BNB = 250 ether; // 250 BNB * 800k = 200M TWAK

    uint256 public constant BNB_TIERS = 4;
    uint256 public constant BONUS_TIERS = 6;

    uint256 public constant VRF_RETRY_DELAY = 1 days;
    uint256 public constant CLAIM_WINDOW = 180 days;

    /// @dev LP tokens are burned (sent to address(0)) by default. A time-locker could be used instead
    /// in a later version by changing this constant before deploy.
    address public constant LP_RECIPIENT = address(0);

    // ---------------------------------------------------------------- immutables
    IAgentId public immutable agentId;
    IWBNB public immutable wbnb;
    address public immutable drawV2Treasury;
    uint256 public immutable mintStart;
    uint256 public immutable mintEnd;

    // ---------------------------------------------------------------- state
    enum Phase {
        Minting,
        DrawPending,
        Seeded,
        Finalized
    }

    Phase public phase;
    address public pair;
    uint256 public mintCount;
    mapping(address => bool) public hasMinted;
    /// @dev 1-based index of each minter (0 = not a minter).
    mapping(address => uint256) public minterIndex;
    mapping(address => bool) public claimed;

    uint256 public vrfRequestId;
    uint256 public vrfRequestedAt;
    bytes32 public seed;

    uint256 public bnbPrizeTotal;
    uint256 public bonusTotal;
    uint256 public bnbOutstanding;
    uint256 public bonusOutstanding;
    uint256 public lpBnb;
    uint256 public lpTokens;
    uint256 public sentToDrawV2;
    uint256 public claimDeadline;

    // ---------------------------------------------------------------- errors/events
    error WrongPhase(Phase have);
    error MintNotOpen();
    error NoAgentId();
    error AlreadyMinted();
    error WrongPrice();
    error SoldOut();
    error MintStillOpen();
    error TooEarly();
    error NotMinter();
    error AlreadyClaimed();
    error NothingToClaim();
    error ClaimWindowClosed();
    error TransferFailed();

    event Minted(address indexed minter, uint256 indexed index);
    event MintClosed(uint256 mintCount, uint256 burnedUnsold);
    event DrawRequested(uint256 requestId);
    event DrawSeeded(uint256 requestId, bytes32 seed);
    event DrawFinalized(
        uint256 bnbPrizeTotal, uint256 bonusTotal, uint256 lpBnb, uint256 lpTokens, uint256 sentToDrawV2
    );
    event Claimed(address indexed minter, uint256 bnbAmount, uint256 bonusAmount);
    event UnclaimedSwept(uint256 bnbToDrawV2, uint256 tokensBurned);

    constructor(
        address agentId_,
        address wbnb_,
        address drawV2Treasury_,
        uint256 mintStart_,
        uint256 mintEnd_,
        VRFConfig memory vrf
    ) VRFConsumerV25(vrf) {
        require(agentId_ != address(0) && wbnb_ != address(0) && drawV2Treasury_ != address(0), "zero addr");
        require(mintEnd_ > mintStart_, "bad window");
        agentId = IAgentId(agentId_);
        wbnb = IWBNB(wbnb_);
        drawV2Treasury = drawV2Treasury_;
        mintStart = mintStart_;
        mintEnd = mintEnd_;
    }

    function _expectedAllocation() internal pure override returns (uint256) {
        return 650_000_000e18; // 400M mint + 50M bonus reserve + 200M LP
    }

    /// @notice Set-once by the deployer, right after the token mints this contract's allocation.
    function bindToken(address token_) external {
        _bindToken(token_);
        require(TowackToken(token_).launch() == address(this), "not launch");
        pair = TowackToken(token_).pair();
    }

    // ================================================================= 1. mint
    function mint() external payable nonReentrant whenBound {
        if (phase != Phase.Minting) revert WrongPhase(phase);
        if (block.timestamp < mintStart || block.timestamp >= mintEnd) revert MintNotOpen();
        if (agentId.balanceOf(msg.sender) == 0) revert NoAgentId();
        if (hasMinted[msg.sender]) revert AlreadyMinted();
        if (msg.value != MINT_PRICE) revert WrongPrice();
        if (mintCount >= MAX_MINTS) revert SoldOut();

        hasMinted[msg.sender] = true;
        uint256 idx = ++mintCount;
        minterIndex[msg.sender] = idx;
        token.safeTransfer(msg.sender, TOKENS_PER_MINT);
        emit Minted(msg.sender, idx);
    }

    // ================================================================= 2. close + VRF
    function closeMint() external nonReentrant whenBound {
        if (phase != Phase.Minting) revert WrongPhase(phase);
        if (block.timestamp < mintEnd && mintCount < MAX_MINTS) revert MintStillOpen();

        uint256 unsold = (MAX_MINTS - mintCount) * TOKENS_PER_MINT;
        if (unsold > 0) TowackToken(address(token)).burn(unsold);
        emit MintClosed(mintCount, unsold);

        if (mintCount == 0) {
            // Nothing sold: burn the bonus reserve and LP allocation, nothing to list.
            TowackToken(address(token)).burn(token.balanceOf(address(this)));
            phase = Phase.Finalized;
            claimDeadline = block.timestamp;
            return;
        }
        phase = Phase.DrawPending;
        _request();
    }

    /// @notice If VRF has not answered for VRF_RETRY_DELAY, anyone can re-request. Only the latest
    /// request id is accepted, so stale fulfilments are ignored.
    function retryDraw() external nonReentrant {
        if (phase != Phase.DrawPending) revert WrongPhase(phase);
        if (block.timestamp < vrfRequestedAt + VRF_RETRY_DELAY) revert TooEarly();
        _request();
    }

    function _request() internal {
        vrfRequestedAt = block.timestamp;
        vrfRequestId = _requestRandomWord();
        emit DrawRequested(vrfRequestId);
    }

    function _fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        if (phase != Phase.DrawPending || requestId != vrfRequestId || randomWords.length == 0) return;
        seed = bytes32(randomWords[0]);
        phase = Phase.Seeded;
        emit DrawSeeded(requestId, seed);
    }

    // ================================================================= 4. finalize + list
    function finalizeDraw() external nonReentrant {
        if (phase != Phase.Seeded) revert WrongPhase(phase);
        phase = Phase.Finalized;
        uint256 n = mintCount;

        uint256 prizes;
        for (uint256 k; k < BNB_TIERS; ++k) {
            prizes += bnbTierCount(n, k) * bnbTierAmount(k);
        }
        uint256 bonuses;
        for (uint256 k; k < BONUS_TIERS; ++k) {
            bonuses += bonusTierCount(n, k) * bonusTierAmount(k);
        }
        // Solvency by construction (prizes <= 0.035 BNB * N < proceeds, bonuses <= 35.2M < 50M).
        assert(prizes <= address(this).balance);
        assert(bonuses <= 50_000_000e18);

        bnbPrizeTotal = prizes;
        bnbOutstanding = prizes;
        bonusTotal = bonuses;
        bonusOutstanding = bonuses;
        claimDeadline = block.timestamp + CLAIM_WINDOW;

        TowackToken twak = TowackToken(address(token));
        uint256 unusedBonus = 50_000_000e18 - bonuses;
        if (unusedBonus > 0) twak.burn(unusedBonus);

        // ---- Listing at mint price
        uint256 leftover = address(this).balance - prizes;
        uint256 bnbForLp = leftover < MAX_LP_BNB ? leftover : MAX_LP_BNB;
        uint256 tokensForLp = bnbForLp * LP_TOKENS_PER_BNB;
        lpBnb = bnbForLp;
        lpTokens = tokensForLp;
        uint256 unusedLp = 200_000_000e18 - tokensForLp;
        if (unusedLp > 0) twak.burn(unusedLp);

        // Seed the pair directly (not via router) so pre-donated WBNB / a pre-synced pair cannot make
        // the listing revert. TWAK cannot be pre-deposited because of the token's pair guard.
        wbnb.deposit{value: bnbForLp}();
        require(wbnb.transfer(pair, bnbForLp), "wbnb transfer");
        token.safeTransfer(pair, tokensForLp);
        IPancakePair(pair).mint(LP_RECIPIENT);
        twak.openTrading();

        uint256 toV2 = leftover - bnbForLp;
        sentToDrawV2 = toV2;
        if (toV2 > 0) _sendBnb(drawV2Treasury, toV2);

        emit DrawFinalized(prizes, bonuses, bnbForLp, tokensForLp, toV2);
    }

    // ================================================================= 5. claims
    function claim() external nonReentrant {
        if (phase != Phase.Finalized) revert WrongPhase(phase);
        if (block.timestamp >= claimDeadline) revert ClaimWindowClosed();
        uint256 idx = minterIndex[msg.sender];
        if (idx == 0) revert NotMinter();
        if (claimed[msg.sender]) revert AlreadyClaimed();

        (, uint256 bnbAmt,, uint256 bonusAmt) = _prizeOfIndex(idx - 1);
        if (bnbAmt == 0 && bonusAmt == 0) revert NothingToClaim();
        claimed[msg.sender] = true;
        bnbOutstanding -= bnbAmt;
        bonusOutstanding -= bonusAmt;

        if (bonusAmt > 0) token.safeTransfer(msg.sender, bonusAmt);
        if (bnbAmt > 0) _sendBnb(msg.sender, bnbAmt);
        emit Claimed(msg.sender, bnbAmt, bonusAmt);
    }

    /// @notice After the claim window, unclaimed BNB goes to Draw V2 and unclaimed bonus TWAK is burned.
    function sweepUnclaimed() external nonReentrant {
        if (phase != Phase.Finalized) revert WrongPhase(phase);
        if (block.timestamp < claimDeadline) revert TooEarly();
        uint256 bnbAmt = address(this).balance;
        uint256 tok = token.balanceOf(address(this));
        bnbOutstanding = 0;
        bonusOutstanding = 0;
        if (tok > 0) TowackToken(address(token)).burn(tok);
        if (bnbAmt > 0) _sendBnb(drawV2Treasury, bnbAmt);
        emit UnclaimedSwept(bnbAmt, tok);
    }

    // ================================================================= views
    /// @return bnbTier 0..3 = 100/75/50/25 % refund, 4 = none
    /// @return bnbAmount refund in wei
    /// @return bonusTier 0..5 = 5x/3x/2x/1.5x/1.25x/1.1x, 6 = none
    /// @return bonusAmount extra TWAK
    function prizeOf(address minter)
        external
        view
        returns (uint256 bnbTier, uint256 bnbAmount, uint256 bonusTier, uint256 bonusAmount)
    {
        uint256 idx = minterIndex[minter];
        if (idx == 0 || (phase != Phase.Seeded && phase != Phase.Finalized)) return (BNB_TIERS, 0, BONUS_TIERS, 0);
        return _prizeOfIndex(idx - 1);
    }

    function _prizeOfIndex(uint256 i)
        internal
        view
        returns (uint256 bnbTier, uint256 bnbAmount, uint256 bonusTier, uint256 bonusAmount)
    {
        uint256 n = mintCount;
        uint256 pB = SwapOrNot.permute(i, n, keccak256(abi.encode(seed, "TWAK_BNB")));
        uint256 pT = SwapOrNot.permute(i, n, keccak256(abi.encode(seed, "TWAK_BONUS")));
        bnbTier = BNB_TIERS;
        uint256 cum;
        for (uint256 k; k < BNB_TIERS; ++k) {
            cum += bnbTierCount(n, k);
            if (pB < cum) {
                bnbTier = k;
                bnbAmount = bnbTierAmount(k);
                break;
            }
        }
        bonusTier = BONUS_TIERS;
        cum = 0;
        for (uint256 k; k < BONUS_TIERS; ++k) {
            cum += bonusTierCount(n, k);
            if (pT < cum) {
                bonusTier = k;
                bonusAmount = bonusTierAmount(k);
                break;
            }
        }
    }

    /// @notice Slots per BNB tier at sellout: 500 / 600 / 800 / 1600 (1500 no prize).
    function bnbTierSlots(uint256 k) public pure returns (uint256) {
        if (k == 0) return 500;
        if (k == 1) return 600;
        if (k == 2) return 800;
        if (k == 3) return 1600;
        revert("tier");
    }

    function bnbTierAmount(uint256 k) public pure returns (uint256) {
        if (k == 0) return 0.1 ether;
        if (k == 1) return 0.075 ether;
        if (k == 2) return 0.05 ether;
        if (k == 3) return 0.025 ether;
        revert("tier");
    }

    /// @notice Slots per bonus tier at sellout: 20 / 40 / 80 / 160 / 320 / 400.
    function bonusTierSlots(uint256 k) public pure returns (uint256) {
        if (k == 0) return 20;
        if (k == 1) return 40;
        if (k == 2) return 80;
        if (k == 3) return 160;
        if (k == 4) return 320;
        if (k == 5) return 400;
        revert("tier");
    }

    /// @notice Extra TWAK on top of the 80k minted (5x => +320k, ..., 1.1x => +8k).
    function bonusTierAmount(uint256 k) public pure returns (uint256) {
        if (k == 0) return 320_000e18;
        if (k == 1) return 160_000e18;
        if (k == 2) return 80_000e18;
        if (k == 3) return 40_000e18;
        if (k == 4) return 20_000e18;
        if (k == 5) return 8_000e18;
        revert("tier");
    }

    function bnbTierCount(uint256 n, uint256 k) public pure returns (uint256) {
        return n * bnbTierSlots(k) / MAX_MINTS;
    }

    function bonusTierCount(uint256 n, uint256 k) public pure returns (uint256) {
        return n * bonusTierSlots(k) / MAX_MINTS;
    }

    // ================================================================= internal
    function _sendBnb(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev Only WBNB unwraps would ever send BNB here; mint() is the payable entry point.
    receive() external payable {
        require(msg.sender == address(wbnb), "no direct BNB");
    }
}
