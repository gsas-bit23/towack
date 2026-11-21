// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {VRFV2PlusClient} from "../interfaces/IVRFCoordinatorV2Plus.sol";

interface IVRFConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// @notice TESTNET/TEST ONLY. NOT a source of secure randomness: the owner chooses/derives the word.
/// Production must use the real Chainlink VRF v2.5 coordinator.
contract MockVRFCoordinator {
    address public immutable owner;
    uint256 public nextRequestId = 1;
    mapping(uint256 => address) public consumerOf;
    VRFV2PlusClient.RandomWordsRequest public lastRequest;

    event Requested(uint256 indexed requestId, address indexed consumer);

    constructor() {
        owner = msg.sender;
    }

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req) external returns (uint256 id) {
        id = nextRequestId++;
        consumerOf[id] = msg.sender;
        lastRequest = req;
        emit Requested(id, msg.sender);
    }

    function fulfill(uint256 requestId, uint256 word) public {
        require(msg.sender == owner, "owner");
        address c = consumerOf[requestId];
        require(c != address(0), "unknown");
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        IVRFConsumer(c).rawFulfillRandomWords(requestId, words);
    }

    /// @notice Convenience for testnet: derive a word from prevrandao + request id.
    function fulfillPseudo(uint256 requestId) external {
        fulfill(requestId, uint256(keccak256(abi.encode(block.prevrandao, requestId, block.timestamp))));
    }
}
