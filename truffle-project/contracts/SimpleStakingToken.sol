// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimpleStakingToken
 * @dev A simple ERC20 token for testing and development purposes
 * This token can be minted by the owner and used as a staking token
 * Automatically mints tokens to users on their first interaction
 */
contract SimpleStakingToken is ERC20, Ownable {
    uint8 private _decimals;
    mapping(address => bool) private hasReceivedInitialTokens;
    uint256 private constant INITIAL_TOKEN_AMOUNT = 10000 * 10 ** 18; // 10,000 tokens in wei

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        _decimals = decimals_;
        _mint(msg.sender, initialSupply * 10 ** decimals_);
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Mints tokens to a specified address (only owner)
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint (in wei)
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev Automatically mints initial tokens to the caller if they haven't received them
     */
    function _mintInitialTokens(address user) private {
        if (!hasReceivedInitialTokens[user]) {
            hasReceivedInitialTokens[user] = true;
            _mint(user, INITIAL_TOKEN_AMOUNT);
            emit InitialTokensMinted(user, INITIAL_TOKEN_AMOUNT);
        }
    }

    /**
     * @dev Burns tokens from the caller's balance
     * @param amount The amount of tokens to burn (in wei)
     */
    function burn(uint256 amount) public {
        _mintInitialTokens(msg.sender); // Mint tokens on first interaction
        _burn(msg.sender, amount);
    }

    /**
     * @dev Burns tokens from a specified address (requires allowance)
     * @param from The address to burn tokens from
     * @param amount The amount of tokens to burn (in wei)
     */
    function burnFrom(address from, uint256 amount) public {
        _mintInitialTokens(msg.sender); // Mint tokens on first interaction
        uint256 currentAllowance = allowance(from, msg.sender);
        require(
            currentAllowance >= amount,
            "ERC20: burn amount exceeds allowance"
        );

        _approve(from, msg.sender, currentAllowance - amount);
        _burn(from, amount);
    }

    /**
     * @dev Overrides ERC20 transfer to include automatic minting
     * @param recipient The address to transfer tokens to
     * @param amount The amount of tokens to transfer (in wei)
     */
    function transfer(
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        _mintInitialTokens(msg.sender); // Mint tokens on first interaction
        return super.transfer(recipient, amount);
    }

    /**
     * @dev Overrides ERC20 transferFrom to include automatic minting
     * @param sender The address to transfer tokens from
     * @param recipient The address to transfer tokens to
     * @param amount The amount of tokens to transfer (in wei)
     */
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        _mintInitialTokens(msg.sender); // Mint tokens on first interaction
        return super.transferFrom(sender, recipient, amount);
    }

    /**
     * @dev Allows the owner to transfer ownership of the contract
     */
    function transferOwnership(
        address newOwner
    ) public virtual override onlyOwner {
        require(
            newOwner != address(0),
            "Ownable: new owner is the zero address"
        );
        _transferOwnership(newOwner);
    }

    /**
     * @dev Emitted when initial tokens are minted to a user
     */
    event InitialTokensMinted(address indexed user, uint256 amount);
}
