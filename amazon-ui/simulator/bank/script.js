class BankSimulator {
    constructor() {
        this.banks = ['SBI', 'Axis Bank', 'ICICI Bank'];
        this.bankStatus = {};

        this.init();
    }

    init() {
        // Initialize status for each bank
        this.banks.forEach(bankName => {
            this.bankStatus[bankName] = false;

            const toggleBtn = document.getElementById(`toggleBtn-${bankName}`);
            if (toggleBtn) {
                toggleBtn.addEventListener('click', () => this.toggleServer(bankName));
            }
        });

        // Check server status on page load
        this.checkServerStatus();
    }

    async toggleServer(bankName) {
        try {
            const response = await fetch('/api/toggle', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ bankName })
            });

            if (response.ok) {
                const data = await response.json();
                this.bankStatus[bankName] = data.status === 'active';
                this.updateBankStatus(bankName);
            }
        } catch (error) {
            console.error(`Error toggling ${bankName} server:`, error);
        }
    }

    async checkServerStatus() {
        try {
            const response = await fetch('/api/status');
            if (response.ok) {
                const data = await response.json();

                for (const [bankName, bankData] of Object.entries(data.banks)) {
                    this.bankStatus[bankName] = bankData.status === 'active';
                    this.updateBankStatus(bankName);
                }
            }
        } catch (error) {
            console.error('Error checking server status:', error);
        }
    }

    updateBankStatus(bankName) {
        const statusLight = document.getElementById(`statusLight-${bankName}`);
        const statusText = document.getElementById(`statusText-${bankName}`);
        const toggleBtn = document.getElementById(`toggleBtn-${bankName}`);

        if (!statusLight || !statusText || !toggleBtn) return;

        const isActive = this.bankStatus[bankName];

        if (isActive) {
            statusLight.classList.add('active');
            statusText.classList.add('active');
            statusText.textContent = 'ACTIVE';
            toggleBtn.textContent = 'Stop Server';
            toggleBtn.classList.add('stop');
        } else {
            statusLight.classList.remove('active');
            statusText.classList.remove('active');
            statusText.textContent = 'INACTIVE';
            toggleBtn.textContent = 'Start Server';
            toggleBtn.classList.remove('stop');
        }
    }
}

// Initialize the simulator when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new BankSimulator();
});
