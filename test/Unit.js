const C2 = artifacts.require("C2");
const BackingToken = artifacts.require("BackingToken");
const { assert } = require("console");
const truffleAssert = require("truffle-assertions");
const agreementHash =
  "0x9e058097cb6c2dcbfa44b5d97f28bf729eed745cb6a061ceea7176cb14d77296";

const getBalance = async (instance, addr) => {
  const bal = await instance.balanceOf.call(addr);
  return bal.toNumber();
};

const getAmountWithdrawn = async (instance, addr) => {
  const amountWithdrawn = await instance.amountWithdrawn.call(addr);
  return amountWithdrawn.toNumber();
}

async function unitTestC3(itFun) {
  contract("Unit Tests", async (acc) => {
    before(async () => {
      this.c2 = await C2.deployed();
      this.bac = await BackingToken.deployed();
      await this.c2.establish(this.bac.address, agreementHash);
      await Promise.all(
        [...Array(10).keys()].map((i) => this.bac.mint(1000000, { from: acc[i] }))
      );
    });
  
    beforeEach(async () => {
      this.c2Bal = await Promise.all(
        [...Array(10).keys()].map((i) => getBalance(this.c2, acc[i]))
      );
  
      this.bacBal = await Promise.all(
        [...Array(10).keys()].map((i) => getBalance(this.bac, acc[i]))
      );
      
      this.amountWithdrawnBefore = await Promise.all(
        [...Array(10).keys()].map((i) => getAmountWithdrawn(this.c2, acc[i]))
      )
    });

    await itFun(this, acc)
  })
}

unitTestC3(async (that, acc) => {
  it("fund updates totalAmountFunded", async () => {
    const amountToBeFunded = 250;
    const account = 1;
    const taf = await that.c2.totalAmountFunded.call();
    const bb = await that.c2.bacBalance.call();
    await that.bac.approve(that.c2.address, amountToBeFunded, {
      from: acc[account],
    });
    await that.c2.fund(amountToBeFunded, { from: acc[account] });
    const tafAfter = (await that.c2.totalAmountFunded.call()).toNumber();
    const bbAfter = (await that.c2.bacBalance.call()).toNumber();
    const bbAccountAfter = await getBalance(that.bac, acc[account]);
  
    assert.equal(taf + amountToBeFunded, tafAfter);
    assert.equal(bb + amountToBeFunded, bbAfter);
    assert.equal(that.bacBal[account] - amountToBeFunded, bbAccountAfter);
  });
})

// unitTestC3(async (that, acc) => {
//   it("allows users to withdraw funds, proportional to share of tokens held, up to the funded ratio", async () => {
//     await that.c2.issue(acc[1], 100, { from: acc[0] })
//     await that.c2.issue(acc[2], 300, { from: acc[0] })
    
//     // fund to 50%
//     await that.bac.approve(that.c2.address, 200, { from: acc[0] })
//     await that.c2.fund(200, { from: acc[0] })

//     // Users withdraw tokens, should get 50% of their tokens worth of bac
//     await that.c2.cashout({ from: acc[1]})
//     assert.equal(await getBalance(that.bac, acc[1]) - that.bacBal[1], 50)

//     await that.c2.cashout({ from: acc[2]})
//     assert.equal(await getBalance(that.bac, acc[1]) - that.bacBal[1], 150)
//   })

//   it("updates amountWithdrawn for the user that withdrew", async () => {
//     assert.equal(await getAmountWithdrawn(that.c2, acc[1]), 50)
//     assert.equal(await getAmountWithdrawn(that.c2, acc[2]), 150)
//   })

//   it("does not destroy tokens when a user withdraws", async () => {
//     assert.equal(await getBalance(that.c2, acc[1]), 100)
//     assert.equal(await getBalance(that.c2, acc[2]), 300)
//   })
// })

// contract("Unit Tests", async (acc) => {
//   before(async () => {
//     this.c2 = await C2.deployed();
//     this.bac = await BackingToken.deployed();
//     await this.c2.establish(this.bac.address, agreementHash);
//     await Promise.all(
//       [...Array(10).keys()].map((i) => this.bac.mint(1000000, { from: acc[i] }))
//     );
//   });

//   beforeEach(async () => {
//     this.c2Bal = await Promise.all(
//       [...Array(10).keys()].map((i) => getBalance(this.c2, acc[i]))
//     );

//     this.bacBal = await Promise.all(
//       [...Array(10).keys()].map((i) => getBalance(this.bac, acc[i]))
//     );
    
//     this.amountWithdrawnBefore = await Promise.all(
//       [...Array(10).keys()].map((i) => getAmountWithdrawn(this.c2, acc[i]))
//     )
//   });

//   it("fund updates totalAmountFunded", async () => {
//     const amountToBeFunded = 250;
//     const account = 1;
//     const taf = await this.c2.totalAmountFunded.call();
//     const bb = await this.c2.bacBalance.call();
//     await this.bac.approve(this.c2.address, amountToBeFunded, {
//       from: acc[account],
//     });
//     await this.c2.fund(amountToBeFunded, { from: acc[account] });
//     const tafAfter = (await this.c2.totalAmountFunded.call()).toNumber();
//     const bbAfter = (await this.c2.bacBalance.call()).toNumber();
//     const bbAccountAfter = await getBalance(this.bac, acc[account]);

//     assert.equal(taf + amountToBeFunded, tafAfter);
//     assert.equal(bb + amountToBeFunded, bbAfter);
//     assert.equal(this.bacBal[account] - amountToBeFunded, bbAccountAfter);
//   });

//   it("updates amount Withdrawn when user withdraws their funds", async () => {
//     assert.isFalse(true)
//   })
// });
