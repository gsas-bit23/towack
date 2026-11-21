// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal Agent ID registry view. Agent IDs are soulbound, so one address == one Agent ID holder.
/// Mainnet registry (configurable at deploy, never hardcoded): 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F
interface IAgentId {
    function balanceOf(address owner) external view returns (uint256);
}
