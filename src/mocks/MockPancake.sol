// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// TEST ONLY: minimal PancakeSwap v2 clones (constant product, 0.25% fee).

contract MockWBNB is ERC20 {
    constructor() ERC20("Wrapped BNB", "WBNB") {}

    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) external {
        _burn(msg.sender, wad);
        (bool ok,) = msg.sender.call{value: wad}("");
        require(ok, "withdraw");
    }

    receive() external payable {
        deposit();
    }
}

contract MockPancakePair is ERC20 {
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public immutable factory;
    address public token0;
    address public token1;
    uint112 private reserve0;
    uint112 private reserve1;

    constructor() ERC20("Pancake LPs", "Cake-LP") {
        factory = msg.sender;
    }

    function initialize(address t0, address t1) external {
        require(msg.sender == factory, "factory");
        token0 = t0;
        token1 = t1;
    }

    function getReserves() public view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, 0);
    }

    /// @dev Uniswap v2 allows minting LP to address(0); OZ forbids it. The mock tracks "burned"
    /// LP (minted to address(0)) separately so the semantics match the real pair.
    uint256 public lpAtZero;

    function _mintLp(address to, uint256 v) internal {
        if (to == address(0)) {
            lpAtZero += v;
            _mint(address(0xdead), v);
        } else {
            _mint(to, v);
        }
    }

    function mint(address to) external returns (uint256 liquidity) {
        uint256 b0 = IERC20(token0).balanceOf(address(this));
        uint256 b1 = IERC20(token1).balanceOf(address(this));
        uint256 a0 = b0 - reserve0;
        uint256 a1 = b1 - reserve1;
        uint256 ts = totalSupply();
        if (ts == 0) {
            liquidity = Math.sqrt(a0 * a1) - MINIMUM_LIQUIDITY;
            _mintLp(address(0), MINIMUM_LIQUIDITY);
        } else {
            liquidity = Math.min(a0 * ts / reserve0, a1 * ts / reserve1);
        }
        require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_MINTED");
        _mintLp(to, liquidity);
        _sync(b0, b1);
    }

    function swap(uint256 out0, uint256 out1, address to, bytes calldata) external {
        require(out0 > 0 || out1 > 0, "out");
        if (out0 > 0) IERC20(token0).transfer(to, out0);
        if (out1 > 0) IERC20(token1).transfer(to, out1);
        uint256 b0 = IERC20(token0).balanceOf(address(this));
        uint256 b1 = IERC20(token1).balanceOf(address(this));
        uint256 in0 = b0 > reserve0 - out0 ? b0 - (reserve0 - out0) : 0;
        uint256 in1 = b1 > reserve1 - out1 ? b1 - (reserve1 - out1) : 0;
        require(in0 > 0 || in1 > 0, "in");
        uint256 adj0 = b0 * 10000 - in0 * 25;
        uint256 adj1 = b1 * 10000 - in1 * 25;
        require(adj0 * adj1 >= uint256(reserve0) * reserve1 * 1e8, "K");
        _sync(b0, b1);
    }

    function sync() external {
        _sync(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
    }

    function _sync(uint256 b0, uint256 b1) internal {
        reserve0 = uint112(b0);
        reserve1 = uint112(b1);
    }
}

contract MockPancakeFactory {
    mapping(address => mapping(address => address)) public getPair;

    function createPair(address a, address b) external returns (address pair) {
        require(getPair[a][b] == address(0), "exists");
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        MockPancakePair p = new MockPancakePair();
        p.initialize(t0, t1);
        pair = address(p);
        getPair[a][b] = pair;
        getPair[b][a] = pair;
    }
}

contract MockPancakeRouter {
    address public immutable factory;
    address public immutable WETH;

    constructor(address factory_, address weth_) {
        factory = factory_;
        WETH = weth_;
    }

    receive() external payable {
        require(msg.sender == WETH, "weth");
    }

    function getAmountOut(uint256 amountIn, uint256 rIn, uint256 rOut) public pure returns (uint256) {
        uint256 inFee = amountIn * 9975;
        return inFee * rOut / (rIn * 10000 + inFee);
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory a) {
        a = new uint256[](2);
        a[0] = amountIn;
        (uint256 rIn, uint256 rOut) = _reserves(path[0], path[1]);
        a[1] = getAmountOut(amountIn, rIn, rOut);
    }

    function _reserves(address tin, address tout) internal view returns (uint256 rIn, uint256 rOut) {
        MockPancakePair p = MockPancakePair(MockPancakeFactory(factory).getPair(tin, tout));
        (uint112 r0, uint112 r1,) = p.getReserves();
        (rIn, rOut) = tin == p.token0() ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    function _swap(address tin, address tout, address to) internal {
        MockPancakePair p = MockPancakePair(MockPancakeFactory(factory).getPair(tin, tout));
        (uint256 rIn, uint256 rOut) = _reserves(tin, tout);
        uint256 amountIn = IERC20(tin).balanceOf(address(p)) - rIn;
        uint256 out = getAmountOut(amountIn, rIn, rOut);
        (uint256 o0, uint256 o1) = tin == p.token0() ? (uint256(0), out) : (out, uint256(0));
        p.swap(o0, o1, to, "");
    }

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable {
        require(block.timestamp <= deadline, "EXPIRED");
        require(path[0] == WETH, "path");
        MockWBNB(payable(WETH)).deposit{value: msg.value}();
        address pair = MockPancakeFactory(factory).getPair(path[0], path[1]);
        IERC20(WETH).transfer(pair, msg.value);
        uint256 before = IERC20(path[1]).balanceOf(to);
        _swap(path[0], path[1], to);
        require(IERC20(path[1]).balanceOf(to) - before >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external {
        require(block.timestamp <= deadline, "EXPIRED");
        require(path[1] == WETH, "path");
        address pair = MockPancakeFactory(factory).getPair(path[0], path[1]);
        IERC20(path[0]).transferFrom(msg.sender, pair, amountIn);
        uint256 before = IERC20(WETH).balanceOf(address(this));
        _swap(path[0], path[1], address(this));
        uint256 out = IERC20(WETH).balanceOf(address(this)) - before;
        require(out >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        MockWBNB(payable(WETH)).withdraw(out);
        (bool ok,) = to.call{value: out}("");
        require(ok, "eth");
    }
}
