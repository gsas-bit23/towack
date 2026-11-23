// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TowackGenesis} from "../src/TowackGenesis.sol";

/// @dev Minimal ABI of the OLD, already-deployed VRF TowackGenesis at 0xD093…8038 (source: git d08d184,
/// src/TowackGenesis.sol). Its `close()` / `sweepSurplus()` selectors happen to equal the new contract's, but the
/// script talks to it only through this interface so it never depends on the rewritten source.
interface IOldGenesisVrf {
    function owner() external view returns (address);
    function ecosystemWallet() external view returns (address);
    function token() external view returns (address);
    function isOpen() external view returns (bool);
    function mintCount() external view returns (uint256);
    function assignedCount() external view returns (uint256);
    function pendingCount() external view returns (uint256);
    function committed() external view returns (uint256);
    function surplus() external view returns (uint256);
    function extraOutstanding() external view returns (uint256);
    function close() external;
    function sweepSurplus() external returns (uint256 amount);
}

/// @notice BSC MAINNET (56) Genesis 300 migration: retire the old VRF Genesis and replace it with the flat,
/// gas-only 20,000 TWAK TowackGenesis (no VRF, non-payable mint, 6,000,000 TWAK budget).
///
/// Sequence (all txs from the deployer = old owner = ecosystem wallet = new owner/ecosystem wallet):
///   1. oldGenesis.close()          (skipped if already closed)
///   2. oldGenesis.sweepSurplus()   (skipped if surplus == 0) -> unused TWAK back to the ecosystem wallet (deployer)
///   3. new TowackGenesis(TWAK, AGENT_ID, deployer, deployer)   (skipped if NEW_GENESIS env is set: resume)
///   4. TWAK.approve(newGenesis, 6M) + newGenesis.fund(6M)      (skipped if newGenesis already holds >= 6M)
///   5. newGenesis.open()           (skipped if already open)
/// forge broadcasts these as separate sequential txs (not one atomic tx: the old contract is owned by the EOA, so
/// a helper contract could not close/sweep it). Every step is idempotent, so a partial broadcast can be resumed by
/// re-running with NEW_GENESIS=<address from step 3>.
///
/// ENTRY POINTS:
///  1. dryRun()  — DEFAULT for review. Simulation only, refuses --broadcast/--resume, no key needed.
///       forge script script/RedeployGenesisFlatMainnet.s.sol --sig "dryRun()" --rpc-url bsc_mainnet \
///         --with-gas-price 0.1gwei --legacy --slow
///  2. run()     — REAL MAINNET. OWNER-ONLY, DO NOT BROADCAST UNTIL THE OWNER SAYS GO.
///     Without --broadcast it is the same simulation (key optional). With --broadcast it requires
///     TOWACK_MAINNET_GO=I_HAVE_MATEENS_GO, MAINNET_DEPLOYER_PRIVATE_KEY (or PRIVATE_KEY) whose address is DEPLOYER,
///     and DEPLOYER.balance >= GAS_RESERVE.
///       set -a; source <mainnet deployer env>; set +a        # never echo it
///       TOWACK_MAINNET_GO=I_HAVE_MATEENS_GO forge script script/RedeployGenesisFlatMainnet.s.sol \
///         --rpc-url bsc_mainnet --with-gas-price 0.1gwei --legacy --slow --broadcast
///     Then put the logged new Genesis address into web/src/config/addresses.json (chain 56 "genesis").
contract RedeployGenesisFlatMainnet is Script {
    // ---------------------------------------------------------------- live mainnet addresses
    address public constant OLD_GENESIS = 0xD093745a1BB0Dc11D5Dc2ded64905a9D27f08038;
    address public constant TWAK = 0xeC5942C5B8952C007E4DCB6c6fF04183e3aBe494;
    /// SPACE ID "Agent ID" HandleRegistry (soulbound ERC-721): ownerOf / handleOf.
    address public constant AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    /// Deployer = old Genesis owner = ecosystem wallet; also owner + ecosystem wallet of the new Genesis.
    address public constant DEPLOYER = 0x38A0f77Dad60B34cF5cD39305687e354696a6776;

    uint256 public constant BUDGET = 6_000_000e18;
    /// Dry run (2026-11-23): 1,294,652 gas raw (1,683,046 with forge's default 1.3x tx gas limits) => ~0.00013 /
    /// 0.00017 BNB at 0.1 gwei. Reserve with ~1.8x headroom over the 1.3x figure.
    uint256 public constant GAS_RESERVE = 0.0003 ether;
    string internal constant GO_PHRASE = "I_HAVE_MATEENS_GO";

    struct Out {
        bool oldWasOpen;
        bool closedOld;
        uint256 swept;
        uint256 oldBalanceAfter;
        address newGenesis;
        bool deployedNew;
        bool funded;
        bool opened;
    }

    // ================================================================= entry points
    function dryRun() external returns (Out memory o) {
        require(
            !vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) && !vm.isContext(VmSafe.ForgeContext.ScriptResume),
            "DRY RUN ONLY: refusing --broadcast/--resume"
        );
        require(block.chainid == 56, "BSC mainnet (or a mainnet fork) only");
        _preflight();
        vm.startBroadcast(DEPLOYER);
        o = _migrate();
        vm.stopBroadcast();
        _verify(o);
        _log(o);
        console2.log("DRY RUN ONLY: the new Genesis address above is simulated; nothing was sent");
    }

    /// OWNER-ONLY when broadcasting. DO NOT BROADCAST UNTIL THE OWNER SAYS GO.
    function run() external returns (Out memory o) {
        require(block.chainid == 56, "BSC mainnet only");
        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        uint256 pk = vm.envOr("MAINNET_DEPLOYER_PRIVATE_KEY", vm.envOr("PRIVATE_KEY", uint256(0)));
        if (live) {
            require(
                keccak256(bytes(vm.envOr("TOWACK_MAINNET_GO", string("")))) == keccak256(bytes(GO_PHRASE)),
                "mainnet broadcast blocked: set TOWACK_MAINNET_GO only after the owner says go"
            );
            require(pk != 0, "set MAINNET_DEPLOYER_PRIVATE_KEY (or PRIVATE_KEY)");
            require(DEPLOYER.balance >= GAS_RESERVE, "deployer BNB < GAS_RESERVE");
        }
        if (pk != 0) require(vm.addr(pk) == DEPLOYER, "key does not match DEPLOYER");
        if (DEPLOYER.balance < GAS_RESERVE) {
            console2.log("WARNING: deployer BNB below GAS_RESERVE (wei)", DEPLOYER.balance);
        }
        _preflight();
        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast(DEPLOYER);
        o = _migrate();
        vm.stopBroadcast();
        _verify(o);
        _log(o);
        if (!live) console2.log("SIMULATION ONLY (no --broadcast): nothing was sent");
    }

    // ================================================================= internals
    function _preflight() internal view {
        IOldGenesisVrf g = IOldGenesisVrf(OLD_GENESIS);
        require(OLD_GENESIS.code.length > 0 && TWAK.code.length > 0 && AGENT_ID.code.length > 0, "missing code");
        require(g.owner() == DEPLOYER, "old genesis owner != DEPLOYER");
        require(g.ecosystemWallet() == DEPLOYER, "old genesis ecosystem wallet != DEPLOYER");
        require(g.token() == TWAK, "old genesis token");
        console2.log("== preflight (live state)");
        console2.log("old isOpen", g.isOpen());
        console2.log("old mintCount", g.mintCount());
        console2.log("old pendingCount (VRF draws in flight)", g.pendingCount());
        console2.log("old extraOutstanding (assigned, unclaimed)", g.extraOutstanding());
        console2.log("old TWAK balance", IERC20(TWAK).balanceOf(OLD_GENESIS));
        console2.log("deployer TWAK balance", IERC20(TWAK).balanceOf(DEPLOYER));
        console2.log("deployer BNB (wei)", DEPLOYER.balance);
    }

    function _migrate() internal returns (Out memory o) {
        IOldGenesisVrf old = IOldGenesisVrf(OLD_GENESIS);
        IERC20 twak = IERC20(TWAK);

        // 1-2. retire the old VRF Genesis; committed() after close keeps only assigned-unclaimed extra + worst-case
        // extra for in-flight VRF draws, so those users stay paid.
        o.oldWasOpen = old.isOpen();
        if (o.oldWasOpen) {
            old.close();
            o.closedOld = true;
        }
        if (old.surplus() > 0) o.swept = old.sweepSurplus();
        o.oldBalanceAfter = twak.balanceOf(OLD_GENESIS);

        // 3. deploy (or resume with) the flat gas-only Genesis
        o.newGenesis = vm.envOr("NEW_GENESIS", address(0));
        if (o.newGenesis == address(0)) {
            o.newGenesis = address(new TowackGenesis(TWAK, AGENT_ID, DEPLOYER, DEPLOYER));
            o.deployedNew = true;
        }
        TowackGenesis g = TowackGenesis(o.newGenesis);

        // 4. fund up to the 6M budget
        uint256 have = twak.balanceOf(o.newGenesis);
        if (have < BUDGET) {
            uint256 need = BUDGET - have;
            require(twak.balanceOf(DEPLOYER) >= need, "deployer TWAK < budget");
            twak.approve(o.newGenesis, need);
            g.fund(need);
            o.funded = true;
        }

        // 5. open the window
        if (!g.isOpen()) {
            g.open();
            o.opened = true;
        }
    }

    function _verify(Out memory o) internal view {
        IOldGenesisVrf old = IOldGenesisVrf(OLD_GENESIS);
        require(!old.isOpen(), "old genesis still open");
        require(old.surplus() == 0, "old genesis surplus left");
        require(IERC20(TWAK).balanceOf(OLD_GENESIS) == old.committed(), "old genesis holds more than committed");
        TowackGenesis g = TowackGenesis(o.newGenesis);
        require(address(g.token()) == TWAK && address(g.agentId()) == AGENT_ID, "new genesis deps");
        require(g.ecosystemWallet() == DEPLOYER && g.owner() == DEPLOYER, "new genesis wallet/owner");
        require(g.MAX_MINTS() == 300 && g.BASE_TOKENS() == 20_000e18 && g.BUDGET() == BUDGET, "new genesis params");
        require(g.isOpen(), "new genesis not open");
        require(IERC20(TWAK).balanceOf(o.newGenesis) >= g.committed(), "new genesis underfunded");
        if (g.mintCount() == 0) require(g.committed() == BUDGET, "committed != 6M");
    }

    function _log(Out memory o) internal view {
        console2.log("== Genesis flat migration (BSC mainnet 56)");
        console2.log("old genesis", OLD_GENESIS);
        console2.log("  was open / closed now", o.oldWasOpen, o.closedOld);
        console2.log("  swept to ecosystem wallet (TWAK wei)", o.swept);
        console2.log("  TWAK left in old (reserved for pending/unclaimed)", o.oldBalanceAfter);
        console2.log("new genesis", o.newGenesis);
        console2.log("  deployed / funded / opened", o.deployedNew, o.funded, o.opened);
        console2.log("  TWAK balance", IERC20(TWAK).balanceOf(o.newGenesis));
        console2.log("  committed", TowackGenesis(o.newGenesis).committed());
        console2.log("deployer TWAK after", IERC20(TWAK).balanceOf(DEPLOYER));
        console2.log("NEXT: set web/src/config/addresses.json chain 56 genesis to the new address above");
    }
}
