const express = require("express");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = 5000;

let banks = {
  SBI: {
    active: true,
    lastToggled: new Date(),
  },
  "Axis Bank": {
    active: true,
    lastToggled: new Date(),
  },
  "ICICI Bank": {
    active: true,
    lastToggled: new Date(),
  },
};

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Serve the HTML file on root route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// GET route to check bank status
app.get("/api/status", (req, res) => {
  const banksStatus = {};
  for (const [bankName, status] of Object.entries(banks)) {
    banksStatus[bankName] = {
      status: status.active ? "active" : "inactive",
      lastToggled: status.lastToggled,
    };
  }

  res.json({
    banks: banksStatus,
    timestamp: new Date(),
  });
});

// POST route to toggle bank status
app.post("/api/toggle", (req, res) => {
  const { bankName } = req.body;

  if (!bankName || !banks[bankName]) {
    return res.status(400).json({
      error:
        "Invalid bank name. Valid banks are: " + Object.keys(banks).join(", "),
    });
  }

  banks[bankName].active = !banks[bankName].active;
  banks[bankName].lastToggled = new Date();

  console.log(
    `${bankName} status toggled to: ${
      banks[bankName].active ? "ACTIVE" : "INACTIVE"
    } at ${banks[bankName].lastToggled}`
  );

  res.json({
    bankName: bankName,
    status: banks[bankName].active ? "active" : "inactive",
    lastToggled: banks[bankName].lastToggled,
    message: `${bankName} server is now ${
      banks[bankName].active ? "active" : "inactive"
    }`,
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`🏦 Bank Simulator Server running on http://localhost:${PORT}`);
  console.log(`📊 Banks Status:`);
  for (const [bankName, status] of Object.entries(banks)) {
    console.log(`   ${bankName}: ${status.active ? "ACTIVE" : "INACTIVE"}`);
  }
  console.log("🔗 API Endpoints:");
  console.log(`   GET  /api/status - Check all banks status`);
  console.log(
    `   POST /api/toggle - Toggle specific bank status (requires bankName in body)`
  );
});
