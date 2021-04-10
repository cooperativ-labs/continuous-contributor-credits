// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.8;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/access/Ownable.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract C2 is ERC20, Ownable {
    string public constant version = "cc v0.2.0";

    ERC20 public backingToken;
    using SafeMath for uint256;

    bool public isEstablished = false;
    modifier isLive() {
        require(
            isEstablished == true,
            "token must be established before use"
        );
        _;
    }
    modifier isNotLive() {
        require(isEstablished == false, "token is already established");
        _;
    }

    bytes32 public agreementHash;

    constructor() public ERC20("ContributorCredits", "C^2") {
    }

    function establish(ERC20 backingTokenAddress, bytes32 agreement)
        public
        onlyOwner
        isNotLive
    {
        agreementHash = agreement;
        backingToken = backingTokenAddress;
        isEstablished = true;
    }

    event Issued(
        address indexed account,
        uint256 c2Issued,
        uint256 backingAmount
    );

    function issue(address account, uint256 amount) public onlyOwner isLive {
        // TODO: Don't allow issue when fully funded
        // TODO: Don't allow when locked
        uint256 backingNeeded = backingNeededFor(amount);
        _mint(account, amount);
        backingToken.transferFrom(_msgSender(), address(this), backingNeeded);
        emit Issued(account, amount, backingNeeded);
    }

    // TODO: Lock function
    // Automatically lock when fully funded

    event Burned(
        address indexed account,
        uint256 c2Burned,
        uint256 backingReturned
    );

    function burn(uint256 amount) public isLive {
        // TODO: Only allow burning down to amount withdrawn
        // Think about this more, logic may be complicated
        // What happens to funding ratio
        uint256 associatedBacking = backingNeededFor(amount);
        _burn(_msgSender(), amount);
        backingToken.transfer(this.owner(), associatedBacking);
        emit Burned(_msgSender(), amount, associatedBacking);
    }

    event CashedOut(
        address indexed account,
        uint256 c2Exchanged,
        uint256 backingReceived
    );

    function cashout(uint256 amount) public isLive {
        // TODO: always all available funds withdraw
        // TODO: update memory values, don't actually delete tokens
        // TODO: make sure that only withdraw upto amount available, don't allow if amountAvailable is < amountWithdrawn
        uint256 associatedBacking = backingNeededFor(amount);
        _burn(_msgSender(), amount);
        backingToken.transfer(_msgSender(), associatedBacking);
        emit CashedOut(_msgSender(), amount, associatedBacking);
    }

    function bacBalance() public view returns (uint256) {
        return backingToken.balanceOf(address(this));
    }

    function backingNeededFor(uint256 amountC2) public view returns (uint256) {
        if (bacBalance() == 0 || totalSupply() == 0) {
            return 0;
        }

        // The -1 +1 is to get the ceiling division, rather than the floor so that you always err on the side of having more backing
        return amountC2.mul(bacBalance()).sub(1).div(totalSupply()).add(1);
    }

    function totalBackingNeededToFund() public view returns (uint256) {
        if (totalSupply() == 0) {
            return 0;
        }
        
        // decimals normalization
        if (decimals() > backingToken.decimals()) {
            // ceiling division
            return (totalSupply().sub(1)).div(uint256(10) ** (decimals() - backingToken.decimals())).add(1);
        } else {
            return totalSupply().mul(uint256(10) ** (backingToken.decimals() - decimals()));
        }
    }

    function isFunded() public view returns (bool) {
        return bacBalance() >= totalBackingNeededToFund();
    }

    // TODO: fund function
    // TODO: fund function checks for extra funds (OPTIONAL)

}
