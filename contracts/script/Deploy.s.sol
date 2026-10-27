// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {BasePulseReceipts} from "../src/BasePulseReceipts.sol";

/// forge script script/Deploy.s.sol --rpc-url https://mainnet.base.org --broadcast --interactive 1
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        BasePulseReceipts r = new BasePulseReceipts();
        vm.stopBroadcast();
        console.log("BasePulseReceipts deployed at", address(r));
    }
}
