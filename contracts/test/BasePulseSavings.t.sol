// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BasePulseSavings, IERC20} from "../src/BasePulseSavings.sol";

/// Runs against a fork of Base mainnet: forge test --fork-url https://mainnet.base.org
contract BasePulseSavingsForkTest is Test {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant AUSDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;
    address constant POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;

    BasePulseSavings v;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        v = new BasePulseSavings(USDC, AUSDC, POOL, 10_000e6, address(this));
        _fund(alice, 1_000e6);
        _fund(bob, 1_000e6);
        _fund(carol, 1_000e6);
    }

    function _fund(address to, uint256 amt) internal {
        vm.prank(AUSDC); // aToken holds the market's USDC
        (bool ok,) = USDC.call(abi.encodeWithSignature("transfer(address,uint256)", to, amt));
        require(ok, "fund");
        vm.prank(to);
        IERC20(USDC).approve(address(v), type(uint256).max);
    }

    function test_SaveStreakAndYield() public {
        vm.startPrank(alice);
        v.setPlanAndSave(1e6);
        vm.expectRevert(BasePulseSavings.AlreadySavedToday.selector);
        v.save();
        for (uint256 i = 0; i < 9; i++) {
            vm.warp(block.timestamp + 1 days);
            v.save();
        }
        vm.stopPrank();

        (,, , uint32 streak, uint32 best, uint32 daysSaved,) = v.savers(alice);
        assertEq(streak, 10);
        assertEq(best, 10);
        assertEq(daysSaved, 10);
        assertEq(v.totalSavers(), 1);
        assertGe(v.balanceOf(alice), 10e6 - 2);

        vm.warp(block.timestamp + 30 days); // accrue Aave interest
        assertGt(v.balanceOf(alice), 10e6);
        assertGt(v.earned(alice), 0);
        assertEq(v.currentStreak(alice), 0); // missed days

        uint256 before = IERC20(USDC).balanceOf(alice);
        vm.prank(alice);
        v.withdrawAll();
        uint256 got = IERC20(USDC).balanceOf(alice) - before;
        assertGt(got, 10e6);
        assertEq(v.shares(alice), 0);
    }

    function test_StreakResets() public {
        vm.startPrank(alice);
        v.setPlanAndSave(2e6);
        vm.warp(block.timestamp + 1 days);
        v.save();
        vm.warp(block.timestamp + 2 days);
        v.save();
        vm.stopPrank();
        (,,, uint32 streak, uint32 best,,) = v.savers(alice);
        assertEq(streak, 1);
        assertEq(best, 2);
    }

    function test_FairSharesAcrossUsers() public {
        vm.prank(alice);
        v.setPlanAndSave(100e6);
        vm.warp(block.timestamp + 60 days);
        vm.prank(bob);
        v.setPlanAndSave(100e6);
        // Bob joined after interest accrued; he must not capture Alice's yield.
        assertApproxEqAbs(v.balanceOf(bob), 100e6, 2);
        assertGt(v.balanceOf(alice), 100e6);

        vm.prank(bob);
        v.withdraw(50e6);
        assertApproxEqAbs(v.balanceOf(bob), 50e6, 2);
        vm.prank(bob);
        vm.expectRevert(BasePulseSavings.InsufficientBalance.selector);
        v.withdraw(60e6);
    }

    function test_CapAndOwner() public {
        BasePulseSavings small = new BasePulseSavings(USDC, AUSDC, POOL, 5e6, address(this));
        vm.startPrank(alice);
        IERC20(USDC).approve(address(small), type(uint256).max);
        vm.expectRevert(BasePulseSavings.CapExceeded.selector);
        small.setPlanAndSave(6e6);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(BasePulseSavings.NotOwner.selector);
        small.raiseDepositCap(100e6);
        small.raiseDepositCap(100e6);
        vm.prank(alice);
        small.setPlanAndSave(6e6);
    }

    function test_PlanBounds() public {
        vm.startPrank(alice);
        vm.expectRevert(BasePulseSavings.NoPlan.selector);
        v.save();
        vm.expectRevert(BasePulseSavings.InvalidAmount.selector);
        v.setPlan(1);
        vm.expectRevert(BasePulseSavings.InvalidAmount.selector);
        v.setPlan(1_001e6);
        vm.stopPrank();
    }

    function test_Circles() public {
        vm.prank(alice);
        uint256 id = v.createCircle("Yenagoa Savers", 1e6, 30);
        vm.prank(bob);
        v.joinCircle(id);
        vm.prank(bob);
        vm.expectRevert(BasePulseSavings.AlreadyInCircle.selector);
        v.joinCircle(id);
        vm.expectRevert(BasePulseSavings.BadCircle.selector);
        vm.prank(carol);
        v.joinCircle(99);

        vm.prank(alice);
        v.setPlanAndSave(1e6);
        vm.prank(bob);
        v.setPlanAndSave(3e6);

        BasePulseSavings.MemberStat[] memory st = v.circleStats(id);
        assertEq(st.length, 2);
        assertEq(st[0].member, alice);
        assertEq(st[0].streak, 1);
        assertApproxEqAbs(st[1].balance, 3e6, 2);

        vm.prank(alice);
        v.leaveCircle();
        (, address[] memory members) = v.getCircle(id);
        assertEq(members.length, 1);
        assertEq(members[0], bob);
        assertEq(v.circleCount(), 1);
    }
}
