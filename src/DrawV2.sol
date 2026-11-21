// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VRFConsumerV25} from "./VRFConsumerV25.sol";
import {TokenBound} from "./TokenBound.sol";

/// @notice Optional price source (TWAP / oracle). Must return USD per 1 TWAK, 18 decimals.
interface ITwakPriceSource {
    function twakUsdPrice() external view returns (uint256);
}

/// @title DrawV2 (MVP / skeleton)
/// @notice Weekly token-ticket draw and Draw V2 treasury.
///  - Holds the 7% (70M TWAK) prize allocation and receives BNB from: Draw V1 leftover, the router's
///    30% fee share, and unclaimed V1 refunds.
///  - Players spend TWAK for tickets: target "$1 of TWAK = 1 ticket". Spent TWAK is BURNED (no custody).
///  - TWAK/USD comes from `priceSource` (TWAP/oracle) if set, else from a manual `usdPerTwak`.
///    Both setters are onlyOwner and the owner is a TimelockController (48h) in the deploy script.
///    Never reads a raw spot reserve.
///  - Each finished round with tickets makes one VRF request; a single winner is chosen weighted by
///    tickets and pulls: TOKEN_PRIZE_PER_ROUND TWAK + BNB_POT_BPS of the unallocated BNB pot.
///  - The owner has NO function to withdraw BNB or TWAK. Funds only leave as prizes.
contract DrawV2 is VRFConsumerV25, TokenBound, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PRIZE_ALLOCATION = 70_000_000e18;
    uint256 public constant ROUND_LENGTH = 7 days;
    uint256 public constant TOKEN_PRIZE_PER_ROUND = 700_000e18; // 100 rounds
    uint256 public constant BNB_POT_BPS = 2_000; // 20% of free BNB per round
    uint256 public constant VRF_RETRY_DELAY = 1 days;

    uint256 public immutable startTime;

    uint256 public usdPerTwak; // 1e18-scaled USD per 1 TWAK (manual fallback)
    ITwakPriceSource public priceSource;

    struct Entry {
        address player;
        uint256 cumTickets; // cumulative tickets INCLUDING this entry
    }

    struct Round {
        uint256 totalTickets;
        uint256 requestId;
        uint256 requestedAt;
        uint256 random;
        bool seeded;
        bool settled;
        address winner;
        uint256 tokenPrize;
        uint256 bnbPrize;
        bool claimed;
    }

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => Entry[]) internal _entries;
    mapping(uint256 => mapping(address => uint256)) public ticketsOf;
    mapping(uint256 => uint256) public roundOfRequest;

    uint256 public owedBnb;
    uint256 public owedTokens;

    error NoPrice();
    error ZeroTickets();
    error RoundNotOver();
    error NoTickets();
    error AlreadyRequested();
    error NotSeeded();
    error AlreadySettled();
    error NotWinner();
    error AlreadyClaimed();
    error TooEarly();

    event PriceSet(uint256 usdPerTwak);
    event PriceSourceSet(address source);
    event Entered(uint256 indexed round, address indexed player, uint256 twakBurned, uint256 tickets);
    event DrawRequested(uint256 indexed round, uint256 requestId);
    event Settled(uint256 indexed round, address indexed winner, uint256 tokenPrize, uint256 bnbPrize);
    event PrizeClaimed(uint256 indexed round, address indexed winner);

    constructor(address owner_, VRFConfig memory vrf) VRFConsumerV25(vrf) Ownable(owner_) {
        startTime = block.timestamp;
    }

    function _expectedAllocation() internal pure override returns (uint256) {
        return PRIZE_ALLOCATION;
    }

    function bindToken(address token_) external {
        _bindToken(token_);
    }

    receive() external payable {}

    // ---------------------------------------------------------------- admin (timelocked owner)
    function setUsdPerTwak(uint256 price) external onlyOwner {
        usdPerTwak = price;
        emit PriceSet(price);
    }

    function setPriceSource(address source) external onlyOwner {
        priceSource = ITwakPriceSource(source);
        emit PriceSourceSet(source);
    }

    // ---------------------------------------------------------------- views
    function currentRound() public view returns (uint256) {
        return (block.timestamp - startTime) / ROUND_LENGTH;
    }

    function twakUsdPrice() public view returns (uint256 p) {
        if (address(priceSource) != address(0)) p = priceSource.twakUsdPrice();
        else p = usdPerTwak;
        if (p == 0) revert NoPrice();
    }

    /// @notice Tickets for `twakAmount` (wei): floor(USD value), 1 ticket per $1.
    function ticketsFor(uint256 twakAmount) public view returns (uint256) {
        return twakAmount * twakUsdPrice() / 1e36;
    }

    function entriesLength(uint256 r) external view returns (uint256) {
        return _entries[r].length;
    }

    // ---------------------------------------------------------------- play
    function enter(uint256 twakAmount) external nonReentrant whenBound returns (uint256 tickets) {
        tickets = ticketsFor(twakAmount);
        if (tickets == 0) revert ZeroTickets();
        uint256 r = currentRound();
        token.safeTransferFrom(msg.sender, address(this), twakAmount);
        ERC20Burnable(address(token)).burn(twakAmount);

        Round storage rd = rounds[r];
        rd.totalTickets += tickets;
        ticketsOf[r][msg.sender] += tickets;
        _entries[r].push(Entry({player: msg.sender, cumTickets: rd.totalTickets}));
        emit Entered(r, msg.sender, twakAmount, tickets);
    }

    function requestDraw(uint256 r) external nonReentrant {
        if (r >= currentRound()) revert RoundNotOver();
        Round storage rd = rounds[r];
        if (rd.totalTickets == 0) revert NoTickets();
        if (rd.seeded) revert AlreadyRequested();
        if (rd.requestId != 0 && block.timestamp < rd.requestedAt + VRF_RETRY_DELAY) revert AlreadyRequested();
        uint256 id = _requestRandomWord();
        rd.requestId = id;
        rd.requestedAt = block.timestamp;
        roundOfRequest[id] = r + 1; // 1-based so 0 == unknown
        emit DrawRequested(r, id);
    }

    function _fulfillRandomWords(uint256 requestId, uint256[] calldata words) internal override {
        uint256 r1 = roundOfRequest[requestId];
        if (r1 == 0 || words.length == 0) return;
        Round storage rd = rounds[r1 - 1];
        if (rd.seeded || rd.requestId != requestId) return;
        rd.random = words[0];
        rd.seeded = true;
    }

    function settle(uint256 r) external nonReentrant {
        Round storage rd = rounds[r];
        if (!rd.seeded) revert NotSeeded();
        if (rd.settled) revert AlreadySettled();
        rd.settled = true;

        uint256 ticket = rd.random % rd.totalTickets;
        rd.winner = _findWinner(r, ticket);

        uint256 freeTokens = token.balanceOf(address(this)) - owedTokens;
        uint256 tp = freeTokens < TOKEN_PRIZE_PER_ROUND ? freeTokens : TOKEN_PRIZE_PER_ROUND;
        uint256 bp = (address(this).balance - owedBnb) * BNB_POT_BPS / 10_000;
        rd.tokenPrize = tp;
        rd.bnbPrize = bp;
        owedTokens += tp;
        owedBnb += bp;
        emit Settled(r, rd.winner, tp, bp);
    }

    function claimPrize(uint256 r) external nonReentrant {
        Round storage rd = rounds[r];
        if (!rd.settled) revert NotSeeded();
        if (msg.sender != rd.winner) revert NotWinner();
        if (rd.claimed) revert AlreadyClaimed();
        rd.claimed = true;
        owedTokens -= rd.tokenPrize;
        owedBnb -= rd.bnbPrize;
        if (rd.tokenPrize > 0) token.safeTransfer(msg.sender, rd.tokenPrize);
        if (rd.bnbPrize > 0) {
            (bool ok,) = msg.sender.call{value: rd.bnbPrize}("");
            require(ok, "bnb");
        }
        emit PrizeClaimed(r, msg.sender);
    }

    /// @dev Binary search for the first entry whose cumulative tickets exceed `ticket`.
    function _findWinner(uint256 r, uint256 ticket) internal view returns (address) {
        Entry[] storage es = _entries[r];
        uint256 lo;
        uint256 hi = es.length - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (es[mid].cumTickets > ticket) hi = mid;
            else lo = mid + 1;
        }
        return es[lo].player;
    }
}
