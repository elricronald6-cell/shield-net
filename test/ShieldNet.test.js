const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ShieldNet", function () {
  let shieldnet, owner, poster, auditor, other;
  const TARGET = "0x1234567890abcdef1234567890abcdef12345678";
  const SCOPE = "Audit token transfer logic for reentrancy and overflow.";
  const POOL = ethers.parseEther("2.0");

  beforeEach(async function () {
    [owner, poster, auditor, other] = await ethers.getSigners();
    const ShieldNet = await ethers.getContractFactory("ShieldNet");
    shieldnet = await ShieldNet.deploy();
    await shieldnet.waitForDeployment();
  });

  describe("Post Bounty", function () {
    it("should create a bounty with correct data", async function () {
      await expect(
        shieldnet.connect(poster).postBounty(TARGET, SCOPE, { value: POOL })
      )
        .to.emit(shieldnet, "BountyPosted")
        .withArgs(0, poster.address, TARGET, POOL);

      const b = await shieldnet.getBounty(0);
      expect(b.target).to.equal(TARGET);
      expect(b.scope).to.equal(SCOPE);
      expect(b.poster).to.equal(poster.address);
      expect(b.pool).to.equal(POOL);
      expect(b.active).to.be.true;
      expect(await shieldnet.getBountyCount()).to.equal(1);
    });

    it("should revert when pool is zero", async function () {
      await expect(
        shieldnet.connect(poster).postBounty(TARGET, SCOPE, { value: 0 })
      ).to.be.revertedWith("Pool must be > 0");
    });
  });

  describe("Submit Finding", function () {
    beforeEach(async function () {
      await shieldnet.connect(poster).postBounty(TARGET, SCOPE, { value: POOL });
    });

    it("should submit a finding and emit event", async function () {
      await expect(
        shieldnet.connect(auditor).submitFinding(0, "Reentrancy in withdraw", 4, "The withdraw function...")
      )
        .to.emit(shieldnet, "FindingSubmitted")
        .withArgs(0, 0, auditor.address, 4);

      const findings = await shieldnet.getFindings(0);
      expect(findings.length).to.equal(1);
      expect(findings[0].title).to.equal("Reentrancy in withdraw");
      expect(findings[0].severity).to.equal(4); // CRITICAL
      expect(findings[0].status).to.equal(0); // Pending
    });

    it("should revert on closed bounty", async function () {
      await shieldnet.connect(poster).closeBounty(0);
      await expect(
        shieldnet.connect(auditor).submitFinding(0, "Bug", 1, "Details")
      ).to.be.revertedWith("Bounty not active");
    });
  });

  describe("Approve Finding", function () {
    beforeEach(async function () {
      await shieldnet.connect(poster).postBounty(TARGET, SCOPE, { value: POOL });
      await shieldnet.connect(auditor).submitFinding(0, "Reentrancy", 4, "Details here");
    });

    it("should approve and assign reward", async function () {
      const reward = ethers.parseEther("1.0");
      await expect(
        shieldnet.connect(poster).approveFinding(0, 0, reward)
      )
        .to.emit(shieldnet, "FindingApproved")
        .withArgs(0, 0, reward);

      const findings = await shieldnet.getFindings(0);
      expect(findings[0].status).to.equal(1); // Approved
      expect(findings[0].reward).to.equal(reward);
    });

    it("should revert if non-poster tries to approve", async function () {
      await expect(
        shieldnet.connect(other).approveFinding(0, 0, ethers.parseEther("1.0"))
      ).to.be.revertedWith("Only poster");
    });

    it("should revert if reward exceeds pool", async function () {
      await expect(
        shieldnet.connect(poster).approveFinding(0, 0, ethers.parseEther("3.0"))
      ).to.be.revertedWith("Exceeds pool");
    });
  });

  describe("Reject Finding", function () {
    beforeEach(async function () {
      await shieldnet.connect(poster).postBounty(TARGET, SCOPE, { value: POOL });
      await shieldnet.connect(auditor).submitFinding(0, "Low impact", 0, "Info detail");
    });

    it("should reject a finding", async function () {
      await expect(
        shieldnet.connect(poster).rejectFinding(0, 0)
      )
        .to.emit(shieldnet, "FindingRejected")
        .withArgs(0, 0);

      const findings = await shieldnet.getFindings(0);
      expect(findings[0].status).to.equal(2); // Rejected
    });
  });

  describe("Claim Reward", function () {
    beforeEach(async function () {
      await shieldnet.connect(poster).postBounty(TARGET, SCOPE, { value: POOL });
      await shieldnet.connect(auditor).submitFinding(0, "Critical bug", 4, "Details");
      await shieldnet.connect(poster).approveFinding(0, 0, ethers.parseEther("1.0"));
    });

    it("should transfer reward to auditor", async function () {
      const before = await ethers.provider.getBalance(auditor.address);

      const tx = await shieldnet.connect(auditor).claimReward(0, 0);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const after = await ethers.provider.getBalance(auditor.address);
      expect(after).to.be.closeTo(
        before + ethers.parseEther("1.0") - gasUsed,
        ethers.parseEther("0.001")
      );

      await expect(tx)
        .to.emit(shieldnet, "RewardClaimed")
        .withArgs(0, 0, auditor.address, ethers.parseEther("1.0"));

      const findings = await shieldnet.getFindings(0);
      expect(findings[0].claimed).to.be.true;
    });

    it("should revert if non-auditor claims", async function () {
      await expect(
        shieldnet.connect(other).claimReward(0, 0)
      ).to.be.revertedWith("Only auditor");
    });

    it("should revert double claim", async function () {
      await shieldnet.connect(auditor).claimReward(0, 0);
      await expect(
        shieldnet.connect(auditor).claimReward(0, 0)
      ).to.be.revertedWith("Already claimed");
    });
  });

  describe("Close Bounty", function () {
    it("should refund remaining pool to poster", async function () {
      await shieldnet.connect(poster).postBounty(TARGET, SCOPE, { value: POOL });
      await shieldnet.connect(auditor).submitFinding(0, "Bug", 3, "High sev");
      await shieldnet.connect(poster).approveFinding(0, 0, ethers.parseEther("0.5"));
      await shieldnet.connect(auditor).claimReward(0, 0);

      const before = await ethers.provider.getBalance(poster.address);

      const tx = await shieldnet.connect(poster).closeBounty(0);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const refund = ethers.parseEther("1.5"); // 2.0 - 0.5
      await expect(tx)
        .to.emit(shieldnet, "BountyClosed")
        .withArgs(0, refund);

      const after = await ethers.provider.getBalance(poster.address);
      expect(after).to.be.closeTo(
        before + refund - gasUsed,
        ethers.parseEther("0.001")
      );

      const b = await shieldnet.getBounty(0);
      expect(b.active).to.be.false;
    });

    it("should revert if non-poster tries to close", async function () {
      await shieldnet.connect(poster).postBounty(TARGET, SCOPE, { value: POOL });
      await expect(
        shieldnet.connect(other).closeBounty(0)
      ).to.be.revertedWith("Only poster");
    });
  });

  describe("Pause / Unpause", function () {
    it("should prevent postBounty when paused", async function () {
      await shieldnet.connect(owner).pause();
      await expect(
        shieldnet.connect(poster).postBounty(TARGET, SCOPE, { value: POOL })
      ).to.be.reverted;
    });

    it("should resume after unpause", async function () {
      await shieldnet.connect(owner).pause();
      await shieldnet.connect(owner).unpause();
      await expect(
        shieldnet.connect(poster).postBounty(TARGET, SCOPE, { value: POOL })
      ).to.not.be.reverted;
    });

    it("should only allow owner to pause", async function () {
      await expect(
        shieldnet.connect(poster).pause()
      ).to.be.reverted;
    });
  });
});
