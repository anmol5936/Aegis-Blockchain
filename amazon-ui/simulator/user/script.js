class UserSimulator {
    constructor() {
        this.initializeElements();
        this.bindEvents();
        this.loadUserData();
    }

    initializeElements() {
        // Form elements
        this.userNameInput = document.getElementById('userName');
        this.accountBalanceInput = document.getElementById('accountBalance');
        this.paymentModeSelect = document.getElementById('paymentMode');
        this.bankSelect = document.getElementById('bankSelect');
        this.updateBtn = document.getElementById('updateBtn');

        // Display elements
        this.displayName = document.getElementById('displayName');
        this.displayBalance = document.getElementById('displayBalance');
        this.displayPaymentMode = document.getElementById('displayPaymentMode');
        this.displayBank = document.getElementById('displayBank');
        this.displayLastUpdated = document.getElementById('displayLastUpdated');
    }

    bindEvents() {
        this.updateBtn.addEventListener('click', () => this.updateUserData());

        // Add enter key support for form fields
        [this.userNameInput, this.accountBalanceInput].forEach(input => {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.updateUserData();
                }
            });
        });
    }

    async loadUserData() {
        try {
            const response = await fetch('/api/user');
            if (response.ok) {
                const data = await response.json();
                this.populateForm(data.user);
                this.updateDisplay(data.user);
            }
        } catch (error) {
            console.error('Error loading user data:', error);
            this.showMessage('Error loading user data', 'error');
        }
    }

    populateForm(userData) {
        this.userNameInput.value = userData.name || '';
        this.accountBalanceInput.value = userData.accountBalance || 0;
        this.paymentModeSelect.value = userData.paymentMode || 'UPI';
        this.bankSelect.value = userData.bank || 'SBI';
    }

    updateDisplay(userData) {
        this.displayName.textContent = userData.name || '-';
        this.displayBalance.textContent = userData.accountBalance ?
            `₹{userData.accountBalance.toLocaleString()}` : '-';
        this.displayPaymentMode.textContent = userData.paymentMode || '-';
        this.displayBank.textContent = userData.bank || '-';
        this.displayLastUpdated.textContent = userData.lastUpdated ?
            new Date(userData.lastUpdated).toLocaleString() : '-';
    }

    async updateUserData() {
        const userData = {
            name: this.userNameInput.value.trim(),
            accountBalance: parseFloat(this.accountBalanceInput.value) || 0,
            paymentMode: this.paymentModeSelect.value,
            bank: this.bankSelect.value
        };

        // Basic validation
        if (!userData.name) {
            this.showMessage('Please enter a valid name', 'error');
            return;
        }

        if (userData.accountBalance < 0) {
            this.showMessage('Account balance cannot be negative', 'error');
            return;
        }

        try {
            this.updateBtn.disabled = true;
            this.updateBtn.textContent = 'Updating...';

            const response = await fetch('/api/user/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(userData)
            });

            const data = await response.json();

            if (response.ok) {
                this.updateDisplay(data.user);
                this.showMessage('User data updated successfully!', 'success');
            } else {
                this.showMessage(data.error || 'Error updating user data', 'error');
            }
        } catch (error) {
            console.error('Error updating user data:', error);
            this.showMessage('Error updating user data', 'error');
        } finally {
            this.updateBtn.disabled = false;
            this.updateBtn.textContent = 'Update User Data';
        }
    }

    showMessage(message, type) {
        // Remove existing message
        const existingMessage = document.querySelector('.message');
        if (existingMessage) {
            existingMessage.remove();
        }

        // Create new message
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}`;
        messageEl.textContent = message;

        // Insert message
        const container = document.querySelector('.container');
        container.insertBefore(messageEl, container.firstChild);

        // Remove message after 3 seconds
        setTimeout(() => {
            if (messageEl.parentNode) {
                messageEl.remove();
            }
        }, 3000);
    }
}

// Initialize the simulator when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new UserSimulator();
});
