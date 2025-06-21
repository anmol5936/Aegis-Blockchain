const express = require('express');
const path = require('path');

const app = express();
const PORT = 5010;

// User data state
let userData = {
    name: 'Astatine',
    accountBalance: 10000,
    paymentMode: 'UPI',
    bank: 'SBI',
    lastUpdated: new Date() 
};

// Available options
const availableBanks = ['SBI', 'Axis Bank', 'ICICI Bank'];
const availablePaymentModes = ['UPI', 'Credit Card'];

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Serve the HTML file on root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// GET route to get user information
app.get('/api/user', (req, res) => {
    res.json({
        user: userData,
        // availableOptions: {
        //     banks: availableBanks,
        //     paymentModes: availablePaymentModes
        // },
        timestamp: new Date()
    });
});

// POST route to update user information
app.post('/api/user/update', (req, res) => {
    const { name, accountBalance, paymentMode, bank } = req.body;

    // Validate inputs
    if (name !== undefined) {
        if (typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Name must be a non-empty string' });
        }
        userData.name = name.trim();
    }

    if (accountBalance !== undefined) {
        const balance = parseFloat(accountBalance);
        if (isNaN(balance) || balance < 0) {
            return res.status(400).json({ error: 'Account balance must be a non-negative number' });
        }
        userData.accountBalance = balance;
    }

    if (paymentMode !== undefined) {
        if (!availablePaymentModes.includes(paymentMode)) {
            return res.status(400).json({
                error: `Payment mode must be one of: ${availablePaymentModes.join(', ')}`
            });
        }
        userData.paymentMode = paymentMode;
    }

    if (bank !== undefined) {
        if (!availableBanks.includes(bank)) {
            return res.status(400).json({
                error: `Bank must be one of: ${availableBanks.join(', ')}`
            });
        }
        userData.bank = bank;
    }

    userData.lastUpdated = new Date();

    console.log(`User data updated:`, userData);

    res.json({
        message: 'User data updated successfully',
        user: userData,
        timestamp: new Date()
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`👤 User Simulator Server running on http://localhost:${PORT}`);
    console.log(`📊 Current User Data:`);
    console.log(`   Name: ${userData.name}`);
    console.log(`   Balance: $${userData.accountBalance.toLocaleString()}`);
    console.log(`   Payment Mode: ${userData.paymentMode}`);
    console.log(`   Bank: ${userData.bank}`);
    console.log('🔗 API Endpoints:');
    console.log(`   GET  /api/user - Get user information`);
    console.log(`   POST /api/user/update - Update user information`);
});
