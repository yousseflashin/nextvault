/*
 * NexVault Clean Interface Engine
 * Canvas background animations disabled for clean, lightweight simplicity.
 */
(function () {
  'use strict';

  // Safe no-op controller to prevent errors in apps referencing NexVaultFX
  window.NexVaultFX = {
    mountAll: function () {},
    unmountAll: function () {},
    reset: function () {}
  };
})();
