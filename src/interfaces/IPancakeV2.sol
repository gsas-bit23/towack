// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// PancakeSwap v2 (BSC testnet):
//   Factory: 0x6725F303b657a9451d8BA641348b6761A6CC7a17
//   Router:  0xD99D1c33F9fC3444f8101754aBC46c52416550D1
//   WBNB:    0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd

interface IPancakeFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

interface IPancakePair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function totalSupply() external view returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
    function mint(address to) external returns (uint256 liquidity);
    function sync() external;
}

interface IPancakeRouter02 {
    function factory() external view returns (address);
    function WETH() external view returns (address);

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}

interface IWBNB {
    function deposit() external payable;
    function withdraw(uint256) external;
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}
