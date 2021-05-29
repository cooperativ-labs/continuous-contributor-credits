import {
  BackingToken21Contract,
  BackingToken6Contract,
  BackingTokenContract,
  BackingTokenInstance,
  C3Instance,
} from "../types/truffle-contracts";
import {
  AllEvents,
  Burned,
  CashedOut,
  Funded,
  Issued,
} from "../types/truffle-contracts/C3";

const C3 = artifacts.require("C3");
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
  contract(`C3 backed by BAC${bacDec}`, async (acc: string[]) => {
    // define s few variables with let for ease of use (don't have to use `this` all the time)
    let c3: C3Instance, bac: BackingTokenInstance;
    let initBac: BN[];

    // handy functions for working with human numbers
    const c3Decimals: BN = new BN(18);
    const humanC3 = (humanNumber: number): BN =>
      new BN(humanNumber).mul(new BN(10).pow(c3Decimals));
    const humanBac = (humanNumber: number): BN =>
      new BN(humanNumber).mul(new BN(10).pow(new BN(bacDec)));

    const issueToEveryone = async (amountC3: BN | number): Promise<void> => {
      // don't issue to owner
      await Promise.all(
        Array(9)
          .fill(0)
          .map(async (_, i) => await c3.issue(acc[i + 1], amountC3))
      );
    };

    const fundC3 = async (
      amountBac: BN | number,
      txDetails: Truffle.TransactionDetails = { from: acc[0] }
    ): Promise<Truffle.TransactionResponse<AllEvents>> => {
      await bac.approve(c3.address, amountBac, txDetails);
      return c3.fund(amountBac, txDetails);
    };

    const fundC3ToPercent = async (
      percentage: number,
      txDetails: Truffle.TransactionDetails = { from: acc[0] }
    ) => {
      expect(percentage).to.be.lessThanOrEqual(100);
      expect(percentage).to.be.greaterThanOrEqual(0);
      const amountToFund = (await c3.totalBackingNeededToFund())
        .mul(new BN(percentage))
        .div(new BN(100))
        .sub(await c3.totalAmountFunded());
      expect(amountToFund).to.be.gte.BN(0);

      return fundC3(amountToFund, txDetails);
    };

    before(async () => {
      bac = await backingToken.deployed();
      const bacDecimals = await bac.decimals();
      expect(bacDecimals).eq.BN(bacDec);

      c3 = await C3.deployed();
      expect(await c3.decimals()).eq.BN(c3Decimals);

      // Give everyone a heaping supply of BAC
      await Promise.all(
        Array(10)
          .fill(0)
          .map((_, i) => bac.mint(humanBac(1000000), { from: acc[i] }))
      );
    });

    beforeEach(async () => {
      // fresh c3 contract for every test
      c3 = await C3.new();
      await c3.establish(bac.address, agreementHash);

      initBac = await Promise.all(
        Array(10)
          .fill(0)
          .map((_, i) => bac.balanceOf(acc[i]))
      );
    });

    describe("interface", () => {
      it("Can access version string", async () => {
        expect(await c3.version()).equals("C3 v1.0.0");
      });

      it("can retrieve backing token address", async () => {
        const bacAddress = await c3.backingToken();
        expect(bacAddress).equals(bac.address);
      });

      it("can retrieve agreement hash", async () => {
        expect(await c3.agreementHash()).equals(agreementHash);
      });
    });

    describe("establish", () => {
      it("starts unestablished, which prevents issuance", async () => {
        const freshC3 = await C3.new();

        expect(await freshC3.isEstablished()).is.false;
        await truffleAssert.reverts(freshC3.issue(acc[1], 1));
      });

      it("can be established", async () => {
        const freshC3 = await C3.new();
        await freshC3.establish(bac.address, agreementHash);

        expect(await freshC3.isEstablished()).is.true;
        expect(await freshC3.totalSupply()).eq.BN(0);
        expect(await bac.balanceOf(freshC3.address)).eq.BN(0);
      });

      it("cannot be established twice", async () => {
        await truffleAssert.reverts(c3.establish(bac.address, agreementHash));
      });
    });

    describe("issue", () => {
      it("can issue tokens", async () => {
        const c3ToIssue = humanC3(1);
        const tx = await c3.issue(acc[1], c3ToIssue);

        truffleAssert.eventEmitted(tx, "Issued", (ev: Issued["args"]) => {
          return ev.account === acc[1] && ev.c3Issued.eq(c3ToIssue);
        });
        expect(await c3.balanceOf(acc[1])).eq.BN(c3ToIssue);
      });

      it("does not allow non-owners to issue tokens", async () => {
        const c3ToIssue = humanC3(1000);
        await truffleAssert.reverts(
          c3.issue(acc[1], c3ToIssue, { from: acc[1] })
        );
      });

      it("increases a counter of shares when issuing", async () => {
        const toIssue1 = humanC3(1234);
        const toIssue2 = humanC3(5678);
        await c3.issue(acc[1], toIssue1);
        await c3.issue(acc[2], toIssue2);

        expect(await c3.shares(acc[1])).eq.BN(toIssue1);
        expect(await c3.shares(acc[2])).eq.BN(toIssue2);

        await c3.issue(acc[1], toIssue2);

        expect(await c3.shares(acc[1])).eq.BN(toIssue1.add(toIssue2));
        expect(await c3.shares(acc[2])).eq.BN(toIssue2);
      });
    });

    describe("finalize", () => {
      it("owner can finalize", async () => {
        const tx = await c3.finalize({ from: acc[0] });
        truffleAssert.eventEmitted(tx, "SharesFinalized");
      });

      it("only owner can finalize", async () => {
        await truffleAssert.reverts(c3.finalize({ from: acc[1] }));
      });

      it("can't issue tokens after finalizing", async () => {
        await issueToEveryone(humanC3(100));
        await c3.finalize({ from: acc[0] });

        const c3ToIssue = humanC3(1);
        await truffleAssert.reverts(c3.issue(acc[1], c3ToIssue));
      });
    });

    describe("burn", () => {
      it("decreases shares when burning", async () => {
        const toIssue = humanC3(100);
        const toBurn = humanC3(10);
        await c3.issue(acc[1], toIssue);
        expect(await c3.shares(acc[1])).eq.BN(toIssue);

        await c3.burn(toBurn, { from: acc[1] });
        expect(await c3.shares(acc[1])).eq.BN(toIssue.sub(toBurn));
      });

      it("can burn up to all held tokens, but no more", async () => {
        const toIssue = humanC3(100);
        const firstBurn = humanC3(20);
        const secondBurn = humanC3(80);
        expect(firstBurn.add(secondBurn)).eq.BN(toIssue);
        const overdraftAmount = 1; //1 of the smallest decimal, not human

        await c3.issue(acc[1], toIssue);

        const tx = await c3.burn(firstBurn, { from: acc[1] });
        truffleAssert.eventEmitted(tx, "Burned", (ev: Burned["args"]) => {
          return ev.account === acc[1] && ev.c3Burned.eq(firstBurn);
        });

        const tx2 = await c3.burn(secondBurn, { from: acc[1] });
        truffleAssert.eventEmitted(tx2, "Burned", (ev: Burned["args"]) => {
          return ev.account === acc[1] && ev.c3Burned.eq(secondBurn);
        });

        await truffleAssert.reverts(c3.burn(overdraftAmount, { from: acc[1] }));
      });

      it("reduces totalSupply when burning", async () => {
        await issueToEveryone(humanC3(100));
        const toBurn = humanC3(5);

        const totalSupplyBefore = await c3.totalSupply();
        await c3.burn(toBurn, { from: acc[1] });

        const totalSupplyAfter = await c3.totalSupply();

        expect(totalSupplyBefore.sub(totalSupplyAfter)).eq.BN(toBurn);
      });
    });

    describe("cashout", () => {
      it("does NOT decrease shares when cashing out", async () => {
        const toIssue = humanC3(100);
        await c3.issue(acc[1], toIssue);
        expect(await c3.shares(acc[1])).eq.BN(toIssue);

        await c3.cashout({ from: acc[1] });
        expect(await c3.shares(acc[1])).eq.BN(toIssue);
      });

      it("does NOT reduce totalSupply when cashing out", async () => {
        await issueToEveryone(humanC3(100));

        const totalSupplyBefore = await c3.totalSupply();

        await fundC3(humanBac(20));
        await c3.cashout({ from: acc[1] });

        const totalSupplyAfter = await c3.totalSupply();

        expect(totalSupplyBefore).eq.BN(totalSupplyAfter);
      });

      it("cashout is idempotent", async () => {
        await issueToEveryone(humanC3(100));

        await fundC3(humanBac(20));
        await c3.cashout({ from: acc[1] });

        const totalSupplyAfter_1 = await c3.totalSupply();
        const amountC3_1 = await c3.balanceOf(acc[1]);
        const amountBac_1 = await bac.balanceOf(acc[1]);

        await c3.cashout({ from: acc[1] });
        const totalSupplyAfter_2 = await c3.totalSupply();
        const amountC3_2 = await c3.balanceOf(acc[1]);
        const amountBac_2 = await bac.balanceOf(acc[1]);

        expect(totalSupplyAfter_1).eq.BN(totalSupplyAfter_2);
        expect(amountC3_1).eq.BN(amountC3_2);
        expect(amountBac_1).eq.BN(amountBac_2);
        expect(amountC3_1).lt.BN(humanC3(100));
      });

      it("can be cashed out up to the proportion funded", async () => {
        await c3.issue(acc[1], humanC3(100));
        await c3.issue(acc[2], humanC3(300));

        // fund to 50%
        await fundC3(humanBac(200));

        // Users withdraw tokens, should get 50% of their tokens worth of bac
        const tx1 = await c3.cashout({ from: acc[1] });
        truffleAssert.eventEmitted(
          tx1,
          "CashedOut",
          (ev: CashedOut["args"]) => {
            return (
              ev.account == acc[1] &&
              ev.c3CashedOut.eq(humanC3(50)) &&
              ev.bacReceived.eq(humanBac(50))
            );
          }
        );
        const acc1Delta = (await bac.balanceOf(acc[1])).sub(initBac[1]);
        expect(acc1Delta).eq.BN(humanBac(50));

        const tx2 = await c3.cashout({ from: acc[2] });
        truffleAssert.eventEmitted(
          tx2,
          "CashedOut",
          (ev: CashedOut["args"]) => {
            return (
              ev.account == acc[2] &&
              ev.c3CashedOut.eq(humanC3(150)) &&
              ev.bacReceived.eq(humanBac(150))
            );
          }
        );
        const acc2Delta = (await bac.balanceOf(acc[2])).sub(initBac[2]);
        expect(acc2Delta).eq.BN(humanBac(150));

        // the c3 amount is updated
        expect(await c3.balanceOf(acc[1])).eq.BN(humanC3(50));
        expect(await c3.balanceOf(acc[2])).eq.BN(humanC3(150));
      });

      it("increases bacWithdrawn when cashing out", async () => {
        const toIssue = humanC3(100);
        await c3.issue(acc[1], toIssue);

        const toFund = humanBac(40);
        await fundC3(toFund);
        await c3.cashout({ from: acc[1] });
        expect((await bac.balanceOf(acc[1])).sub(initBac[1])).eq.BN(toFund);
        expect(await c3.bacWithdrawn(acc[1])).eq.BN(toFund);

        await fundC3(toFund);
        await c3.cashout({ from: acc[1] });
        expect((await bac.balanceOf(acc[1])).sub(initBac[1])).eq.BN(
          toFund.add(toFund)
        );
        expect(await c3.bacWithdrawn(acc[1])).eq.BN(toFund.add(toFund));
      });
    });

    describe("fund", () => {
      it("can be (partially) funded", async () => {
        const toIssue = humanC3(100);
        await c3.issue(acc[1], toIssue);
        const contractBacBal = await c3.bacBalance();

        const toFund = humanBac(20);
        const funder = acc[3];
        const funderInitBac = initBac[3];
        const tx = await fundC3(toFund, { from: funder });

        truffleAssert.eventEmitted(tx, "Funded", (ev: Funded["args"]) => {
          return ev.account === funder && ev.bacFunded.eq(toFund);
        });
        expect(await bac.balanceOf(funder)).eq.BN(funderInitBac.sub(toFund));
        const contractBacBalAfter = await c3.bacBalance();
        expect(contractBacBal.add(toFund)).eq.BN(contractBacBalAfter);

        expect(await c3.isFunded()).is.false;
        expect(await c3.remainingBackingNeededToFund()).eq.BN(humanBac(80));
      });

      it("fund updates totalAmountFunded", async () => {
        await c3.issue(acc[3], humanC3(1000));
        const toFund = humanBac(250);
        const funder = acc[1];
        const totalFunded = await c3.totalAmountFunded();

        await fundC3(toFund, { from: funder });
        const totalFundedAfter = await c3.totalAmountFunded();

        expect(totalFunded.add(toFund)).eq.BN(totalFundedAfter);

        await fundC3(toFund, { from: funder });
        const totalFundedAfterAnother = await c3.totalAmountFunded();

        expect(totalFundedAfter.add(toFund)).eq.BN(totalFundedAfterAnother);
      });

      it("reports total BAC needed to be fully funded", async () => {
        const toIssue = humanC3(3000);

        // Starts "funded", but once tokens are issued, should not considered funded
        expect(await c3.isFunded()).is.true;
        await c3.issue(acc[1], toIssue);
        expect(await c3.isFunded()).is.false;

        const amountNeededToFund = await c3.totalBackingNeededToFund();
        const remainingToFund = await c3.remainingBackingNeededToFund();
        expect(amountNeededToFund).eq.BN(remainingToFund);
        expect(amountNeededToFund).gt.BN(0);

        const firstFunding = amountNeededToFund.div(new BN(10));
        const txPartialFund1 = await fundC3(firstFunding);
        truffleAssert.eventNotEmitted(txPartialFund1, "CompletelyFunded");

        const amountNeededToFund2 = await c3.totalBackingNeededToFund();
        const remainingToFund2 = await c3.remainingBackingNeededToFund();
        expect(amountNeededToFund).eq.BN(amountNeededToFund2);
        expect(remainingToFund2).eq.BN(amountNeededToFund.sub(firstFunding));
        expect(await c3.isFunded()).is.false;

        // Fund remaining
        const tx = await fundC3(remainingToFund2);
        truffleAssert.eventEmitted(tx, "CompletelyFunded");

        expect(await c3.isFunded()).is.true;
        const remainingToFund3 = await c3.remainingBackingNeededToFund();
        expect(remainingToFund3).eq.BN(0);
      });

      it("uses 100 human Bac to fund 100 human C3", async () => {
        await c3.issue(acc[1], humanC3(100));
        const tx = await fundC3(humanBac(100));

        truffleAssert.eventEmitted(tx, "Funded", (ev: Funded["args"]) => {
          return ev.bacFunded.eq(humanBac(100));
        });
        truffleAssert.eventEmitted(tx, "CompletelyFunded");
        expect(await c3.isFunded()).is.true;
      });

      it("refunds overfunding to funder", async () => {
        await issueToEveryone(humanC3(100));
        const bacNeededToFund = await c3.remainingBackingNeededToFund();
        const bacToOverpay = humanBac(30);
        const tryToFund = bacNeededToFund.add(bacToOverpay);
        const funder = acc[1];
        const funderInitBac = initBac[1];

        expect(await bac.balanceOf(funder)).eq.BN(funderInitBac);
        const tx = await fundC3(tryToFund, { from: funder });

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
        await truffleAssert.reverts(fundC3(1));
        await truffleAssert.reverts(fundC3(humanBac(100)));
      });

      it("reverts if funded when already completely funded", async () => {
        await issueToEveryone(humanC3(100));
        const toFund = await c3.remainingBackingNeededToFund();
        await fundC3(toFund);

        await truffleAssert.reverts(fundC3(1));
        await truffleAssert.reverts(fundC3(humanBac(100)));
      });

      it("auto-finalizes when contract is fully funded", async () => {
        await issueToEveryone(humanC3(100));
        const toFund = await c3.remainingBackingNeededToFund();

        expect(await c3.sharesFinalized()).is.false;
        const tx = await fundC3(toFund);
        expect(await c3.sharesFinalized()).is.true;
        truffleAssert.eventEmitted(tx, "SharesFinalized");
      });
    });

    it.skip("what does it do if someone tries burning when they have stuff available to cashout (particuarly after the contract is already funded)?", async () => {
      expect.fail();
    });

    describe("transfer", () => {
      it("can transfer all tokens to a fresh address", async () => {
        const toIssue = humanC3(100);
        await c3.issue(acc[1], toIssue);
        await c3.transfer(acc[2], toIssue, { from: acc[1] });

        expect(await c3.balanceOf(acc[1])).to.eq.BN(0);
        expect(await c3.balanceOf(acc[2])).to.eq.BN(toIssue);

        expect(await c3.shares(acc[1])).to.eq.BN(0);
        expect(await c3.shares(acc[2])).to.eq.BN(toIssue);
      });

      it("can transfer all tokens to an address that already has tokens", async () => {
        const toIssue1 = humanC3(100);
        await c3.issue(acc[1], toIssue1);
        const toIssue2 = humanC3(350);
        await c3.issue(acc[2], toIssue2);

        await c3.transfer(acc[2], toIssue1, { from: acc[1] });

        expect(await c3.balanceOf(acc[1])).to.eq.BN(0);
        expect(await c3.balanceOf(acc[2])).to.eq.BN(toIssue1.add(toIssue2));

        expect(await c3.shares(acc[1])).to.eq.BN(0);
        expect(await c3.shares(acc[2])).to.eq.BN(toIssue1.add(toIssue2));
      });

      it("can transfer all remaining tokens after a cashout has been performed", async () => {
        const toIssue1 = humanC3(100);
        await c3.issue(acc[1], toIssue1);
        const toIssue2 = humanC3(300);
        await c3.issue(acc[2], toIssue2);

        await fundC3ToPercent(50);
        await c3.cashout({ from: acc[1] });
        const newBal1 = await c3.balanceOf(acc[1]);
        expect(newBal1).to.eq.BN(toIssue1.div(new BN(2)));
        const bacWithdrawn = (await bac.balanceOf(acc[1])).sub(initBac[1]);
        expect(bacWithdrawn).to.eq.BN(await c3.bacWithdrawn(acc[1]));

        await c3.transfer(acc[2], newBal1, { from: acc[1] });

        expect(await c3.balanceOf(acc[1])).to.eq.BN(0);
        expect(await c3.balanceOf(acc[2])).to.eq.BN(toIssue2.add(newBal1));

        expect(await c3.shares(acc[1])).to.eq.BN(0);
        expect(await c3.shares(acc[2])).to.eq.BN(toIssue2.add(toIssue1));

        // BacWithdrawn transfers as well
        expect(await c3.bacWithdrawn(acc[1])).to.eq.BN(0);
        expect(await c3.bacWithdrawn(acc[2])).to.eq.BN(bacWithdrawn);
      });

      it("can use a helper function transferAll, to automatically transfer all tokens to another address", async () => {
        const toIssue = humanC3(100);
        await c3.issue(acc[3], toIssue);

        await c3.transferAll(acc[4], { from: acc[3] });
        expect(await c3.balanceOf(acc[3])).to.eq.BN(0);
        expect(await c3.balanceOf(acc[4])).to.eq.BN(toIssue);
      });

      it("reverts if trying to transfer not all the coins", async () => {
        await c3.issue(acc[1], humanC3(100));
        await truffleAssert.reverts(
          c3.transfer(acc[2], humanC3(50), { from: acc[1] })
        );
      });
    });
  });
}

describe("C3", async () => {
  await testBacDecimals(BAC, 18);
});
