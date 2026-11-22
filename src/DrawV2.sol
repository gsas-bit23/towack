// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VRFConsumerV25} from "./VRFConsumerV25.sol";
import {TokenBound} from "./TokenBound.sol";

/// @title DrawV2 — instant pool wheel
/// @notice Players deposit TWAK INTO the prize pool (nothing is burned). Every entry requests one Chainlink
/// VRF v2.5 word and the callback lands a 10,000-slot wheel that pays a multiplier of THAT entry from the pool:
///
///   id  multiplier   slots    p     p × m
///   0   0×           2,100   21%    0
///   1   0.5×         3,200   32%    0.16
///   2   1×           2,200   22%    0.22
///   3   1.5×         1,400   14%    0.21
///   4   2×             800    8%    0.16
///   5   5×             200    2%    0.10
///   6   10× jackpot    100    1%    0.10
///                   10,000  100%    0.95   <- expected TWAK return 95%; the ~5% edge stays in the pool.
///
/// Pool
///  - Intended seed: the 7% V2 prize allocation (PRIZE_ALLOCATION = 70,000,000 TWAK) minted here by the token
///    (bind via TokenBound). A stand-alone deploy (testnet) passes `presetToken_` and is seeded with `seed()`.
///  - availableTwak = token.balanceOf(this) − reservedTwak − outstandingTwak, where
///      reservedTwak    = Σ 10 × entry over spins still waiting for VRF (worst case, released on fulfil),
///      outstandingTwak = Σ assigned-but-unclaimed TWAK prizes.
///  - Entry limits: MIN_ENTRY = 100 TWAK. A 10× win may be at most MAX_PAYOUT_BPS (5%) of availableTwak,
///    so maxEntry = availableTwak × 500 / 100,000 = 0.5% of availableTwak. `enter` reverts if availableTwak
///    cannot cover 10 × entry or the entry exceeds maxEntry. Availability is measured before the entry is added.
///
/// BNB pot (router 30% fee share, launch sellout 75 BNB, unclaimed V1 refunds; plain `receive()`)
///  - Only the top tiers get a BNB bonus: 10× → BNB_BONUS_BPS_10X (2%), 5× → BNB_BONUS_BPS_5X (1%) of
///    availableBnb = balance − reservedBnb − outstandingBnb, snapshotted at entry. The 2% cap is reserved on
///    entry (released on fulfil unless won), so concurrent top-tier wins can never overdraw. An empty pot just
///    means a TWAK-only spin; it never reverts.
///
/// Prizes are pull-based (`claim`). The owner (TimelockController) can only pause NEW entries; there is no
/// function to withdraw BNB or TWAK. Funds leave only as claimed prizes.
contract DrawV2 is VRFConsumerV25, TokenBound, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PRIZE_ALLOCATION = 70_000_000e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant WHEEL_SLOTS = 10_000;
    uint256 public constant PRIZE_COUNT = 7;
    uint256 public constant JACKPOT_ID = 6; // 10×
    uint256 public constant BIG_WIN_ID = 5; // 5×
    uint256 public constant MAX_MULT_BPS = 100_000; // 10×
    uint256 public constant EXPECTED_RETURN_BPS = 9_500; // Σ p × m
    uint256 public constant MIN_ENTRY = 100e18;
    uint256 public constant MAX_PAYOUT_BPS = 500; // a 10× win <= 5% of available TWAK
    uint256 public constant BNB_BONUS_BPS_10X = 200; // 2% of available BNB
    uint256 public constant BNB_BONUS_BPS_5X = 100; // 1% of available BNB
    uint256 public constant VRF_RETRY_DELAY = 1 hours;

    uint8 internal constant PENDING = 1;
    uint8 internal constant ASSIGNED = 2;

    struct Spin {
        address player;
        uint8 status; // 0 none, 1 pending VRF, 2 assigned
        uint8 prizeId;
        uint64 requestedAt;
        uint256 amount; // TWAK entered
        uint256 maxTwak; // 10 × amount: booked at entry, counted in reservedTwak only while pending
        uint256 bnbCap; // 2% of available BNB at entry: counted in reservedBnb only while pending
        uint256 requestId; // live VRF request
    }

    mapping(uint256 => Spin) public spins; // 1-based
    mapping(uint256 => uint256) public spinOfRequest; // requestId => spinId (0 = unknown / invalidated)
    mapping(address => uint256) public lastSpinOf;
    mapping(address => uint256) public owedTwak;
    mapping(address => uint256) public owedBnb;
    uint256 public spinCount;

    uint256 public reservedTwak;
    uint256 public outstandingTwak;
    uint256 public reservedBnb;
    uint256 public outstandingBnb;

    uint256 public totalSeeded;
    uint256 public totalEntered;
    uint256 public totalClaimedTwak;
    uint256 public totalClaimedBnb;

    bool public entriesPaused;

    error EntriesPaused();
    error EntryTooSmall(uint256 amount, uint256 min);
    error EntryTooLarge(uint256 amount, uint256 max);
    error PoolTooSmall(uint256 needed, uint256 available);
    error ZeroAmount();
    error NotPending();
    error TooEarly();
    error NothingToClaim();
    error BnbTransferFailed();

    event PoolSeeded(address indexed from, uint256 amount);
    event Entered(uint256 indexed spinId, address indexed player, uint256 amount, uint256 maxTwak, uint256 bnbCap);
    event SpinRequested(uint256 indexed spinId, uint256 indexed requestId);
    event SpinRetried(uint256 indexed spinId, uint256 oldRequestId, uint256 newRequestId);
    event SpinAssigned(uint256 indexed spinId, address indexed player, uint256 prizeId, uint256 twakPrize, uint256 bnbPrize);
    event Claimed(address indexed player, uint256 twak, uint256 bnb);
    event EntriesPausedSet(bool paused);

    /// @param presetToken_ address(0) for the real stack (token mints 70M here, then `bindToken`). Non-zero for
    /// a stand-alone deploy next to an existing token (testnet): binds immediately, pool is filled via `seed`.
    constructor(address owner_, address presetToken_, VRFConfig memory vrf) VRFConsumerV25(vrf) Ownable(owner_) {
        if (presetToken_ != address(0)) {
            token = IERC20(presetToken_);
            emit TokenBound_(presetToken_);
        }
    }

    function _expectedAllocation() internal pure override returns (uint256) {
        return PRIZE_ALLOCATION;
    }

    function bindToken(address token_) external {
        _bindToken(token_);
    }

    /// @notice BNB pot inflows (router fee share, launch sellout, V1 sweeps, donations).
    receive() external payable {}

    // ---------------------------------------------------------------- admin (timelocked owner)
    /// @notice Pauses NEW entries only. Pending spins still fulfil and claims always work.
    function setEntriesPaused(bool paused) external onlyOwner {
        entriesPaused = paused;
        emit EntriesPausedSet(paused);
    }

    // ---------------------------------------------------------------- payout table
    /// @notice Multiplier of prize `id` in bps of the entry (10,000 = 1×).
    function multiplierBps(uint256 id) public pure returns (uint256) {
        return [uint256(0), 5_000, 10_000, 15_000, 20_000, 50_000, 100_000][id];
    }

    /// @notice Slots of prize `id` out of WHEEL_SLOTS.
    function prizeSlots(uint256 id) public pure returns (uint256) {
        return [uint256(2_100), 3_200, 2_200, 1_400, 800, 200, 100][id];
    }

    function payoutTable() external pure returns (uint256[7] memory mults, uint256[7] memory slots) {
        for (uint256 i; i < PRIZE_COUNT; ++i) {
            mults[i] = multiplierBps(i);
            slots[i] = prizeSlots(i);
        }
    }

    /// @notice Prize id for a VRF word: slot = word % 10,000, walked through the cumulative table.
    function prizeForWord(uint256 word) public pure returns (uint256 id) {
        uint256 slot = word % WHEEL_SLOTS;
        uint256 cum;
        for (; id < PRIZE_COUNT - 1; ++id) {
            cum += prizeSlots(id);
            if (slot < cum) return id;
        }
    }

    // ---------------------------------------------------------------- views
    function availableTwak() public view returns (uint256) {
        if (address(token) == address(0)) return 0;
        uint256 bal = token.balanceOf(address(this));
        uint256 locked = reservedTwak + outstandingTwak;
        return bal > locked ? bal - locked : 0;
    }

    function availableBnb() public view returns (uint256) {
        uint256 locked = reservedBnb + outstandingBnb;
        return address(this).balance > locked ? address(this).balance - locked : 0;
    }

    /// @notice Largest entry right now (0.5% of available TWAK). Below MIN_ENTRY means entries are closed.
    function maxEntry() public view returns (uint256) {
        return availableTwak() * MAX_PAYOUT_BPS / MAX_MULT_BPS;
    }

    /// @notice Lifetime assigned prizes (claimed + still owed).
    function totalAssignedTwak() external view returns (uint256) {
        return totalClaimedTwak + outstandingTwak;
    }

    function totalAssignedBnb() external view returns (uint256) {
        return totalClaimedBnb + outstandingBnb;
    }

    /// @notice Assigned TWAK / BNB prize of a spin (0, 0 while pending). Derived, not stored, to keep the
    /// VRF callback cheap: twak = amount × multiplier, bnb = bnbCap (10×) or bnbCap / 2 (5×).
    function spinPrize(uint256 spinId) public view returns (uint256 twak, uint256 bnb) {
        Spin storage s = spins[spinId];
        if (s.status != ASSIGNED) return (0, 0);
        return _prizeOf(s.amount, s.bnbCap, s.prizeId);
    }

    function _prizeOf(uint256 amount, uint256 bnbCap, uint256 id) internal pure returns (uint256 twak, uint256 bnb) {
        twak = amount * multiplierBps(id) / BPS;
        if (id == JACKPOT_ID) bnb = bnbCap;
        else if (id == BIG_WIN_ID) bnb = bnbCap * BNB_BONUS_BPS_5X / BNB_BONUS_BPS_10X;
    }

    /// @notice BNB bonus a 10× / 5× hit would get if entered now.
    function bnbBonusPreview() external view returns (uint256 jackpot, uint256 bigWin) {
        jackpot = availableBnb() * BNB_BONUS_BPS_10X / BPS;
        bigWin = jackpot * BNB_BONUS_BPS_5X / BNB_BONUS_BPS_10X;
    }

    // ---------------------------------------------------------------- play
    /// @notice Seed / top up the TWAK pool. Anyone may add; nobody can take it back out.
    function seed(uint256 amount) external nonReentrant whenBound {
        if (amount == 0) revert ZeroAmount();
        totalSeeded += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit PoolSeeded(msg.sender, amount);
    }

    /// @notice Deposit `amount` TWAK into the pool and spin. Reserves 10 × amount TWAK and 2% of free BNB.
    function enter(uint256 amount) external nonReentrant whenBound returns (uint256 spinId, uint256 requestId) {
        if (entriesPaused) revert EntriesPaused();
        if (amount < MIN_ENTRY) revert EntryTooSmall(amount, MIN_ENTRY);
        uint256 avail = availableTwak();
        uint256 twakRes = amount * MAX_MULT_BPS / BPS;
        if (twakRes > avail) revert PoolTooSmall(twakRes, avail);
        uint256 maxE = avail * MAX_PAYOUT_BPS / MAX_MULT_BPS;
        if (amount > maxE) revert EntryTooLarge(amount, maxE);
        uint256 bnbRes = availableBnb() * BNB_BONUS_BPS_10X / BPS;

        reservedTwak += twakRes;
        reservedBnb += bnbRes;
        totalEntered += amount;
        spinId = ++spinCount;
        Spin storage s = spins[spinId];
        s.player = msg.sender;
        s.status = PENDING;
        s.amount = amount;
        s.maxTwak = twakRes;
        s.bnbCap = bnbRes;
        s.requestedAt = uint64(block.timestamp);
        lastSpinOf[msg.sender] = spinId;

        token.safeTransferFrom(msg.sender, address(this), amount);
        requestId = _requestRandomWord();
        s.requestId = requestId;
        spinOfRequest[requestId] = spinId;
        emit Entered(spinId, msg.sender, amount, twakRes, bnbRes);
        emit SpinRequested(spinId, requestId);
    }

    /// @notice Re-request VRF for a spin stuck for VRF_RETRY_DELAY. Anyone. The reservation stays in place;
    /// the old request id is invalidated (unmapped, and no longer the spin's live id) so a late fulfil is ignored.
    function retrySpin(uint256 spinId) external nonReentrant returns (uint256 requestId) {
        Spin storage s = spins[spinId];
        if (s.status != PENDING) revert NotPending();
        if (block.timestamp < uint256(s.requestedAt) + VRF_RETRY_DELAY) revert TooEarly();
        uint256 old = s.requestId;
        delete spinOfRequest[old];
        requestId = _requestRandomWord();
        s.requestId = requestId;
        s.requestedAt = uint64(block.timestamp);
        spinOfRequest[requestId] = spinId;
        emit SpinRetried(spinId, old, requestId);
        emit SpinRequested(spinId, requestId);
    }

    /// @dev Lands the wheel, books the prize as owed, releases the whole reservation. Never reverts on
    /// unknown / stale requests (they are ignored). Kept to a few SSTOREs (callback gas limit 300k).
    function _fulfillRandomWords(uint256 requestId, uint256[] calldata words) internal override {
        uint256 spinId = spinOfRequest[requestId];
        if (spinId == 0 || words.length == 0) return;
        Spin storage s = spins[spinId];
        if (s.status != PENDING || s.requestId != requestId) return;

        uint256 id = prizeForWord(words[0]);
        uint256 maxTwak = s.maxTwak;
        uint256 bnbCap = s.bnbCap;
        (uint256 twak, uint256 bnb) = _prizeOf(s.amount, bnbCap, id); // twak <= maxTwak, bnb <= bnbCap

        s.status = ASSIGNED;
        s.prizeId = uint8(id);
        reservedTwak -= maxTwak;
        if (bnbCap > 0) reservedBnb -= bnbCap;
        address player = s.player;
        if (twak > 0) {
            outstandingTwak += twak;
            owedTwak[player] += twak;
        }
        if (bnb > 0) {
            outstandingBnb += bnb;
            owedBnb[player] += bnb;
        }
        emit SpinAssigned(spinId, player, id, twak, bnb);
    }

    /// @notice Pull every assigned, unclaimed TWAK + BNB prize of the caller.
    function claim() external nonReentrant {
        uint256 t = owedTwak[msg.sender];
        uint256 b = owedBnb[msg.sender];
        if (t == 0 && b == 0) revert NothingToClaim();
        owedTwak[msg.sender] = 0;
        owedBnb[msg.sender] = 0;
        outstandingTwak -= t;
        outstandingBnb -= b;
        totalClaimedTwak += t;
        totalClaimedBnb += b;
        if (t > 0) token.safeTransfer(msg.sender, t);
        if (b > 0) {
            (bool ok,) = msg.sender.call{value: b}("");
            if (!ok) revert BnbTransferFailed();
        }
        emit Claimed(msg.sender, t, b);
    }
}
