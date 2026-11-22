// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Agent ID registry interface.
/// Mainnet verified registry (BSC chain 56): `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
/// (SPACE ID `HandleRegistry`, ERC-721 symbol "AI", soulbound, strictly one handle per address,
/// `tokenId = uint256(keccak256(bytes(handle)))`, Sourcify exact_match on chain 56).
///
/// Compatibility:
///  - `balanceOf(address)` is the universal gate used by TowackLaunch and TowackRouter; it works identically
///    on mainnet `HandleRegistry` (returns 1 iff `handleOf(owner)` is non-empty, 0 otherwise) and on the
///    testnet `MockAgentId` / `MockAgentIdNFT` contracts.
///  - `ownerOf(uint256)` is used by TowackGenesis (`mint(uint256)`); compatible with mainnet `HandleRegistry`
///    and testnet `MockAgentIdNFT`.
///  - `handleOf(address)` and `ownerOfHandle(string)` are mainnet `HandleRegistry` views (not implemented by
///    testnet mocks); callers that use them (`TowackGenesis.mintByHandle()`, frontend resolution) handle
///    missing methods gracefully.
interface IAgentId {
    function balanceOf(address owner) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function handleOf(address owner) external view returns (string memory);
    function ownerOfHandle(string calldata handle) external view returns (address);
}
