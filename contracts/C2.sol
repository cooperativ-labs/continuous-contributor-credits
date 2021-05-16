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
        require(isEstablished == true, "token must be established before use");
        _;
    }
    modifier isNotLive() {
        require(isEstablished == false, "token is already established");
        _;
    }

    bytes32 public agreementHash;

    uint256 public totalAmountFunded = 0;

    mapping(address => uint256) public issuedToAddress;

    constructor() public ERC20("ContributorCredits", "C^2") {}

    bool public isLocked = false;
    modifier isNotLocked() {
        require(isLocked == false, "token must not be locked to use");
        _;
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

    event Issued(address indexed account, uint256 c2Issued);

    function issue(address account, uint256 amount)
        public
        onlyOwner
        isLive
        isNotLocked
    {
        _mint(account, amount);
        issuedToAddress[account] = issuedToAddress[account].add(amount);
        emit Issued(account, amount);
    }

    function lock() public onlyOwner {
        isLocked = true;
    }

    event Burned(address indexed account, uint256 c2Burned);

    function burn(uint256 amount) public isLive {
        // TODO: Only allow burning down to amount withdrawn
        // Think about this more, logic may be complicated
        // What happens to funding ratio
        uint256 associatedBacking = backingNeededFor(amount);
        _burn(_msgSender(), amount);
        issuedToAddress[_msgSender()] = issuedToAddress[_msgSender()].sub(
            amount
        );
        backingToken.transfer(this.owner(), associatedBacking);
        emit Burned(_msgSender(), amount);
    }

    event CashedOut(
        address indexed account,
        uint256 c2CashedOut,
        uint256 bacReceived
    );

    function cashout() public isLive {
        if (issuedToAddress[_msgSender()] == 0 || totalAmountFunded == 0) {
            return;
        }
        // at 100% funded, all C2 can be withdrawn. At n% funded, n% of C2 can be withdrawn.
        // Proportion funded can be calculated (handling the decimal conversion using the totalAmountNeededToFund)
        uint256 cashableC2 =
            issuedToAddress[_msgSender()].mul(totalAmountFunded).div(
                totalBackingNeededToFund()
            );
        uint256 alreadyCashedC2 =
            issuedToAddress[_msgSender()].sub(this.balanceOf(_msgSender()));
        uint256 c2ToCashOut = cashableC2.sub(alreadyCashedC2);

        if (c2ToCashOut == 0) {
            return;
        }

        // proportion of funds earmarked for address is proportional to issuedToAddress/totalSupply
        uint256 totalBacForAccount =
            totalAmountFunded.mul(issuedToAddress[_msgSender()]).div(
                totalSupply()
            );
        // of this, the part that is still eligible for withdrawal is proportional to the proportion of cashableC2 eligible for withdrawal
        uint256 bacToReceive =
            totalBacForAccount.mul(c2ToCashOut).div(cashableC2);

        _transfer(_msgSender(), address(this), c2ToCashOut);
        emit CashedOut(_msgSender(), c2ToCashOut, bacToReceive);
        backingToken.transfer(_msgSender(), bacToReceive);
    }

    function bac_2_c2(uint256 amount) public view returns (uint256) {
        if (decimals() > backingToken.decimals()) {
            return
                amount.mul(uint256(10)**(decimals() - backingToken.decimals()));
        } else {
            return
                amount.div(uint256(10)**(backingToken.decimals() - decimals()));
        }
    }

    function c2_2_bac(uint256 amount) public view returns (uint256) {
        if (decimals() > backingToken.decimals()) {
            return
                amount.div(uint256(10)**(decimals() - backingToken.decimals()));
        } else {
            return
                amount.div(uint256(10)**(backingToken.decimals() - decimals()));
        }
    }

    // TODO: Transfer function that handles withdrawn amount

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

    //    function totalAmountPaidTo(address c2Holder) public view returns (uint256) {
    //        if (balanceOf(c2Holder) == 0) {
    //            return 0;
    //        }
    //        // tokens owned * proportion funded
    //        // proportion funded = totalAmountFunded / totalBackingNeededToFund
    //    }

    function totalBackingNeededToFund() public view returns (uint256) {
        if (totalSupply() == 0) {
            return 0;
        }

        // decimals normalization
        if (decimals() > backingToken.decimals()) {
            // ceiling division
            return
                (totalSupply().sub(1))
                    .div(uint256(10)**(decimals() - backingToken.decimals()))
                    .add(1);
        } else {
            return
                totalSupply().mul(
                    uint256(10)**(backingToken.decimals() - decimals())
                );
        }
    }

    function remainingBackingNeededToFund() public view returns (uint256) {
        return totalBackingNeededToFund().sub(totalAmountFunded);
    }

    function isFunded() public view returns (bool) {
        return totalAmountFunded >= totalBackingNeededToFund();
    }

    event Funded(address indexed account, uint256 bacFunded);
    event CompletelyFunded();

    function fund(uint256 amount) public isLive {
        // TODO: fund function checks for extra funds (OPTIONAL)
        require(
            isFunded() == false,
            "cannot fund a contract that is is already funded"
        );

        uint256 remainingNeeded = remainingBackingNeededToFund();
        if (remainingNeeded <= amount) {
            totalAmountFunded = totalAmountFunded.add(remainingNeeded);
            isLocked = true;
            emit Funded(_msgSender(), remainingNeeded);
            emit CompletelyFunded();
            backingToken.transferFrom(
                _msgSender(),
                address(this),
                remainingNeeded
            );
        } else {
            totalAmountFunded = totalAmountFunded.add(amount);
            emit Funded(_msgSender(), amount);
            backingToken.transferFrom(_msgSender(), address(this), amount);
        }
    }
}

