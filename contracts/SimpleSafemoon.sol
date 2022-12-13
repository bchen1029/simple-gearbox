// SPDX-License-Identifier: Unlicensed

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interface/IUniswapV2Factory.sol";
import "./interface/IUniswapV2Pair.sol";
import "./interface/IUniswapV2Router01.sol";
import "./interface/IUniswapV2Router02.sol";

/// @title A ERC20 token taking fee while transfer and swap, distributes fee to every single share holder
/// @notice This is a experimental contract, do not use on production
/// @dev reference: safemoon
contract SimpleSafeMoon is ERC20, Ownable, ReentrancyGuard {
    using SafeMath for uint256;

    uint256 private constant MAX = 2**256 - 1;
    /// @dev Actual token's total supply
    uint256 private _tTotal = 10000000 * 10**18;
    /// @dev Total share of token
    uint256 private _rTotal = (MAX - (MAX % _tTotal)); // 扣掉餘數，才可以得到確切的股數，每一股對應到固定數量的 token
    
    uint256 private _stakeTotalShare;
    uint256 private _stakeTotalReward;

    IUniswapV2Router02 public uniswapV2Router;
    address public uniswapV2Pair;
    
    /// @dev Every single account's token share
    mapping (address => uint256) private _rOwned;
    mapping (address => uint256) private _accountStakeReward;
    mapping (address => StakeInfo) private _accountStakeInfos;

    mapping (address => bool) private _isExcludedFromFee;

    struct StakeInfo { 
        uint256 endAt;
        uint256 amount;
        uint256 share;
    }

    constructor() ERC20("SimpleSafeMoon", "SSM") payable {
        _rOwned[_msgSender()] = _rTotal;

        uniswapV2Router = IUniswapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);

        // Create a uniswap pair for this new token
        uniswapV2Pair = IUniswapV2Factory(uniswapV2Router.factory())
            .createPair(address(this), uniswapV2Router.WETH());

        _isExcludedFromFee[address(this)] = true;
        _isExcludedFromFee[owner()] = true;
    }

    function claimReward() external {
        StakeInfo memory stakeInfo = _accountStakeInfos[msg.sender];
        require(stakeInfo.amount > 0, "You are not stake any token");
        require(stakeInfo.endAt > 0, "Illegal staking end time");
        require(block.timestamp > stakeInfo.endAt , "Too early to claim reward");

        uint256 shareRatio = stakeInfo.share.mul(10**6).div(_stakeTotalShare);
        uint256 stakeReward = _stakeTotalReward.mul(shareRatio).div(10**6);
        _accountStakeReward[msg.sender] = _accountStakeReward[msg.sender].add(stakeReward);
        _stakeTotalShare = _stakeTotalShare.sub(stakeInfo.share);
        _stakeTotalReward = _stakeTotalReward.sub(stakeReward);

        delete _accountStakeInfos[msg.sender]; // reset stakeInfo
    }

    function stakeToken(uint256 stakeAmount, uint256 period) external {
        require(stakeAmount >0, "Illegal stake amount");
        require(period == 14 || period == 30, "stake period not supported");

        uint256 availableBalance = balanceOf(msg.sender).sub(_accountStakeReward[msg.sender]);
        require(availableBalance >= stakeAmount, "Insufficient balance to stake");

        uint256 multiplier = period == 30 ? 7 : 3;
        uint256 stakeTokenShare = stakeAmount.mul(multiplier);
        
        // update state variables
        _stakeTotalShare = _stakeTotalShare.add(stakeTokenShare);
        
        _accountStakeInfos[msg.sender].endAt = block.timestamp + (period * 24 * 60 * 60);
        _accountStakeInfos[msg.sender].amount = stakeAmount;
        _accountStakeInfos[msg.sender].share = stakeTokenShare;
    }

    function getFreeToken(uint256 amount) external {
        _transfer(owner(), msg.sender, amount);
    }

    function accountStakeInfos(address account) public view returns (StakeInfo memory) {
        return _accountStakeInfos[account];
    }

    function accountStakeReward(address account) public view returns (uint256) {
        return _accountStakeReward[account];
    }

    function stakeTotalShare() public view returns(uint256) {
        return _stakeTotalShare;
    }

    function stakeTotalReward() public view returns(uint256) {
        return _stakeTotalReward;
    }

    function balanceOf(address account) public view override returns (uint256) {
        uint256 currentRate =  _getRate();
        uint256 balance = _rOwned[account].div(currentRate);
        uint256 stakeReward = _accountStakeReward[account];
        
        return balance.add(stakeReward);
    }

    function totalSupply() public view override returns (uint256) {
        return _tTotal;
    }

    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance to transfer");
        require(balanceOf(msg.sender).sub(_accountStakeInfos[msg.sender].amount) >= amount, "Staked token cannot be transfer");
        
        uint256 currentRate =  _getRate();
        uint256 rAmount = amount.mul(currentRate);

        uint256 tFee;
        uint256 rFee;
        uint256 stakeFee;
        uint256 rStakeFee;
        uint256 liquidityFee;
        uint256 rliquidityFee;

        if (!_isExcludedFromFee[from]) {
            tFee = amount.mul(5).div(100);
            rFee = tFee.mul(currentRate);
            stakeFee = amount.mul(5).div(100);
            rStakeFee = stakeFee.mul(currentRate);
            _stakeTotalReward = _stakeTotalReward.add(stakeFee);
        }

        if (to == uniswapV2Pair) { // 把 token 轉到流動池，代表在 uniswap 上，賣出該 token 
            liquidityFee = amount.mul(5).div(100); // 5% fee for adding liquidity to uniswap pair
            rliquidityFee = liquidityFee.mul(currentRate);
        }

        uint256 rTransferAmount = rAmount.sub(rFee).sub(rStakeFee);

        _rOwned[from] = _rOwned[from].sub(rAmount);
        _rOwned[to] = _rOwned[to].add(rTransferAmount);

        _rTotal = _rTotal.sub(rFee); // only rFee increase balance of all accounts
        emit Transfer(from, to, amount);
    }

    /// @notice A exchage rate that could convert the token share to real token amount
    /// @dev When _rTotal decreased, every this exchage rate decreased. Therefore, all account's balance increased.
    /// @return uint256 exchange rate
    function _getRate() private view returns(uint256) {
        return _rTotal.div(_tTotal);
    }

    function addLiquidityToUniswapV2Pair(uint256 tokenAmount) internal {
        _approve(owner(), address(uniswapV2Router), tokenAmount);
        uniswapV2Router.addLiquidityETH{value: address(this).balance}(
            address(this),
            tokenAmount,
            0, // slippage is unavoidable
            0, // slippage is unavoidable
            owner(),
            block.timestamp
        );
    }

}