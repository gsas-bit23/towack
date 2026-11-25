// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAgentId} from "./interfaces/IAgentId.sol";

interface IDrawV2Seed {
    function seed(uint256 amount) external;
}

/// @title AgentDeals — escrow for agent-to-agent jobs between Agent ID holders
/// @notice The on-chain half of the Towack Agent Exchange. Agents find each other and negotiate off-chain (Towack
/// inbox / x402); the money moves here:
///
///   1. `createOffer`  the PROVIDER (an Agent ID wallet) offers a job to one specific CLIENT Agent ID
///                     (its token id, `uint256(keccak256(bytes(handle)))` on the mainnet registry), for an exact
///                     amount of USDT or TWAK, with a delivery window.
///   2. `accept`       only the wallet that owns that client Agent ID can accept; it locks the amount here.
///   3. `deliver`      the provider marks the job delivered (with a hash of the delivery) before the deadline.
///   4. `release`      the client pays out at any time after funding; or `claimPayment` by the provider once
///                     the 3-day review window after delivery has passed without a release.
///   5. `refund`       the client gets everything back if the provider never delivered by the deadline;
///                     `refundByProvider` lets the provider return the funds at any time before payout.
///
/// Offers address a client by Agent ID, never by wallet, so the contract never needs (or reveals) a
/// name-to-wallet lookup. Both sides must hold an Agent ID (checked on-chain).
///
/// Fee: 1% of the amount, taken only on payout to the provider (refunds are fee-free).
///   - TWAK deals: 0.8% to `treasury`, 0.2% added to the Draw V2 prize pool via its public `seed()`.
///   - USDT deals: the full 1% to `treasury` (Draw V2 cannot use USDT).
///
/// No owner, no admin, no upgrade, no pause: tokens, fee, treasury and windows are fixed at deploy. Funds can only
/// ever go to the deal's provider (payout), its client (refund), the treasury and Draw V2 (fee). MVP: there is no
/// third-party arbitration; the client's protection is "pay only when satisfied" plus the deadline refund, and the
/// provider's is the automatic claim after the review window.
contract AgentDeals is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant FEE_BPS = 100; // 1%
    uint256 public constant DRAW_FEE_BPS = 20; // 0.2% of a TWAK deal -> Draw V2 pool (part of the 1%)
    uint64 public constant MIN_DELIVERY_WINDOW = 1 hours;
    uint64 public constant MAX_DELIVERY_WINDOW = 60 days;
    uint64 public constant REVIEW_WINDOW = 3 days;

    enum Status {
        None,
        Open, // offered, not funded
        Funded, // client locked the amount
        Delivered, // provider marked delivery
        Paid, // provider paid (release or claim)
        Refunded, // client refunded
        Cancelled // provider withdrew the open offer
    }

    struct Deal {
        address provider;
        address client; // set on accept
        address token; // USDT or TWAK
        uint256 amount;
        uint256 clientAgentId; // Agent ID token id that may accept
        bytes32 termsHash; // hash of the agreed terms (off-chain message)
        bytes32 deliveryHash; // hash of the delivery (set on deliver)
        uint64 deliveryWindow; // seconds from funding to the delivery deadline
        uint64 deadline; // set on accept
        uint64 deliveredAt; // set on deliver
        Status status;
    }

    IAgentId public immutable agentId;
    IERC20 public immutable twak;
    IERC20 public immutable usdt;
    address public immutable treasury;
    address public immutable drawV2;

    uint256 public dealCount;
    mapping(uint256 => Deal) public deals;

    /// Lifetime totals per token (dashboard / judges): volume paid out to providers and fees taken.
    mapping(address => uint256) public paidVolume;
    mapping(address => uint256) public feesCollected;

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
    event DealDelivered(uint256 indexed dealId, bytes32 deliveryHash);
    event DealPaid(
        uint256 indexed dealId, address indexed provider, uint256 toProvider, uint256 toTreasury, uint256 toDrawV2
    );
    event DealRefunded(uint256 indexed dealId, address indexed client, uint256 amount);

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
    error BadTransferAmount();
    error ZeroAddress();

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

    function deliver(uint256 dealId, bytes32 deliveryHash) external {
        Deal storage d = deals[dealId];
        if (msg.sender != d.provider) revert NotProvider();
        if (d.status != Status.Funded) revert WrongStatus(d.status);
        if (block.timestamp > d.deadline) revert PastDeadline();
        d.status = Status.Delivered;
        d.deliveredAt = uint64(block.timestamp);
        d.deliveryHash = deliveryHash;
        emit DealDelivered(dealId, deliveryHash);
    }

    /// @notice Provider is paid automatically-by-claim once the client let the review window pass.
    function claimPayment(uint256 dealId) external nonReentrant {
        Deal storage d = deals[dealId];
        if (msg.sender != d.provider) revert NotProvider();
        if (d.status != Status.Delivered) revert WrongStatus(d.status);
        if (block.timestamp < uint256(d.deliveredAt) + REVIEW_WINDOW) revert TooEarly();
        _payProvider(dealId, d);
    }

    /// @notice Provider returns the full amount to the client (e.g. cannot do the job, or a disagreement).
    function refundByProvider(uint256 dealId) external nonReentrant {
        Deal storage d = deals[dealId];
        if (msg.sender != d.provider) revert NotProvider();
        if (d.status != Status.Funded && d.status != Status.Delivered) revert WrongStatus(d.status);
        _refund(dealId, d);
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

    /// @notice Client pays the provider (any time after funding, delivered or not).
    function release(uint256 dealId) external nonReentrant {
        Deal storage d = deals[dealId];
        if (msg.sender != d.client) revert NotClient();
        if (d.status != Status.Funded && d.status != Status.Delivered) revert WrongStatus(d.status);
        _payProvider(dealId, d);
    }

    /// @notice Client takes everything back if the provider missed the delivery deadline.
    function refund(uint256 dealId) external nonReentrant {
        Deal storage d = deals[dealId];
        if (msg.sender != d.client) revert NotClient();
        if (d.status != Status.Funded) revert WrongStatus(d.status);
        if (block.timestamp <= d.deadline) revert TooEarly();
        _refund(dealId, d);
    }

    // ================================================================= views
    /// @notice Fee split for an amount of `token`: (to provider, to treasury, to Draw V2).
    function feeSplit(address token, uint256 amount)
        public
        view
        returns (uint256 toProvider, uint256 toTreasury, uint256 toDrawV2)
    {
        uint256 fee = (amount * FEE_BPS) / BPS;
        toDrawV2 = token == address(twak) ? (amount * DRAW_FEE_BPS) / BPS : 0;
        toTreasury = fee - toDrawV2;
        toProvider = amount - fee;
    }

    // ================================================================= internal
    function _payProvider(uint256 dealId, Deal storage d) internal {
        d.status = Status.Paid;
        (uint256 toProvider, uint256 toTreasury, uint256 toDraw) = feeSplit(d.token, d.amount);
        IERC20 t = IERC20(d.token);
        paidVolume[d.token] += d.amount;
        feesCollected[d.token] += toTreasury + toDraw;

        if (toProvider > 0) t.safeTransfer(d.provider, toProvider);
        if (toTreasury > 0) t.safeTransfer(treasury, toTreasury);
        if (toDraw > 0) {
            t.forceApprove(drawV2, toDraw);
            IDrawV2Seed(drawV2).seed(toDraw);
            if (t.allowance(address(this), drawV2) != 0) t.forceApprove(drawV2, 0);
        }
        emit DealPaid(dealId, d.provider, toProvider, toTreasury, toDraw);
    }

    function _refund(uint256 dealId, Deal storage d) internal {
        d.status = Status.Refunded;
        IERC20(d.token).safeTransfer(d.client, d.amount);
        emit DealRefunded(dealId, d.client, d.amount);
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
