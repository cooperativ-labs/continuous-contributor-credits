import { testBacDecimals } from "./C3";
const BAC21 = artifacts.require("BackingToken21");
const BAC6 = artifacts.require("BackingToken6");

describe("alternative BAC decimals", async () => {
  await testBacDecimals(BAC21, 21);
  await testBacDecimals(BAC6, 6);
});
