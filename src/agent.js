const {
  getJsonRpcUrl,
  ethers,
  Finding,
  FindingSeverity,
  FindingType
} = require("forta-agent");
const ganache = require("ganache-core");
const {
  EVM
} = require("evm");

const TOKEN_ABI = [{
    "constant": true,
    "inputs": [{
      "name": "who",
      "type": "address"
    }],
    "name": "balanceOf",
    "outputs": [{
      "name": "",
      "type": "uint256"
    }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "name",
    "outputs": [{
      "name": "",
      "type": "string"
    }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "decimals",
    "outputs": [{
      "name": "",
      "type": "uint8"
    }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
]
const ERC20_TRANSFER_EVENT = "event Transfer(address indexed from, address indexed to, uint256 value)";

let findingsCount = 0;
// returns an ethers provider pointing to a forked version of the chain from the specified block
function getEthersForkProvider(blockNumber, user) {
  return new ethers.providers.Web3Provider(ganache.provider({
    fork: getJsonRpcUrl(), // specify the chain to fork from
    fork_block_number: blockNumber, // specify the block number to fork from
    unlocked_accounts: [user] // specify any accounts to unlock so you dont need the private key to make transactions
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
  return ethers.utils.getContractAddress({
    from: user,
    nonce
  })
}

function filterLogWithERC20Transfer(txReceipt, deployer) {
  const results = [];
  const iface = new ethers.utils.Interface([ERC20_TRANSFER_EVENT]);
  for (const log of txReceipt.logs) {
    try {
      const parsedLog = iface.parseLog(log);
      if ((parsedLog.args.from).toLowerCase() == deployer || (parsedLog.args.to).toLowerCase() == deployer) {
        results.push(
          Object.assign(parsedLog, {
            address: log.address
          })
        )
      }
    } catch (e) {

    }
  }

  return results
}

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

async function checkTokenBalance(signer, logs) {
  const result = {}
  await asyncForEach(logs, async function (log, index, array) {
    if (!(result[log.address])) {
      const tokenContract = new ethers.Contract(log.address, TOKEN_ABI, signer);
      const data = {
        name: await tokenContract.name(),
        decimal: await tokenContract.decimals(),
        value: ethers.BigNumber.from('0')
      }
      if (signer._address == log.args.from) {
        data.value = data.value.sub(log.args.value)
      } else {
        data.value = data.value.add(log.args.value)
      }
      result[log.address] = data
    } else {
      if (signer._address == log.args.from) {
        result[log.address].value = data.value.sub(log.args.value)
      } else {
        result[log.address].value = data.value.add(log.args.value)
      }
    }
  })
  //

  for (var i in result) {
    result[i].value = ((result[i].value).div(ethers.BigNumber.from((Math.pow(10, result[i].decimal)).toString()))).toNumber()
  }

  return result
}

const handleTransaction = async (txEvent) => {
  const findings = [];

  // limiting this agent to emit only 5 findings so that the alert feed is not spammed
  if (findingsCount >= 5) return findings;
  // filter Contract Created
  if (txEvent.transaction.to) return findings;

  const contractByteCode = txEvent.transaction.data;
  const deployer = txEvent.transaction.from;
  const contractAddresss = calculateContractAddress(deployer, txEvent.transaction.nonce)
  //Simulate Contract
  const evm = new EVM(contractByteCode);
  const functionHex = (arrayNonRepeatfy(evm.getOpcodes()
    .filter(opcode => opcode.name === 'PUSH4')
    .map(opcode => (opcode.pushData ? opcode.pushData.toString('hex') : ''))))

  //invoke contract
  await asyncForEach(functionHex, async function (key, index, array) {
    try {
      const provider = getEthersForkProvider(txEvent.block.number, deployer);
      const signer = provider.getSigner(deployer);
      const tx = await signer.sendTransaction({
        to: contractAddresss,
        data: `0x${key}`
      })
      const txReceipt = await provider.getTransactionReceipt(tx.hash)
      const result = await checkTokenBalance(signer, filterLogWithERC20Transfer(txReceipt, deployer))
      if (Object.keys(result).length > 0) {
        findings.push(
          Finding.fromObject({
            name: "Exploit Alert",
            description: `New Contract with public function can get many tokens`,
            alertId: "FORTA-1",
            severity: FindingSeverity.High,
            type: FindingType.Exploit,
            metadata: {
              contractAddress: contractAddresss,
              detail: result
            },
          })
        );
        findingsCount++;
      }

    } catch (e) {
      // MOck contract error
    }
  })

  return findings;
};


module.exports = {
  handleTransaction
};