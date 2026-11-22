// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {DeployFullStackTestnet} from "./DeployFullStackTestnet.s.sol";

/// @notice BSC TESTNET ONLY (chainid 97). Thin alias of DeployFullStackTestnet that always deploys Launch with
/// `instantClose = true` (ignores INSTANT_CLOSE). Everything else (7-day default window, official VRF v2.5 wrapper,
/// callback limits, MockAgentId defaults, Genesis funding, chain-97 guard, keyless dryRun() that refuses
/// --broadcast/--resume) is inherited unchanged.
///
/// This is a SEPARATE instant-list rehearsal stack: after one paid mint and its VRF callback, anyone can call
/// closeMint() + finalizeListing() and trading opens. Do NOT write its addresses into web/src/config/addresses.json
/// (the live 7-day stack stays there).
///
/// Keyless preview (never pass --broadcast):
///   forge script script/DeployRehearsalStackTestnet.s.sol --sig "dryRun()" \
///     --rpc-url bsc_testnet --legacy --with-gas-price 1gwei
/// Broadcast (Grok / the operator only):
///   set -a; source /workspace/secrets/towack-deployer.env; set +a   # do not echo
///   forge script script/DeployRehearsalStackTestnet.s.sol \
///     --rpc-url bsc_testnet --broadcast --legacy --with-gas-price 1gwei --slow
contract DeployRehearsalStackTestnet is DeployFullStackTestnet {
    function _instantClose() internal pure override returns (bool) {
        return true;
    }
}
