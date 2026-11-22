// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

/// @notice TESTNET/TEST ONLY. ERC-721 mock Agent ID registry with real token ids (`ownerOf`), used by
/// TowackGenesis. Transferable (so tests can move a used id to a fresh wallet). Anyone can self-register
/// once; the owner can register any number of ids for anyone. Token ids start at 1.
contract MockAgentIdNFT is ERC721Enumerable {
    address public immutable owner;
    uint256 public nextId = 1;
    mapping(address => bool) public selfRegistered;

    constructor() ERC721("Mock Agent ID", "mAGENT") {
        owner = msg.sender;
    }

    function register() external returns (uint256 id) {
        require(!selfRegistered[msg.sender], "has id");
        selfRegistered[msg.sender] = true;
        id = _next(msg.sender);
    }

    function registerFor(address who) external returns (uint256 id) {
        require(msg.sender == owner, "owner");
        id = _next(who);
    }

    function _next(address who) internal returns (uint256 id) {
        id = nextId++;
        _mint(who, id);
    }
}
