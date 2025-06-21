module.exports = {
  networks: {
    development: {
      host: "127.0.0.1",
      port: 7545,
      network_id: "*",
      gas: 5500000,
      gasPrice: 20000000000
    }
  },
  compilers: {
    solc: {
      version: "0.8.28",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200
        },
        viaIR: true,
        evmVersion: "london"
      }
    }
  }
};