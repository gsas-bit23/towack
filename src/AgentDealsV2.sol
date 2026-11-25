// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAgentId} from "./interfaces/IAgentId.sol";

interface IDrawV2SeedV2 {
    function seed(uint256 amount) external;
}

/// @title AgentDealsV2 — Agent ID escrow with open judge agents
/// @notice Same deal flow as AgentDeals (offer → accept → deliver → pay / refund), plus a public jury of JUDGE
/// agents that decides every delivered deal the client has not already paid.
///
/// Judging (every delivery opens it automatically):
///   - Anyone holding an Agent ID can judge, except the deal's provider and client. One vote per Agent ID wallet
///     (Agent IDs are soulbound, one per wallet). No limit on the number of judges.
///   - Sealed votes. COMMIT phase (48h after delivery): `commitVote(id, keccak256(abi.encode(id, judge, pass, salt)))`.
///     REVEAL phase (next 24h): `revealVote(id, pass, salt)`. Sealing stops late judges from copying the visible tally.
///   - Then anyone calls `finalize(id)`. Verdict:
///       FAIL  if at least QUORUM (3) judges revealed AND at least 2/3 of revealed votes are FAIL → client refunded.
///       PASS  otherwise (including too few votes) → provider paid. A deal succeeds unless a clear jury rejects it.
///   - The client can still `release` at any time before finalization (that is a PASS with no jury needed).
///
/// Fees (in the deal token):
///   - PASS: 1% protocol fee (TWAK deals: 0.8% treasury + 0.2% Draw V2 seed; USDT deals: 1% treasury), plus
///           0.5% to the judges who revealed PASS. If no judge revealed PASS, that 0.5% stays with the provider.
///   - FAIL: 0.5% to the judges who revealed FAIL; the client gets the other 99.5%. No protocol fee.
///   - Deadline refund, provider refund, cancel: free.
///   Winning judges split their 0.5% equally and each pulls their share with `claimJudgeReward` (no loops, so any
///   number of judges works). Judges on the losing side, and judges who committed but never revealed, get nothing.
///
/// No owner, no admin, no upgrade, no pause. Funds can only go to the deal's provider, its client, the treasury,
/// Draw V2 and the deal's winning judges.
contract AgentDealsV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant FEE_BPS = 100; // 1% protocol fee on PASS
    uint256 public constant DRAW_FEE_BPS = 20; // 0.2% of a TWAK deal → Draw V2 (part of the 1%)
    uint256 public constant JUDGE_FEE_BPS = 50; // 0.5% to the winning judges
    uint64 public constant MIN_DELIVERY_WINDOW = 1 hours;
    uint64 public constant MAX_DELIVERY_WINDOW = 60 days;
    uint64 public constant COMMIT_WINDOW = 48 hours;
    uint64 public constant REVEAL_WINDOW = 24 hours;
    uint32 public constant QUORUM = 3;

    enum Status {
        None,
        Open, // offered, not funded
        Funded, // client locked the amount
        Delivered, // provider delivered: jury open
        Paid, // provider paid (client release or PASS verdict)
        Refunded, // client refunded (deadline / provider refund / FAIL verdict)
        Cancelled // provider withdrew the open offer
    }

    enum Verdict {
        None, // not decided by a jury (client release, refunds, or not finalized yet)
        Pass,
        Fail
    }

    struct Deal {
        address provider;
        address client; // set on accept
        address token; // USDT or TWAK
        uint256 amount;
        uint256 clientAgentId; // Agent ID token id that may accept
        bytes32 termsHash; // keccak256 of the agreed terms text
        bytes32 deliveryHash; // keccak256 of the delivery note (set on deliver)
        uint64 deliveryWindow; // seconds from funding to the delivery deadline
        uint64 deadline; // set on accept
        uint64 deliveredAt; // set on deliver; the jury clock starts here
        Status status;
    }

    struct Jury {
        uint32 commits;
        uint32 passVotes;
        uint32 failVotes;
        Verdict verdict;
        uint256 rewardPool; // judge share for this deal (set at settlement)
        uint256 rewardPerJudge; // rewardPool / winners
    }

    struct Ballot {
        bytes32 commitment;
        bool revealed;
        bool pass;
        bool claimed;
    }

    IAgentId public immutable agentId;
    IERC20 public immutable twak;
    IERC20 public immutable usdt;
    address public immutable treasury;
    address public immutable drawV2;

    uint256 public dealCount;
    mapping(uint256 => Deal) public deals;
    mapping(uint256 => Jury) public juries;
    mapping(uint256 => mapping(address => Ballot)) public ballots;

    /// Lifetime totals per token.
    mapping(address => uint256) public paidVolume;
    mapping(address => uint256) public feesCollected;
    mapping(address => uint256) public judgeRewards; // set aside for judges
    uint256 public dealsJudged; // deals settled by a jury verdict

    event OfferCreated(
        uint256 indexed dealId,
        address indexed provider,
        uint256 indexed clientAgentId,
        address token,
        uint256 amount,
        uint64 deliveryWindow,
        bytes32 termsHash
    );
    event OfferCancelled(uint256 indexed dealId);
    event DealFunded(uint256 indexed dealId, address indexed client, uint64 deadline);
    event DealDelivered(uint256 indexed dealId, bytes32 deliveryHash, uint64 commitEnds, uint64 revealEnds);
    event VoteCommitted(uint256 indexed dealId, address indexed judge);
    event VoteRevealed(uint256 indexed dealId, address indexed judge, bool pass);
    event DealFinalized(uint256 indexed dealId, Verdict verdict, uint32 passVotes, uint32 failVotes);
    event DealPaid(
        uint256 indexed dealId,
        address indexed provider,
        uint256 toProvider,
        uint256 toTreasury,
        uint256 toDrawV2,
        uint256 toJudges
    );
    event DealRefunded(uint256 indexed dealId, address indexed client, uint256 toClient, uint256 toJudges);
    event JudgeRewardClaimed(uint256 indexed dealId, address indexed judge, uint256 amount);

    error NoAgentId();
    error NotClientAgent();
    error SelfDeal();
    error UnsupportedToken();
    error ZeroAmount();
    error BadWindow();
    error WrongStatus(Status have);
    error NotProvider();
    error NotClient();
    error PastDeadline();
    error TooEarly();
    error TooLate();
    error BadTransferAmount();
    error ZeroAddress();
    error PartyCannotJudge();
    error AlreadyCommitted();
    error NoCommit();
    error AlreadyRevealed();
    error BadReveal();
    error NothingToClaim();

    constructor(address agentId_, address twak_, address usdt_, address treasury_, address drawV2_) {
        if (
            agentId_ == address(0) || twak_ == address(0) || usdt_ == address(0) || treasury_ == address(0)
                || drawV2_ == address(0)
        ) revert ZeroAddress();
        agentId = IAgentId(agentId_);
        twak = IERC20(twak_);
        usdt = IERC20(usdt_);
        treasury = treasury_;
        drawV2 = drawV2_;
    }

    // ================================================================= provider
    /// @notice Offer a job to the holder of Agent ID `clientAgentId`, paid in `token` (USDT or TWAK).
    function createOffer(address token, uint256 amount, uint256 clientAgentId, uint64 deliveryWindow, bytes32 termsHash)
        external
        returns (uint256 dealId)
    {
        if (agentId.balanceOf(msg.sender) == 0) revert NoAgentId();
        if (token != address(twak) && token != address(usdt)) revert UnsupportedToken();
        if (amount == 0) revert ZeroAmount();
        if (deliveryWindow < MIN_DELIVERY_WINDOW || deliveryWindow > MAX_DELIVERY_WINDOW) revert BadWindow();
        address clientOwner = _ownerOfAgent(clientAgentId);
        if (clientOwner == address(0)) revert NotClientAgent();
        if (clientOwner == msg.sender) revert SelfDeal();

        dealId = ++dealCount;
        deals[dealId] = Deal({
            provider: msg.sender,
            client: address(0),
            token: token,
            amount: amount,
            clientAgentId: clientAgentId,
            termsHash: termsHash,
            deliveryHash: bytes32(0),
            deliveryWindow: deliveryWindow,
            deadline: 0,
            deliveredAt: 0,
            status: Status.Open
        });
        emit OfferCreated(dealId, msg.sender, clientAgentId, token, amount, deliveryWindow, termsHash);
    }

    function cancelOffer(uint256 dealId) external {
        Deal storage d = deals[dealId];
        if (msg.sender != d.provider) revert NotProvider();
        if (d.status != Status.Open) revert WrongStatus(d.status);
        d.status = Status.Cancelled;
        emit OfferCancelled(dealId);
    }

    /// @notice Mark the job delivered before the deadline. Opens the jury (48h commit, then 24h reveal).
    function deliver(uint256 dealId, bytes32 deliveryHash) external {
        Deal storage d = deals[dealId];
        if (msg.sender != d.provider) revert NotProvider();
        if (d.status != Status.Funded) revert WrongStatus(d.status);
        if (block.timestamp > d.deadline) revert PastDeadline();
        d.status = Status.Delivered;
        d.deliveredAt = uint64(block.timestamp);
        d.deliveryHash = deliveryHash;
        emit DealDelivered(
            dealId, deliveryHash, d.deliveredAt + COMMIT_WINDOW, d.deliveredAt + COMMIT_WINDOW + REVEAL_WINDOW
        );
    }

    /// @notice Provider returns the full amount to the client (fee-free) before funding is judged: while Funded, or
    /// during the commit phase. Once votes are being revealed, only the verdict (or the client's release) settles
    /// the deal, so a provider can't dodge the judges' fee on a coming FAIL.
    function refundByProvider(uint256 dealId) external nonReentrant {
        Deal storage d = deals[dealId];
        if (msg.sender != d.provider) revert NotProvider();
        if (d.status != Status.Funded && d.status != Status.Delivered) revert WrongStatus(d.status);
        if (d.status == Status.Delivered && block.timestamp >= uint256(d.deliveredAt) + COMMIT_WINDOW) {
            revert TooLate();
        }
        _refundAll(dealId, d);
    }

    // ================================================================= client
    /// @notice Accept an offer made to your Agent ID and lock exactly `amount` (approve this contract first).
    function accept(uint256 dealId) external nonReentrant {
        Deal storage d = deals[dealId];
        if (d.status != Status.Open) revert WrongStatus(d.status);
        if (_ownerOfAgent(d.clientAgentId) != msg.sender) revert NotClientAgent();

        d.status = Status.Funded;
        d.client = msg.sender;
        d.deadline = uint64(block.timestamp) + d.deliveryWindow;

        IERC20 t = IERC20(d.token);
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), d.amount);
        if (t.balanceOf(address(this)) - before != d.amount) revert BadTransferAmount();
        emit DealFunded(dealId, msg.sender, d.deadline);
    }

    /// @notice Client pays the provider at any time before settlement (delivered or not). Judges who already
    /// revealed PASS share the 0.5% judge fee; with none, it stays with the provider.
    function release(uint256 dealId) external nonReentrant {
        Deal storage d = deals[dealId];
        if (msg.sender != d.client) revert NotClient();
        if (d.status != Status.Funded && d.status != Status.Delivered) revert WrongStatus(d.status);
        _payProvider(dealId, d, juries[dealId].passVotes);
    }

    /// @notice Client takes everything back if the provider missed the delivery deadline (never delivered).
    function refund(uint256 dealId) external nonReentrant {
        Deal storage d = deals[dealId];
        if (msg.sender != d.client) revert NotClient();
        if (d.status != Status.Funded) revert WrongStatus(d.status);
        if (block.timestamp <= d.deadline) revert TooEarly();
        _refundAll(dealId, d);
    }

    // ================================================================= judges
    /// @notice Seal a vote on a delivered deal during the 48h commit phase.
    /// `commitment = keccak256(abi.encode(dealId, msg.sender, pass, salt))` (see `voteCommitment`).
    function commitVote(uint256 dealId, bytes32 commitment) external {
        Deal storage d = deals[dealId];
        if (d.status != Status.Delivered) revert WrongStatus(d.status);
        if (block.timestamp >= uint256(d.deliveredAt) + COMMIT_WINDOW) revert TooLate();
        if (msg.sender == d.provider || msg.sender == d.client) revert PartyCannotJudge();
        if (agentId.balanceOf(msg.sender) == 0) revert NoAgentId();
        Ballot storage b = ballots[dealId][msg.sender];
        if (b.commitment != bytes32(0)) revert AlreadyCommitted();
        b.commitment = commitment;
        juries[dealId].commits += 1;
        emit VoteCommitted(dealId, msg.sender);
    }

    /// @notice Open a sealed vote during the 24h reveal phase. Only revealed votes count and earn rewards.
    function revealVote(uint256 dealId, bool pass, bytes32 salt) external {
        Deal storage d = deals[dealId];
        if (d.status != Status.Delivered) revert WrongStatus(d.status);
        uint256 commitEnd = uint256(d.deliveredAt) + COMMIT_WINDOW;
        if (block.timestamp < commitEnd) revert TooEarly();
        if (block.timestamp >= commitEnd + REVEAL_WINDOW) revert TooLate();
        Ballot storage b = ballots[dealId][msg.sender];
        if (b.commitment == bytes32(0)) revert NoCommit();
        if (b.revealed) revert AlreadyRevealed();
        if (b.commitment != voteCommitment(dealId, msg.sender, pass, salt)) revert BadReveal();
        b.revealed = true;
        b.pass = pass;
        Jury storage j = juries[dealId];
        if (pass) j.passVotes += 1;
        else j.failVotes += 1;
        emit VoteRevealed(dealId, msg.sender, pass);
    }

    /// @notice Settle a delivered deal after the reveal phase. Anyone can call it.
    function finalize(uint256 dealId) external nonReentrant {
        Deal storage d = deals[dealId];
        if (d.status != Status.Delivered) revert WrongStatus(d.status);
        if (block.timestamp < uint256(d.deliveredAt) + COMMIT_WINDOW + REVEAL_WINDOW) revert TooEarly();
        Jury storage j = juries[dealId];
        bool fail = isFailVerdict(j.passVotes, j.failVotes);
        j.verdict = fail ? Verdict.Fail : Verdict.Pass;
        dealsJudged += 1;
        emit DealFinalized(dealId, j.verdict, j.passVotes, j.failVotes);
        if (fail) _refundFail(dealId, d, j.failVotes);
        else _payProvider(dealId, d, j.passVotes);
    }

    /// @notice A judge on the winning side pulls their equal share of the deal's 0.5% judge fee.
    function claimJudgeReward(uint256 dealId) public nonReentrant returns (uint256 amount) {
        amount = claimable(dealId, msg.sender);
        if (amount == 0) revert NothingToClaim();
        ballots[dealId][msg.sender].claimed = true;
        IERC20(deals[dealId].token).safeTransfer(msg.sender, amount);
        emit JudgeRewardClaimed(dealId, msg.sender, amount);
    }

    /// @notice Claim several deals at once; deals with nothing to claim are skipped.
    function claimJudgeRewards(uint256[] calldata dealIds) external returns (uint256 total) {
        for (uint256 i = 0; i < dealIds.length; i++) {
            if (claimable(dealIds[i], msg.sender) > 0) total += claimJudgeReward(dealIds[i]);
        }
        if (total == 0) revert NothingToClaim();
    }

    // ================================================================= views
    function voteCommitment(uint256 dealId, address judge, bool pass, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(dealId, judge, pass, salt));
    }

    /// @notice FAIL only with a quorum and a 2/3 FAIL supermajority of revealed votes.
    function isFailVerdict(uint256 passVotes, uint256 failVotes) public pure returns (bool) {
        uint256 total = passVotes + failVotes;
        return total >= QUORUM && failVotes * 3 >= total * 2;
    }

    /// @notice 0 none, 1 commit, 2 reveal, 3 ready to finalize, 4 settled.
    function juryPhase(uint256 dealId) external view returns (uint8) {
        Deal storage d = deals[dealId];
        if (d.status == Status.Paid || d.status == Status.Refunded || d.status == Status.Cancelled) return 4;
        if (d.status != Status.Delivered) return 0;
        uint256 commitEnd = uint256(d.deliveredAt) + COMMIT_WINDOW;
        if (block.timestamp < commitEnd) return 1;
        if (block.timestamp < commitEnd + REVEAL_WINDOW) return 2;
        return 3;
    }

    /// @notice Unclaimed judge reward for `judge` on `dealId` (0 if not a winning revealed vote).
    function claimable(uint256 dealId, address judge) public view returns (uint256) {
        Jury storage j = juries[dealId];
        if (j.rewardPerJudge == 0) return 0;
        Ballot storage b = ballots[dealId][judge];
        if (!b.revealed || b.claimed) return 0;
        Deal storage d = deals[dealId];
        // Winners: PASS voters when the provider was paid, FAIL voters when the client was refunded by verdict.
        bool winnerSidePass = d.status == Status.Paid;
        return b.pass == winnerSidePass ? j.rewardPerJudge : 0;
    }

    /// @notice Split of a PASS payout: (provider, treasury, Draw V2, judges) given how many judges voted PASS.
    function payoutSplit(address token, uint256 amount, uint256 passJudges)
        public
        view
        returns (uint256 toProvider, uint256 toTreasury, uint256 toDrawV2, uint256 toJudges)
    {
        uint256 fee = (amount * FEE_BPS) / BPS;
        toDrawV2 = token == address(twak) ? (amount * DRAW_FEE_BPS) / BPS : 0;
        toTreasury = fee - toDrawV2;
        toJudges = passJudges > 0 ? (amount * JUDGE_FEE_BPS) / BPS : 0;
        toProvider = amount - fee - toJudges;
    }

    // ================================================================= internal
    function _payProvider(uint256 dealId, Deal storage d, uint256 passJudges) internal {
        d.status = Status.Paid;
        (uint256 toProvider, uint256 toTreasury, uint256 toDraw, uint256 toJudges) =
            payoutSplit(d.token, d.amount, passJudges);
        IERC20 t = IERC20(d.token);
        paidVolume[d.token] += d.amount;
        feesCollected[d.token] += toTreasury + toDraw;
        // Rounding dust (< number of judges, in wei) goes to the treasury.
        toTreasury += _setJudgePool(dealId, d.token, toJudges, passJudges);

        if (toProvider > 0) t.safeTransfer(d.provider, toProvider);
        if (toTreasury > 0) t.safeTransfer(treasury, toTreasury);
        if (toDraw > 0) {
            t.forceApprove(drawV2, toDraw);
            IDrawV2SeedV2(drawV2).seed(toDraw);
            if (t.allowance(address(this), drawV2) != 0) t.forceApprove(drawV2, 0);
        }
        emit DealPaid(dealId, d.provider, toProvider, toTreasury, toDraw, toJudges);
    }

    function _refundFail(uint256 dealId, Deal storage d, uint256 failJudges) internal {
        d.status = Status.Refunded;
        uint256 toJudges = (d.amount * JUDGE_FEE_BPS) / BPS; // failJudges >= 2 here (quorum + supermajority)
        uint256 toClient = d.amount - toJudges;
        uint256 dust = _setJudgePool(dealId, d.token, toJudges, failJudges);
        IERC20 t = IERC20(d.token);
        t.safeTransfer(d.client, toClient);
        if (dust > 0) t.safeTransfer(treasury, dust);
        emit DealRefunded(dealId, d.client, toClient, toJudges);
    }

    function _refundAll(uint256 dealId, Deal storage d) internal {
        d.status = Status.Refunded;
        IERC20(d.token).safeTransfer(d.client, d.amount);
        emit DealRefunded(dealId, d.client, d.amount, 0);
    }

    /// Sets the per-judge reward and returns the rounding dust (sent to the treasury by the caller).
    function _setJudgePool(uint256 dealId, address token, uint256 toJudges, uint256 winners)
        internal
        returns (uint256 dust)
    {
        if (toJudges == 0 || winners == 0) return toJudges;
        Jury storage j = juries[dealId];
        j.rewardPerJudge = toJudges / winners;
        j.rewardPool = j.rewardPerJudge * winners;
        judgeRewards[token] += j.rewardPool;
        dust = toJudges - j.rewardPool;
    }

    /// Agent ID owner, or address(0) if the id does not exist (the registry reverts for unknown ids).
    function _ownerOfAgent(uint256 tokenId) internal view returns (address o) {
        try agentId.ownerOf(tokenId) returns (address a) {
            o = a;
        } catch {
            o = address(0);
        }
    }
}
