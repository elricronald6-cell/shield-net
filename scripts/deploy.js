const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying ShieldNet with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const ShieldNet = await ethers.getContractFactory("ShieldNet");
  const shieldnet = await ShieldNet.deploy();
  await shieldnet.waitForDeployment();

  const address = await shieldnet.getAddress();
  console.log("ShieldNet deployed to:", address);
  console.log("Update CONTRACT_ADDRESS in frontend/index.html with this address.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
