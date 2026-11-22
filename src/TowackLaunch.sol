// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAgentId} from "./interfaces/IAgentId.sol";
import {IPancakePair, IWBNB} from "./interfaces/IPancakeV2.sol";
import {VRFConsumerV25} from "./VRFConsumerV25.sol";
import {TokenBound} from "./TokenBound.sol";
import {TowackToken} from "./TowackToken.sol";

/// @title TowackLaunch
/// @notice Public mint + Draw V1 (instant per-mint prize deck) + PancakeSwap v2 listing, in one ownerless
/// contract.
///
/// Flow:
///  1. mint(): 0.1 BNB + the VRF fee (`vrfFeeAt(gasPrice)`) -> 80,000 TWAK instantly. One per Agent ID
///     holder, cap 5000. Each mint makes its own Chainlink VRF v2.5 request; exactly the wrapper's price is
///     forwarded to the VRF v2.5 direct-funding wrapper and any excess over 0.1 BNB + price is refunded. Only the 0.1 BNB stays in this contract.
///  2. VRF callback: pops ONE slot uniformly at random from the remaining fixed 5,000-slot prize deck and
///     assigns it to that minter (event `PrizeAssigned`). Prizes are mutually exclusive: a BNB refund
///     tier, a TWAK bonus tier, or "better luck next time".
///  3. claim(): pull-based, any time after the minter's prize is assigned.
///  4. closeMint(): anyone, after `mintEnd` or at sellout. Burns unsold mint tokens. If the immutable
///     `instantClose` flag is set (testnet rehearsal stacks only), it may also run before `mintEnd` as soon as
///     at least one mint exists. Production deploys pass `instantClose = false`.
///  5. finalizeListing(): anyone, once closed AND every mint has an assigned prize. Burns the unused bonus
///     reserve, keeps the still-unclaimed BNB prizes in escrow, lists the remaining BNB at the mint price
///     (800,000 TWAK/BNB, capped at 250 BNB / 200M TWAK) with the LP burned, sends the rest to DrawV2 and
///     opens trading.
///  6. sweepUnclaimed(): after the 180-day claim window, unclaimed BNB -> DrawV2, unclaimed bonus burned.
///
/// The prize deck (immutable, see `prizeSlots`) always starts at 5,000 slots; it is NOT rescaled for an
/// undersold mint. Slots never drawn are simply unsold: their bonus tokens are burned and the BNB they
/// would have needed is never reserved, so it flows to LP / DrawV2.
///
/// Randomness / MEV notes:
///  - The VRF word is only used as a uniform index into the remaining deck (`word % remainingTotal`).
///    There is no user-supplied randomness. Mempool observers can neither change the VRF word (it is
///    proven by the oracle key) nor the minter it is assigned to (bound to the request id at mint).
///    The only thing ordering can affect is WHICH remaining deck state a fulfilment sees, which does not
///    bias any individual draw: every draw is uniform over whatever slots remain.
///  - The callback is O(number of tiers) = O(11), never O(mints), so it fits comfortably in the
///    configured callbackGasLimit (see docs/ARCHITECTURE.md for the measured worst case and the tight limit).
///  - `retryPrize` (after VRF_RETRY_DELAY without an answer) re-requests and invalidates the old request.
///    Chainlink advises against re-requests because a fulfilment that is still pending at that point could
///    in theory be front-run with a retry (a re-roll). The delay makes that only possible during a VRF
///    outage; it exists so a stalled request can never lock the listing forever.
///
/// There is no owner. No function can move mint proceeds, reserved prize BNB or LP anywhere except to the
/// fixed destinations above.
contract TowackLaunch is VRFConsumerV25, TokenBound, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants
    uint256 public constant MINT_PRICE = 0.1 ether;
    uint256 public constant TOKENS_PER_MINT = 80_000e18;
    uint256 public constant MAX_MINTS = 5000;

    uint256 public constant LP_TOKENS_PER_BNB = 800_000; // listing price == mint price
    uint256 public constant MAX_LP_BNB = 250 ether; // 250 BNB * 800k = 200M TWAK
    uint256 public constant LP_TOKEN_ALLOCATION = 200_000_000e18;
    uint256 public constant BONUS_RESERVE = 50_000_000e18;

    /// @notice Prize ids: 0..3 BNB refund tiers, 4..9 TWAK bonus tiers, 10 = no win.
    uint8 public constant PRIZE_TIERS = 11;
    uint8 public constant NO_WIN = 10;

    /// @dev Remaining slots per tier, packed 16 bits per tier (tier k at bits [16k, 16k+16)).
    /// 500 / 600 / 800 / 1600 / 20 / 40 / 80 / 160 / 320 / 400 / 480 = 5000.
    uint256 internal constant INITIAL_DECK = 500 | (600 << 16) | (800 << 32) | (1600 << 48) | (20 << 64)
        | (40 << 80) | (80 << 96) | (160 << 112) | (320 << 128) | (400 << 144) | (480 << 160);

    /// @notice Total BNB / bonus TWAK of the full deck (all 5000 slots drawn).
    uint256 public constant DECK_BNB_TOTAL = 175 ether;
    uint256 public constant DECK_BONUS_TOTAL = 35_200_000e18;

    uint256 public constant VRF_RETRY_DELAY = 1 hours;
    uint256 public constant CLAIM_WINDOW = 180 days;

    /// @dev LP tokens are burned (sent to address(0)).
    address public constant LP_RECIPIENT = address(0);

    // ---------------------------------------------------------------- immutables
    IAgentId public immutable agentId;
    IWBNB public immutable wbnb;
    address public immutable drawV2Treasury;
    uint256 public immutable mintStart;
    uint256 public immutable mintEnd;
    /// @notice Rehearsal-only: when true, `closeMint()` may run before `mintEnd` once `mintCount >= 1`.
    /// False on production stacks (close only at/after `mintEnd` or at sellout).
    bool public immutable instantClose;

    // ---------------------------------------------------------------- state
    enum Phase {
        Minting,
        Closed,
        Finalized
    }

    struct Ticket {
        uint32 index; // 1-based mint index, 0 = not a minter
        uint8 prizeId; // valid only if assigned
        bool assigned;
        bool claimed;
        uint64 requestedAt;
        uint256 requestId; // live VRF request for this minter
    }

    Phase public phase;
    address public pair;
    uint256 public mintCount;
    uint256 public assignedCount;

    mapping(address => Ticket) public tickets;
    /// @notice Live VRF request id -> minter. Cleared on fulfilment or retry (stale ids map to nothing).
    mapping(uint256 => address) public requestMinter;

    uint256 internal _deck = INITIAL_DECK;
    uint256 public remainingTotal = MAX_MINTS;

    uint256 public bnbAssigned;
    uint256 public bonusAssigned;
    uint256 public bnbOutstanding;
    uint256 public bonusOutstanding;

    uint256 public lpBnb;
    uint256 public lpTokens;
    uint256 public sentToDrawV2;
    uint256 public bonusBurned;
    /// @notice 0 until finalizeListing; claims have no deadline before that.
    uint256 public claimDeadline;

    // ---------------------------------------------------------------- errors/events
    error WrongPhase(Phase have);
    error MintNotOpen();
    error NoAgentId();
    error AlreadyMinted();
    error WrongPrice();
    error SoldOut();
    error MintStillOpen();
    error PrizesPending(uint256 pending);
    error TooEarly();
    error NotMinter();
    error NotAssigned();
    error AlreadyAssigned();
    error AlreadyClaimed();
    error NothingToClaim();
    error ClaimWindowClosed();
    error TransferFailed();

    event Minted(address indexed minter, uint256 indexed mintIndex);
    event PrizeRequested(address indexed minter, uint256 indexed mintIndex, uint256 requestId);
    event PrizeAssigned(
        address indexed minter, uint256 indexed mintIndex, uint8 prizeId, uint256 bnbWei, uint256 bonusTokens
    );
    event MintClosed(uint256 mintCount, uint256 burnedUnsold);
    event ListingFinalized(
        uint256 reservedBnb, uint256 bonusBurned, uint256 lpBnb, uint256 lpTokens, uint256 sentToDrawV2
    );
    event Claimed(address indexed minter, uint8 prizeId, uint256 bnbAmount, uint256 bonusAmount);
    event UnclaimedSwept(uint256 bnbToDrawV2, uint256 tokensBurned);

    constructor(
        address agentId_,
        address wbnb_,
        address drawV2Treasury_,
        uint256 mintStart_,
        uint256 mintEnd_,
        VRFConfig memory vrf,
        bool instantClose_
    ) VRFConsumerV25(vrf) {
        require(agentId_ != address(0) && wbnb_ != address(0) && drawV2Treasury_ != address(0), "zero addr");
        require(mintEnd_ > mintStart_, "bad window");
        agentId = IAgentId(agentId_);
        wbnb = IWBNB(wbnb_);
        drawV2Treasury = drawV2Treasury_;
        mintStart = mintStart_;
        mintEnd = mintEnd_;
        instantClose = instantClose_;
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

    // ================================================================= 1. mint + VRF request
    function mint() external payable nonReentrant whenBound {
        if (phase != Phase.Minting) revert WrongPhase(phase);
        if (block.timestamp < mintStart || block.timestamp >= mintEnd) revert MintNotOpen();
        if (agentId.balanceOf(msg.sender) == 0) revert NoAgentId();
        Ticket storage t = tickets[msg.sender];
        if (t.index != 0) revert AlreadyMinted();
        if (msg.value < MINT_PRICE) revert WrongPrice();
        if (mintCount >= MAX_MINTS) revert SoldOut();

        uint256 idx = ++mintCount;
        t.index = uint32(idx);
        token.safeTransfer(msg.sender, TOKENS_PER_MINT);
        emit Minted(msg.sender, idx);
        // MINT_PRICE stays here (launch accounting); exactly the wrapper price goes to the VRF wrapper; the rest is refunded.
        uint256 available = msg.value - MINT_PRICE;
        uint256 fee = _request(msg.sender, t, available);
        _refund(available - fee);
    }

    /// @notice If a minter's VRF request has not been answered for VRF_RETRY_DELAY, anyone can re-request
    /// for that minter. The previous request id is invalidated, so a late fulfilment of it is ignored.
    /// The caller pays the VRF fee of the new request (`msg.value >= vrfFeeAt(gasprice)`, excess refunded).
    function retryPrize(address minter) external payable nonReentrant {
        Ticket storage t = tickets[minter];
        if (t.index == 0) revert NotMinter();
        if (t.assigned) revert AlreadyAssigned();
        if (block.timestamp < uint256(t.requestedAt) + VRF_RETRY_DELAY) revert TooEarly();
        delete requestMinter[t.requestId];
        uint256 fee = _request(minter, t, msg.value);
        _refund(msg.value - fee);
    }

    function _request(address minter, Ticket storage t, uint256 available) internal returns (uint256 fee) {
        uint256 id;
        (id, fee) = _requestRandomWordPaid(available);
        t.requestId = id;
        t.requestedAt = uint64(block.timestamp);
        requestMinter[id] = minter;
        emit PrizeRequested(minter, t.index, id);
    }

    // ================================================================= 2. VRF callback: draw from deck
    /// @dev O(PRIZE_TIERS). Never reverts on bad input (stale / unknown ids are ignored) so the wrapper
    /// never sees a failed callback for them.
    function _fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        address minter = requestMinter[requestId];
        if (minter == address(0) || randomWords.length == 0) return;
        Ticket storage t = tickets[minter];
        if (t.assigned || t.requestId != requestId) return;
        delete requestMinter[requestId];

        uint8 prizeId = _drawFromDeck(randomWords[0]);
        uint256 bnbAmt = prizeBnb(prizeId);
        uint256 bonusAmt = prizeBonus(prizeId);

        t.prizeId = prizeId;
        t.assigned = true;
        ++assignedCount;
        if (bnbAmt > 0) {
            bnbAssigned += bnbAmt;
            bnbOutstanding += bnbAmt;
        }
        if (bonusAmt > 0) {
            bonusAssigned += bonusAmt;
            bonusOutstanding += bonusAmt;
        }
        emit PrizeAssigned(minter, t.index, prizeId, bnbAmt, bonusAmt);
    }

    /// @dev Picks slot `word % remainingTotal` of the remaining deck and removes it.
    /// remainingTotal >= 1 here: at most MAX_MINTS mints exist and each consumes exactly one slot.
    function _drawFromDeck(uint256 word) internal returns (uint8 k) {
        uint256 deck = _deck;
        uint256 pick = word % remainingTotal;
        for (k = 0; k < PRIZE_TIERS; ++k) {
            uint256 c = (deck >> (16 * uint256(k))) & 0xFFFF;
            if (pick < c) break;
            pick -= c;
        }
        // k < PRIZE_TIERS always holds because sum(counts) == remainingTotal > pick.
        _deck = deck - (uint256(1) << (16 * uint256(k)));
        --remainingTotal;
    }

    // ================================================================= 3. claims
    /// @notice Pull your assigned prize (BNB refund or bonus TWAK). Available as soon as it is assigned.
    function claim() external nonReentrant {
        Ticket storage t = tickets[msg.sender];
        if (t.index == 0) revert NotMinter();
        if (!t.assigned) revert NotAssigned();
        if (t.claimed) revert AlreadyClaimed();
        if (claimDeadline != 0 && block.timestamp >= claimDeadline) revert ClaimWindowClosed();
        uint8 id = t.prizeId;
        uint256 bnbAmt = prizeBnb(id);
        uint256 bonusAmt = prizeBonus(id);
        if (bnbAmt == 0 && bonusAmt == 0) revert NothingToClaim();

        t.claimed = true;
        bnbOutstanding -= bnbAmt;
        bonusOutstanding -= bonusAmt;
        if (bonusAmt > 0) token.safeTransfer(msg.sender, bonusAmt);
        if (bnbAmt > 0) _sendBnb(msg.sender, bnbAmt);
        emit Claimed(msg.sender, id, bnbAmt, bonusAmt);
    }

    // ================================================================= 4. close
    function closeMint() external nonReentrant whenBound {
        if (phase != Phase.Minting) revert WrongPhase(phase);
        if (block.timestamp < mintEnd && mintCount < MAX_MINTS && !(instantClose && mintCount >= 1)) {
            revert MintStillOpen();
        }

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
        phase = Phase.Closed;
    }

    // ================================================================= 5. finalize + list
    function finalizeListing() external nonReentrant {
        if (phase != Phase.Closed) revert WrongPhase(phase);
        uint256 pending = mintCount - assignedCount;
        if (pending != 0) revert PrizesPending(pending);
        phase = Phase.Finalized;
        claimDeadline = block.timestamp + CLAIM_WINDOW;

        TowackToken twak = TowackToken(address(token));
        // Bonus reserve not assigned to anyone (unsold deck slots + no-win/BNB slots) is burned.
        uint256 unusedBonus = BONUS_RESERVE - bonusAssigned;
        bonusBurned = unusedBonus;
        if (unusedBonus > 0) twak.burn(unusedBonus);

        // Assigned-but-unclaimed refunds stay in escrow. Everything else is free for LP / DrawV2.
        uint256 reserved = bnbOutstanding;
        uint256 leftover = address(this).balance - reserved;
        uint256 bnbForLp = leftover < MAX_LP_BNB ? leftover : MAX_LP_BNB;
        uint256 tokensForLp = bnbForLp * LP_TOKENS_PER_BNB; // <= 200M by the 250 BNB cap
        lpBnb = bnbForLp;
        lpTokens = tokensForLp;
        uint256 unusedLp = LP_TOKEN_ALLOCATION - tokensForLp;
        if (unusedLp > 0) twak.burn(unusedLp);

        if (bnbForLp > 0) {
            // Seed the pair directly (not via router) so pre-donated WBNB / a pre-synced pair cannot make
            // the listing revert. TWAK cannot be pre-deposited because of the token's pair guard.
            wbnb.deposit{value: bnbForLp}();
            require(wbnb.transfer(pair, bnbForLp), "wbnb transfer");
            token.safeTransfer(pair, tokensForLp);
            IPancakePair(pair).mint(LP_RECIPIENT);
        }
        twak.openTrading();

        uint256 toV2 = leftover - bnbForLp;
        sentToDrawV2 = toV2;
        if (toV2 > 0) _sendBnb(drawV2Treasury, toV2);

        emit ListingFinalized(reserved, unusedBonus, bnbForLp, tokensForLp, toV2);
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
    function hasMinted(address minter) external view returns (bool) {
        return tickets[minter].index != 0;
    }

    function minterIndex(address minter) external view returns (uint256) {
        return tickets[minter].index;
    }

    /// @notice Number of mints still waiting for their VRF prize.
    function pendingCount() external view returns (uint256) {
        return mintCount - assignedCount;
    }

    /// @notice A minter's prize. `assigned` is false until the VRF callback lands.
    function prizeOf(address minter)
        external
        view
        returns (bool minted, bool assigned, uint8 prizeId, uint256 bnbAmount, uint256 bonusAmount, bool claimed)
    {
        Ticket storage t = tickets[minter];
        minted = t.index != 0;
        assigned = t.assigned;
        claimed = t.claimed;
        if (assigned) {
            prizeId = t.prizeId;
            bnbAmount = prizeBnb(prizeId);
            bonusAmount = prizeBonus(prizeId);
        }
    }

    /// @notice Remaining slots in tier `id`.
    function remaining(uint8 id) public view returns (uint256) {
        require(id < PRIZE_TIERS, "tier");
        return (_deck >> (16 * uint256(id))) & 0xFFFF;
    }

    /// @notice Remaining slots for all 11 tiers (index = prize id).
    function remainingCounts() external view returns (uint256[11] memory counts) {
        uint256 deck = _deck;
        for (uint256 k; k < PRIZE_TIERS; ++k) {
            counts[k] = (deck >> (16 * k)) & 0xFFFF;
        }
    }

    /// @notice Slots per prize id in the full 5,000-slot deck.
    function prizeSlots(uint8 id) public pure returns (uint256) {
        require(id < PRIZE_TIERS, "tier");
        return (INITIAL_DECK >> (16 * uint256(id))) & 0xFFFF;
    }

    /// @notice BNB refund for prize id (0 for bonus / no-win tiers).
    function prizeBnb(uint8 id) public pure returns (uint256) {
        if (id == 0) return 0.1 ether;
        if (id == 1) return 0.075 ether;
        if (id == 2) return 0.05 ether;
        if (id == 3) return 0.025 ether;
        if (id < PRIZE_TIERS) return 0;
        revert("tier");
    }

    /// @notice Extra TWAK for prize id, on top of the 80k minted (5x => +320k, ..., 1.1x => +8k).
    function prizeBonus(uint8 id) public pure returns (uint256) {
        if (id == 4) return 320_000e18;
        if (id == 5) return 160_000e18;
        if (id == 6) return 80_000e18;
        if (id == 7) return 40_000e18;
        if (id == 8) return 20_000e18;
        if (id == 9) return 8_000e18;
        if (id < PRIZE_TIERS) return 0;
        revert("tier");
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
