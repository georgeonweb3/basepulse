// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BasePulseReceipts} from "../src/BasePulseReceipts.sol";

contract BasePulseReceiptsTest is Test {
    BasePulseReceipts r;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        vm.warp(1_800_000_000);
        r = new BasePulseReceipts();
    }

    function test_MintAndRead() public {
        vm.startPrank(alice);
        r.mintReceipt(keccak256("tx1"), "Swap on Uniswap");
        r.mintReceipt(keccak256("tx2"), "");
        vm.stopPrank();

        assertEq(r.receiptCount(alice), 2);
        assertEq(r.totalReceipts(), 2);
        BasePulseReceipts.Receipt[] memory p = r.getReceipts(alice, 0, 10);
        assertEq(p.length, 2);
        assertEq(p[0].txHash, keccak256("tx2")); // newest first
        assertEq(p[1].label, "Swap on Uniswap");
        assertEq(r.getReceipts(alice, 1, 10).length, 1);
        assertEq(r.getReceipts(alice, 5, 10).length, 0);
        assertEq(r.receiptCount(bob), 0);
    }

    function test_RevertDuplicate() public {
        vm.startPrank(alice);
        r.mintReceipt(keccak256("tx1"), "a");
        vm.expectRevert(BasePulseReceipts.DuplicateReceipt.selector);
        r.mintReceipt(keccak256("tx1"), "b");
        vm.stopPrank();
        vm.prank(bob);
        r.mintReceipt(keccak256("tx1"), "b"); // other users may anchor the same hash
    }

    function test_RevertEmptyAndLong() public {
        vm.startPrank(alice);
        vm.expectRevert(BasePulseReceipts.EmptyHash.selector);
        r.mintReceipt(bytes32(0), "x");
        vm.expectRevert(BasePulseReceipts.LabelTooLong.selector);
        r.mintReceipt(keccak256("t"), string(new bytes(65)));
        vm.stopPrank();
    }

    function test_CheckInStreak() public {
        vm.startPrank(alice);
        assertTrue(r.canCheckIn(alice));
        r.checkIn();
        assertFalse(r.canCheckIn(alice));
        vm.expectRevert(BasePulseReceipts.AlreadyCheckedInToday.selector);
        r.checkIn();

        vm.warp(block.timestamp + 1 days);
        r.checkIn();
        (, uint32 streak, uint32 total) = r.checkIns(alice);
        assertEq(streak, 2);
        assertEq(total, 2);
        assertEq(r.currentStreak(alice), 2);

        vm.warp(block.timestamp + 3 days); // missed days
        assertEq(r.currentStreak(alice), 0);
        r.checkIn();
        (, streak, total) = r.checkIns(alice);
        assertEq(streak, 1);
        assertEq(total, 3);
        vm.stopPrank();
        assertEq(r.totalCheckIns(), 3);
    }
}
