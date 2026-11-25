/**
 * NextVault Threat Defense & Endpoint Security Ecosystem Engine
 * Modular foundation for antivirus, phishing defense, domain reputation,
 * and system integrity auditing.
 */

const { DomainShield } = require('./domainShield');
const { SecurityEventBus, globalEventBus } = require('./eventBus');
const { IntegrityAuditor } = require('./integrity');

module.exports = {
  DomainShield,
  SecurityEventBus,
  globalEventBus,
  IntegrityAuditor
};
