import {
  BackingToken21Contract,
  BackingToken6Contract,
  BackingTokenContract,
  BackingTokenInstance,
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

type AnyBac =
  | BackingTokenContract
  | BackingToken21Contract
  | BackingToken6Contract;

const chai = require("chai");
const expect = chai.expect;
const truffleAssert = require("truffle-assertions");

const BN = require("bn.js");
const bnChai = require("bn-chai");
chai.use(bnChai(BN));

const agreementHash =
  "0x9e058097cb6c2dc3fa44b5d97f28bf729eed745cb6a061c3ea7176cb14d77296";

export async function testBacDecimals(backingToken: AnyBac, bacDec: number) {
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
      txDetails: Truffle.TransactionDetails = { from: acc[0] }
    ): Promise<Truffle.TransactionResponse<AllEvents>> => {
      await bac.approve(c2.address, amountBac, txDetails);
      return c2.fund(amountBac, txDetails);
    };

    const fundC2ToPercent = async (
      percentage: number,
      txDetails: Truffle.TransactionDetails = { from: acc[0] }
    ) => {
      expect(percentage).to.be.lessThanOrEqual(100);
      expect(percentage).to.be.greaterThanOrEqual(0);
      const amountToFund = (await c2.totalBackingNeededToFund())
        .mul(new BN(percentage))
        .div(new BN(100))
        .sub(await c2.totalAmountFunded());
      expect(amountToFund).to.be.gte.BN(0);

      return fundC2(amountToFund, txDetails);
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
          .map((_, i) => bac.balanceOf(acc[i]))
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
      expect(await bac.balanceOf(freshC2.address)).eq.BN(0);
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
      expect(await c2.balanceOf(acc[1])).eq.BN(c2ToIssue);
    });

    it("only SU can lock", async () => {
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

    it("increases a counter of shares when issuing", async () => {
      const toIssue1 = humanC2(1234);
      const toIssue2 = humanC2(5678);
      await c2.issue(acc[1], toIssue1);
      await c2.issue(acc[2], toIssue2);

      expect(await c2.shares(acc[1])).eq.BN(toIssue1);
      expect(await c2.shares(acc[2])).eq.BN(toIssue2);

      await c2.issue(acc[1], toIssue2);

      expect(await c2.shares(acc[1])).eq.BN(toIssue1.add(toIssue2));
      expect(await c2.shares(acc[2])).eq.BN(toIssue2);
    });

    it("decreases shares when burning", async () => {
      const toIssue = humanC2(100);
      const toBurn = humanC2(10);
      await c2.issue(acc[1], toIssue);
      expect(await c2.shares(acc[1])).eq.BN(toIssue);

      await c2.burn(toBurn, { from: acc[1] });
      expect(await c2.shares(acc[1])).eq.BN(toIssue.sub(toBurn));
    });

    it("does NOT decrease shares when cashing out", async () => {
      const toIssue = humanC2(100);
      await c2.issue(acc[1], toIssue);
      expect(await c2.shares(acc[1])).eq.BN(toIssue);

      await c2.cashout({ from: acc[1] });
      expect(await c2.shares(acc[1])).eq.BN(toIssue);
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

    it("does NOT reduce totalSupply when cashing out", async () => {
      await issueToEveryone(humanC2(100));

      const totalSupplyBefore = await c2.totalSupply();

      await fundC2(humanBac(20));
      await c2.cashout({ from: acc[1] });

      const totalSupplyAfter = await c2.totalSupply();

      expect(totalSupplyBefore).eq.BN(totalSupplyAfter);
    });

    it("cashout is idempotent", async () => {
      await issueToEveryone(humanC2(100));

      await fundC2(humanBac(20));
      await c2.cashout({ from: acc[1] });

      const totalSupplyAfter_1 = await c2.totalSupply();
      const amountC2_1 = await c2.balanceOf(acc[1]);
      const amountBac_1 = await bac.balanceOf(acc[1]);

      await c2.cashout({ from: acc[1] });
      const totalSupplyAfter_2 = await c2.totalSupply();
      const amountC2_2 = await c2.balanceOf(acc[1]);
      const amountBac_2 = await bac.balanceOf(acc[1]);

      expect(totalSupplyAfter_1).eq.BN(totalSupplyAfter_2);
      expect(amountC2_1).eq.BN(amountC2_2);
      expect(amountBac_1).eq.BN(amountBac_2);
      expect(amountC2_1).lt.BN(humanC2(100));
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

    it("can be cashed out up to the proportion funded", async () => {
      await c2.issue(acc[1], humanC2(100));
      await c2.issue(acc[2], humanC2(300));

      // fund to 50%
      await fundC2(humanBac(200));

      // Users withdraw tokens, should get 50% of their tokens worth of bac
      const tx1 = await c2.cashout({ from: acc[1] });
      truffleAssert.eventEmitted(tx1, "CashedOut", (ev: CashedOut["args"]) => {
        return (
          ev.account == acc[1] &&
          ev.c2CashedOut.eq(humanC2(50)) &&
          ev.bacReceived.eq(humanBac(50))
        );
      });
      const acc1Delta = (await bac.balanceOf(acc[1])).sub(initBac[1]);
      expect(acc1Delta).eq.BN(humanBac(50));

      const tx2 = await c2.cashout({ from: acc[2] });
      truffleAssert.eventEmitted(tx2, "CashedOut", (ev: CashedOut["args"]) => {
        return (
          ev.account == acc[2] &&
          ev.c2CashedOut.eq(humanC2(150)) &&
          ev.bacReceived.eq(humanBac(150))
        );
      });
      const acc2Delta = (await bac.balanceOf(acc[2])).sub(initBac[2]);
      expect(acc2Delta).eq.BN(humanBac(150));

      // the c2 amount is updated
      expect(await c2.balanceOf(acc[1])).eq.BN(humanC2(50));
      expect(await c2.balanceOf(acc[2])).eq.BN(humanC2(150));
    });

    it("increases bacWithdrawn when cashing out", async () => {
      const toIssue = humanC2(100);
      await c2.issue(acc[1], toIssue);

      const toFund = humanBac(40);
      await fundC2(toFund);
      await c2.cashout({ from: acc[1] });
      expect((await bac.balanceOf(acc[1])).sub(initBac[1])).eq.BN(toFund);
      expect(await c2.bacWithdrawn(acc[1])).eq.BN(toFund);

      await fundC2(toFund);
      await c2.cashout({ from: acc[1] });
      expect((await bac.balanceOf(acc[1])).sub(initBac[1])).eq.BN(
        toFund.add(toFund)
      );
      expect(await c2.bacWithdrawn(acc[1])).eq.BN(toFund.add(toFund));
    });

    describe("transfer", () => {
      it("can transfer all tokens to a fresh address", async () => {
        const toIssue = humanC2(100);
        await c2.issue(acc[1], toIssue);
        await c2.transfer(acc[2], toIssue, { from: acc[1] });

        expect(await c2.balanceOf(acc[1])).to.eq.BN(0);
        expect(await c2.balanceOf(acc[2])).to.eq.BN(toIssue);

        expect(await c2.shares(acc[1])).to.eq.BN(0);
        expect(await c2.shares(acc[2])).to.eq.BN(toIssue);
      });

      it("can transfer all tokens to an address that already has tokens", async () => {
        const toIssue1 = humanC2(100);
        await c2.issue(acc[1], toIssue1);
        const toIssue2 = humanC2(350);
        await c2.issue(acc[2], toIssue2);

        await c2.transfer(acc[2], toIssue1, { from: acc[1] });

        expect(await c2.balanceOf(acc[1])).to.eq.BN(0);
        expect(await c2.balanceOf(acc[2])).to.eq.BN(toIssue1.add(toIssue2));

        expect(await c2.shares(acc[1])).to.eq.BN(0);
        expect(await c2.shares(acc[2])).to.eq.BN(toIssue1.add(toIssue2));
      });

      it("can transfer all remaining tokens after a cashout has been performed", async () => {
        const toIssue1 = humanC2(100);
        await c2.issue(acc[1], toIssue1);
        const toIssue2 = humanC2(300);
        await c2.issue(acc[2], toIssue2);

        await fundC2ToPercent(50);
        await c2.cashout({ from: acc[1] });
        const newBal1 = await c2.balanceOf(acc[1]);
        expect(newBal1).to.eq.BN(toIssue1.div(new BN(2)));
        const bacWithdrawn = (await bac.balanceOf(acc[1])).sub(initBac[1]);
        expect(bacWithdrawn).to.eq.BN(await c2.bacWithdrawn(acc[1]));

        await c2.transfer(acc[2], newBal1, { from: acc[1] });

        expect(await c2.balanceOf(acc[1])).to.eq.BN(0);
        expect(await c2.balanceOf(acc[2])).to.eq.BN(toIssue2.add(newBal1));

        expect(await c2.shares(acc[1])).to.eq.BN(0);
        expect(await c2.shares(acc[2])).to.eq.BN(toIssue2.add(toIssue1));

        // BacWithdrawn transfers as well
        expect(await c2.bacWithdrawn(acc[1])).to.eq.BN(0);
        expect(await c2.bacWithdrawn(acc[2])).to.eq.BN(bacWithdrawn);
      });

      it("can use a helper function transferAll, to automatically transfer all tokens to another address", async () => {
        const toIssue = humanC2(100);
        await c2.issue(acc[3], toIssue);

        await c2.transferAll(acc[4], { from: acc[3] });
        expect(await c2.balanceOf(acc[3])).to.eq.BN(0);
        expect(await c2.balanceOf(acc[4])).to.eq.BN(toIssue);
      });

      it("reverts if trying to transfer not all the coins", async () => {
        await c2.issue(acc[1], humanC2(100));
        await truffleAssert.reverts(
          c2.transfer(acc[2], humanC2(50), { from: acc[1] })
        );
      });
    });
  });
}

describe("C2", async () => {
  await testBacDecimals(BAC, 18);
});
