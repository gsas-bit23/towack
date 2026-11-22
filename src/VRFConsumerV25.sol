// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {VRFV2PlusClient} from "./interfaces/IVRFCoordinatorV2Plus.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";

/// @notice Minimal, ownerless Chainlink VRF v2.5 consumer on the official DIRECT-FUNDING WRAPPER
/// (`VRFV2PlusWrapper`), paid in native BNB per request. No subscription, no deposit, no LINK.
/// All config is immutable: wrapper address, request confirmations, callback gas limit. The key hash (gas lane)
/// lives on the wrapper. BSC testnet (97) and mainnet (56) wrapper: 0x471506e6ADED0b9811D05B8cAc8Db25eE839Ac94.
///
/// Same pattern as Chainlink's `VRFV2PlusWrapperConsumerBase.requestRandomnessPayInNative`, re-implemented so the
/// hook keeps `calldata` words, the contract stays ownerless, and the constructor does not need `wrapper.link()`.
/// Only the wrapper may deliver words: it calls `rawFulfillRandomWords` with exactly `vrfCallbackGasLimit` gas
/// (`_callWithExactGas`), so callbacks are kept to a few SSTOREs and never revert on unknown / stale requests.
/// Trade-off: no owner can repoint the wrapper, so a Chainlink wrapper migration needs a consumer redeploy.
///
/// USER-PAID VRF FEE. Every request is paid by its caller, at request time:
///   price = wrapper.calculateRequestPriceNative(vrfCallbackGasLimit, 1)   // priced at THIS tx's tx.gasprice
/// The request path requires `available >= price`, forwards EXACTLY `price` with `requestRandomWordsInNative`
/// (the wrapper keeps any overpayment, it never refunds) and the caller refunds `available - price` itself.
/// The wrapper's own premium + overheads cover fulfilment gas variance, so there is no gas-price floor here.
/// The UI quote `vrfFeeAt(gasPrice)` = wrapper.estimateRequestPriceNative(limit, 1, gasPrice) + FEE_BUFFER_BPS;
/// the buffer is never forwarded: whatever is not needed is refunded in the same tx.
abstract contract VRFConsumerV25 {
    struct VRFConfig {
        address wrapper; // official VRFV2PlusWrapper
        uint16 requestConfirmations;
        uint32 callbackGasLimit; // gas the wrapper forwards to rawFulfillRandomWords
    }

    /// @dev Chainlink v2.5 bounds: min confirmations 3 (BSC), max callback gas 2,500,000 (BSC config).
    uint16 public constant MIN_REQUEST_CONFIRMATIONS = 3;
    uint16 public constant MAX_REQUEST_CONFIRMATIONS = 200;
    uint32 public constant MIN_CALLBACK_GAS = 50_000;
    uint32 public constant MAX_CALLBACK_GAS = 2_500_000;
    /// @notice 10% UI buffer on top of the wrapper's quote in `vrfFeeAt`: absorbs a small gas-price move between
    /// quoting and inclusion. Never forwarded to the wrapper; refunded by us when unused.
    uint256 public constant FEE_BUFFER_BPS = 1_000;
    uint256 public constant FEE_BPS = 10_000;

    error OnlyVRFWrapperCanFulfill(address have, address want);
    error VrfFeeTooLow(uint256 sent, uint256 required);
    error RefundFailed();

    /// @param fee the EXACT amount forwarded to the wrapper (its `calculateRequestPriceNative` at tx.gasprice).
    event VrfFeePaid(address indexed payer, uint256 indexed requestId, uint256 fee);

    IVRFV2PlusWrapper public immutable vrfWrapper;
    uint16 public immutable vrfRequestConfirmations;
    uint32 public immutable vrfCallbackGasLimit;

    constructor(VRFConfig memory cfg) {
        require(cfg.wrapper.code.length > 0, "VRF: wrapper");
        require(
            cfg.requestConfirmations >= MIN_REQUEST_CONFIRMATIONS
                && cfg.requestConfirmations <= MAX_REQUEST_CONFIRMATIONS,
            "VRF: confirmations"
        );
        require(cfg.callbackGasLimit >= MIN_CALLBACK_GAS && cfg.callbackGasLimit <= MAX_CALLBACK_GAS, "VRF: gas");
        vrfWrapper = IVRFV2PlusWrapper(cfg.wrapper);
        vrfRequestConfirmations = cfg.requestConfirmations;
        vrfCallbackGasLimit = cfg.callbackGasLimit;
    }

    // ================================================================= fee quote
    /// @notice Suggested `msg.value` for the VRF part of one request sent at `gasPrice`: the wrapper's own quote
    /// plus FEE_BUFFER_BPS. THE FRONTEND MUST CALL THIS with the gas price it will send at (eth_call often has
    /// tx.gasprice == 0, which makes the wrapper's `calculateRequestPriceNative` meaningless off-chain).
    /// The amount actually charged is the wrapper's price at the request tx's real gas price; the rest is refunded.
    function vrfFeeAt(uint256 gasPrice) public view returns (uint256) {
        uint256 p = vrfWrapper.estimateRequestPriceNative(vrfCallbackGasLimit, 1, gasPrice);
        return p * (FEE_BPS + FEE_BUFFER_BPS) / FEE_BPS;
    }

    /// @notice Convenience: `vrfFeeAt(tx.gasprice)`. Off-chain, prefer `vrfFeeAt(gasPrice)`.
    function vrfFee() external view returns (uint256) {
        return vrfFeeAt(tx.gasprice);
    }

    // ================================================================= request
    /// @dev Prices the request at tx.gasprice through the wrapper, requires `available >= price`, sends the wrapper
    /// EXACTLY `price` (it does not refund) and requests one word in native. Returns (requestId, price); the caller
    /// refunds `available - price`. Reverts (atomically, with the caller) if the price is not covered.
    function _requestRandomWordPaid(uint256 available) internal returns (uint256 requestId, uint256 price) {
        IVRFV2PlusWrapper w = vrfWrapper;
        price = w.calculateRequestPriceNative(vrfCallbackGasLimit, 1);
        if (available < price) revert VrfFeeTooLow(available, price);
        requestId = w.requestRandomWordsInNative{value: price}(
            vrfCallbackGasLimit,
            vrfRequestConfirmations,
            1,
            VRFV2PlusClient.argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: true}))
        );
        emit VrfFeePaid(msg.sender, requestId, price);
    }

    /// @dev Sends `amount` back to msg.sender (no-op for 0). Call last (CEI); callers are nonReentrant.
    function _refund(uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert RefundFailed();
    }

    /// @dev Called by the wrapper. Name/signature match Chainlink's VRFV2PlusWrapperConsumerBase.
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(vrfWrapper)) revert OnlyVRFWrapperCanFulfill(msg.sender, address(vrfWrapper));
        _fulfillRandomWords(requestId, randomWords);
    }

    function _fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal virtual;
}
