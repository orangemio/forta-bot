const { getJsonRpcUrl, ethers } = require("forta-agent");
const ganache = require("ganache-core");
const { EVM } = require("evm");

const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
const WETH_ABI = [
  {
    "constant": true,
    "inputs": [{ "name": "who", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "name": "", "type": "uint256" }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }
]

let findingsCount = 0;
// returns an ethers provider pointing to a forked version of the chain from the specified block
function getEthersForkProvider(blockNumber, user) {
  return new ethers.providers.Web3Provider(ganache.provider({
    fork: getJsonRpcUrl(), // specify the chain to fork from
    fork_block_number: blockNumber,// specify the block number to fork from
    unlocked_accounts: [user], // specify any accounts to unlock so you dont need the private key to make transactions
    forkCacheSize: -1,
    debug: true,
    vmErrorsOnRPCResponse: true
  }))
}

function arrayNonRepeatfy(arr) {
  let hashMap = new Map();
  let result = new Array();
  for (let i = 0; i < arr.length; i++) {
    if (hashMap.has(arr[i])) {
      hashMap.set(arr[i], true);
    } else {
      hashMap.set(arr[i], false);
      result.push(arr[i]);
    }
  }
  return result;
}

function calculateContractAddress(user, nonce) {
  const rlp_encoded = ethers.utils.RLP.encode(
    [user, ethers.BigNumber.from(nonce.toString()).toHexString()]
  );
  const contract_address_long = ethers.utils.keccak256(rlp_encoded);
  const contract_address = '0x'.concat(contract_address_long.substring(26));
  return ethers.utils.getAddress(contract_address);
}


const handleTransaction = async (txEvent) => {
  const findings = [];

  // limiting this agent to emit only 5 findings so that the alert feed is not spammed
  if (findingsCount >= 5) return findings;

  // filter Contract Created
  if (txEvent.transaction.to) return findings;

  const contractByteCode = txEvent.transaction.data;
  const deployer = txEvent.from;
  const contractAddresss = calculateContractAddress(deployer, txEvent.transaction.nonce)

  //Simulate Contract
  const evm = new EVM(contractByteCode);
  const functionHex = (arrayNonRepeatfy(evm.getOpcodes()
    .filter(opcode => opcode.name === 'PUSH4')
    .map(opcode => (opcode.pushData ? opcode.pushData.toString('hex') : '')))
  )
  //invoke contract
  try {
    console.log(deployer)
    const provider = getEthersForkProvider(txEvent.blockNumber, deployer);
    const signer = provider.getSigner(deployer);
    const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer);
    console.log(provider)
    const balanceBefore =  await weth.balanceOf(deployer);
    console.log(balanceBefore)
    const tx = await signer.sendTransaction({
      to: contractAddresss,
      data: '0xaf8271f7'
    })
    await tx.wait()
    const balanceAfter =  await weth.balanceOf(deployer);
    console.log(balanceAfter)
  }catch(e){
    console.log(e)
  }
  return findings;
};


module.exports = {
  handleTransaction
};
