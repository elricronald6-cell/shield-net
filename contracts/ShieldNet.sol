// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title ShieldNet
 * @notice On-chain smart contract audit bounty board for BOT Chain.
 *         Project owners post bounties, auditors submit findings,
 *         approved findings earn rewards.
 */
contract ShieldNet is Ownable, ReentrancyGuard, Pausable {

    enum Severity { INFO, LOW, MEDIUM, HIGH, CRITICAL }
    enum FindingStatus { Pending, Approved, Rejected }

    struct Bounty {
        uint256 id;
        string target;
        string scope;
        address poster;
        uint256 pool;
        uint256 paid;
        bool active;
        uint256 createdAt;
    }

    struct Finding {
        address auditor;
        string title;
        Severity severity;
        string details;
        FindingStatus status;
        uint256 reward;
        bool claimed;
        uint256 submittedAt;
    }

    uint256 private _bountyCounter;

    mapping(uint256 => Bounty) private _bounties;
    mapping(uint256 => Finding[]) private _findings;

    event BountyPosted(uint256 indexed id, address indexed poster, string target, uint256 pool);
    event FindingSubmitted(uint256 indexed bountyId, uint256 findingIndex, address indexed auditor, Severity severity);
    event FindingApproved(uint256 indexed bountyId, uint256 findingIndex, uint256 reward);
    event FindingRejected(uint256 indexed bountyId, uint256 findingIndex);
    event RewardClaimed(uint256 indexed bountyId, uint256 findingIndex, address indexed auditor, uint256 reward);
    event BountyClosed(uint256 indexed id, uint256 refunded);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Post a new bounty. msg.value becomes the reward pool.
     * @param target Contract address or repository link to audit.
     * @param scope  Description of what to audit.
     */
    function postBounty(string calldata target, string calldata scope)
        external
        payable
        whenNotPaused
    {
        require(msg.value > 0, "Pool must be > 0");
        require(bytes(target).length > 0, "Target required");
        require(bytes(scope).length > 0, "Scope required");

        uint256 id = _bountyCounter++;

        _bounties[id] = Bounty({
            id: id,
            target: target,
            scope: scope,
            poster: msg.sender,
            pool: msg.value,
            paid: 0,
            active: true,
            createdAt: block.timestamp
        });

        emit BountyPosted(id, msg.sender, target, msg.value);
    }

    /**
     * @notice Submit a security finding for a bounty.
     */
    function submitFinding(
        uint256 bountyId,
        string calldata title,
        Severity severity,
        string calldata details
    )
        external
        whenNotPaused
    {
        Bounty storage b = _bounties[bountyId];
        require(b.active, "Bounty not active");
        require(bytes(title).length > 0, "Title required");
        require(bytes(details).length > 0, "Details required");

        _findings[bountyId].push(Finding({
            auditor: msg.sender,
            title: title,
            severity: severity,
            details: details,
            status: FindingStatus.Pending,
            reward: 0,
            claimed: false,
            submittedAt: block.timestamp
        }));

        uint256 idx = _findings[bountyId].length - 1;
        emit FindingSubmitted(bountyId, idx, msg.sender, severity);
    }

    /**
     * @notice Approve a finding and assign a reward from the bounty pool.
     */
    function approveFinding(uint256 bountyId, uint256 findingIndex, uint256 reward)
        external
        whenNotPaused
    {
        Bounty storage b = _bounties[bountyId];
        require(msg.sender == b.poster, "Only poster");
        require(b.active, "Bounty not active");

        Finding storage f = _findings[bountyId][findingIndex];
        require(f.status == FindingStatus.Pending, "Not pending");
        require(reward > 0, "Reward must be > 0");
        require(b.paid + reward <= b.pool, "Exceeds pool");

        f.status = FindingStatus.Approved;
        f.reward = reward;
        b.paid += reward;

        emit FindingApproved(bountyId, findingIndex, reward);
    }

    /**
     * @notice Reject a finding.
     */
    function rejectFinding(uint256 bountyId, uint256 findingIndex)
        external
        whenNotPaused
    {
        Bounty storage b = _bounties[bountyId];
        require(msg.sender == b.poster, "Only poster");

        Finding storage f = _findings[bountyId][findingIndex];
        require(f.status == FindingStatus.Pending, "Not pending");

        f.status = FindingStatus.Rejected;

        emit FindingRejected(bountyId, findingIndex);
    }

    /**
     * @notice Claim an approved reward.
     */
    function claimReward(uint256 bountyId, uint256 findingIndex)
        external
        nonReentrant
        whenNotPaused
    {
        Finding storage f = _findings[bountyId][findingIndex];
        require(msg.sender == f.auditor, "Only auditor");
        require(f.status == FindingStatus.Approved, "Not approved");
        require(!f.claimed, "Already claimed");
        require(f.reward > 0, "No reward");

        f.claimed = true;

        (bool ok, ) = payable(f.auditor).call{value: f.reward}("");
        require(ok, "Transfer failed");

        emit RewardClaimed(bountyId, findingIndex, f.auditor, f.reward);
    }

    /**
     * @notice Close a bounty and refund remaining pool to the poster.
     */
    function closeBounty(uint256 bountyId)
        external
        nonReentrant
        whenNotPaused
    {
        Bounty storage b = _bounties[bountyId];
        require(msg.sender == b.poster, "Only poster");
        require(b.active, "Already closed");

        b.active = false;

        uint256 refund = b.pool - b.paid;
        if (refund > 0) {
            (bool ok, ) = payable(b.poster).call{value: refund}("");
            require(ok, "Refund failed");
        }

        emit BountyClosed(bountyId, refund);
    }

    // ---- View functions ----

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return _bounties[bountyId];
    }

    function getFindings(uint256 bountyId) external view returns (Finding[] memory) {
        return _findings[bountyId];
    }

    function getBountyCount() external view returns (uint256) {
        return _bountyCounter;
    }

    // ---- Admin ----

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
