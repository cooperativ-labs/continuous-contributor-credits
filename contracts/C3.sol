// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.8;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/access/Ownable.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract C3 is ERC20, Ownable {
    string public constant version = "C3 v1.0.0";

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

    mapping(address => uint256) public shares;
    mapping(address => uint256) public bacWithdrawn;

    constructor() public ERC20("Continuous Contributor Credits", "C3") {}

    bool public sharesFinalized = false;

    function establish(ERC20 backingTokenAddress, bytes32 agreement)
        public
        onlyOwner
        isNotLive
    {
        agreementHash = agreement;
        backingToken = backingTokenAddress;
        isEstablished = true;
    }

    event Issued(address indexed account, uint256 c3Issued);

    function issue(address account, uint256 amount) public onlyOwner isLive {
        require(
            sharesFinalized == false,
            "cannot issue more C3 after shares have been finalized"
        );
        _mint(account, amount);
        shares[account] = shares[account].add(amount);
        emit Issued(account, amount);
    }

    event SharesFinalized();

    function finalize() public onlyOwner {
        sharesFinalized = true;
        emit SharesFinalized();
    }

    function transfer(address recipient, uint256 amount)
        public
        override
        isLive
        returns (bool)
    {
        require(
            amount == this.balanceOf(_msgSender()),
            "Only transfers of all tokens are allowed"
        );

        shares[recipient] = shares[recipient].add(shares[_msgSender()]);
        shares[_msgSender()] = 0;

        bacWithdrawn[recipient] = bacWithdrawn[recipient].add(
            bacWithdrawn[_msgSender()]
        );
        bacWithdrawn[_msgSender()] = 0;

        _transfer(_msgSender(), recipient, amount);

        return true;
    }

    function transferAll(address recipient) public isLive returns (bool) {
        return transfer(recipient, this.balanceOf(_msgSender()));
    }

    event Burned(address indexed account, uint256 c3Burned);

    function burn(uint256 amount) public isLive {
        require(
            withdrawableBac(_msgSender()) == 0,
            "burns are not allowed when a cashout is possible"
        );
        uint256 associatedBacking = backingNeededFor(amount);
        _burn(_msgSender(), amount);
        shares[_msgSender()] = shares[_msgSender()].sub(amount);
        backingToken.transfer(this.owner(), associatedBacking);
        emit Burned(_msgSender(), amount);
    }

    event CashedOut(
        address indexed account,
        uint256 c3CashedOut,
        uint256 bacReceived
    );

    function withdrawableBac(address account) public view returns (uint256) {
        // proportion of funds earmarked for address is proportional to shares/totalSupply
        uint256 totalBacForAccount =
            totalAmountFunded.mul(shares[account]).div(totalSupply());
        return totalBacForAccount.sub(bacWithdrawn[account]);
    }

    function cashableC3(address account) public view returns (uint256) {
        // at 100% funded, all C3 can be withdrawn. At n% funded, n% of C3 can be withdrawn.
        // Proportion funded can be calculated (handling the decimal conversion using the totalAmountNeededToFund)
        // At some level C3 is purely aesthetic. BAC is distributed soley based on actual amount of money give to the
        // contract and proportion of share that each contributor has.
        uint256 fundedC3 =
            shares[account].mul(totalAmountFunded).div(
                totalBackingNeededToFund()
            );
        uint256 alreadyCashedC3 = shares[account].sub(this.balanceOf(account));
        return fundedC3.sub(alreadyCashedC3);
    }

    function cashout() public isLive {
        if (shares[_msgSender()] == 0 || totalAmountFunded == 0) {
            return;
        }

        uint256 bacToReceive = withdrawableBac(_msgSender());
        if (bacToReceive == 0) {
            return;
        }

        uint256 c3ToCashout = cashableC3(_msgSender());

        _transfer(_msgSender(), address(this), c3ToCashout);
        bacWithdrawn[_msgSender()] = bacWithdrawn[_msgSender()].add(
            bacToReceive
        );
        emit CashedOut(_msgSender(), c3ToCashout, bacToReceive);
        backingToken.transfer(_msgSender(), bacToReceive);
    }

    function bacBalance() public view returns (uint256) {
        return backingToken.balanceOf(address(this));
    }

    function backingNeededFor(uint256 amountC3) public view returns (uint256) {
        if (bacBalance() == 0 || totalSupply() == 0) {
            return 0;
        }

        // The -1 +1 is to get the ceiling division, rather than the floor so that you always err on the side of having more backing
        return amountC3.mul(bacBalance()).sub(1).div(totalSupply()).add(1);
    }

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
        require(
            isFunded() == false,
            "cannot fund a contract that is is already completely funded"
        );

        uint256 remainingNeeded = remainingBackingNeededToFund();
        if (remainingNeeded <= amount) {
            totalAmountFunded = totalAmountFunded.add(remainingNeeded);
            if (sharesFinalized == false) {
                sharesFinalized = true;
                emit SharesFinalized();
            }
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
