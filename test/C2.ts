import {
  BackingToken15Contract,
  BackingToken15Instance,
  BackingToken21Instance,
  BackingToken6Instance,
  BackingTokenContract,
  BackingTokenInstance,
  C2Contract,
  C2Instance,
} from "../types/truffle-contracts";
import { Burned, CashedOut, Issued } from "../types/truffle-contracts/C2";

const C2 = artifacts.require("C2");
const BAC = artifacts.require("BackingToken");
const BAC21 = artifacts.require("BackingToken21");
const BAC15 = artifacts.require("BackingToken15");
const BAC6 = artifacts.require("BackingToken6");

type AnyBac =
  | BackingTokenInstance
  | BackingToken21Instance
  | BackingToken15Instance
  | BackingToken6Instance;
type BacOrC2 = C2Instance | AnyBac;

const chai = require("chai");
const expect = chai.expect;
const truffleAssert = require("truffle-assertions");

const BN = require("bn.js");
const bnChai = require("bn-chai");
chai.use(bnChai(BN));

const agreementHash =
  "0x9e058097cb6c2dc3fa44b5d97f28bf729eed745cb6a061c3ea7176cb14d77296";

const getBalance = async (instance: BacOrC2, addr: string): Promise<BN> => {
  return await instance.balanceOf(addr);
};
const assertBalance = async (
  instance: BacOrC2,
  addr: string,
  amount: BN | number
): Promise<void> => {
  const bal = await getBalance(instance, addr);
  expect(bal).to.eq.BN(amount);
};

const getAmountWithdrawn = async (
  instance: C2Instance,
  addr: string
): Promise<BN> => {
  return await instance.amountWithdrawn(addr);
};

function testBacDecimals(backingToken: BackingTokenContract, bacDec: number) {
  contract(`C2 backed by BAC${bacDec}`, async (acc: string[]) => {
    // define s few variables with let for ease of use (don't have to use `this` all the time)
    let c2: C2Instance, bac: BackingTokenInstance;
    let initBac: BN[];
    let humanC2, humanBac;

    before(async () => {
      bac = await backingToken.deployed();
      const bacDecimals = await bac.decimals();
      expect(bacDecimals).eq.BN(bacDec);

      // Give everyone a heaping supply of BAC
      await Promise.all(
        Array(10)
          .fill(0)
          .map((_, i) => bac.mint(1000000, { from: acc[i] }))
      );

      // This c2 isn't actually used except to get the number of decimals
      c2 = await C2.deployed();
      const c2Decimals = await c2.decimals();
    });

    beforeEach(async () => {
      // fresh c2 contract for every test
      c2 = await C2.new();
      await c2.establish(bac.address, agreementHash);

      initBac = await Promise.all(
        Array(10)
          .fill(0)
          .map((_, i) => getBalance(bac, acc[i]))
      );
    });

    it("starts unestablished, which prevents issuance", async () => {
      const freshC2 = await C2.new();

      expect(await freshC2.isEstablished()).is.false;
      await truffleAssert.reverts(freshC2.issue(acc[1], 1));
    });

    it("can be established", async () => {
      const freshC2 = await C2.new();
      await freshC2.establish(bac.address, agreementHash);

      expect(await freshC2.isEstablished()).is.true;
      expect(await freshC2.totalSupply()).eq.BN(0);
      await assertBalance(bac, freshC2.address, 0);
    });

    it("cannot be established twice", async () => {
      truffleAssert.reverts(c2.establish(bac.address, agreementHash));
    });

    it("Can access version string", async () => {
      expect(await c2.version()).equals("cc v0.2.0");
    });

    it("can retrieve backing token address", async () => {
      const bacAddress = await c2.backingToken();
      expect(bacAddress).equals(bac.address);
    });

    it("can retrieve agreement hash", async () => {
      expect(await c2.agreementHash()).equals(agreementHash);
    });

    it("can issue tokens", async () => {
      const c2ToIssue = new BN(1);
      const tx = await c2.issue(acc[1], c2ToIssue);

      truffleAssert.eventEmitted(tx, "Issued", (ev: Issued["args"]) => {
        return ev.account === acc[1] && ev.c2Issued.eq(c2ToIssue);
      });
      await assertBalance(c2, acc[1], c2ToIssue);
    });

    it("does not allow non-owners to issue tokens", async () => {
      const c2ToIssue = 1000;
      truffleAssert.reverts(c2.issue(acc[1], c2ToIssue, { from: acc[1] }));
    });

    it.skip("increases a counter of tokensIssued when issuing", async () => {
      const toIssue = new BN(1234);
      expect.fail();
    });

    it.skip("decreases tokensIssued when burning", async () => {
      expect.fail();
    });

    it.skip("does NOT decrease tokensIssued when cashing out", async () => {
      expect.fail();
    });

    it("can burn up to all held tokens, but no more", async () => {
      const c2ToIssue = 100;
      const firstBurn = 20;
      const secondBurn = 80;
      expect(firstBurn + secondBurn).equals(c2ToIssue);
      const overdraftAmount = 10;

      await c2.issue(acc[1], c2ToIssue);

      const tx = await c2.burn(firstBurn, { from: acc[1] });
      truffleAssert.eventEmitted(tx, "Burned", (ev: Burned["args"]) => {
        return ev.account === acc[1] && ev.c2Burned.toNumber() === firstBurn;
      });

      const tx2 = await c2.burn(secondBurn, { from: acc[1] });
      truffleAssert.eventEmitted(tx2, "Burned", (ev: Burned["args"]) => {
        return ev.account === acc[1] && ev.c2Burned.toNumber() === secondBurn;
      });

      truffleAssert.reverts(c2.burn(overdraftAmount, { from: acc[1] }));
    });

    it("reduces totalSupply when burning", async () => {
      const toBurn = 5;
      await c2.issue(acc[1], toBurn);

      const totalSupplyBefore = await c2.totalSupply();
      await c2.burn(toBurn, { from: acc[1] });

      const totalSupplyAfter = await c2.totalSupply();

      expect(totalSupplyBefore.sub(totalSupplyAfter)).eq.BN(toBurn);
    });

    it.skip("does NOT reduce totalSupply when cashing out", async () => {
      expect.fail();
    });

    it.skip("cannot burn tokens that have already been cashed out (i.e. can only burn down to 100% cashed out)", async () => {
      expect.fail();
    });

    it("reports total BAC needed to be fully funded", async () => {
      const amountToIssue = 300000;

      // Once tokens are issued, should not considered funded
      await c2.issue(acc[1], amountToIssue);
      expect(await c2.isFunded()).is.false;

      const amountNeededToFund = await c2.totalBackingNeededToFund();
      const remainingToFund = await c2.remainingBackingNeededToFund();
      expect(amountNeededToFund).eq.BN(remainingToFund);
      expect(amountNeededToFund).gt.BN(0);

      const firstFunding = amountNeededToFund.div(new BN(10));
      await bac.approve(c2.address, firstFunding);
      await c2.fund(firstFunding);

      const amountNeededToFund2 = await c2.totalBackingNeededToFund();
      const remainingToFund2 = await c2.remainingBackingNeededToFund();
      expect(amountNeededToFund).eq.BN(amountNeededToFund2);
      expect(remainingToFund2).eq.BN(amountNeededToFund.sub(firstFunding));
      expect(await c2.isFunded()).is.false;

      // Fund remaining
      await bac.approve(c2.address, remainingToFund2);
      await c2.fund(remainingToFund2);

      expect(await c2.isFunded()).is.true;
      const remainingToFund3 = await c2.remainingBackingNeededToFund();
      expect(remainingToFund3).eq.BN(0);
    });

    it.skip("refunds overfunding to owner", async () => {
      //issue
      //overund
      //check owner balance
      expect.fail();
    });

    it.skip("auto-locks when contract is fully funded", async () => {
      expect.fail();
    });

    it.skip("does not allow transferring of tokens", async () => {
      expect.fail();
    });

    it("fund updates totalAmountFunded", async () => {
      const amountToBeFunded = new BN(250);
      const account = 1;
      const totalFunded = await c2.totalAmountFunded();
      const bacBal = await c2.bacBalance();
      await bac.approve(c2.address, amountToBeFunded, {
        from: acc[account],
      });
      await c2.fund(amountToBeFunded, { from: acc[account] });
      const totalFundedAfter = await c2.totalAmountFunded();
      const bacBalAfter = await c2.bacBalance();
      const bacBalAccountAfter = await getBalance(bac, acc[account]);

      expect(totalFunded.add(amountToBeFunded)).eq.BN(totalFundedAfter);
      expect(bacBal.add(amountToBeFunded)).eq.BN(bacBalAfter);
      expect(initBac[account].sub(amountToBeFunded)).eq.BN(
        bacBalAccountAfter
      );
    });

    it("allows users to withdraw funds, proportional to share of tokens held, up to the funded ratio", async () => {
      // TODO: Abstract this a bit
      await c2.issue(acc[1], 100);
      await c2.issue(acc[2], 300);

      // fund to 50%
      await bac.approve(c2.address, 200, { from: acc[0] });
      await c2.fund(200, { from: acc[0] });

      // Users withdraw tokens, should get 50% of their tokens worth of bac
      const tx1 = await c2.cashout({ from: acc[1] });
      truffleAssert.eventEmitted(tx1, "CashedOut", (ev: CashedOut["args"]) => {
        return ev.account == acc[1] && ev.bacReceived.eq(new BN(50));
      });
      const acc1Delta = (await getBalance(bac, acc[1])).sub(initBac[1]);
      expect(acc1Delta).eq.BN(50);

      const tx2 = await c2.cashout({ from: acc[2] });
      truffleAssert.eventEmitted(tx2, "CashedOut", (ev: CashedOut["args"]) => {
        return ev.account == acc[2] && ev.bacReceived.toNumber() == 150;
      });
      const acc2Delta = (await getBalance(bac, acc[2])).sub(initBac[2]);
      expect(acc2Delta).eq.BN(150);

      // amountWithdrawn is updated
      expect(await getAmountWithdrawn(c2, acc[1])).eq.BN(50);
      expect(await getAmountWithdrawn(c2, acc[2])).eq.BN(150);

      // but the actual c2 tokens themselves are not destroyed
      expect(await getBalance(c2, acc[1])).eq.BN(100);
      expect(await getBalance(c2, acc[2])).eq.BN(300);
    });
  });
}

describe("C2", () => {
  testBacDecimals(BAC, 18);
  // testBacDecimals(BAC21, 21);
  // testBacDecimals(BAC15, 15);
  // testBacDecimals(BAC6, 6);
});
