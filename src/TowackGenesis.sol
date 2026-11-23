// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAgentId} from "./interfaces/IAgentId.sol";

/// @title TowackGenesis ("Genesis 300")
/// @notice 300 completely FREE claims for Agent ID holders, separate from the 5,000 paid TowackLaunch mints.
/// Gas-only: `mint` is non-payable (0 BNB attached), there is no Chainlink VRF request, no wheel and no
/// second `claim()` transaction. Every claim transfers a flat 20,000 TWAK to the caller in the same tx.
/// The contract never holds or accepts BNB.
///
/// Design numbers:
///  - Cap 300 claims x flat 20,000 TWAK = BUDGET 6,000,000 TWAK (12% of the 50M / 5% ecosystem allocation).
///    Pre-funded from the ecosystem wallet via `fund()`. The contract never pulls from TowackLaunch, the LP
///    pair, DrawV2 or the bonus reserve.
///
/// Gate: the caller must `ownerOf(tokenId)` on the Agent ID (ERC-721) registry. Both the tokenId and the
/// wallet are marked used, so a used tokenId moved to a fresh wallet is still blocked and a wallet that
/// already claimed cannot use a second tokenId.
///
/// Solvency: `committed()` is every TWAK the contract may still owe: `(MAX_MINTS - mintCount) * BASE_TOKENS`
/// while open, 0 once closed (every claim is paid out instantly, nothing is ever left owed). `open()` requires
/// `balance >= committed()`, and `sweepSurplus()` can only send `balance - committed()` to the ecosystem
/// wallet, so an open window is always fully funded for the remaining claims.
///
/// Owner (Ownable2Step; deployer first, can be handed to the timelock) can only open/close the window and
/// sweep surplus to the fixed ecosystem wallet. It cannot touch committed TWAK or change the grant.
contract TowackGenesis is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants
    uint256 public constant MAX_MINTS = 300;
    uint256 public constant BASE_TOKENS = 20_000e18;
    uint256 public constant BUDGET = MAX_MINTS * BASE_TOKENS; // 6M

    // ---------------------------------------------------------------- immutables
    IERC20 public immutable token;
    IERC721 public immutable agentId;
    address public immutable ecosystemWallet;

    // ---------------------------------------------------------------- state
    bool public isOpen;
    uint256 public mintCount;

    /// @notice Wallet already claimed (one claim per wallet, ever).
    mapping(address => bool) public hasMinted;
    /// @notice 1-based claim index of a wallet (0 = not a minter).
    mapping(address => uint256) public mintIndexOf;
    /// @notice Agent ID tokenId already used (one claim per Agent ID, ever).
    mapping(uint256 => bool) public tokenIdUsed;

    uint256 public totalFunded;
    uint256 public totalSwept;

    // ---------------------------------------------------------------- errors/events
    error AlreadyOpen();
    error NotOpen();
    error NotAgentOwner();
    error TokenIdUsed();
    error AlreadyMinted();
    error SoldOut();
    error Underfunded(uint256 have, uint256 need);
    error ZeroAmount();
    error RenounceDisabled();

    event WindowOpened(uint256 balance, uint256 committed);
    event WindowClosed(uint256 mintCount);
    event GenesisMinted(
        address indexed minter, uint256 indexed mintIndex, uint256 indexed agentTokenId, uint256 amount
    );
    event BudgetFunded(address indexed from, uint256 amount, uint256 balance);
    event SurplusSwept(address indexed to, uint256 amount);

    constructor(address token_, address agentId_, address ecosystemWallet_, address owner_) Ownable(owner_) {
        require(token_ != address(0) && agentId_ != address(0) && ecosystemWallet_ != address(0), "zero addr");
        token = IERC20(token_);
        agentId = IERC721(agentId_);
        ecosystemWallet = ecosystemWallet_;
    }

    // ================================================================= funding / window (owner)
    /// @notice Pull `amount` TWAK from the caller (needs approval). Anyone may fund; the ecosystem wallet does.
    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        totalFunded += amount;
        emit BudgetFunded(msg.sender, amount, token.balanceOf(address(this)));
    }

    function open() external onlyOwner {
        if (isOpen) revert AlreadyOpen();
        if (mintCount >= MAX_MINTS) revert SoldOut();
        isOpen = true;
        uint256 need = committed();
        uint256 bal = token.balanceOf(address(this));
        if (bal < need) revert Underfunded(bal, need);
        emit WindowOpened(bal, need);
    }

    function close() external onlyOwner {
        if (!isOpen) revert NotOpen();
        isOpen = false;
        emit WindowClosed(mintCount);
    }

    /// @notice Send TWAK not needed for any remaining claim back to the ecosystem wallet. While open, only an
    /// overfund above the remaining claims; once closed, the whole balance.
    function sweepSurplus() external onlyOwner nonReentrant returns (uint256 amount) {
        amount = surplus();
        if (amount == 0) revert ZeroAmount();
        totalSwept += amount;
        token.safeTransfer(ecosystemWallet, amount);
        emit SurplusSwept(ecosystemWallet, amount);
    }

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ================================================================= claim
    /// @notice Free, gas-only claim. Caller must own Agent ID `agentTokenId`. Sends 20,000 TWAK in this tx.
    function mint(uint256 agentTokenId) external nonReentrant {
        _mint(agentTokenId);
    }

    /// @notice Convenience for the mainnet SPACE ID HandleRegistry (`0x60B9…022F`), where each address has
    /// at most one handle and `tokenId = uint256(keccak256(bytes(handle)))`. Resolves `handleOf(msg.sender)`
    /// and delegates to `_mint(tokenId)`, enforcing the same `ownerOf` and single-use `tokenIdUsed` checks.
    /// Reverts `NotAgentOwner` on registries without `handleOf` (e.g. testnet MockAgentIdNFT).
    function mintByHandle() external nonReentrant {
        string memory handle;
        try IAgentId(address(agentId)).handleOf(msg.sender) returns (string memory h) {
            handle = h;
        } catch {
            revert NotAgentOwner();
        }
        if (bytes(handle).length == 0) revert NotAgentOwner();
        _mint(uint256(keccak256(bytes(handle))));
    }

    function _mint(uint256 agentTokenId) internal {
        if (!isOpen) revert NotOpen();
        if (mintCount >= MAX_MINTS) revert SoldOut();
        if (hasMinted[msg.sender]) revert AlreadyMinted();
        if (tokenIdUsed[agentTokenId]) revert TokenIdUsed();
        if (_ownerOf(agentTokenId) != msg.sender) revert NotAgentOwner();

        uint256 idx = ++mintCount;
        tokenIdUsed[agentTokenId] = true;
        hasMinted[msg.sender] = true;
        mintIndexOf[msg.sender] = idx;
        if (idx == MAX_MINTS) {
            isOpen = false;
            emit WindowClosed(idx);
        }
        token.safeTransfer(msg.sender, BASE_TOKENS);
        emit GenesisMinted(msg.sender, idx, agentTokenId, BASE_TOKENS);
    }

    function _ownerOf(uint256 tokenId) internal view returns (address o) {
        try agentId.ownerOf(tokenId) returns (address a) {
            o = a;
        } catch {
            revert NotAgentOwner();
        }
    }

    // ================================================================= views
    /// @notice TWAK the contract may still owe: the remaining claims while open, nothing once closed.
    function committed() public view returns (uint256) {
        return isOpen ? (MAX_MINTS - mintCount) * BASE_TOKENS : 0;
    }

    function surplus() public view returns (uint256) {
        uint256 bal = token.balanceOf(address(this));
        uint256 need = committed();
        return bal > need ? bal - need : 0;
    }

    /// @notice Total TWAK handed out so far (mintCount * 20,000). Never exceeds BUDGET.
    function totalClaimed() external view returns (uint256) {
        return mintCount * BASE_TOKENS;
    }

    function remainingMints() external view returns (uint256) {
        return MAX_MINTS - mintCount;
    }
}
