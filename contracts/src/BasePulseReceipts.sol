// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BasePulseReceipts
/// @notice On-chain receipt registry and daily check-in log for BasePulse.
///         Users anchor a transaction hash with a short label as social proof,
///         and check in once per UTC day to build a streak. No tokens, no fees,
///         no owner powers: the contract holds no funds and cannot be paused.
contract BasePulseReceipts {
    struct Receipt {
        bytes32 txHash;
        uint64 timestamp;
        string label;
    }

    struct CheckInState {
        uint32 lastDay;      // UTC day number (block.timestamp / 1 days) of last check-in
        uint32 streak;       // consecutive days
        uint32 total;        // all-time check-ins
    }

    uint256 public constant MAX_LABEL_LENGTH = 64;

    mapping(address => Receipt[]) private _receipts;
    mapping(address => mapping(bytes32 => bool)) public hasReceipt;
    mapping(address => CheckInState) public checkIns;

    uint256 public totalReceipts;
    uint256 public totalCheckIns;

    event ReceiptMinted(address indexed user, bytes32 indexed txHash, uint256 index, string label);
    event CheckedIn(address indexed user, uint32 day, uint32 streak, uint32 total);

    error EmptyHash();
    error LabelTooLong();
    error DuplicateReceipt();
    error AlreadyCheckedInToday();

    /// @notice Anchor a transaction hash with an optional label.
    function mintReceipt(bytes32 txHash, string calldata label) external {
        if (txHash == bytes32(0)) revert EmptyHash();
        if (bytes(label).length > MAX_LABEL_LENGTH) revert LabelTooLong();
        if (hasReceipt[msg.sender][txHash]) revert DuplicateReceipt();

        hasReceipt[msg.sender][txHash] = true;
        _receipts[msg.sender].push(Receipt(txHash, uint64(block.timestamp), label));
        unchecked { totalReceipts++; }

        emit ReceiptMinted(msg.sender, txHash, _receipts[msg.sender].length - 1, label);
    }

    /// @notice Check in once per UTC day. Missing a day resets the streak to 1.
    function checkIn() external {
        uint32 today = uint32(block.timestamp / 1 days);
        CheckInState storage s = checkIns[msg.sender];
        if (s.total != 0 && s.lastDay == today) revert AlreadyCheckedInToday();

        s.streak = (s.total != 0 && s.lastDay + 1 == today) ? s.streak + 1 : 1;
        s.lastDay = today;
        unchecked { s.total++; totalCheckIns++; }

        emit CheckedIn(msg.sender, today, s.streak, s.total);
    }

    /// @notice Current streak, treating a missed day as a broken streak.
    function currentStreak(address user) external view returns (uint32) {
        CheckInState memory s = checkIns[user];
        if (s.total == 0) return 0;
        uint32 today = uint32(block.timestamp / 1 days);
        return (s.lastDay == today || s.lastDay + 1 == today) ? s.streak : 0;
    }

    function canCheckIn(address user) external view returns (bool) {
        CheckInState memory s = checkIns[user];
        return s.total == 0 || s.lastDay != uint32(block.timestamp / 1 days);
    }

    function receiptCount(address user) external view returns (uint256) {
        return _receipts[user].length;
    }

    /// @notice Newest-first page of a user's receipts.
    function getReceipts(address user, uint256 offset, uint256 limit) external view returns (Receipt[] memory page) {
        Receipt[] storage all = _receipts[user];
        uint256 n = all.length;
        if (offset >= n) return new Receipt[](0);
        uint256 count = n - offset < limit ? n - offset : limit;
        page = new Receipt[](count);
        for (uint256 i = 0; i < count; i++) {
            page[i] = all[n - 1 - offset - i];
        }
    }
}
