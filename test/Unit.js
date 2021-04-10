const C2 = artifacts.require("C2");
const BackingToken = artifacts.require("BackingToken");
const truffleAssert = require("truffle-assertions");
const agreementHash =
  "0x9e058097cb6c2dcbfa44b5d97f28bf729eed745cb6a061ceea7176cb14d77296";

const getBalance = async (instance, addr) => {
  const bal = await instance.balanceOf.call(addr);
  return bal.toNumber();
};

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
  });

  it("fund updates totalAmountFunded", async () => {
    const amountToBeFunded = 250;
    const account = 1;
    const taf = await this.c2.totalAmountFunded.call();
    const bb = await this.c2.bacBalance.call();
    await this.bac.approve(this.c2.address, amountToBeFunded, {
      from: acc[account],
    });
    await this.c2.fund(amountToBeFunded, { from: acc[account] });
    const tafAfter = (await this.c2.totalAmountFunded.call()).toNumber();
    const bbAfter = (await this.c2.bacBalance.call()).toNumber();
    const bbAccountAfter = await getBalance(this.bac, acc[account]);

    assert.equal(taf + amountToBeFunded, tafAfter);
    assert.equal(bb + amountToBeFunded, bbAfter);
    assert.equal(this.bacBal[account] - amountToBeFunded, bbAccountAfter);
  });
});
