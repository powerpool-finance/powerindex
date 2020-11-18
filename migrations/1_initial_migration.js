const Migrations = artifacts.require('Migrations');

module.exports = function (deployer, network) {
  if (network === 'test') {
    return;
  }
  deployer.deploy(Migrations);
};
