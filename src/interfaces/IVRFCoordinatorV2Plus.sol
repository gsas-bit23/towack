// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Chainlink VRF v2.5 ("V2Plus") client types. Byte-for-byte equal to Chainlink's
/// `VRFV2PlusClient` (`test/OfficialVRF.t.sol` asserts the tag and encoding against the official Chainlink library).
library VRFV2PlusClient {
    // bytes4(keccak256("VRF ExtraArgsV1"))
    bytes4 internal constant EXTRA_ARGS_V1_TAG = 0x92fd1338;

    struct ExtraArgsV1 {
        bool nativePayment;
    }

    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }

    function argsToBytes(ExtraArgsV1 memory extraArgs) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, extraArgs);
    }
}

/// @notice Subscription half of the official coordinator (same signatures as Chainlink's
/// `IVRFSubscriptionV2Plus`). Used by the deploy script and tests; consumers only call `requestRandomWords`.
interface IVRFSubscriptionV2Plus {
    function createSubscription() external returns (uint256 subId);
    function fundSubscriptionWithNative(uint256 subId) external payable;
    function addConsumer(uint256 subId, address consumer) external;
    function removeConsumer(uint256 subId, address consumer) external;
    function cancelSubscription(uint256 subId, address to) external;
    function requestSubscriptionOwnerTransfer(uint256 subId, address newOwner) external;
    function acceptSubscriptionOwnerTransfer(uint256 subId) external;
    function getSubscription(uint256 subId)
        external
        view
        returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] memory consumers);
    function pendingRequestExists(uint256 subId) external view returns (bool);
    function getActiveSubscriptionIds(uint256 startIndex, uint256 maxCount) external view returns (uint256[] memory);
}

/// @notice Official Chainlink VRF v2.5 coordinator (BSC testnet: 0xDA3b641D438362C440Ac5458c57e00a712b66700).
interface IVRFCoordinatorV2Plus is IVRFSubscriptionV2Plus {
    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req) external returns (uint256 requestId);
}
