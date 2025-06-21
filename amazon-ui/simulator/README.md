# Bank Simulator

### Tasks
* Frontend toggles the server active / down
* The server creates the following endpoint: A "Get" request to get the status of the app

### PORT = 5000

### API Endpoints
1. Get the status of all the banks
```
/api/status
```
Example response:
```
{
    "banks": {
        "SBI": {
            "status": "active",
            "lastToggled": "2025-06-14T08:42:39.629Z"
        },
        "Axis Bank": {
            "status": "active",
            "lastToggled": "2025-06-14T08:42:39.629Z"
        },
        "ICICI Bank": {
            "status": "active",
            "lastToggled": "2025-06-14T08:42:39.629Z"
        }
    },
    "timestamp": "2025-06-14T08:42:41.784Z"
}
```
2. Toggle the status of a particular bank
```
/api/toggle
```

---
# User Simulator

### Tasks
* Frontend updates the user information about balance, paymentMode and bank
* The server creates the following endpoint: A "Get" request to get the information about the user

### PORT = 5000

### API Endpoints
1. Get the information of the user
```
/api/user
```
Example response:
```
{
    "user": {
        "name": "Soham Samal",
        "accountBalance": 12000,
        "paymentMode": "UPI",
        "bank": "SBI",
        "lastUpdated": "2025-06-14T10:50:11.724Z"
    },
    "timestamp": "2025-06-14T10:50:14.879Z"
}
```
2. Toggle the status of a particular bank
```
/api/user/update
```
