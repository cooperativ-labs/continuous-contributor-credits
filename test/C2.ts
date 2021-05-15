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
import {
  AllEvents,
  Burned,
  CashedOut,
  Funded,
  Issued,
} from "../types/truffle-contracts/C2";

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

async function testBacDecimals(
  backingToken: BackingTokenContract,
  bacDec: number
) {
  contract(`C2 backed by BAC${bacDec}`, async (acc: string[]) => {
    // define s few variables with let for ease of use (don't have to use `this` all the time)
    let c2: C2Instance, bac: BackingTokenInstance;
    let initBac: BN[];

    // handy functions for working with human numbers
    const c2Decimals: BN = new BN(18);
    const humanC2 = (humanNumber: number): BN =>
      new BN(humanNumber).mul(new BN(10).pow(c2Decimals));
    const humanBac = (humanNumber: number): BN =>
      new BN(humanNumber).mul(new BN(10).pow(new BN(bacDec)));

    const issueToEveryone = async (amountC2: BN | number): Promise<void> => {
      // don't issue to owner
      await Promise.all(
        Array(9)
          .fill(0)
          .map(async (_, i) => await c2.issue(acc[i + 1], amountC2))
      );
    };

    const fundC2 = async (
      amountBac: BN | number,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>> => {
      if (txDetails !== undefined) {
        await bac.approve(c2.address, amountBac, txDetails);
        return c2.fund(amountBac, txDetails);
      } else {
        await bac.approve(c2.address, amountBac);
        return c2.fund(amountBac);
      }
    };

    before(async () => {
      bac = await backingToken.deployed();
      const bacDecimals = await bac.decimals();
      expect(bacDecimals).eq.BN(bacDec);

      c2 = await C2.deployed();
      expect(await c2.decimals()).eq.BN(c2Decimals);

      // Give everyone a heaping supply of BAC
      await Promise.all(
        Array(10)
          .fill(0)
          .map((_, i) => bac.mint(humanBac(1000000), { from: acc[i] }))
      );
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
      await truffleAssert.reverts(c2.establish(bac.address, agreementHash));
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
      const c2ToIssue = humanC2(1);
      const tx = await c2.issue(acc[1], c2ToIssue);

      truffleAssert.eventEmitted(tx, "Issued", (ev: Issued["args"]) => {
        return ev.account === acc[1] && ev.c2Issued.eq(c2ToIssue);
      });
      await assertBalance(c2, acc[1], c2ToIssue);
    });

    it("ownly SU can lock", async () => {
      await truffleAssert.reverts(c2.lock({ from: acc[1] }));
    });

    it("can't issue tokens after locking", async () => {
      const c2ToIssue = humanC2(1);

      await c2.lock({ from: acc[0] });
      await truffleAssert.reverts(c2.issue(acc[1], c2ToIssue));
    });

    it("does not allow non-owners to issue tokens", async () => {
      const c2ToIssue = humanC2(1000);
      await truffleAssert.reverts(
        c2.issue(acc[1], c2ToIssue, { from: acc[1] })
      );
    });

    it("increases a counter of issuedToAccount when issuing", async () => {
      const toIssue1 = humanC2(1234);
      const toIssue2 = humanC2(5678);
      await c2.issue(acc[1], toIssue1);
      await c2.issue(acc[2], toIssue2);

      expect(await c2.issuedToAddress(acc[1])).eq.BN(toIssue1);
      expect(await c2.issuedToAddress(acc[2])).eq.BN(toIssue2);

      await c2.issue(acc[1], toIssue2);

      expect(await c2.issuedToAddress(acc[1])).eq.BN(toIssue1.add(toIssue2));
      expect(await c2.issuedToAddress(acc[2])).eq.BN(toIssue2);
    });

    it("decreases issuedToAccount when burning", async () => {
      const toIssue = humanC2(100);
      const toBurn = humanC2(10);
      await c2.issue(acc[1], toIssue);
      expect(await c2.issuedToAddress(acc[1])).eq.BN(toIssue);

      await c2.burn(toBurn, { from: acc[1] });
      expect(await c2.issuedToAddress(acc[1])).eq.BN(toIssue.sub(toBurn));
    });

    it("does NOT decrease issuedToAccount when cashing out", async () => {
      const toIssue = humanC2(100);
      await c2.issue(acc[1], toIssue);
      expect(await c2.issuedToAddress(acc[1])).eq.BN(toIssue);

      await c2.cashout({ from: acc[1] });
      expect(await c2.issuedToAddress(acc[1])).eq.BN(toIssue);
    });

    it("can burn up to all held tokens, but no more", async () => {
      const toIssue = humanC2(100);
      const firstBurn = humanC2(20);
      const secondBurn = humanC2(80);
      expect(firstBurn.add(secondBurn)).eq.BN(toIssue);
      const overdraftAmount = 1; //1 of the smallest decimal, not human

      await c2.issue(acc[1], toIssue);

      const tx = await c2.burn(firstBurn, { from: acc[1] });
      truffleAssert.eventEmitted(tx, "Burned", (ev: Burned["args"]) => {
        return ev.account === acc[1] && ev.c2Burned.eq(firstBurn);
      });

      const tx2 = await c2.burn(secondBurn, { from: acc[1] });
      truffleAssert.eventEmitted(tx2, "Burned", (ev: Burned["args"]) => {
        return ev.account === acc[1] && ev.c2Burned.eq(secondBurn);
      });

      await truffleAssert.reverts(c2.burn(overdraftAmount, { from: acc[1] }));
    });

    it("reduces totalSupply when burning", async () => {
      await issueToEveryone(humanC2(100));
      const toBurn = humanC2(5);

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
      const toIssue = humanC2(3000);

      // Starts "funded", but once tokens are issued, should not considered funded
      expect(await c2.isFunded()).is.true;
      await c2.issue(acc[1], toIssue);
      expect(await c2.isFunded()).is.false;

      const amountNeededToFund = await c2.totalBackingNeededToFund();
      const remainingToFund = await c2.remainingBackingNeededToFund();
      expect(amountNeededToFund).eq.BN(remainingToFund);
      expect(amountNeededToFund).gt.BN(0);

      const firstFunding = amountNeededToFund.div(new BN(10));
      const txPartialFund1 = await fundC2(firstFunding);
      truffleAssert.eventNotEmitted(txPartialFund1, "CompletelyFunded");

      const amountNeededToFund2 = await c2.totalBackingNeededToFund();
      const remainingToFund2 = await c2.remainingBackingNeededToFund();
      expect(amountNeededToFund).eq.BN(amountNeededToFund2);
      expect(remainingToFund2).eq.BN(amountNeededToFund.sub(firstFunding));
      expect(await c2.isFunded()).is.false;

      // Fund remaining
      const tx = await fundC2(remainingToFund2);
      truffleAssert.eventEmitted(tx, "CompletelyFunded");

      expect(await c2.isFunded()).is.true;
      const remainingToFund3 = await c2.remainingBackingNeededToFund();
      expect(remainingToFund3).eq.BN(0);
    });

    it("can be (partially) funded", async () => {
      const toIssue = humanC2(100);
      await c2.issue(acc[1], toIssue);
      const contractBacBal = await c2.bacBalance();

      const toFund = humanBac(20);
      const funder = acc[3];
      const funderInitBac = initBac[3];
      const tx = await fundC2(toFund, { from: funder });

      truffleAssert.eventEmitted(tx, "Funded", (ev: Funded["args"]) => {
        return ev.account === funder && ev.bacFunded.eq(toFund);
      });
      expect(await bac.balanceOf(funder)).eq.BN(funderInitBac.sub(toFund));
      const contractBacBalAfter = await c2.bacBalance();
      expect(contractBacBal.add(toFund)).eq.BN(contractBacBalAfter);

      expect(await c2.isFunded()).is.false;
      expect(await c2.remainingBackingNeededToFund()).eq.BN(humanBac(80));
    });

    it("fund updates totalAmountFunded", async () => {
      await c2.issue(acc[3], humanC2(1000));
      const toFund = humanBac(250);
      const funder = acc[1];
      const totalFunded = await c2.totalAmountFunded();

      await fundC2(toFund, { from: funder });
      const totalFundedAfter = await c2.totalAmountFunded();

      expect(totalFunded.add(toFund)).eq.BN(totalFundedAfter);

      await fundC2(toFund, { from: funder });
      const totalFundedAfterAnother = await c2.totalAmountFunded();

      expect(totalFundedAfter.add(toFund)).eq.BN(totalFundedAfterAnother);
    });

    it("uses 100 human Bac to fund 100 human C2, regardless of decimals", async () => {
      await c2.issue(acc[1], humanC2(100));
      const tx = await fundC2(humanBac(100));

      truffleAssert.eventEmitted(tx, "Funded", (ev: Funded["args"]) => {
        return ev.bacFunded.eq(humanBac(100));
      });
      truffleAssert.eventEmitted(tx, "CompletelyFunded");
      expect(await c2.isFunded()).is.true;
    });

    it("refunds overfunding to funder", async () => {
      await issueToEveryone(humanC2(100));
      const bacNeededToFund = await c2.remainingBackingNeededToFund();
      const bacToOverpay = humanBac(30);
      const tryToFund = bacNeededToFund.add(bacToOverpay);
      const funder = acc[1];
      const funderInitBac = initBac[1];

      expect(await bac.balanceOf(funder)).eq.BN(funderInitBac);
      const tx = await fundC2(tryToFund, { from: funder });

      truffleAssert.eventEmitted(tx, "Funded", (ev: Funded["args"]) => {
        // Actual amount funded is only the amount needed not the amount
        return ev.account === funder && ev.bacFunded.eq(bacNeededToFund);
      });
      truffleAssert.eventEmitted(tx, "CompletelyFunded");

      expect(await bac.balanceOf(funder)).eq.BN(
        funderInitBac.sub(bacNeededToFund)
      );
    });

    it("reverts if trying to fund before any tokens have been issued", async () => {
      await truffleAssert.reverts(fundC2(1));
      await truffleAssert.reverts(fundC2(humanBac(100)));
    });

    it("reverts if funded when already completely funded", async () => {
      await issueToEveryone(humanC2(100));
      const toFund = await c2.remainingBackingNeededToFund();
      await fundC2(toFund);

      await truffleAssert.reverts(fundC2(1));
      await truffleAssert.reverts(fundC2(humanBac(100)));
    });

    it("auto-locks when contract is fully funded", async () => {
      await issueToEveryone(humanC2(100));
      const toFund = await c2.remainingBackingNeededToFund();

      expect(await c2.isLocked()).is.false;
      await fundC2(toFund);
      expect(await c2.isLocked()).is.true;
    });

    it.skip("what does it do if someone tries burning when they have stuff available to cashout (particuarly after the contract is already funded)?", async () => {
      expect.fail();
    });

    it.skip("does not allow transferring of tokens", async () => {
      expect.fail();
    });

    it.skip("allows users to withdraw funds, proportional to share of tokens held, up to the funded ratio", async () => {
      // TODO: Abstract this a bit
      await c2.issue(acc[1], 100);
      await c2.issue(acc[2], 300);

      // fund to 50%
      await fundC2(200);

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

describe("C2", async () => {
  await testBacDecimals(BAC, 18);
  await testBacDecimals(BAC21, 21);
  await testBacDecimals(BAC15, 15);
  await testBacDecimals(BAC6, 6);
});
