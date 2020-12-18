// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.8;

import 'openzeppelin-solidity/contracts/token/ERC20/ERC20.sol';

contract BackingToken is ERC20 {
    constructor(address account) ERC20("BackingToken", "BAC") public {
        _mint(account, 1000000000000000);
    }

    function mint(uint256 amount) public {
        _mint(_msgSender(), amount);
    }
}

contract BackingToken21 is ERC20 {
    constructor(address account) ERC20("BackingToken", "BAC21") public {
        _mint(account, 1000000000000000);
        _setupDecimals(21);
    }

    function mint(uint256 amount) public {
        _mint(_msgSender(), amount);
    }
}

contract BackingToken15 is ERC20 {
    constructor(address account) ERC20("BackingToken", "BAC15") public {
        _mint(account, 1000000000000000);
        _setupDecimals(15);
    }

    function mint(uint256 amount) public {
        _mint(_msgSender(), amount);
    }
}

contract BackingToken6 is ERC20 {
    constructor(address account) ERC20("BackingToken", "BAC6") public {
        _mint(account, 1000000000000000);
        _setupDecimals(6);
    }

    function mint(uint256 amount) public {
        _mint(_msgSender(), amount);
    }
}