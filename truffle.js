module.exports = {
  compilers: {
    solc: {
      version: 'native',
      settings: {
        optimizer: {
          enabled: true,
          runs: 200
        }
      }
    }
  }
};
