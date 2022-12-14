import { expect } from "chai";
import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { SimpleSafeMoon } from "../typechain-types/contracts/SimpleSafemoon.sol/index";

async function deploySimpleSafeMoon() {
  const SimpleSafeMoon = await ethers.getContractFactory("SimpleSafeMoon");
  const simpleSafeMoon = await SimpleSafeMoon.deploy();

  return { simpleSafeMoon };
}

describe("SimpleSafeMoon", function () {
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;

  let simpleSafeMoon: SimpleSafeMoon;

  beforeEach(async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: `https://eth-goerli.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
            blockNumber: 8121740,
          },
        },
      ],
    });
    ({ simpleSafeMoon } = await deploySimpleSafeMoon());
    [owner, user1, user2, user3, user4] = await ethers.getSigners();
  });

  describe("# ERC20", function () {
    it("Should decimals be 18", async function () {
      const decimals = await simpleSafeMoon.decimals()

      expect(decimals).to.eq(18)
    })

    it("Should total supply be 10000000", async function() {
      const totalSupply = await simpleSafeMoon.totalSupply()

      expect(totalSupply).to.eq(ethers.utils.parseUnits("10000000", "18"))
    })

    it("Should balance of owner be 10000000", async function () {
      const balanceOfOwner = await simpleSafeMoon.balanceOf(owner.address)

      expect(balanceOfOwner).to.eq(ethers.utils.parseUnits("10000000", "18"))
    })

    it("Should stakeTotalShare be 0", async function () {
      const stakeTotalShare = await simpleSafeMoon.stakeTotalShare()

      expect(stakeTotalShare).to.eq(ethers.utils.parseUnits("0", "18"))
    })

    it("Should stakeTotalReward be 0", async function () {
      const stakeTotalReward = await simpleSafeMoon.stakeTotalReward()

      expect(stakeTotalReward).to.eq(ethers.utils.parseUnits("0", "18"))
    })
  })

  describe("# Transfer", function () {
    beforeEach(async function () {
      // owner transfer 100 to user1, 200 to user3
      await simpleSafeMoon.transfer(
        user1.address,
        ethers.utils.parseUnits("100", "18")
      );
      await simpleSafeMoon.transfer(
        user3.address,
        ethers.utils.parseUnits("200", "18")
      );
    });

    it("forces error, when transfer to the zero address", async function () {
      await expect(
        simpleSafeMoon.transfer(ethers.constants.AddressZero, 1)
      ).to.be.revertedWith("ERC20: transfer to the zero address");
    });

    it("forces error, when transfer amount exceed balance", async function () {
      await expect(
        simpleSafeMoon.transfer(user3.address, ethers.constants.MaxUint256)
      ).to.be.revertedWith("Insufficient balance to transfer");
    });

    it("Should charge zero fee for each transaction if sender is excluded from fee", async function () {
      const receivedToken = await simpleSafeMoon.balanceOf(user1.address);

      expect(receivedToken).to.eq(ethers.utils.parseUnits("100", "18"));
    });

    it("Should sender's account balance be correct after transfer", async function () {
      await simpleSafeMoon
        .connect(user1)
        .transfer(user2.address, ethers.utils.parseUnits("100", "18"));
      
      const balance = await simpleSafeMoon.balanceOf(user1.address)
      expect(balance).to.be.eq(ethers.utils.parseUnits("0", "18"))
    });

    it("Should charge 10% fee for each transaction", async function () {
      await simpleSafeMoon.connect(user1).transfer(user2.address, ethers.utils.parseUnits("100", "18"))

      const receivedToken = await simpleSafeMoon.balanceOf(user2.address)

      // user1 transfer 100 token to user2, 10 token will be taken as fee
      // 5 for every address, 5 for stake reward
      // 90/10000000 * 5 = 0.0001 = 0.000045
      // user2 receive 90.000045000022500011
      expect(receivedToken).to.below(ethers.utils.parseUnits("90.000046", "18"))
      expect(receivedToken).to.above(ethers.utils.parseUnits("90.000045", "18"))
    })

    it("Should charge 5% fee as staking reward for each transaction", async function() {
      await simpleSafeMoon.connect(user1).transfer(user2.address, ethers.utils.parseUnits("100", "18"))

      const totalStakingReward = await simpleSafeMoon.stakeTotalReward()
      expect(totalStakingReward).to.eq(ethers.utils.parseUnits("5", "18"))
    })

    it("Should fee distribute to every account by their balance proportion", async function() {
      await simpleSafeMoon.transfer(user2.address, ethers.utils.parseUnits("100", "18"))

      const user1Balance = await simpleSafeMoon.balanceOf(user1.address)
      const user3Balance = await simpleSafeMoon.balanceOf(user3.address)
      expect(user3Balance).to.eq(user1Balance.mul(2))
    })
  });

  describe("# Staking Token", function () {
    beforeEach(async function () {
      await simpleSafeMoon.transfer(
        user1.address,
        ethers.utils.parseUnits("10000", "18")
      );
      await simpleSafeMoon
        .connect(user1)
        .transfer(user2.address, ethers.utils.parseUnits("5000", "18"));
    });
    it("forces error, when staking amount above balance", async function () {
      await expect(
        simpleSafeMoon
          .connect(user1)
          .stakeToken(ethers.utils.parseUnits("5001", "18"), 30)
      ).to.be.revertedWith("Insufficient balance to stake");
    });
    it("forces error, when claiming reward without stake any token", async function () {
      await expect(
        simpleSafeMoon.connect(user1).claimReward()
      ).to.be.revertedWith("You are not stake any token");
    });
    it("forces error, when claiming reward too early", async function () {
      await simpleSafeMoon
        .connect(user1)
        .stakeToken(ethers.utils.parseUnits("5000", "18"), 30);
      await expect(
        simpleSafeMoon.connect(user1).claimReward()
      ).to.be.revertedWith("Too early to claim reward");
    });
    it("Should user claim reward with correct amount", async function () {
      const totalReward = await simpleSafeMoon.stakeTotalReward();
      await simpleSafeMoon
        .connect(user1)
        .stakeToken(ethers.utils.parseUnits("5000", "18"), 30);
      const balance = await simpleSafeMoon.balanceOf(user1.address);
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]); // 31 days
      await simpleSafeMoon.connect(user1).claimReward();
      const balanceAfterClaim = await simpleSafeMoon.balanceOf(user1.address);
      expect(balanceAfterClaim.sub(balance)).to.eq(totalReward);
    });
    it("Should claim same amount of reward if staked same token amount and period", async function () {
      await simpleSafeMoon
        .connect(user1)
        .stakeToken(ethers.utils.parseUnits("100", "18"), 30);
      await simpleSafeMoon
        .connect(user2)
        .stakeToken(ethers.utils.parseUnits("100", "18"), 30);
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]); // 31 days
      await simpleSafeMoon.connect(user1).claimReward();
      await simpleSafeMoon.connect(user2).claimReward();
      const user1Reward = await simpleSafeMoon.accountStakeReward(
        user1.address
      );
      const user2Reward = await simpleSafeMoon.accountStakeReward(
        user2.address
      );
      expect(user1Reward).to.be.eq(user2Reward);
    });
    it("Should claim different amount of reward if staked different period, weights of 14D/30D is 3 : 7", async function () {
      await simpleSafeMoon
        .connect(user1)
        .stakeToken(ethers.utils.parseUnits("100", "18"), 14);
      await simpleSafeMoon
        .connect(user2)
        .stakeToken(ethers.utils.parseUnits("100", "18"), 30);
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]); // 31 days
      await simpleSafeMoon.connect(user1).claimReward();
      await simpleSafeMoon.connect(user2).claimReward();
      const user1Reward = await simpleSafeMoon.accountStakeReward(
        user1.address
      );
      const user2Reward = await simpleSafeMoon.accountStakeReward(
        user2.address
      );
      expect(user1Reward.mul(7)).to.be.eq(user2Reward.mul(3));
    });
  });
});
