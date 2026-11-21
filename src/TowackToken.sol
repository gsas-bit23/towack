// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {IPancakeFactory} from "./interfaces/IPancakeV2.sol";

/// @title Towack (TWAK)
/// @notice Fixed-supply ERC-20. 1,000,000,000 TWAK minted once in the constructor to the allocation
/// recipients. No transfer tax, no owner, no mint function, holders can burn their own tokens.
///
/// The ONLY non-standard behaviour is a one-way pre-listing pair guard: until the launch contract
/// seeds the PancakeSwap TWAK/WBNB pair, nobody except the launch contract may transfer TWAK *into*
/// that pair. This stops a minter from pre-seeding the pool at a manipulated price (which would
/// skew or brick the listing). The guard is lifted permanently by the launch contract when it lists;
/// there is no way to re-enable it.
contract TowackToken is ERC20, ERC20Burnable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;

    uint256 public constant PUBLIC_MINT = 400_000_000e18; // 40%
    uint256 public constant DRAW_V1_BONUS = 50_000_000e18; // 5%
    uint256 public constant INITIAL_LP = 200_000_000e18; // 20%
    uint256 public constant TRADER_REBATES = 100_000_000e18; // 10%
    uint256 public constant TEAM_VESTING = 50_000_000e18; // 5%
    uint256 public constant DRAW_V2_PRIZES = 70_000_000e18; // 7%
    uint256 public constant SEASONS = 50_000_000e18; // 5%
    uint256 public constant ECOSYSTEM = 50_000_000e18; // 5%
    uint256 public constant POL_BUFFER = 30_000_000e18; // 3%

    /// @dev Launch contract receives public mint + draw V1 bonus reserve + initial LP.
    uint256 public constant LAUNCH_ALLOCATION = PUBLIC_MINT + DRAW_V1_BONUS + INITIAL_LP;

    struct Recipients {
        address launch; // TowackLaunch (mint + draw V1 + listing)
        address rebates; // RebateDistributor
        address team; // TeamVesting
        address drawV2; // DrawV2
        address seasons; // seasons / referrals wallet
        address ecosystem; // ecosystem / dev wallet
        address polBuffer; // protocol-owned liquidity buffer wallet
    }

    error PairLocked();
    error OnlyLaunch();
    error ZeroAddress();

    address public immutable launch;
    address public immutable pair;
    bool public tradingOpen;

    event TradingOpened();

    constructor(Recipients memory r, address pancakeFactory, address wbnb) ERC20("Towack", "TWAK") {
        if (
            r.launch == address(0) || r.rebates == address(0) || r.team == address(0) || r.drawV2 == address(0)
                || r.seasons == address(0) || r.ecosystem == address(0) || r.polBuffer == address(0)
                || pancakeFactory == address(0) || wbnb == address(0)
        ) revert ZeroAddress();

        launch = r.launch;
        pair = IPancakeFactory(pancakeFactory).createPair(address(this), wbnb);

        _mint(r.launch, LAUNCH_ALLOCATION);
        _mint(r.rebates, TRADER_REBATES);
        _mint(r.team, TEAM_VESTING);
        _mint(r.drawV2, DRAW_V2_PRIZES);
        _mint(r.seasons, SEASONS);
        _mint(r.ecosystem, ECOSYSTEM);
        _mint(r.polBuffer, POL_BUFFER);
        assert(totalSupply() == TOTAL_SUPPLY);
    }

    /// @notice One-way switch, callable only by the launch contract right after it seeds the pair.
    function openTrading() external {
        if (msg.sender != launch) revert OnlyLaunch();
        if (!tradingOpen) {
            tradingOpen = true;
            emit TradingOpened();
        }
    }

    function _update(address from, address to, uint256 value) internal override {
        if (!tradingOpen && to == pair && from != launch) revert PairLocked();
        super._update(from, to, value);
    }
}
