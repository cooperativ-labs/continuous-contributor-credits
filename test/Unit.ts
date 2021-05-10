import { assert } from "chai";
// @ts-ignore
import {contract, artifacts} from "@typechain/truffle-v5/static"
import BN from "bn.js";
import {BackingTokenContract, BackingTokenInstance, C2Contract, C2Instance} from "../types/truffle-contracts";
import ContractInstance = Truffle.ContractInstance;
import {AddressType} from "typechain";


const C2: C2Contract = artifacts.require("C2");
const BAC: BackingTokenContract = artifacts.require("BackingToken");
const BAC21: BackingTokenContract = artifacts.require("BackingToken21");
const BAC15: BackingTokenContract = artifacts.require("BackingToken15");
const BAC6: BackingTokenContract = artifacts.require("BackingToken6");
const truffleAssert = require("truffle-assertions");
const agreementHash =
  "0x9e058097cb6c2dcbfa44b5d97f28bf729eed745cb6a061ceea7176cb14d77296";

const fail = () => {
  assert.isTrue(false);
};

const getBalance = async (instance: ContractInstance, addr: string) => {
  const bal = await instance.balanceOf.call(addr);
  return bal.toNumber();
};
const assertBalance = async (instance, addr, amount) => {
  const bal = await getBalance(instance, addr);
  assert.equal(bal, amount, `Balance is ${bal}, not ${amount}`);
};

const getAmountWithdrawn = async (instance, addr) => {
  const amountWithdrawn = await instance.amountWithdrawn.call(addr);
  return amountWithdrawn.toNumber();
};

function testBacDecimals(backingToken: BackingTokenContract, bacDec) {
  contract(`C2 backed by BAC${bacDec}`, async (acc: string[]) => {
    // define s few variables with let for ease of use (don't have to use `this` all the time)
    let c2: C2Instance, bac: BackingTokenInstance;
    let humanC2, humanBac;

    before(async () => {
      bac = await backingToken.new(acc[0]);
      const bacDecimals = await bac.decimals.call(this);
      assert.isTrue(bacDecimals.eq(new BN(bacDec)));

      // Give everyone a heaping supply of BAC
      await Promise.all(
        Array(10).fill(0).map((_,i) => bac.mint(1000000, { from: acc[i] }))
      );

      // This c2 isn't actually used except to get the number of decimals
    });

    beforeEach(async () => {
      // fresh c2 contract for every test
      c2 = await C2.new();
      c2.establish(bac.address, agreementHash);

      this.initBac = await Promise.all(
        Array(10).fill(0).map((_,i) => getBalance(bac, acc[i]))
      );
    });

    it("starts unestablished, which prevents issuance", async () => {
      const freshC2 = await C2.new();
      assert.isFalse(await freshC2.isEstablished.call(this));
      await truffleAssert.reverts(freshC2.issue(acc[1], 1));
    });

    it("can be established", async () => {
      const freshC2 = await C2.new();
      await freshC2.establish(bac.address, agreementHash);
      assert.isTrue(await freshC2.isEstablished.call(this));
      assert.equal(await freshC2.totalSupply.call(), 0);
      await assertBalance(bac, freshC2.address, 0);
    });

    it("cannot be established twice", async () => {
      truffleAssert.reverts(c2.establish(bac.address, agreementHash));
    });

    it("Can access version string", async () => {
      const version = await c2.version.call();
      assert.equal(version, "cc v0.2.0");
    });

    it("can retrieve backing token address", async () => {
      const address = await c2.backingToken.call();
      assert.equal(bac.address, address);
    });

    it("can retrieve agreement hash", async () => {
      const agreement = await c2.agreementHash.call();
      assert.equal(agreementHash, agreement);
    });

    it("can issue tokens", async () => {
      const c2ToIssue = 1;
      const tx = await c2.issue(acc[1], c2ToIssue);

      truffleAssert.eventEmitted(tx, "Issued", (ev) => {
        return ev.account === acc[1] && ev.c2Issued.toNumber() === c2ToIssue;
      });
      await assertBalance(c2, acc[1], c2ToIssue);
    });

    it("does not allow non-owners to issue tokens", async () => {
      const c2ToIssue = 1000;
      truffleAssert.reverts(c2.issue(acc[1], c2ToIssue, { from: acc[1] }));
    });

    it.skip("increases a counter of tokensIssued when issuing", async () => {
      const toIssue = new BN(1234);
      fail();
    });

    it.skip("decreases tokensIssued when burning", async () => {
      fail();
    });

    it.skip("does NOT decrease tokensIssued when cashing out", async () => {
      fail();
    });

    it("can burn up to all held tokens, but no more", async () => {
      const c2ToIssue = 100;
      const firstBurn = 20;
      const secondBurn = 80;
      assert.equal(firstBurn + secondBurn, c2ToIssue);
      const overdraftAmount = 10;

      await c2.issue(acc[1], c2ToIssue);

      const tx = await c2.burn(firstBurn, { from: acc[1] });
      truffleAssert.eventEmitted(tx, "Burned", (ev) => {
        return ev.account === acc[1] && ev.c2Burned.toNumber() === firstBurn;
      });

      const tx2 = await c2.burn(secondBurn, { from: acc[1] });
      truffleAssert.eventEmitted(tx2, "Burned", (ev) => {
        return ev.account === acc[1] && ev.c2Burned.toNumber() === secondBurn;
      });

      truffleAssert.reverts(c2.burn(overdraftAmount, { from: acc[1] }));
    });

    it("reduces totalSupply when burning", async () => {
      const toBurn = 5;
      await c2.issue(acc[1], toBurn);

      const totalSupplyBefore = (await this.c2.totalSupply.call()).toNumber();
      const tx = await this.c2.burn(toBurn, { from: acc[1] });

      const totalSupplyAfter = (await this.c2.totalSupply.call()).toNumber();

      assert.equal(totalSupplyAfter - totalSupplyBefore, toBurn * -1);
    });

    it.skip("does NOT reduce totalSupply when cashing out", async () => {
      assert.isTrue(false);
    });

    it.skip("cannot burn tokens that have already been cashed out (i.e. can only burn down to 100% cashed out)", async () => {
      assert.isTrue(false);
    });

    it("reports total BAC needed to be fully funded", async () => {
      const amountToIssue = 300000;

      // Once tokens are issued, should not considered funded
      await c2.issue(acc[1], amountToIssue);
      assert.isFalse(await c2.isFunded.call());

      const amountNeededToFund = (
        await c2.totalBackingNeededToFund.call()
      ).toNumber();
      const remainingToFund = (
        await c2.remainingBackingNeededToFund.call()
      ).toNumber();
      assert.equal(amountNeededToFund, remainingToFund);
      assert.isAbove(amountNeededToFund, 0);

      const firstFunding = Math.floor(amountNeededToFund / 10);
      await bac.approve(c2.address, firstFunding);
      await c2.fund(firstFunding);

      const amountNeededToFund2 = (
        await c2.totalBackingNeededToFund.call()
      ).toNumber();
      const remainingToFund2 = (
        await c2.remainingBackingNeededToFund.call()
      ).toNumber();
      assert.equal(amountNeededToFund, amountNeededToFund2);
      assert.equal(remainingToFund2, amountNeededToFund - firstFunding);
      assert.isFalse(await c2.isFunded.call());

      // Fund remaining
      await bac.approve(c2.address, remainingToFund2);
      await c2.fund(remainingToFund2);

      assert.isTrue(await c2.isFunded.call());
      const remainingToFund3 = (
        await c2.remainingBackingNeededToFund.call()
      ).toNumber();
      assert.equal(remainingToFund3, 0);
    });

    it.skip("refunds overfunding to owner", async () => {
      //issue
      //overund
      //check owner balance
      assert.isTrue(false);
    });

    it.skip("auto-locks when contract is fully funded", async () => {
      assert.isTrue(false);
    });

    it.skip("does not allow transferring of tokens", async () => {
      assert.isTrue(false);
    });

    it("fund updates totalAmountFunded", async () => {
      const amountToBeFunded = 250;
      const account = 1;
      const taf = await c2.totalAmountFunded.call();
      const bb = await c2.bacBalance.call();
      await bac.approve(c2.address, amountToBeFunded, {
        from: acc[account],
      });
      await c2.fund(amountToBeFunded, { from: acc[account] });
      const tafAfter = (await c2.totalAmountFunded.call()).toNumber();
      const bbAfter = (await c2.bacBalance.call()).toNumber();
      const bbAccountAfter = await getBalance(bac, acc[account]);

      assert.equal(taf + amountToBeFunded, tafAfter);
      assert.equal(bb + amountToBeFunded, bbAfter);
      assert.equal(this.initBac[account] - amountToBeFunded, bbAccountAfter);
    });

    it("allows users to withdraw funds, proportional to share of tokens held, up to the funded ratio", async () => {
      // TODO: Abstract this a bit
      await c2.issue(acc[1], 100, { from: acc[0] });
      await c2.issue(acc[2], 300, { from: acc[0] });

      // fund to 50%
      await bac.approve(c2.address, 200, { from: acc[0] });
      await c2.fund(200, { from: acc[0] });

      // Users withdraw tokens, should get 50% of their tokens worth of bac
      const tx1 = await c2.cashout({ from: acc[1] });
      truffleAssert.eventEmitted(tx1, "CashedOut", (ev) => {
        return ev.account == acc[1] && ev.bacReceived.toNumber() == 50;
      });
      assert.equal((await getBalance(bac, acc[1])) - this.initBac[1], 50);

      const tx2 = await c2.cashout({ from: acc[2] });
      truffleAssert.eventEmitted(tx2, "CashedOut", (ev) => {
        return ev.account == acc[2] && ev.bacReceived.toNumber() == 150;
      });
      assert.equal((await getBalance(bac, acc[2])) - this.initBac[2], 150);

      // amountWithdrawn is updated
      assert.equal(await getAmountWithdrawn(c2, acc[1]), 50);
      assert.equal(await getAmountWithdrawn(c2, acc[2]), 150);

      // but the actual c2 tokens themselves are not destroyed
      assert.equal(await getBalance(c2, acc[1]), 100);
      assert.equal(await getBalance(c2, acc[2]), 300);
    });
  });
}

describe("C2", () => {
  testBacDecimals(BAC, 18);
  testBacDecimals(BAC21, 21);
  testBacDecimals(BAC15, 15);
  testBacDecimals(BAC6, 6);
});
