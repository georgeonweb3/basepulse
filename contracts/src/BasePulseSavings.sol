// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

interface IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
}

interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

/// @title BasePulseSavings
/// @notice Daily USDC streak savings on Base. Each wallet picks a daily amount, saves once per
///         UTC day to grow a streak, and earns Aave v3 yield on everything saved. Savers can
///         withdraw their full balance at any time. Friends can form Circles with a shared goal.
/// @dev    Non-custodial: there is no admin function that can move, freeze or redirect user funds.
///         The only owner power is raising the global deposit cap.
contract BasePulseSavings {
    // ── Immutable config ──────────────────────────────────────────────────────
    IERC20 public immutable usdc;
    IERC20 public immutable aUsdc;
    IAavePool public immutable pool;

    uint256 public constant MIN_DAILY = 1e5;        // 0.10 USDC
    uint256 public constant MAX_DAILY = 1_000e6;    // 1,000 USDC
    uint256 private constant VIRTUAL_SHARES = 1e6;  // inflation-attack guard
    uint256 private constant VIRTUAL_ASSETS = 1;

    address public owner;
    uint256 public depositCap; // max total assets held (USDC, 6 decimals)

    // ── Savers ────────────────────────────────────────────────────────────────
    struct Saver {
        uint128 dailyAmount;
        uint128 totalDeposited; // net principal (deposits minus withdrawals, floored at 0)
        uint32 lastDay;
        uint32 streak;
        uint32 bestStreak;
        uint32 daysSaved;
        uint32 circleId;        // 0 = none
    }

    mapping(address => Saver) public savers;
    mapping(address => uint256) public shares;
    uint256 public totalShares;
    uint256 public totalSavers;

    // ── Circles ───────────────────────────────────────────────────────────────
    struct Circle {
        address creator;
        uint32 goalDays;
        uint64 createdAt;
        uint128 dailyTarget;
        string name;
    }

    Circle[] private _circles; // index 0 unused
    mapping(uint256 => address[]) private _members;
    uint256 public constant MAX_CIRCLE_MEMBERS = 50;

    // ── Events / errors ───────────────────────────────────────────────────────
    event PlanSet(address indexed user, uint256 dailyAmount);
    event Saved(address indexed user, uint256 amount, uint32 day, uint32 streak, uint256 sharesMinted);
    event Withdrawn(address indexed user, uint256 amount, uint256 sharesBurned);
    event CircleCreated(uint256 indexed circleId, address indexed creator, string name, uint256 dailyTarget, uint32 goalDays);
    event CircleJoined(uint256 indexed circleId, address indexed user);
    event CircleLeft(uint256 indexed circleId, address indexed user);
    event DepositCapRaised(uint256 newCap);

    error InvalidAmount();
    error NoPlan();
    error AlreadySavedToday();
    error CapExceeded();
    error InsufficientBalance();
    error TransferFailed();
    error NotOwner();
    error BadCircle();
    error CircleFull();
    error AlreadyInCircle();
    error NotInCircle();
    error NameLength();

    constructor(address _usdc, address _aUsdc, address _pool, uint256 _depositCap, address _owner) {
        usdc = IERC20(_usdc);
        aUsdc = IERC20(_aUsdc);
        pool = IAavePool(_pool);
        depositCap = _depositCap;
        owner = _owner;
        _circles.push(); // reserve id 0
        IERC20(_usdc).approve(_pool, type(uint256).max);
    }

    // ── Views ─────────────────────────────────────────────────────────────────
    function today() public view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function totalAssets() public view returns (uint256) {
        return aUsdc.balanceOf(address(this));
    }

    function balanceOf(address user) public view returns (uint256) {
        return _toAssets(shares[user]);
    }

    function earned(address user) external view returns (uint256) {
        uint256 bal = balanceOf(user);
        uint256 p = savers[user].totalDeposited;
        return bal > p ? bal - p : 0;
    }

    function currentStreak(address user) public view returns (uint32) {
        Saver memory s = savers[user];
        if (s.daysSaved == 0) return 0;
        uint32 t = today();
        return (s.lastDay == t || s.lastDay + 1 == t) ? s.streak : 0;
    }

    function canSaveToday(address user) external view returns (bool) {
        Saver memory s = savers[user];
        return s.dailyAmount != 0 && (s.daysSaved == 0 || s.lastDay != today());
    }

    // ── Saving ────────────────────────────────────────────────────────────────
    function setPlan(uint256 dailyAmount) public {
        if (dailyAmount < MIN_DAILY || dailyAmount > MAX_DAILY) revert InvalidAmount();
        savers[msg.sender].dailyAmount = uint128(dailyAmount);
        emit PlanSet(msg.sender, dailyAmount);
    }

    /// @notice Save today's amount. Requires a prior USDC approval to this contract.
    function save() external {
        _save(msg.sender);
    }

    /// @notice Set (or change) the plan and save in one call.
    function setPlanAndSave(uint256 dailyAmount) external {
        setPlan(dailyAmount);
        _save(msg.sender);
    }

    /// @notice Save using an EIP-2612 permit, so no separate approval transaction is needed.
    function saveWithPermit(uint256 dailyAmount, uint256 permitValue, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        if (savers[msg.sender].dailyAmount != dailyAmount) setPlan(dailyAmount);
        try IERC20Permit(address(usdc)).permit(msg.sender, address(this), permitValue, deadline, v, r, s) {} catch {}
        _save(msg.sender);
    }

    function _save(address user) internal {
        Saver storage s = savers[user];
        uint256 amount = s.dailyAmount;
        if (amount == 0) revert NoPlan();
        uint32 t = today();
        if (s.daysSaved != 0 && s.lastDay == t) revert AlreadySavedToday();

        uint256 assetsBefore = totalAssets();
        if (assetsBefore + amount > depositCap) revert CapExceeded();

        uint256 minted = _toShares(amount, assetsBefore);
        if (minted == 0) revert InvalidAmount();

        if (!usdc.transferFrom(user, address(this), amount)) revert TransferFailed();
        pool.supply(address(usdc), amount, address(this), 0);

        if (s.daysSaved == 0) totalSavers++;
        s.streak = (s.daysSaved != 0 && s.lastDay + 1 == t) ? s.streak + 1 : 1;
        if (s.streak > s.bestStreak) s.bestStreak = s.streak;
        s.lastDay = t;
        s.daysSaved++;
        s.totalDeposited += uint128(amount);

        shares[user] += minted;
        totalShares += minted;

        emit Saved(user, amount, t, s.streak, minted);
    }

    // ── Withdrawing ───────────────────────────────────────────────────────────
    /// @notice Withdraw `amount` USDC (principal or yield) to your wallet. Streak is unaffected.
    function withdraw(uint256 amount) public {
        if (amount == 0) revert InvalidAmount();
        uint256 assets = totalAssets();
        uint256 burn = _toSharesUp(amount, assets);
        if (burn > shares[msg.sender]) revert InsufficientBalance();
        _withdraw(msg.sender, amount, burn);
    }

    function withdrawAll() external {
        uint256 sh = shares[msg.sender];
        if (sh == 0) revert InsufficientBalance();
        uint256 amount = _toAssets(sh);
        _withdraw(msg.sender, amount, sh);
    }

    function _withdraw(address user, uint256 amount, uint256 burn) internal {
        shares[user] -= burn;
        totalShares -= burn;
        Saver storage s = savers[user];
        s.totalDeposited = amount >= s.totalDeposited ? 0 : s.totalDeposited - uint128(amount);
        pool.withdraw(address(usdc), amount, user);
        emit Withdrawn(user, amount, burn);
    }

    // ── Circles ───────────────────────────────────────────────────────────────
    function createCircle(string calldata name, uint256 dailyTarget, uint32 goalDays) external returns (uint256 id) {
        uint256 len = bytes(name).length;
        if (len == 0 || len > 32) revert NameLength();
        if (dailyTarget < MIN_DAILY || dailyTarget > MAX_DAILY || goalDays == 0 || goalDays > 366) revert InvalidAmount();
        id = _circles.length;
        _circles.push(Circle(msg.sender, goalDays, uint64(block.timestamp), uint128(dailyTarget), name));
        emit CircleCreated(id, msg.sender, name, dailyTarget, goalDays);
        _join(id, msg.sender);
    }

    function joinCircle(uint256 id) external {
        if (id == 0 || id >= _circles.length) revert BadCircle();
        _join(id, msg.sender);
    }

    function leaveCircle() external {
        uint256 id = savers[msg.sender].circleId;
        if (id == 0) revert NotInCircle();
        address[] storage m = _members[id];
        for (uint256 i = 0; i < m.length; i++) {
            if (m[i] == msg.sender) {
                m[i] = m[m.length - 1];
                m.pop();
                break;
            }
        }
        savers[msg.sender].circleId = 0;
        emit CircleLeft(id, msg.sender);
    }

    function _join(uint256 id, address user) internal {
        if (savers[user].circleId != 0) revert AlreadyInCircle();
        if (_members[id].length >= MAX_CIRCLE_MEMBERS) revert CircleFull();
        _members[id].push(user);
        savers[user].circleId = uint32(id);
        emit CircleJoined(id, user);
    }

    function circleCount() external view returns (uint256) {
        return _circles.length - 1;
    }

    function getCircle(uint256 id) external view returns (Circle memory c, address[] memory members) {
        if (id == 0 || id >= _circles.length) revert BadCircle();
        return (_circles[id], _members[id]);
    }

    struct MemberStat {
        address member;
        uint32 streak;
        uint32 bestStreak;
        uint32 daysSaved;
        uint256 balance;
    }

    /// @notice Leaderboard data for a circle (unsorted; sort client-side).
    function circleStats(uint256 id) external view returns (MemberStat[] memory out) {
        if (id == 0 || id >= _circles.length) revert BadCircle();
        address[] storage m = _members[id];
        out = new MemberStat[](m.length);
        for (uint256 i = 0; i < m.length; i++) {
            Saver memory s = savers[m[i]];
            out[i] = MemberStat(m[i], currentStreak(m[i]), s.bestStreak, s.daysSaved, balanceOf(m[i]));
        }
    }

    // ── Owner (cap only) ──────────────────────────────────────────────────────
    function raiseDepositCap(uint256 newCap) external {
        if (msg.sender != owner) revert NotOwner();
        if (newCap <= depositCap) revert InvalidAmount();
        depositCap = newCap;
        emit DepositCapRaised(newCap);
    }

    // ── Share math ────────────────────────────────────────────────────────────
    function _toShares(uint256 assets, uint256 totalA) internal view returns (uint256) {
        return assets * (totalShares + VIRTUAL_SHARES) / (totalA + VIRTUAL_ASSETS);
    }

    function _toSharesUp(uint256 assets, uint256 totalA) internal view returns (uint256) {
        uint256 num = assets * (totalShares + VIRTUAL_SHARES);
        uint256 den = totalA + VIRTUAL_ASSETS;
        return (num + den - 1) / den;
    }

    function _toAssets(uint256 sh) internal view returns (uint256) {
        return sh * (totalAssets() + VIRTUAL_ASSETS) / (totalShares + VIRTUAL_SHARES);
    }
}
