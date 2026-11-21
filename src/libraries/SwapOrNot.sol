// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title SwapOrNot
/// @notice Seeded pseudo-random permutation of [0, n) ("swap-or-not" shuffle, Hoang/Morris/Rogaway,
/// the same construction the Ethereum beacon chain uses for committee shuffling).
/// It is equivalent to a seeded Fisher-Yates for our purposes: `permute(., n, seed)` is a BIJECTION on
/// [0, n) for every seed, so each prize slot is assigned to exactly one minter and no slot can be
/// assigned twice. Unlike an in-storage Fisher-Yates it needs O(1) storage and can be evaluated lazily
/// per minter at claim time, so the VRF callback only stores one seed.
library SwapOrNot {
    uint256 internal constant ROUNDS = 90;

    function permute(uint256 index, uint256 n, bytes32 seed) internal pure returns (uint256) {
        require(index < n, "SwapOrNot: index");
        for (uint256 r; r < ROUNDS; ++r) {
            uint256 pivot = uint256(keccak256(abi.encodePacked(seed, uint8(r)))) % n;
            uint256 flip = (pivot + n - index) % n;
            uint256 pos = index > flip ? index : flip;
            bytes32 h = keccak256(abi.encodePacked(seed, uint8(r), uint32(pos >> 8)));
            if ((uint256(h) >> (pos & 0xff)) & 1 == 1) index = flip;
        }
        return index;
    }
}
