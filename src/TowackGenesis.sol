// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VRFConsumerV25} from "./VRFConsumerV25.sol";

/// @title TowackGenesis ("Genesis 300")
/// @notice 300 FREE mints for Agent ID holders, separate from the 5,000 paid TowackLaunch mints. No mint
/// price: the only BNB a minter sends is the Chainlink VRF fee (`vrfFeeAt(gasPrice)`), forwarded straight into
/// the VRF subscription in the same tx (excess refunded). The contract never holds BNB.
///
/// Design numbers:
///  - Cap 300 free mints. Base grant 20,000 TWAK per mint (paid mint: 80,000), sent instantly on mint.
///  - Each mint makes its own VRF v2.5 request; the callback pops ONE slot uniformly from a fixed,
///    mutually exclusive 300-slot deck (`word % remainingTotal`, walk 7 packed counts). The multiplier is
///    on the 20k base, so the extra is (mult - 1) * 20,000:
///        id 0  5x      5 slots  +80,000  (  400,000 total)
///        id 1  3x     10 slots  +40,000  (  400,000)
///        id 2  2x     20 slots  +20,000  (  400,000)
///        id 3  1.5x   40 slots  +10,000  (  400,000)
///        id 4  1.25x  50 slots   +5,000  (  250,000)
///        id 5  1.1x   75 slots   +2,000  (  150,000)
///        id 6  none  100 slots        0
///  - Sellout: base 300 * 20,000 = 6,000,000 + extra 2,000,000 = BUDGET 8,000,000 TWAK
///    (16% of the 50M / 5% ecosystem allocation). Pre-funded from the ecosystem wallet via `fund()`.
///    The contract never pulls from TowackLaunch, the LP pair, DrawV2 or the bonus reserve.
///  - Extra TWAK is pull-claimed with `claim()` once assigned.
///
/// Gate: the caller must `ownerOf(tokenId)` on the Agent ID (ERC-721) registry. Both the tokenId and the
/// wallet are marked used, so a used tokenId moved to a fresh wallet is still blocked and a wallet that
/// already minted cannot use a second tokenId.
///
/// Solvency: `committed()` is every TWAK the contract may still owe (unminted base + extra of undrawn deck
/// slots + assigned-but-unclaimed extra while open; assigned-but-unclaimed extra + worst-case extra for
/// pending VRF requests once closed). `open()` and `mint()` require `balance >= committed()`, and
/// `sweepSurplus()` can only send `balance - committed()` to the ecosystem wallet. Total assigned
/// (base + extra) is bounded by the deck and can never exceed BUDGET.
///
/// Owner (Ownable2Step; deployer first, can be handed to the timelock) can only open/close the window and
/// sweep surplus to the fixed ecosystem wallet. It cannot touch committed TWAK or change the deck.
contract TowackGenesis is VRFConsumerV25, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants
    uint256 public constant MAX_MINTS = 300;
    uint256 public constant BASE_TOKENS = 20_000e18;
    uint256 public constant DECK_EXTRA_TOTAL = 2_000_000e18;
    uint256 public constant BASE_TOTAL = MAX_MINTS * BASE_TOKENS; // 6M
    uint256 public constant BUDGET = BASE_TOTAL + DECK_EXTRA_TOTAL; // 8M
    uint256 public constant MAX_EXTRA = 80_000e18;

    uint8 public constant PRIZE_TIERS = 7;
    uint8 public constant NO_BONUS = 6;

    /// @dev Remaining slots per tier, 16 bits per tier. 5 / 10 / 20 / 40 / 50 / 75 / 100 = 300.
    uint256 internal constant INITIAL_DECK =
        5 | (10 << 16) | (20 << 32) | (40 << 48) | (50 << 64) | (75 << 80) | (100 << 96);

    uint256 public constant VRF_RETRY_DELAY = 1 hours;

    // ---------------------------------------------------------------- immutables
    IERC20 public immutable token;
    IERC721 public immutable agentId;
    address public immutable ecosystemWallet;

    // ---------------------------------------------------------------- state
    struct Ticket {
        uint32 index; // 1-based mint index, 0 = not a minter
        uint8 prizeId; // valid only if assigned
        bool assigned;
        bool claimed;
        uint64 requestedAt;
        uint256 agentTokenId;
        uint256 requestId;
    }

    bool public isOpen;
    uint256 public mintCount;
    uint256 public assignedCount;

    mapping(address => Ticket) public tickets;
    mapping(uint256 => bool) public tokenIdUsed;
    mapping(uint256 => address) public requestMinter;

    uint256 internal _deck = INITIAL_DECK;
    uint256 public remainingTotal = MAX_MINTS;
    /// @notice Extra TWAK of the slots still in the deck.
    uint256 public deckExtraRemaining = DECK_EXTRA_TOTAL;

    uint256 public baseGranted;
    uint256 public extraAssigned;
    uint256 public extraOutstanding;
    uint256 public totalFunded;
    uint256 public totalSwept;

    // ---------------------------------------------------------------- errors/events
    error AlreadyOpen();
    error NotOpen();
    error NotAgentOwner();
    error TokenIdUsed();
    error AlreadyMinted();
    error SoldOut();
    error Underfunded(uint256 have, uint256 need);
    error NotMinter();
    error NotAssigned();
    error AlreadyAssigned();
    error AlreadyClaimed();
    error NothingToClaim();
    error TooEarly();
    error ZeroAmount();
    error RenounceDisabled();

    event WindowOpened(uint256 balance, uint256 committed);
    event WindowClosed(uint256 mintCount);
    event GenesisMinted(address indexed minter, uint256 indexed mintIndex, uint256 indexed agentTokenId, uint256 base);
    event PrizeRequested(address indexed minter, uint256 indexed mintIndex, uint256 requestId);
    event PrizeRetried(address indexed minter, uint256 oldRequestId, uint256 newRequestId);
    event PrizeAssigned(address indexed minter, uint256 indexed mintIndex, uint8 prizeId, uint256 extraTokens);
    event Claimed(address indexed minter, uint8 prizeId, uint256 extraTokens);
    event BudgetFunded(address indexed from, uint256 amount, uint256 balance);
    event SurplusSwept(address indexed to, uint256 amount);

    constructor(address token_, address agentId_, address ecosystemWallet_, address owner_, VRFConfig memory vrf)
        VRFConsumerV25(vrf)
        Ownable(owner_)
    {
        require(token_ != address(0) && agentId_ != address(0) && ecosystemWallet_ != address(0), "zero addr");
        token = IERC20(token_);
        agentId = IERC721(agentId_);
        ecosystemWallet = ecosystemWallet_;
    }

    // ================================================================= funding / window (owner)
    /// @notice Pull `amount` TWAK from the caller (needs approval). Anyone may fund; the ecosystem wallet does.
    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        totalFunded += amount;
        emit BudgetFunded(msg.sender, amount, token.balanceOf(address(this)));
    }

    function open() external onlyOwner {
        if (isOpen) revert AlreadyOpen();
        if (mintCount >= MAX_MINTS) revert SoldOut();
        isOpen = true;
        uint256 need = committed();
        uint256 bal = token.balanceOf(address(this));
        if (bal < need) revert Underfunded(bal, need);
        emit WindowOpened(bal, need);
    }

    function close() external onlyOwner {
        if (!isOpen) revert NotOpen();
        isOpen = false;
        emit WindowClosed(mintCount);
    }

    /// @notice Send TWAK not needed for any current or future obligation back to the ecosystem wallet.
    /// Assigned-but-unclaimed prizes (and pending draws) stay reserved.
    function sweepSurplus() external onlyOwner nonReentrant returns (uint256 amount) {
        amount = surplus();
        if (amount == 0) revert ZeroAmount();
        totalSwept += amount;
        token.safeTransfer(ecosystemWallet, amount);
        emit SurplusSwept(ecosystemWallet, amount);
    }

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ================================================================= mint + VRF request
    /// @notice Free mint. Caller must own Agent ID `agentTokenId`. 20,000 TWAK now + one wheel spin.
    /// `msg.value` must cover the VRF fee (no mint price); excess is refunded.
    function mint(uint256 agentTokenId) external payable nonReentrant {
        if (!isOpen) revert NotOpen();
        if (mintCount >= MAX_MINTS) revert SoldOut();
        Ticket storage t = tickets[msg.sender];
        if (t.index != 0) revert AlreadyMinted();
        if (tokenIdUsed[agentTokenId]) revert TokenIdUsed();
        if (_ownerOf(agentTokenId) != msg.sender) revert NotAgentOwner();
        uint256 bal = token.balanceOf(address(this));
        uint256 need = committed();
        if (bal < need) revert Underfunded(bal, need);

        uint256 idx = ++mintCount;
        tokenIdUsed[agentTokenId] = true;
        t.index = uint32(idx);
        t.agentTokenId = agentTokenId;
        baseGranted += BASE_TOKENS;
        token.safeTransfer(msg.sender, BASE_TOKENS);
        emit GenesisMinted(msg.sender, idx, agentTokenId, BASE_TOKENS);
        (, uint256 fee) = _request(msg.sender, t);
        if (idx == MAX_MINTS) {
            isOpen = false;
            emit WindowClosed(idx);
        }
        _refund(msg.value - fee);
    }

    /// @notice Re-request a stalled VRF draw (anyone, after VRF_RETRY_DELAY). The old request is invalidated.
    /// The caller pays the new request's VRF fee (excess refunded).
    function retryPrize(address minter) external payable nonReentrant {
        Ticket storage t = tickets[minter];
        if (t.index == 0) revert NotMinter();
        if (t.assigned) revert AlreadyAssigned();
        if (block.timestamp < uint256(t.requestedAt) + VRF_RETRY_DELAY) revert TooEarly();
        uint256 old = t.requestId;
        delete requestMinter[old];
        (uint256 id, uint256 fee) = _request(minter, t);
        emit PrizeRetried(minter, old, id);
        _refund(msg.value - fee);
    }

    function _request(address minter, Ticket storage t) internal returns (uint256 id, uint256 fee) {
        (id, fee) = _requestRandomWordPaid(msg.value);
        t.requestId = id;
        t.requestedAt = uint64(block.timestamp);
        requestMinter[id] = minter;
        emit PrizeRequested(minter, t.index, id);
    }

    function _ownerOf(uint256 tokenId) internal view returns (address o) {
        try agentId.ownerOf(tokenId) returns (address a) {
            o = a;
        } catch {
            revert NotAgentOwner();
        }
    }

    // ================================================================= VRF callback
    function _fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        address minter = requestMinter[requestId];
        if (minter == address(0) || randomWords.length == 0) return;
        Ticket storage t = tickets[minter];
        if (t.assigned || t.requestId != requestId) return;
        delete requestMinter[requestId];

        uint8 prizeId = _drawFromDeck(randomWords[0]);
        uint256 extra = prizeExtra(prizeId);
        t.prizeId = prizeId;
        t.assigned = true;
        ++assignedCount;
        if (extra > 0) {
            deckExtraRemaining -= extra;
            extraAssigned += extra;
            extraOutstanding += extra;
        }
        emit PrizeAssigned(minter, t.index, prizeId, extra);
    }

    /// @dev remainingTotal >= 1 here: at most MAX_MINTS mints exist and each consumes exactly one slot.
    function _drawFromDeck(uint256 word) internal returns (uint8 k) {
        uint256 deck = _deck;
        uint256 pick = word % remainingTotal;
        for (k = 0; k < PRIZE_TIERS; ++k) {
            uint256 c = (deck >> (16 * uint256(k))) & 0xFFFF;
            if (pick < c) break;
            pick -= c;
        }
        _deck = deck - (uint256(1) << (16 * uint256(k)));
        --remainingTotal;
    }

    // ================================================================= claim
    function claim() external nonReentrant {
        Ticket storage t = tickets[msg.sender];
        if (t.index == 0) revert NotMinter();
        if (!t.assigned) revert NotAssigned();
        if (t.claimed) revert AlreadyClaimed();
        uint8 id = t.prizeId;
        uint256 extra = prizeExtra(id);
        if (extra == 0) revert NothingToClaim();
        t.claimed = true;
        extraOutstanding -= extra;
        token.safeTransfer(msg.sender, extra);
        emit Claimed(msg.sender, id, extra);
    }

    // ================================================================= views
    /// @notice TWAK the contract may still owe.
    function committed() public view returns (uint256) {
        if (isOpen) {
            return (MAX_MINTS - mintCount) * BASE_TOKENS + deckExtraRemaining + extraOutstanding;
        }
        uint256 pending = mintCount - assignedCount;
        uint256 worst = pending * MAX_EXTRA;
        if (worst > deckExtraRemaining) worst = deckExtraRemaining;
        return extraOutstanding + worst;
    }

    function surplus() public view returns (uint256) {
        uint256 bal = token.balanceOf(address(this));
        uint256 need = committed();
        return bal > need ? bal - need : 0;
    }

    /// @notice Total TWAK handed out or owed so far (base + assigned extra). Never exceeds BUDGET.
    function totalAssigned() external view returns (uint256) {
        return baseGranted + extraAssigned;
    }

    function pendingCount() external view returns (uint256) {
        return mintCount - assignedCount;
    }

    function hasMinted(address minter) external view returns (bool) {
        return tickets[minter].index != 0;
    }

    function prizeOf(address minter)
        external
        view
        returns (bool minted, bool assigned, uint8 prizeId, uint256 extraAmount, bool claimed)
    {
        Ticket storage t = tickets[minter];
        minted = t.index != 0;
        assigned = t.assigned;
        claimed = t.claimed;
        if (assigned) {
            prizeId = t.prizeId;
            extraAmount = prizeExtra(prizeId);
        }
    }

    function remaining(uint8 id) public view returns (uint256) {
        require(id < PRIZE_TIERS, "tier");
        return (_deck >> (16 * uint256(id))) & 0xFFFF;
    }

    function remainingCounts() external view returns (uint256[7] memory counts) {
        uint256 deck = _deck;
        for (uint256 k; k < PRIZE_TIERS; ++k) {
            counts[k] = (deck >> (16 * k)) & 0xFFFF;
        }
    }

    function prizeSlots(uint8 id) public pure returns (uint256) {
        require(id < PRIZE_TIERS, "tier");
        return (INITIAL_DECK >> (16 * uint256(id))) & 0xFFFF;
    }

    /// @notice Extra TWAK on top of the 20k base (5x => +80k, ..., 1.1x => +2k, none => 0).
    function prizeExtra(uint8 id) public pure returns (uint256) {
        if (id == 0) return 80_000e18;
        if (id == 1) return 40_000e18;
        if (id == 2) return 20_000e18;
        if (id == 3) return 10_000e18;
        if (id == 4) return 5_000e18;
        if (id == 5) return 2_000e18;
        if (id == NO_BONUS) return 0;
        revert("tier");
    }
}
