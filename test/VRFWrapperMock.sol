// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {VRFV2PlusClient} from "../src/interfaces/IVRFCoordinatorV2Plus.sol";

interface IWrapperConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// @notice TEST ONLY. Mirrors Chainlink's official `VRFV2PlusWrapper` (v1.0.0) on the parts our consumers touch:
///  - native price = gasPrice * wrapperGasOverhead
///                 + (gasPrice * (callbackGas + coordinatorGasOverheadNative + numWords * perWord)) * (100 + premium) / 100
///                 + 1e12 * flatFeeNativePPM
///    (`_calculateRequestPriceNative`, L1 cost 0). Defaults = the LIVE BSC 97 / 56 wrapper `getConfig()` read
///    2026-11-22: wrapper overhead 13,400, coordinator native overhead 99,500, 435 per word, premium 60%, flat 0.
///  - `requestRandomWordsInNative` prices at tx.gasprice, requires `msg.value >= price` ("fee too low"),
///    KEEPS any overpayment (no refund), checks extraArgs is ExtraArgsV1 with nativePayment = true.
///  - `fulfill` calls the consumer's `rawFulfillRandomWords` with EXACTLY the request's callbackGasLimit
///    (`_callWithExactGas`), never reverts on a failed callback (emits WrapperFulfillmentFailed instead).
contract VRFWrapperMock {
    event WrapperFulfillmentFailed(uint256 indexed requestId, address indexed consumer);
    event Requested(
        uint256 indexed requestId, address indexed consumer, uint32 callbackGasLimit, uint16 conf, uint256 paid
    );

    struct Callback {
        address consumer;
        uint32 callbackGasLimit;
        uint16 confirmations;
        uint32 numWords;
        uint256 paid;
    }

    uint32 public wrapperGasOverhead = 13_400;
    uint32 public coordinatorGasOverheadNative = 99_500;
    uint16 public coordinatorGasOverheadPerWord = 435;
    uint8 public nativePremiumPercentage = 60;
    uint32 public fulfillmentFlatFeeNativePPM;
    uint32 public maxNumWords = 10;
    address public immutable link = address(0x1111);

    /// Like the official wrapper, only the LINK path (onTokenTransfer) sets this; the native path does NOT, so
    /// consumers must use the return value of requestRandomWordsInNative (ours do). Always 0 here.
    uint256 public lastRequestId;
    uint256 internal nonce;
    uint256 public totalPaid;
    uint256 public requestCount;
    mapping(uint256 => Callback) public callbacks;
    /// Gas the consumer actually used in the last `fulfill` (for callback-limit measurements).
    uint256 public lastCallbackGasUsed;

    function setConfig(uint32 wrapperOh, uint32 coordOh, uint16 perWord, uint8 premium, uint32 flatPPM) external {
        wrapperGasOverhead = wrapperOh;
        coordinatorGasOverheadNative = coordOh;
        coordinatorGasOverheadPerWord = perWord;
        nativePremiumPercentage = premium;
        fulfillmentFlatFeeNativePPM = flatPPM;
    }

    function linkNativeFeed() external pure returns (address) {
        return address(0x2222);
    }

    // ---------------------------------------------------------------- pricing (official formula)
    function _price(uint256 gas, uint32 numWords, uint256 gp) internal view returns (uint256) {
        uint256 wrapperCost = gp * wrapperGasOverhead;
        uint256 coordCost =
            gp * (gas + coordinatorGasOverheadNative + uint256(numWords) * coordinatorGasOverheadPerWord);
        return wrapperCost + coordCost * (uint256(nativePremiumPercentage) + 100) / 100 + 1e12
            * uint256(fulfillmentFlatFeeNativePPM);
    }

    function calculateRequestPriceNative(uint32 callbackGasLimit, uint32 numWords) external view returns (uint256) {
        return _price(callbackGasLimit, numWords, tx.gasprice);
    }

    function estimateRequestPriceNative(uint32 callbackGasLimit, uint32 numWords, uint256 gasPrice)
        external
        view
        returns (uint256)
    {
        return _price(callbackGasLimit, numWords, gasPrice);
    }

    // ---------------------------------------------------------------- request
    function requestRandomWordsInNative(
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        uint32 numWords,
        bytes calldata extraArgs
    ) external payable returns (uint256 requestId) {
        require(extraArgs.length >= 36, "IncorrectExtraArgsLength");
        require(bytes4(extraArgs[:4]) == VRFV2PlusClient.EXTRA_ARGS_V1_TAG, "extraArgs tag");
        require(abi.decode(extraArgs[4:], (bool)), "LINKPaymentInRequestRandomWordsInNative");
        uint256 price = _price(callbackGasLimit, numWords, tx.gasprice);
        require(msg.value >= price, "fee too low");
        require(numWords <= maxNumWords, "numWords too high");
        requestId = ++nonce; // sequential (the real id comes from the coordinator)
        callbacks[requestId] = Callback(msg.sender, callbackGasLimit, requestConfirmations, numWords, msg.value);
        totalPaid += msg.value;
        ++requestCount;
        emit Requested(requestId, msg.sender, callbackGasLimit, requestConfirmations, msg.value);
    }

    // ---------------------------------------------------------------- fulfil (test driver)
    /// Delivers `word` for `requestId`. Returns the callback's success flag (like the wrapper, a failed callback
    /// does not revert the fulfilment).
    function fulfill(uint256 requestId, uint256 word) external returns (bool success) {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        return fulfillWords(requestId, words);
    }

    function fulfillWords(uint256 requestId, uint256[] memory words) public returns (bool success) {
        Callback memory cb = callbacks[requestId];
        require(cb.consumer != address(0), "request not found");
        delete callbacks[requestId];
        success = fulfillRawTo(cb.consumer, requestId, words, cb.callbackGasLimit);
        if (!success) emit WrapperFulfillmentFailed(requestId, cb.consumer);
    }

    /// Delivers to an arbitrary consumer with an arbitrary gas amount (wrong-consumer / OOG tests).
    function fulfillRawTo(address consumer, uint256 requestId, uint256[] memory words, uint256 gasAmount)
        public
        returns (bool success)
    {
        bytes memory data = abi.encodeCall(IWrapperConsumer.rawFulfillRandomWords, (requestId, words));
        uint256 before;
        uint256 afterG;
        assembly {
            let g := gas()
            if lt(g, 5000) { revert(0, 0) }
            g := sub(g, 5000)
            if iszero(gt(sub(g, div(g, 64)), gasAmount)) { revert(0, 0) }
            if iszero(extcodesize(consumer)) { revert(0, 0) }
            before := gas()
            success := call(gasAmount, consumer, 0, add(data, 0x20), mload(data), 0, 0)
            afterG := gas()
        }
        lastCallbackGasUsed = before - afterG;
    }
}
