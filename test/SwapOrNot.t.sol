// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {SwapOrNot} from "../src/libraries/SwapOrNot.sol";

contract SwapOrNotHarness {
    function permute(uint256 i, uint256 n, bytes32 s) external pure returns (uint256) {
        return SwapOrNot.permute(i, n, s);
    }
}

contract SwapOrNotTest is Test {
    SwapOrNotHarness h = new SwapOrNotHarness();

    function testFuzz_IsBijection(uint256 n, bytes32 seed) public view {
        n = bound(n, 1, 400);
        bool[] memory seen = new bool[](n);
        for (uint256 i; i < n; ++i) {
            uint256 p = h.permute(i, n, seed);
            assertLt(p, n);
            assertFalse(seen[p], "collision");
            seen[p] = true;
        }
    }

    function test_DifferentSeedsDiffer() public view {
        uint256 same;
        for (uint256 i; i < 100; ++i) {
            if (h.permute(i, 100, bytes32(uint256(1))) == h.permute(i, 100, bytes32(uint256(2)))) same++;
        }
        assertLt(same, 10);
    }

    function test_IndexOutOfRangeReverts() public {
        vm.expectRevert("SwapOrNot: index");
        h.permute(5, 5, bytes32(0));
    }
}

/// Reference (non-assembly) implementation to check the optimized version.
contract SwapOrNotReferenceTest is Test {
    SwapOrNotHarness h = new SwapOrNotHarness();

    function ref(uint256 index, uint256 n, bytes32 seed) internal pure returns (uint256) {
        for (uint256 r; r < 90; ++r) {
            uint256 pivot = uint256(keccak256(abi.encodePacked(seed, uint8(r)))) % n;
            uint256 flip = (pivot + n - index) % n;
            uint256 pos = index > flip ? index : flip;
            bytes32 hh = keccak256(abi.encodePacked(seed, uint8(r), uint32(pos >> 8)));
            if ((uint256(hh) >> (pos & 0xff)) & 1 == 1) index = flip;
        }
        return index;
    }

    function testFuzz_MatchesReference(uint256 n, uint256 i, bytes32 seed) public view {
        n = bound(n, 1, 100_000);
        i = bound(i, 0, n - 1);
        assertEq(h.permute(i, n, seed), ref(i, n, seed));
    }
}
