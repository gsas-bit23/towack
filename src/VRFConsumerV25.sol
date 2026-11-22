// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IVRFCoordinatorV2Plus, VRFV2PlusClient} from "./interfaces/IVRFCoordinatorV2Plus.sol";

/// @notice Minimal, ownerless Chainlink VRF v2.5 consumer. All VRF config is immutable.
/// Production config = the official coordinator, a registered key hash, a native-payment subscription
/// that lists this contract as a consumer, 3 confirmations. Only the coordinator may deliver words; the
/// coordinator calls `rawFulfillRandomWords` with exactly `vrfCallbackGasLimit` gas, so callbacks are
/// kept to a few SSTOREs and never revert on unknown / stale requests.
/// Trade-off vs Chainlink's `VRFConsumerBaseV2Plus`: no owner can `setCoordinator`, so a Chainlink
/// coordinator migration needs a redeploy of the consumer.
///
/// USER-PAID VRF FEE. Every randomness request is paid by its caller: the request path quotes
/// `vrfFeeAt(tx.gasprice)`, forwards exactly that fee into the subscription with
/// `fundSubscriptionWithNative` BEFORE `requestRandomWords`, and the caller refunds any excess `msg.value`.
/// The subscription coordinator (unlike the direct-funding wrapper) has no price-quote function, so the quote
/// re-implements `VRFCoordinatorV2_5._calculatePaymentAmountNative` (L1 cost = 0 on BSC) on the FULL callback
/// gas limit, with the coordinator's live `s_config()` and a conservative coordinator-overhead constant:
///   payment = gasPrice * (gasAfterPaymentCalculation + COORDINATOR_OVERHEAD_GAS + callbackGasLimit)
///             * (100 + nativePremiumPercentage) / 100 + 1e12 * fulfillmentFlatFeeNativePPM
///   fee     = payment * (BPS + FEE_BUFFER_BPS) / BPS
/// `gasPrice` is clamped to [vrfMinFeeGasPrice, vrfMaxFeeGasPrice]: the floor is the gas price the Chainlink
/// node actually fulfils at (so a user cannot underpay with a low-priced tx), the cap is the key hash lane
/// maximum (the node never fulfils above it, so charging more would be pure overpayment).
abstract contract VRFConsumerV25 {
    struct VRFConfig {
        address coordinator;
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        bool nativePayment;
        uint64 minFeeGasPrice; // fee quote floor (wei/gas)
        uint64 maxFeeGasPrice; // fee quote cap = key hash lane max (wei/gas)
    }

    /// @dev Chainlink v2.5 bounds: min confirmations 3 (BSC), max callback gas 2,500,000 (BSC config).
    uint16 public constant MIN_REQUEST_CONFIRMATIONS = 3;
    uint16 public constant MAX_REQUEST_CONFIRMATIONS = 200;
    uint32 public constant MIN_CALLBACK_GAS = 50_000;
    uint32 public constant MAX_CALLBACK_GAS = 2_500_000;

    /// @notice Coordinator gas outside the callback that is billed to the sub (proof verification, request
    /// bookkeeping, payment calc). Not in `s_config`. Chainlink's BSC mainnet direct-funding table lists
    /// 99,500 (native); our real BSC-testnet fulfilments implied ~73k. Rounded up to 100,000.
    uint256 public constant COORDINATOR_OVERHEAD_GAS = 100_000;
    /// @notice 15% on top of the formula: the fulfilment tx may land at a higher gas price than the request.
    /// The gas side already assumes the full callback limit (actual use is ~50-75% of it) and 100k overhead.
    uint256 public constant FEE_BUFFER_BPS = 1_500;
    uint256 public constant FEE_BPS = 10_000;
    /// @dev Fallback billing parameters when the coordinator exposes neither `s_config` nor mock getters.
    uint256 internal constant FALLBACK_PREMIUM_PCT = 100;
    uint256 internal constant FALLBACK_GAS_AFTER_PAYMENT = 60_000;

    error OnlyCoordinator(address have, address want);
    error VrfFeeTooLow(uint256 sent, uint256 required);
    error RefundFailed();

    event VrfFeePaid(address indexed payer, uint256 indexed requestId, uint256 fee);

    IVRFCoordinatorV2Plus public immutable vrfCoordinator;
    bytes32 public immutable vrfKeyHash;
    uint256 public immutable vrfSubId;
    uint16 public immutable vrfRequestConfirmations;
    uint32 public immutable vrfCallbackGasLimit;
    bool public immutable vrfNativePayment;
    uint64 public immutable vrfMinFeeGasPrice;
    uint64 public immutable vrfMaxFeeGasPrice;

    constructor(VRFConfig memory cfg) {
        require(cfg.coordinator.code.length > 0, "VRF: coordinator");
        require(cfg.keyHash != bytes32(0), "VRF: keyHash");
        require(cfg.subId != 0, "VRF: subId");
        require(
            cfg.requestConfirmations >= MIN_REQUEST_CONFIRMATIONS
                && cfg.requestConfirmations <= MAX_REQUEST_CONFIRMATIONS,
            "VRF: confirmations"
        );
        require(cfg.callbackGasLimit >= MIN_CALLBACK_GAS && cfg.callbackGasLimit <= MAX_CALLBACK_GAS, "VRF: gas");
        // Users pay in native, so the subscription must bill in native.
        require(cfg.nativePayment, "VRF: native");
        require(cfg.minFeeGasPrice > 0 && cfg.minFeeGasPrice <= cfg.maxFeeGasPrice, "VRF: fee gas price");
        vrfCoordinator = IVRFCoordinatorV2Plus(cfg.coordinator);
        vrfKeyHash = cfg.keyHash;
        vrfSubId = cfg.subId;
        vrfRequestConfirmations = cfg.requestConfirmations;
        vrfCallbackGasLimit = cfg.callbackGasLimit;
        vrfNativePayment = cfg.nativePayment;
        vrfMinFeeGasPrice = cfg.minFeeGasPrice;
        vrfMaxFeeGasPrice = cfg.maxFeeGasPrice;
    }

    // ================================================================= fee quote
    /// @notice VRF fee (wei) for one request sent at `gasPrice`. THE FRONTEND MUST CALL THIS (eth_call often
    /// has tx.gasprice == 0) with the gas price it will send the tx at.
    function vrfFeeAt(uint256 gasPrice) public view returns (uint256) {
        uint256 gp = gasPrice < vrfMinFeeGasPrice ? vrfMinFeeGasPrice : gasPrice;
        if (gp > vrfMaxFeeGasPrice) gp = vrfMaxFeeGasPrice;
        uint256 gasUnits = COORDINATOR_OVERHEAD_GAS + vrfCallbackGasLimit;

        uint256 payment;
        (bool ok, bytes memory ret) =
            address(vrfCoordinator).staticcall(abi.encodeWithSignature("s_config()"));
        if (ok && ret.length >= 9 * 32) {
            (, uint32 maxGasLimit,,, uint32 gasAfter, uint32 flatPPM,, uint8 premium,) =
                abi.decode(ret, (uint16, uint32, bool, uint32, uint32, uint32, uint32, uint8, uint8));
            if (maxGasLimit != 0) {
                // Official VRFCoordinatorV2_5 (configured).
                payment = gp * (uint256(gasAfter) + gasUnits) * (100 + uint256(premium)) / 100
                    + 1e12 * uint256(flatPPM);
                return payment * (FEE_BPS + FEE_BUFFER_BPS) / FEE_BPS;
            }
            // Zeroed s_config = Chainlink's VRFCoordinatorV2_5Mock: bills i_base_fee + gasUsed * i_gas_price.
            (bool okB, bytes memory rb) = address(vrfCoordinator).staticcall(abi.encodeWithSignature("i_base_fee()"));
            (bool okG, bytes memory rg) = address(vrfCoordinator).staticcall(abi.encodeWithSignature("i_gas_price()"));
            if (okB && okG && rb.length >= 32 && rg.length >= 32) {
                payment = abi.decode(rb, (uint256)) + gasUnits * abi.decode(rg, (uint256));
                return payment * (FEE_BPS + FEE_BUFFER_BPS) / FEE_BPS;
            }
        }
        // Unknown coordinator: conservative (100% premium, 60k post-payment gas).
        payment = gp * (FALLBACK_GAS_AFTER_PAYMENT + gasUnits) * (100 + FALLBACK_PREMIUM_PCT) / 100;
        return payment * (FEE_BPS + FEE_BUFFER_BPS) / FEE_BPS;
    }

    /// @notice Convenience: fee at this tx's gas price. Off-chain, prefer `vrfFeeAt(gasPrice)`.
    function vrfFee() external view returns (uint256) {
        return vrfFeeAt(tx.gasprice);
    }

    // ================================================================= request
    /// @dev Quotes the fee at tx.gasprice, requires `available >= fee`, funds the subscription with exactly
    /// the fee, then requests one word. Returns (requestId, fee); the caller refunds `available - fee`.
    /// Reverts (atomically, with the caller) if the fee is not covered.
    function _requestRandomWordPaid(uint256 available) internal returns (uint256 requestId, uint256 fee) {
        fee = vrfFeeAt(tx.gasprice);
        if (available < fee) revert VrfFeeTooLow(available, fee);
        vrfCoordinator.fundSubscriptionWithNative{value: fee}(vrfSubId);
        requestId = vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: vrfKeyHash,
                subId: vrfSubId,
                requestConfirmations: vrfRequestConfirmations,
                callbackGasLimit: vrfCallbackGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient.argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: vrfNativePayment}))
            })
        );
        emit VrfFeePaid(msg.sender, requestId, fee);
    }

    /// @dev Sends `amount` back to msg.sender (no-op for 0). Call last (CEI); callers are nonReentrant.
    function _refund(uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert RefundFailed();
    }

    /// @dev Called by the coordinator. Name/signature must match Chainlink's VRFConsumerBaseV2Plus.
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(vrfCoordinator)) revert OnlyCoordinator(msg.sender, address(vrfCoordinator));
        _fulfillRandomWords(requestId, randomWords);
    }

    function _fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal virtual;
}
