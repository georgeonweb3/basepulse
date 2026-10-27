// BasePulseReceipts on Base mainnet (chain 8453).
// Deployed Oct 27, 2026 via CREATE2, tx 0x3a54b6a79a81bda04e6b384e5be31352021f9a97a68b63e93f415489e3b53ff3.
// NEXT_PUBLIC_RECEIPT_CONTRACT can override it.
export const RECEIPT_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_RECEIPT_CONTRACT || "0x2A46AeA3A312d6555936f57bA3d0bE533EeD4586";
export const CONTRACT_READY = /^0x[0-9a-fA-F]{40}$/.test(RECEIPT_CONTRACT_ADDRESS);

export const RECEIPT_CONTRACT_ABI = [
  {
    "type": "function",
    "name": "MAX_LABEL_LENGTH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "canCheckIn",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "checkIn",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "checkIns",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "lastDay",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "streak",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "total",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "currentStreak",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getReceipts",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "offset",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "limit",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "page",
        "type": "tuple[]",
        "internalType": "struct BasePulseReceipts.Receipt[]",
        "components": [
          {
            "name": "txHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "timestamp",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "label",
            "type": "string",
            "internalType": "string"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasReceipt",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "mintReceipt",
    "inputs": [
      {
        "name": "txHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "label",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "receiptCount",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalCheckIns",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalReceipts",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "CheckedIn",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "day",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "streak",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "total",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ReceiptMinted",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "txHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "index",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "label",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyCheckedInToday",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DuplicateReceipt",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyHash",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LabelTooLong",
    "inputs": []
  }
];
