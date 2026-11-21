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

    function permute(uint256 index, uint256 n, bytes32 seed) internal pure returns (uint256 result) {
        require(index < n, "SwapOrNot: index");
        // Equivalent to:
        //   pivot = uint256(keccak256(abi.encodePacked(seed, uint8(r)))) % n;
        //   flip  = (pivot + n - index) % n;  pos = max(index, flip);
        //   bit   = keccak256(abi.encodePacked(seed, uint8(r), uint32(pos >> 8))) bit (pos & 0xff)
        //   if (bit) index = flip;
        // Uses only scratch space [0x00, 0x40).
        assembly ("memory-safe") {
            mstore(0x00, seed)
            for { let r := 0 } lt(r, ROUNDS) { r := add(r, 1) } {
                mstore(0x20, shl(248, r))
                let pivot := mod(keccak256(0x00, 0x21), n)
                let flip := mod(sub(add(pivot, n), index), n)
                let pos := index
                if gt(flip, index) { pos := flip }
                mstore(0x20, or(shl(248, r), shl(216, and(shr(8, pos), 0xffffffff))))
                let h := keccak256(0x00, 0x25)
                if and(shr(and(pos, 0xff), h), 1) { index := flip }
            }
            result := index
        }
    }
}
