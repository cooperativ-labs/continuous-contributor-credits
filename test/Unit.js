const C2 = artifacts.require("C2");
const BackingToken = artifacts.require("BackingToken");
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


contract("Unit Tests", async (acc) => {
  let c2, bac;
  before(async () => {
    bac = await BackingToken.deployed();
    // Give everyone a heaping supply of BAC
    await Promise.all(
      [...Array(10).keys()].map((i) => bac.mint(1000000, { from: acc[i] }))
    );
  });

  beforeEach(async () => {
    // fresh c2 contract for every test
    c2 = await C2.new();
    c2.establish(bac.address, agreementHash);

    this.initBac = await Promise.all(
      [...Array(10).keys()].map((i) => getBalance(bac, acc[i]))
    );
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
    await c2.issue(acc[1], 100, { from: acc[0] })
    await c2.issue(acc[2], 300, { from: acc[0] })
    
    // fund to 50%
    await bac.approve(c2.address, 200, { from: acc[0] })
    await c2.fund(200, { from: acc[0] })

    // Users withdraw tokens, should get 50% of their tokens worth of bac
    await c2.cashout({ from: acc[1]})
    assert.equal(await getBalance(bac, acc[1]) - this.initBac[1], 50)

    await c2.cashout({ from: acc[2]})
    assert.equal(await getBalance(bac, acc[2]) - this.initBac[2], 150)
    
    // amountWithdrawn is updated
    assert.equal(await getAmountWithdrawn(c2, acc[1]), 50)
    assert.equal(await getAmountWithdrawn(c2, acc[2]), 150)

    // but the actual c2 tokens themselves are not destroyed
    assert.equal(await getBalance(c2, acc[1]), 100)
    assert.equal(await getBalance(c2, acc[2]), 300)
  })
  
})
