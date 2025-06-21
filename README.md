# Project AEGIS - AI Payment Orchestration Agents

This project implements three AI agents for an AI-orchestrated, blockchain-backed payment continuity system. The system ensures successful transactions even during bank server downtimes by leveraging blockchain liquidity pools as a fallback.

## Project Overview

The core idea is to use AI agents to monitor bank services, route transactions appropriately (to bank or blockchain), manage recovery processes, and optimize liquidity pool usage. These agents interact with each other and external systems via Kafka and Redis, and call blockchain functions exposed by a React frontend.

## Agents

There are three main agents in this system:

1.  **Agent 1: Bank Server Monitor (`agent1_bank_monitor`)**
    *   **Function**: Simulates and monitors bank server availability.
    *   **Responsibilities**:
        *   Continuously checks/simulates bank server status (randomly toggles between "up" and "down").
        *   Publishes bank availability to the `bank_server` Kafka topic.
        *   Message format: `{"bank_id": "bank_001", "status": "up/down", "timestamp": "..."}`

2.  **Agent 2: Transaction Router & Recovery Manager (`agent2_transaction_router`)**
    *   **Function**: Routes transactions based on bank status and manages recovery payments. Exposes an API for frontend interaction.
    *   **Core Responsibilities**:
        *   **Transaction Routing**:
            *   Monitors the `transaction_requests` Redis queue.
            *   Checks bank server status from the `bank_server` Kafka topic (published by Agent 1).
            *   If bank is UP: Publishes transaction to `bank_tx_processing` Kafka topic.
            *   If bank is DOWN: Calls `fallbackPayWithCrossPools()` blockchain function via the frontend API.
        *   **Recovery Processing**:
            *   Monitors the `Recovery_payments` Redis queue.
            *   When bank is UP:
                *   Credit card recovery: Publishes to `credit_card_recovery` Kafka topic.
                *   Bank account recovery: Publishes to `bank_recovery` Kafka topic.
                *   Blockchain collateral recovery: Calls `unstakeFromPool()` via the frontend API.
            *   Monitors `recovery_status_update` Kafka topic for completion signals.
        *   **Liquidity Pool & Debt Management (via API)**:
            *   Exposes FastAPI endpoints for the frontend:
                *   `POST /stakeInPool` (params: `poolId`, `amount`)
                *   `POST /createPoolOnChain` (params: `regionName`)
                *   `POST /repayDebt` (params: `poolId`, `amount`)
            *   These API calls trigger corresponding blockchain functions via the frontend API.
    *   **API Port**: Runs on port `8000`.

3.  **Agent 3: Liquidity Pool Optimizer & Payment Monitor (`agent3_liquidity_optimizer`)**
    *   **Function**: Fetches blockchain data for pool optimization and (placeholder) monitors payment confirmations.
    *   **Responsibilities**:
        *   Periodically calls `fetchBlockchainPools()` and `fetchUserData()` via the frontend API to get real-time data.
        *   Includes a basic placeholder for liquidity pool optimization logic.
        *   Includes a basic placeholder for monitoring payment confirmations from bank/blockchain and updating Redis. (This part requires further specification for full implementation).

## Prerequisites

*   **Docker and Docker Compose**: For running the agents in a containerized environment.
*   **Python 3.8+**: If you intend to run agents locally outside Docker.
*   **Access to Kafka and Redis**: The agents require Kafka brokers and a Redis instance. Their addresses must be configured in the `.env` file.
*   **Running Frontend Application**: The agents (especially Agent 2 and 3) interact with blockchain functions via a React frontend. The URL for this frontend's API must be configured in `.env`.

## Setup

1.  **Clone the repository (if applicable)**:
    ```bash
    # git clone <repository_url>
    # cd <repository_directory>
    ```

2.  **Create and Configure Environment File**:
    Copy the example environment file `.env.example` to a new file named `.env`:
    ```bash
    cp .env.example .env
    ```
    Open `.env` and **edit the following variables** to match your environment:
    *   `KAFKA_BROKER_URL`: Address of your Kafka broker (e.g., `localhost:9092`).
    *   `REDIS_HOST`: Hostname of your Redis server (e.g., `localhost`).
    *   `REDIS_PORT`: Port of your Redis server (e.g., `6379`).
    *   `FRONTEND_API_URL`: The base URL for the React frontend's API that exposes blockchain functions (e.g., `http://localhost:3000/api`).
    *   `AGENT3_USER_ADDRESS_TO_MONITOR`: (For Agent 3) An Ethereum address you want Agent 3 to fetch data for.
    *   Other Kafka topics and Redis queue names can be customized if needed, but default values are provided.

## Running the Agents

### Using Docker Compose (Recommended)

This is the easiest way to run all agents together.
Ensure Docker is running and you are in the root directory of the project.

1.  **Build and start the services**:
    ```bash
    docker-compose up --build
    ```
    To run in detached mode:
    ```bash
    docker-compose up --build -d
    ```

2.  **View logs**:
    ```bash
    docker-compose logs -f
    # To view logs for a specific agent:
    # docker-compose logs -f agent1_bank_monitor
    # docker-compose logs -f agent2_transaction_router
    # docker-compose logs -f agent3_liquidity_optimizer
    ```

3.  **Stop the services**:
    ```bash
    docker-compose down
    ```

### Running Agents Individually (Locally, for development)

Ensure you have Python installed and the required libraries from `requirements.txt`.

1.  **Install dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

2.  **Ensure your `.env` file is configured correctly in the root directory.**

3.  **Run each agent in a separate terminal**:
    *   **Agent 1**:
        ```bash
        python agent1/agent.py
        ```
    *   **Agent 2** (FastAPI application):
        ```bash
        # The agent2/agent.py script now directly runs uvicorn if __name__ == '__main__'
        python agent2/agent.py
        # Alternatively, you can run it with uvicorn command for more control:
        # uvicorn agent2.agent:app --host 0.0.0.0 --port 8000 --reload
        ```
    *   **Agent 3**:
        ```bash
        python agent3/agent.py
        ```

## Project Structure

```
.
├── agent1/                     # Bank Server Monitor Agent
│   ├── agent.py
│   └── Dockerfile
├── agent2/                     # Transaction Router & Recovery Manager Agent
│   ├── agent.py
│   └── Dockerfile
├── agent3/                     # Liquidity Pool Optimizer & Payment Monitor Agent
│   ├── agent.py
│   └── Dockerfile
├── .env.example                # Example environment variables
├── docker-compose.yml          # Docker Compose configuration
├── requirements.txt            # Python dependencies
└── README.md                   # This file
```

## Interacting with Agent 2 API

Agent 2 exposes a FastAPI interface on port `8000` (when run via Docker Compose or locally as configured).
Base URL: `http://localhost:8000`

*   **`POST /stakeInPool`**
    *   Body: `{"poolId": "string", "amount": "string"}`
*   **`POST /createPoolOnChain`**
    *   Body: `{"regionName": "string"}`
*   **`POST /repayDebt`**
    *   Body: `{"poolId": "string", "amount": "string"}`
*   **`GET /health`**
    *   Provides health status of Agent 2, including Redis connection and thread status.

Example using `curl`:
```bash
curl -X POST -H "Content-Type: application/json" \
     -d '{"poolId": "0xSomePoolAddress", "amount": "100"}' \
     http://localhost:8000/stakeInPool
```

## Basic Verification

1.  **Agent 1**: Check logs for bank status changes being published. You can use a Kafka consumer tool to listen to the `bank_server` topic.
2.  **Agent 2**:
    *   Check logs for bank status consumption from Agent 1.
    *   Push a test transaction message to the `transaction_requests` Redis queue (e.g., using `redis-cli LPUSH transaction_requests '{"transaction_id": "test001", ...}'`). Observe if Agent 2 processes it based on bank status (routes to Kafka topic or calls fallback API).
    *   Test the API endpoints using `curl` or a tool like Postman. Check Agent 2 logs for API call processing and interaction with the `FRONTEND_API_URL`.
    *   Check the `/health` endpoint.
3.  **Agent 3**: Check logs for periodic fetching of blockchain pool and user data. Verify calls being made to `FRONTEND_API_URL`.

## Important Notes

*   **External Dependencies**: This system relies on external Kafka, Redis, and the React Frontend API being operational and correctly configured in the `.env` file.
*   **Blockchain Interaction**: All blockchain interactions are proxied through the API specified by `FRONTEND_API_URL`. The agents themselves do not directly connect to an Ethereum node.
*   **Error Handling**: Basic error handling is in place. For production, this would need to be significantly enhanced.
*   **Simplicity**: Current AI/optimizer logic in Agent 3 is a placeholder. The focus is on the agent framework and communication.
