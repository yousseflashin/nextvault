    let currentAuthTab = 'unlock';
    let activePage = 'vault';
    let cachedVaultEntries = [];
    let cachedOTPEntries = [];
    let otpTimer = null;
    let latestUpdateInfo = null;
    let currentPendingPairPeerId = null;

    function $(id) { return document.getElementById(id); }

    function log(msg, el = $('security-log')) {
      if (!el) return;
      el.textContent += '\n>> ' + msg;
      el.scrollTop = el.scrollHeight;
    }

    function gridLog(msg) { log(msg, $('grid-log')); }
    function setStatus(txt) {
      if ($('status-text')) $('status-text').textContent = txt;
      if ($('auth-status')) $('auth-status').textContent = txt;
    }

    // Page Navigation
    const PAGE_METADATA = {
      vault: { title: 'Vault Credentials', subtitle: 'Manage stored logins and credentials' },
      otp: { title: 'Authenticator', subtitle: 'Two-factor TOTP codes and secrets' },
      grid: { title: 'NexGrid Sync', subtitle: 'Peer-to-peer sync and trusted devices' },
      security: { title: 'Security & Integrity', subtitle: 'Cryptographic checks and tamper diagnostics' },
      settings: { title: 'Settings', subtitle: 'Vault identity, updates, and configuration' }
    };

    function navigateTo(pageId) {
      activePage = pageId;
      document.querySelectorAll('.app-page').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

      const targetPage = $(`page-${pageId}`);
      if (targetPage) targetPage.classList.add('active');

      const targetNav = document.querySelector(`.nav-item[data-page="${pageId}"]`);
      if (targetNav) targetNav.classList.add('active');

      const meta = PAGE_METADATA[pageId] || { title: pageId, subtitle: '' };
      $('page-header-title').textContent = meta.title;
      $('page-header-subtitle').textContent = meta.subtitle;

      if (pageId === 'vault') listPasswords();
      if (pageId === 'otp') listOTPs();
      if (pageId === 'grid') {
        loadTrustedDevicesUI();
        if (typeof desktopMeshVisualizer !== 'undefined') {
          setTimeout(() => desktopMeshVisualizer.resize(), 50);
        }
      }
    }

    // Auth Tab switching
    function switchAuthTab(tab) {
      currentAuthTab = tab;
      document.querySelectorAll('#auth-tabs .nv-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
      });
      document.querySelectorAll('#auth-container .nv-tab-content').forEach(c => {
        c.classList.remove('active');
      });
      $(`tab-${tab}`).classList.add('active');
    }

    function toggleTokenView() {
      const container = $('token-container');
      const btn = $('toggle-token-btn');
      if (!container) return;
      const isHidden = container.style.display === 'none';
      container.style.display = isHidden ? 'block' : 'none';
      if (btn) btn.textContent = isHidden ? 'Hide Token' : 'Token JSON';
    }

    // Copy a secret and clear the clipboard after 30s if it still holds that value
    async function copySecret(value) {
      await navigator.clipboard.writeText(value);
      setTimeout(async () => {
        try {
          if ((await navigator.clipboard.readText()) === value) await navigator.clipboard.writeText('');
        } catch (e) {}
      }, 30000);
    }

    // Configurable Auto-Lock
    function getAutoLockMinutes() {
      const v = localStorage.getItem('nexvault_autolock_minutes');
      if (v === 'never') return 'never';
      const num = Number(v);
      return isNaN(num) || num <= 0 ? 5 : num;
    }

    function changeAutoLockSetting(val) {
      localStorage.setItem('nexvault_autolock_minutes', val);
      const badge = $('autolock-current-badge');
      if (badge) {
        badge.textContent = val === 'never' ? 'Disabled' : `${val} Minutes`;
        badge.className = val === 'never' ? 'nv-badge' : 'nv-badge success';
      }
      setStatus('Auto-lock set to: ' + (val === 'never' ? 'Disabled' : `${val} Minutes`));
    }

    function initAutoLockUI() {
      const sel = $('setting-autolock-select');
      const current = getAutoLockMinutes();
      if (sel) sel.value = String(current);
      const badge = $('autolock-current-badge');
      if (badge) {
        badge.textContent = current === 'never' ? 'Disabled' : `${current} Minutes`;
        badge.className = current === 'never' ? 'nv-badge' : 'nv-badge success';
      }
    }

    // Auto-lock setup with dynamic timeout
    (function setupAutoLock() {
      let last = Date.now();
      ['mousemove', 'keydown', 'click'].forEach(ev => window.addEventListener(ev, () => { last = Date.now(); }, { passive: true }));
      setInterval(() => {
        const ws = document.getElementById('main-workspace');
        if (ws && ws.style.display !== 'none') {
          const minutes = getAutoLockMinutes();
          if (minutes !== 'never' && typeof minutes === 'number') {
            if (Date.now() - last > minutes * 60 * 1000) lockVault();
          }
        }
      }, 10000);
    })();

    // Lock Vault
    function lockVault() {
      try { window.nexVault.lockVault(); } catch (e) {}
      $('main-workspace').style.display = 'none';
      $('auth-container').style.display = 'flex';
      $('existing-password').value = '';
      setStatus('Vault locked');
    }

    // Authentication Handlers
    async function handleNewUser() {
      const u = $('new-username').value.trim();
      const p = $('new-password').value;
      if (!u || !p) return setStatus('Enter username and password');
      setStatus('Generating keys...');
      try {
        const r = await window.nexVault.initializeNewUser(u, p);
        if (!r.success) throw new Error(r.error);
        setStatus('Identity created: ' + r.tokenId);
        $('existing-token').value = JSON.stringify(r.bootstrapToken, null, 2);
        $('settings-token-display').value = JSON.stringify(r.bootstrapToken, null, 2);
        $('sidebar-user').textContent = u;
        switchAuthTab('unlock');
        $('existing-password').value = p;
        await handleExistingUser();
      } catch (e) { setStatus('Error: ' + e.message); }
    }

    async function handleExistingUser() {
      const raw = $('existing-token').value.trim();
      const p = $('existing-password').value;
      if (!raw || !p) return setStatus('Enter token and password');
      setStatus('Validating token...');
      try {
        const t = JSON.parse(raw);
        const r = await window.nexVault.initializeExistingUser(t.tokenId, t.publicKey, t.signature, p, t.expiresAt);
        if (!r.success) throw new Error(r.error);
        setStatus('Unlocked: ' + r.tokenId);
        $('settings-token-display').value = JSON.stringify(t, null, 2);
        $('sidebar-user').textContent = r.tokenId ? (r.tokenId.slice(0, 12) + '...') : 'Vault';
        showWorkspace();
      } catch (e) { setStatus('Error: ' + e.message); }
    }

    let securityStatusTimer = null;

    function showWorkspace() {
      $('auth-container').style.display = 'none';
      $('main-workspace').style.display = 'flex';
      navigateTo('vault');
      initAutoLockUI();
      refreshSecurityStatus();
      if (!securityStatusTimer) {
        securityStatusTimer = setInterval(refreshSecurityStatus, 10000);
      }
      listPasswords();
      listOTPs();
      loadTrustedDevicesUI();
      setTimeout(() => startGrid(), 300);
    }

    function copyTokenFromSettings() {
      const t = $('settings-token-display').value;
      if (!t) return;
      navigator.clipboard.writeText(t);
      setStatus('Token copied to clipboard');
    }

    // Vault Credentials Management
    let editingVaultService = null;

    function openCredentialModal(service = null) {
      editingVaultService = service;
      const modal = $('credential-modal');
      if (!modal) return;
      if (service) {
        if ($('credential-modal-title')) $('credential-modal-title').textContent = 'Edit Credential';
        if ($('save-cred-btn')) $('save-cred-btn').textContent = 'Update Credential';
      } else {
        if ($('credential-modal-title')) $('credential-modal-title').textContent = 'New Credential';
        if ($('save-cred-btn')) $('save-cred-btn').textContent = 'Save Credential';
        $('service').value = '';
        $('vault-username').value = '';
        $('vault-password').value = '';
        updatePasswordStrengthMeter('');
      }
      modal.style.display = 'flex';
      setTimeout(() => {
        if (service) $('vault-password')?.focus();
        else $('service')?.focus();
      }, 50);
    }

    function closeCredentialModal() {
      const modal = $('credential-modal');
      if (modal) modal.style.display = 'none';
      editingVaultService = null;
    }

    function toggleAddCredentialForm() {
      openCredentialModal(null);
    }

    function togglePasswordVisibility(inputId, btnEl) {
      const inp = $(inputId);
      if (!inp) return;
      if (inp.type === 'password') {
        inp.type = 'text';
        if (btnEl) btnEl.textContent = '🔒';
      } else {
        inp.type = 'password';
        if (btnEl) btnEl.textContent = '👁';
      }
    }

    function updatePasswordStrengthMeter(pass) {
      let score = 0;
      if (pass) {
        if (pass.length >= 8) score++;
        if (pass.length >= 14) score++;
        if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score++;
        if (/[0-9]/.test(pass) && /[^A-Za-z0-9]/.test(pass)) score++;
      }
      const bars = [$('str-bar-1'), $('str-bar-2'), $('str-bar-3'), $('str-bar-4')];
      const label = $('str-label');
      bars.forEach((b, idx) => {
        if (!b) return;
        b.className = 'nv-strength-bar';
        if (idx < score) {
          if (score === 1) b.classList.add('weak');
          else if (score === 2) b.classList.add('fair');
          else if (score === 3) b.classList.add('good');
          else b.classList.add('strong');
        }
      });
      if (label) {
        if (!pass) label.textContent = 'Enter password';
        else if (score === 1) label.textContent = 'Weak';
        else if (score === 2) label.textContent = 'Fair';
        else if (score === 3) label.textContent = 'Good';
        else label.textContent = 'Strong (Excellent entropy)';
      }
    }

    async function editPassword(service) {
      try {
        const r = await window.nexVault.getPassword(service);
        if (!r.success) throw new Error(r.error || 'Credential not found');
        openCredentialModal(service);
        $('service').value = service;
        $('vault-username').value = r.username || '';
        $('vault-password').value = r.password || '';
        updatePasswordStrengthMeter(r.password || '');
      } catch (e) {
        setStatus('Error: ' + e.message);
      }
    }

    function generateRandomPassword() {
      const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_+=';
      let res = '';
      const array = new Uint32Array(20);
      window.crypto.getRandomValues(array);
      for (let i = 0; i < 20; i++) res += chars[array[i] % chars.length];
      $('vault-password').value = res;
      updatePasswordStrengthMeter(res);
    }

    async function savePassword() {
      const s = $('service').value.trim();
      const u = $('vault-username').value.trim();
      const p = $('vault-password').value;
      if (!s || !p) return setStatus('Enter service and password');
      try {
        const r = await window.nexVault.addPassword(s, p, u);
        if (r.success) {
          if (editingVaultService && editingVaultService !== s) {
            await window.nexVault.deletePassword(editingVaultService);
          }
          setStatus(editingVaultService ? 'Credential updated' : 'Credential saved');
          closeCredentialModal();
          listPasswords();
        } else throw new Error(r.error);
      } catch (e) { setStatus('Error: ' + e.message); }
    }

    let desktopActiveCategory = 'all';
    function setDesktopCategory(cat) {
      desktopActiveCategory = cat;
      ['all', 'logins', '2fa'].forEach(c => {
        const el = $('desk-cat-' + c);
        if (el) {
          if (c === cat) el.classList.add('active');
          else el.classList.remove('active');
        }
      });
      if (cat === '2fa') {
        navigateTo('otp');
      } else {
        navigateTo('vault');
        filterVaultEntries();
      }
    }

    async function listPasswords() {
      try {
        const r = await window.nexVault.listPasswords();
        cachedVaultEntries = r.entries || [];
        if ($('count-all-desk')) $('count-all-desk').textContent = cachedVaultEntries.length;
        if ($('count-logins-desk')) $('count-logins-desk').textContent = cachedVaultEntries.length;
        try {
          const otpRes = await window.nexVault.listOTPs?.();
          if ($('count-2fa-desk')) $('count-2fa-desk').textContent = otpRes?.entries?.length || otpRes?.otps?.length || 0;
          if ($('count-all-desk')) $('count-all-desk').textContent = cachedVaultEntries.length + (otpRes?.entries?.length || otpRes?.otps?.length || 0);
        } catch {}
        filterVaultEntries();
      } catch (e) { setStatus('Error: ' + e.message); }
    }

    function filterVaultEntries() {
      const q = ($('vault-search-input')?.value || '').toLowerCase().trim();
      const filterType = $('vault-filter-select')?.value || 'all';
      const sortType = $('vault-sort-select')?.value || 'date-desc';
      const groupMode = $('vault-group-select')?.value || 'none';

      let filtered = cachedVaultEntries.filter(e => {
        if (q) {
          const match = (e.service && e.service.toLowerCase().includes(q)) ||
                        (e.username && e.username.toLowerCase().includes(q));
          if (!match) return false;
        }
        if (filterType === 'has-user' && !e.username) return false;
        if (filterType === 'no-user' && e.username) return false;
        return true;
      });

      filtered.sort((a, b) => {
        if (sortType === 'name-asc') return (a.service || '').localeCompare(b.service || '');
        if (sortType === 'name-desc') return (b.service || '').localeCompare(a.service || '');
        if (sortType === 'user-asc') return (a.username || '').localeCompare(b.username || '');
        if (sortType === 'date-asc') return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });

      const countBadge = $('vault-count-badge');
      if (countBadge) {
        countBadge.textContent = `${filtered.length} of ${cachedVaultEntries.length} items`;
      }

      renderVaultList(filtered, groupMode);
    }

    function toggleGroupAccordion(headerEl) {
      const card = headerEl.closest('.nv-group-card');
      if (card) {
        card.classList.toggle('collapsed');
      }
    }

    function renderVaultItemHtml(e) {
      const initial = (e.service.charAt(0) || 'V').toUpperCase();
      const encService = encodeURIComponent(e.service);
      const encUser = e.username ? encodeURIComponent(e.username) : '';
      return `
        <div class="vault-item">
          <div style="display: flex; align-items: center; gap: 0.85rem; flex: 1; min-width: 0;">
            <div class="nv-avatar-monogram">${escapeHtml(initial)}</div>
            <div class="vault-item-info" style="min-width: 0;">
              <div class="vault-service" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(e.service)}</div>
              <div class="vault-meta">
                ${e.username ? `<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">👤 ${escapeHtml(e.username)}</span>` : '<span style="color: var(--nv-muted);">No username</span>'}
                <span class="nv-muted">•</span>
                <span>${new Date(e.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
          <div class="vault-actions">
            <button class="nv-btn nv-btn-sm" id="btn-pass-${encService}" onclick="copyPassword(decodeURIComponent('${encService}'))" title="Copy password">
              ⚡ Pass
            </button>
            ${e.username ? `
              <button class="nv-btn nv-btn-ghost nv-btn-sm" id="btn-user-${encUser}" onclick="copyUsername(decodeURIComponent('${encUser}'))" title="Copy username">
                👤 User
              </button>
            ` : ''}
            <button class="nv-btn-icon" onclick="editPassword(decodeURIComponent('${encService}'))" title="Edit credential">
              ✏️
            </button>
            <button class="nv-btn-icon" style="color: var(--nv-danger);" onclick="deletePassword(decodeURIComponent('${encService}'))" title="Delete credential">
              🗑
            </button>
          </div>
        </div>
      `;
    }

    function renderVaultList(entries, groupMode = 'none') {
      const el = $('vault-list');
      if (!entries.length) {
        el.innerHTML = '<div class="nv-empty">No credentials found matching filter.</div>';
        return;
      }

      if (groupMode === 'none') {
        el.innerHTML = entries.map(renderVaultItemHtml).join('');
        return;
      }

      const groups = new Map();
      entries.forEach(e => {
        let key = '';
        let label = '';
        if (groupMode === 'site') {
          key = (e.service || 'unknown').toLowerCase().trim();
          label = e.service || 'Unknown Site';
        } else if (groupMode === 'account') {
          key = (e.username || '').toLowerCase().trim() || '__empty__';
          label = e.username ? `👤 ${e.username}` : '(No Username Specified)';
        } else if (groupMode === 'letter') {
          const firstChar = (e.service || '').charAt(0).toUpperCase();
          key = /^[A-Z]$/.test(firstChar) ? firstChar : '#';
          label = key === '#' ? '# (Symbols & Numbers)' : `Letter ${key}`;
        }
        if (!groups.has(key)) {
          groups.set(key, { label, items: [] });
        }
        groups.get(key).items.push(e);
      });

      const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
        if (a === '__empty__') return 1;
        if (b === '__empty__') return -1;
        return a.localeCompare(b);
      });

      el.innerHTML = sortedKeys.map(k => {
        const grp = groups.get(k);
        const count = grp.items.length;
        const countText = count === 1 ? '1 credential' : `${count} credentials`;
        return `
          <div class="nv-group-card">
            <div class="nv-group-header" onclick="toggleGroupAccordion(this)" title="Click to collapse / expand">
              <div class="nv-group-title">
                <span class="nv-group-chevron">▼</span>
                <span>📁</span>
                <span>${escapeHtml(grp.label)}</span>
              </div>
              <span class="nv-badge" style="font-size: 0.68rem;">${countText}</span>
            </div>
            <div class="nv-group-items">
              ${grp.items.map(renderVaultItemHtml).join('')}
            </div>
          </div>
        `;
      }).join('');
    }

    async function copyUsername(user) {
      try {
        await navigator.clipboard.writeText(user);
        setStatus('Username copied');
        const b = document.getElementById(`btn-user-${encodeURIComponent(user)}`);
        if (b) {
          const old = b.textContent;
          b.textContent = '✓ Copied';
          b.style.color = 'var(--nv-primary)';
          setTimeout(() => { b.textContent = old; b.style.color = ''; }, 1600);
        }
      } catch (e) { setStatus('Error: ' + e.message); }
    }

    async function copyPassword(service) {
      try {
        const r = await window.nexVault.getPassword(service);
        if (r.success) {
          await copySecret(r.password);
          setStatus('Password copied for ' + service);
          const b = document.getElementById(`btn-pass-${encodeURIComponent(service)}`);
          if (b) {
            const old = b.textContent;
            b.textContent = '✓ Copied';
            b.style.color = 'var(--nv-primary)';
            setTimeout(() => { b.textContent = old; b.style.color = ''; }, 1600);
          }
        } else throw new Error(r.error);
      } catch (e) { setStatus('Error: ' + e.message); }
    }

    async function deletePassword(service) {
      if (!confirm('Delete credential for ' + service + '?')) return;
      try {
        const r = await window.nexVault.deletePassword(service);
        if (r.success) {
          setStatus('Deleted ' + service);
          listPasswords();
        } else throw new Error(r.error);
      } catch (e) { setStatus('Error: ' + e.message); }
    }

    async function deleteAllPasswords() {
      if (!confirm('Are you sure you want to delete ALL passwords? This will delete them across all connected devices in the mesh.')) return;
      try {
        const r = await window.nexVault.deleteAllPasswords();
        if (r.success) {
          setStatus(`Deleted ${r.count || 0} passwords from vault.`);
          gridLog(`Deleted ${r.count || 0} passwords and synchronized across mesh.`);
          listPasswords();
        } else throw new Error(r.error);
      } catch (e) { setStatus('Error: ' + e.message); }
    }

    // Authenticator (TOTP) Management
    let editingOtpService = null;

    function renderCircularTimer(seconds, period = 30, size = 26) {
      const radius = 10;
      const stroke = 2.4;
      const normalizedRadius = radius - stroke * 0.5;
      const circumference = normalizedRadius * 2 * Math.PI;
      const strokeDashoffset = circumference - (seconds / period) * circumference;
      const isUrgent = seconds <= 5;
      const strokeColor = isUrgent ? '#ef4444' : '#10b981';

      return `
        <div style="position: relative; width: ${size}px; height: ${size}px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;">
          <svg height="${size}" width="${size}" style="transform: rotate(-90deg); display: block;">
            <circle
              stroke="rgba(255, 255, 255, 0.12)"
              fill="transparent"
              stroke-width="${stroke}"
              r="${normalizedRadius}"
              cx="${size / 2}"
              cy="${size / 2}"
            />
            <circle
              stroke="${strokeColor}"
              fill="transparent"
              stroke-width="${stroke}"
              stroke-dasharray="${circumference} ${circumference}"
              style="stroke-dashoffset: ${strokeDashoffset}; transition: stroke-dashoffset 0.85s linear, stroke 0.3s ease;"
              stroke-linecap="round"
              r="${normalizedRadius}"
              cx="${size / 2}"
              cy="${size / 2}"
            />
          </svg>
          <span style="position: absolute; font-size: ${Math.round(size * 0.38)}px; font-weight: 700; font-family: var(--nv-font-mono); color: ${strokeColor}; line-height: 1;">
            ${seconds}
          </span>
        </div>
      `;
    }

    function openOtpModal(service = null) {
      editingOtpService = service;
      const modal = $('otp-modal');
      if (!modal) return;
      if (service) {
        if ($('otp-modal-title')) $('otp-modal-title').textContent = 'Edit Authenticator';
        if ($('save-otp-btn')) $('save-otp-btn').textContent = 'Update TOTP';
      } else {
        if ($('otp-modal-title')) $('otp-modal-title').textContent = 'Add TOTP Service';
        if ($('save-otp-btn')) $('save-otp-btn').textContent = 'Save TOTP';
        $('otp-service').value = '';
        $('otp-secret').value = '';
      }
      modal.style.display = 'flex';
      setTimeout(() => {
        if (service) $('otp-secret')?.focus();
        else $('otp-service')?.focus();
      }, 50);
    }

    function closeOtpModal() {
      const modal = $('otp-modal');
      if (modal) modal.style.display = 'none';
      editingOtpService = null;
    }

    function toggleAddOtpForm() {
      openOtpModal(null);
    }

    async function editOTP(service) {
      try {
        const r = await window.nexVault.getOTPDetails(service);
        if (!r.success) throw new Error(r.error || 'Authenticator not found');
        openOtpModal(service);
        $('otp-service').value = r.service || service;
        $('otp-secret').value = r.secret || '';
      } catch (e) {
        setStatus('Error: ' + e.message);
      }
    }

    async function saveOTP() {
      const s = $('otp-service').value.trim();
      const sec = $('otp-secret').value.trim().toUpperCase().replace(/\s/g, '');
      if (!s || !sec) return setStatus('Enter service and secret key');
      try {
        const r = await window.nexVault.addOTP(s, sec);
        if (r.success) {
          if (editingOtpService && editingOtpService !== s) {
            await window.nexVault.deleteOTP(editingOtpService);
          }
          setStatus(editingOtpService ? 'Authenticator updated' : 'Authenticator added');
          closeOtpModal();
          listOTPs();
        } else throw new Error(r.error);
      } catch (e) { setStatus('Error: ' + e.message); }
    }

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('vault-search-input')?.focus();
      }
      if (e.key === 'Escape') {
        closeCredentialModal();
        closeOtpModal();
        if (typeof closeBulkImportModal === 'function') closeBulkImportModal();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const credModal = $('credential-modal');
        if (credModal && credModal.style.display !== 'none') {
          savePassword();
        }
        const otpModal = $('otp-modal');
        if (otpModal && otpModal.style.display !== 'none') {
          saveOTP();
        }
      }
    });

    async function listOTPs() {
      try {
        const r = await window.nexVault.listOTPs();
        cachedOTPEntries = r.entries || [];
        filterOTPEntries();
        if (!otpTimer) {
          otpTimer = setInterval(updateOTPCountdowns, 1000);
          updateOTPCountdowns();
        }
      } catch (e) { setStatus('Error: ' + e.message); }
    }

    function filterOTPEntries() {
      const q = ($('otp-search-input')?.value || '').toLowerCase().trim();
      const sortType = $('otp-sort-select')?.value || 'name-asc';
      let filtered = cachedOTPEntries.filter(e => {
        if (!q) return true;
        return (e.service && e.service.toLowerCase().includes(q)) ||
               (e.otpType && e.otpType.toLowerCase().includes(q));
      });

      filtered.sort((a, b) => {
        if (sortType === 'name-desc') return (b.service || '').localeCompare(a.service || '');
        return (a.service || '').localeCompare(b.service || '');
      });

      const countBadge = $('otp-count-badge');
      if (countBadge) {
        countBadge.textContent = `${filtered.length} of ${cachedOTPEntries.length} items`;
      }

      renderOTPList(filtered);
    }

    function renderOTPList(entries = null) {
      const el = $('otp-list');
      const list = entries !== null ? entries : (function() {
        const q = ($('otp-search-input')?.value || '').toLowerCase().trim();
        if (!q) return cachedOTPEntries;
        return cachedOTPEntries.filter(e => (e.service && e.service.toLowerCase().includes(q)) || (e.otpType && e.otpType.toLowerCase().includes(q)));
      })();

      if (!list.length) {
        el.innerHTML = '<div class="nv-empty">No TOTP entries found.</div>';
        return;
      }
      const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
      el.innerHTML = list.map(e => {
        const cleanCode = (e.code || '').replace(/\s+/g, '');
        const displayCode = cleanCode.length === 6 ? `${cleanCode.slice(0, 3)} ${cleanCode.slice(3)}` : (e.code || '------');
        const safeService = escapeHtml(e.service);
        const encService = encodeURIComponent(e.service);
        return `
          <div class="vault-item" style="cursor: pointer;" onclick="copyOTP(decodeURIComponent('${encService}'))">
            <div style="display: flex; align-items: center; gap: 0.85rem; flex: 1; min-width: 0;">
              <div class="nv-avatar-monogram" style="background: linear-gradient(135deg, rgba(14, 165, 233, 0.25), rgba(16, 185, 129, 0.25)); border-color: rgba(14, 165, 233, 0.35);">
                ${escapeHtml((e.service.charAt(0) || '2').toUpperCase())}
              </div>
              <div class="vault-item-info">
                <div class="vault-service">${safeService}</div>
                <div style="display: flex; align-items: center; gap: 0.75rem; margin-top: 0.25rem;">
                  <span style="font-size: 1.35rem; font-weight: 700; font-family: var(--nv-font-mono); color: var(--nv-primary); letter-spacing: 2.5px;" id="otp-code-${encService}">
                    ${displayCode}
                  </span>
                  <div class="otp-timer-slot">${renderCircularTimer(remaining, 30, 24)}</div>
                </div>
              </div>
            </div>
            <div class="vault-actions" onclick="event.stopPropagation()">
              <button class="nv-btn nv-btn-accent nv-btn-sm" id="btn-otp-${encService}" onclick="copyOTP(decodeURIComponent('${encService}'))">Copy Code</button>
              <button class="nv-btn nv-btn-ghost nv-btn-sm" onclick="editOTP(decodeURIComponent('${encService}'))">Edit</button>
              <button class="nv-btn nv-btn-ghost nv-btn-sm" style="color: var(--nv-danger);" onclick="deleteOTP(decodeURIComponent('${encService}'))">Delete</button>
            </div>
          </div>
        `;
      }).join('');
    }

    function updateOTPCountdowns() {
      const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
      if ($('otp-timer-badge')) $('otp-timer-badge').textContent = `Auto-refresh: ${remaining}s`;
      if ($('otp-circular-timer-wrap')) {
        $('otp-circular-timer-wrap').innerHTML = renderCircularTimer(remaining, 30, 26);
      }
      document.querySelectorAll('.otp-timer-slot').forEach(el => {
        el.innerHTML = renderCircularTimer(remaining, 30, 24);
      });
      if (remaining === 30) {
        listOTPs();
      }
    }

    async function copyOTP(service) {
      try {
        const r = await window.nexVault.getOTP(service);
        if (r.success) {
          await copySecret(r.code);
          setStatus('Copied OTP: ' + r.code);
          const b = document.getElementById(`btn-otp-${encodeURIComponent(service)}`);
          if (b) {
            const old = b.textContent;
            b.textContent = '✓ Copied';
            setTimeout(() => { b.textContent = old; }, 1600);
          }
        } else throw new Error(r.error);
      } catch (e) { setStatus('Error: ' + e.message); }
    }

    async function deleteOTP(service) {
      if (!confirm('Delete TOTP for ' + service + '?')) return;
      try {
        const r = await window.nexVault.deleteOTP(service);
        if (r.success) {
          setStatus('Deleted TOTP ' + service);
          listOTPs();
        } else throw new Error(r.error);
      } catch (e) { setStatus('Error: ' + e.message); }
    }

    async function deleteAllOTPs() {
      if (!confirm('Are you sure you want to delete ALL 2FA authenticators? This will delete them across all connected devices in the mesh.')) return;
      try {
        const r = await window.nexVault.deleteAllOTPs();
        if (r.success) {
          setStatus(`Deleted ${r.count || 0} authenticators from vault.`);
          gridLog(`Deleted ${r.count || 0} authenticators and synchronized across mesh.`);
          listOTPs();
        } else throw new Error(r.error);
      } catch (e) { setStatus('Error: ' + e.message); }
    }

    async function deleteAllVault() {
      if (!confirm('Are you sure you want to delete ALL passwords and 2FA authenticators? This will permanently wipe all credentials from this vault and all mesh devices.')) return;
      try {
        const r = await window.nexVault.deleteAllVault();
        if (r.success) {
          setStatus(`Deleted all ${r.totalCount || 0} vault items.`);
          gridLog(`Wiped ${r.totalCount || 0} vault items across mesh.`);
          listPasswords();
          listOTPs();
        } else throw new Error(r.error);
      } catch (e) { setStatus('Error: ' + e.message); }
    }

    // NexGrid & P2P Synchronization
    async function startGrid() {
      gridLog('Starting NexGrid...');
      try {
        const relayUrl = $('grid-relay-url').value.trim();
        if (relayUrl) {
          localStorage.setItem('nexvault_relay_url', relayUrl);
          if (window.nexVault?.setRelayUrl) await window.nexVault.setRelayUrl(relayUrl);
        }
        const r = await window.nexVault.startNexGrid(relayUrl);
        if (r.success) {
          $('grid-badge').innerHTML = '<span class="dot"></span>connected';
          $('grid-status-pill').textContent = 'Connected';
          gridLog('NexGrid connected to ' + (r.relayUrl || relayUrl));
          if (r.peers && r.peers.length) {
            gridLog('Active peers: ' + r.peers.map(p => p.deviceName || p.deviceId).join(', '));
          }
        } else {
          gridLog('Error: ' + r.error);
        }
      } catch (e) { gridLog('Exception: ' + e.message); }
    }

    async function pairWithPeerCode() {
      const code = $('grid-peer-code')?.value.trim();
      if (!code) return gridLog('Enter a 6-digit code first.');
      gridLog(`Announcing pair request with code ${code}...`);
      try {
        const r = await window.nexVault.pairWithCode(code);
        if (r.success) {
          gridLog(`Pair request sent with code ${code}. Awaiting peer handshake...`);
          $('grid-peer-code').value = '';
        } else {
          gridLog('Pairing error: ' + r.error);
        }
      } catch (e) {
        gridLog('Error: ' + e.message);
      }
    }

    async function stopGrid() {
      gridLog('Stopping NexGrid...');
      try {
        await window.nexVault.stopNexGrid();
        $('grid-badge').innerHTML = '<span class="dot"></span>stopped';
        $('grid-status-pill').textContent = 'Local';
        $('pair-code-box').style.display = 'none';
        $('pair-approval-box').style.display = 'none';
        gridLog('NexGrid stopped.');
      } catch (e) { gridLog('Error: ' + e.message); }
    }

    async function requestPair() {
      gridLog('Generating pairing code...');
      try {
        const r = await window.nexVault.requestPairingCode();
        if (r.success) {
          gridLog('Pairing code generated: ' + r.code);
          $('pair-code-val').innerText = r.code;
          $('pair-code-box').style.display = 'block';
        } else gridLog('Error: ' + r.error);
      } catch (e) { gridLog('Error: ' + e.message); }
    }

    async function approvePair() {
      if (!currentPendingPairPeerId) return;
      gridLog('Approving pairing with ' + currentPendingPairPeerId + '...');
      try {
        const r = await window.nexVault.approvePairRequest(currentPendingPairPeerId);
        if (r.success) {
          gridLog('Approved! Synced vault.');
          $('pair-approval-box').style.display = 'none';
          currentPendingPairPeerId = null;
        } else gridLog('Error: ' + r.error);
      } catch (e) { gridLog('Error: ' + e.message); }
    }

    async function rejectPair() {
      if (!currentPendingPairPeerId) return;
      gridLog('Rejecting pair request');
      try {
        await window.nexVault.rejectPairRequest(currentPendingPairPeerId);
        $('pair-approval-box').style.display = 'none';
        currentPendingPairPeerId = null;
      } catch (e) { gridLog('Error: ' + e.message); }
    }

    async function syncAndRefreshVault() {
      setStatus('Syncing with peers...');
      try {
        await window.nexVault.syncVaultToPeers();
        await listPasswords();
        await listOTPs();
        await loadTrustedDevicesUI();
        const timeStr = new Date().toLocaleTimeString();
        setStatus(`Refreshed at ${timeStr}`);
      } catch (err) {
        setStatus('Sync notice: ' + err.message);
      }
    }

    async function loadTrustedDevicesUI() {
      const container = $('trusted-devices-list');
      if (!container || !window.nexVault?.getTrustedDevices) return;
      try {
        const res = await window.nexVault.getTrustedDevices();
        const devices = res.devices || [];
        
        // Update target peer select in Security Center
        const selectEl = $('grant-target-peer-select');
        if (selectEl) {
          selectEl.innerHTML = '<option value="">Select a paired device...</option>' + 
            devices.map(d => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.deviceName || d.deviceId.slice(0, 14))}</option>`).join('');
        }

        if (typeof desktopMeshVisualizer !== 'undefined') {
          desktopMeshVisualizer.updateNodes(devices);
        }

        if (!devices.length) {
          container.innerHTML = '<div class="nv-empty" style="padding: 1rem;">No paired devices yet. Mobile devices will appear here once linked.</div>';
          return;
        }
        container.innerHTML = devices.map(d => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 0.95rem; background: var(--nv-bg-2); border: 1px solid var(--nv-border); border-radius: var(--nv-radius-sm); margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <div style="font-weight: 600; color: #fff; display: flex; align-items: center; gap: 0.4rem;">
                <span class="nv-pulse-dot" style="width: 6px; height: 6px;"></span>
                <span>${escapeHtml(d.deviceName || 'NexVault Node')}</span>
              </div>
              <div style="font-size: 0.72rem; color: var(--nv-muted); font-family: var(--nv-font-mono);">${escapeHtml(d.deviceId)}</div>
            </div>
            <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
              <button class="nv-btn nv-btn-sm" style="font-size: 0.7rem; padding: 0.25rem 0.5rem;" onclick="grantPeerExtensionUI('${escapeHtml(d.deviceId)}', '1week')">
                ⚡ +1W Safe
              </button>
              <button class="nv-btn nv-btn-accent nv-btn-sm" style="font-size: 0.7rem; padding: 0.25rem 0.5rem;" onclick="grantPeerExtensionUI('${escapeHtml(d.deviceId)}', '1month')">
                ⚡ +1M Safe
              </button>
              <button class="nv-btn nv-btn-ghost nv-btn-sm" style="font-size: 0.7rem; padding: 0.25rem 0.5rem;" onclick="requestPeerToExtendUI('${escapeHtml(d.deviceId)}', '1week')">
                🔔 Prompt
              </button>
              <button class="nv-btn nv-btn-ghost nv-btn-sm" style="color: var(--nv-danger); font-size: 0.7rem; padding: 0.25rem 0.5rem;" onclick="removeTrustedDeviceUI('${escapeHtml(d.deviceId)}')">
                Revoke
              </button>
            </div>
          </div>
        `).join('');
      } catch (err) {
        console.error('Failed to load trusted devices:', err);
      }
    }

    async function grantPeerExtensionUI(deviceId, duration = '1week') {
      setStatus(`Beaming safe period extension (${duration}) to peer...`);
      try {
        desktopMeshVisualizer.beamExtensionGrant(deviceId, duration);
        if (window.electronAPI?.grantPeerExtension) {
          const res = await window.electronAPI.grantPeerExtension(deviceId, duration);
          if (res.success) {
            setStatus(`✓ Successfully granted ${duration} safe period extension!`);
            gridLog(`Granted ${duration} safe period extension to peer ${deviceId}`);
          }
        }
      } catch (err) {
        setStatus('Grant notice: ' + err.message);
      }
    }

    async function requestPeerToExtendUI(deviceId, duration = '1week') {
      setStatus('Prompting peer to check in and extend safe period...');
      try {
        if (window.electronAPI?.requestPeerToExtend) {
          await window.electronAPI.requestPeerToExtend(deviceId, duration);
          setStatus('✓ Extension prompt dispatched to peer');
          desktopMeshVisualizer.showToast('🔔 Extension prompt dispatched to peer');
        }
      } catch (err) {
        setStatus('Prompt notice: ' + err.message);
      }
    }

    async function grantPeerExtensionFromSelect() {
      const select = $('grant-target-peer-select');
      const durSelect = $('grant-duration-select');
      const peerId = select ? select.value : '';
      const dur = durSelect ? durSelect.value : '1week';
      if (!peerId) {
        alert('Please select a paired peer device from the dropdown first.');
        return;
      }
      await grantPeerExtensionUI(peerId, dur);
    }

    // Serverless Peer-to-Peer Mesh Visualizer Engine (Decentralized, No Central Host)
    const desktopMeshVisualizer = {
      canvas: null,
      ctx: null,
      nodes: [
        { id: 0, name: "This Node (Linux)", type: "desktop", icon: "🖥️", x: 0.5, y: 0.5, isLocal: true, safeHours: 24, latency: 0, status: "Local Enclave", color: "#10b981", deviceId: "local" }
      ],
      defaultDemoNodes: [
        { id: 1, name: "Pixel 8 Pro (Android)", type: "mobile", icon: "📱", x: 0.22, y: 0.35, isLocal: false, safeHours: 18.2, latency: 16, status: "Direct P2P WebRTC", color: "#0ea5e9", deviceId: "peer-pixel" },
        { id: 2, name: "Laptop Node (macOS)", type: "laptop", icon: "💻", x: 0.78, y: 0.35, isLocal: false, safeHours: 23.8, latency: 12, status: "Direct P2P WebRTC", color: "#10b981", deviceId: "peer-mac" },
        { id: 3, name: "Remote Peer (Workstation)", type: "desktop", icon: "🖥️", x: 0.50, y: 0.82, isLocal: false, safeHours: 720, latency: 8, status: "Direct P2P WebRTC", color: "#f59e0b", deviceId: "peer-linux" }
      ],
      packets: [],
      ripples: [],
      selectedNode: null,
      frame: 0,
      initialized: false,
      loopStarted: false,

      init() {
        this.canvas = $('desktop-mesh-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.canvas.addEventListener('click', (e) => this.handleClick(e));

        // Use ResizeObserver on container so switching tabs or resizing layout always updates canvas immediately
        const container = this.canvas.closest('.nv-mesh-container') || this.canvas.parentElement;
        if (container && window.ResizeObserver) {
          try {
            const ro = new ResizeObserver(() => this.resize());
            ro.observe(container);
          } catch {}
        }

        if (!this.loopStarted) {
          this.startLoop();
          this.loopStarted = true;
        }
        this.initialized = true;
      },

      resize() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const dpr = window.devicePixelRatio || 1;
        const targetW = Math.round(rect.width * dpr);
        const targetH = Math.round(rect.height * dpr);
        if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
          this.canvas.width = targetW;
          this.canvas.height = targetH;
        }
        if (this.ctx) {
          this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      },

      updateNodes(trustedDevices) {
        const local = this.nodes[0] || { id: 0, name: "This Node (Linux)", type: "desktop", icon: "🖥️", x: 0.5, y: 0.5, isLocal: true, safeHours: 24, latency: 0, status: "Local Enclave", color: "#10b981", deviceId: "local" };
        if (!trustedDevices || !trustedDevices.length) {
          this.nodes = [local, ...this.defaultDemoNodes];
          if ($('mesh-topo-status')) $('mesh-topo-status').textContent = 'Serverless Demo Mesh';
          return;
        }

        if ($('mesh-topo-status')) $('mesh-topo-status').textContent = `${trustedDevices.length} P2P Peers Linked`;
        const angles = [0.35 * Math.PI, 0.85 * Math.PI, 1.35 * Math.PI, 1.85 * Math.PI, 0.1 * Math.PI];
        const newNodes = [local];
        trustedDevices.forEach((d, idx) => {
          const angle = angles[idx % angles.length];
          const dist = 0.35;
          const x = 0.5 + Math.cos(angle) * dist;
          const y = 0.5 + Math.sin(angle) * (dist * 0.85);
          const isPhone = /android|phone|pixel|galaxy|ios|mobile/i.test(d.deviceName || '');
          newNodes.push({
            id: idx + 1,
            name: d.deviceName || 'NexVault Peer',
            type: isPhone ? 'mobile' : 'laptop',
            icon: isPhone ? '📱' : '💻',
            x: Math.max(0.15, Math.min(0.85, x)),
            y: Math.max(0.15, Math.min(0.85, y)),
            isLocal: false,
            safeHours: 24,
            latency: 12 + (idx * 4),
            status: 'P2P WebRTC Direct',
            color: '#0ea5e9',
            deviceId: d.deviceId
          });
        });
        this.nodes = newNodes;
      },

      addPacket(fromIndex, toIndex, type, payload) {
        const from = this.nodes[fromIndex];
        const to = this.nodes[toIndex];
        if (!from || !to) return;
        this.packets.push({
          from, to,
          progress: 0,
          speed: 0.016 + Math.random() * 0.008,
          type: type || 'extension-grant',
          payload: payload || {},
          size: type === 'extension-grant' ? 7 : 4,
          color: type === 'extension-grant' ? '#10b981' : (type === 'ping' ? '#0ea5e9' : '#f59e0b'),
          tail: []
        });
      },

      addRipple(x, y, color) {
        this.ripples.push({
          x, y,
          radius: 6,
          maxRadius: 40,
          alpha: 0.9,
          color: color || '#10b981'
        });
      },

      showToast(msg, isSuccess = true) {
        const toast = $('desktop-mesh-toast');
        const text = $('desktop-mesh-toast-msg');
        if (!toast || !text) return;
        text.textContent = msg;
        toast.style.borderColor = isSuccess ? 'rgba(16, 185, 129, 0.6)' : 'rgba(14, 165, 233, 0.6)';
        toast.classList.add('active');
        clearTimeout(window._meshToastTimer);
        window._meshToastTimer = setTimeout(() => {
          toast.classList.remove('active');
        }, 3600);
      },

      beamExtensionGrant(targetId, duration = '1week') {
        let targetNode = null;
        if (typeof targetId === 'number') {
          targetNode = this.nodes[targetId];
        } else if (typeof targetId === 'string') {
          targetNode = this.nodes.find(n => n.deviceId === targetId);
        }
        if (!targetNode) {
          const peers = this.nodes.filter(n => !n.isLocal);
          if (!peers.length) return this.showToast('No peer nodes available to beam extension');
          targetNode = peers[0];
        }

        const durLabel = duration === '1week' ? '+7 Days' : '+30 Days';
        this.showToast(`⚡ Beaming Safe Period Extension to peer "${targetNode.name}" (${durLabel})...`);
        this.addPacket(0, this.nodes.indexOf(targetNode), 'extension-grant', { duration, durLabel, targetName: targetNode.name });

        if (targetNode.deviceId && targetNode.deviceId !== 'peer-mac' && targetNode.deviceId !== 'peer-pixel' && window.electronAPI?.grantPeerExtension) {
          window.electronAPI.grantPeerExtension(targetNode.deviceId, duration).catch(() => {});
        }
      },

      pingAllPeers() {
        this.showToast('📡 P2P ping broadcasted across all encrypted mesh channels');
        for (let i = 1; i < this.nodes.length; i++) {
          setTimeout(() => this.addPacket(0, i, 'ping', { latency: this.nodes[i].latency }), i * 110);
        }
      },

      simulateVaultSync() {
        this.showToast('🔄 Synchronizing encrypted records peer-to-peer across mesh...');
        for (let i = 1; i < this.nodes.length; i++) {
          setTimeout(() => this.addPacket(0, i, 'sync', {}), i * 120);
        }
        // Also exchange packets between peers to show true decentralized mesh
        if (this.nodes.length > 2) {
          setTimeout(() => this.addPacket(1, 2, 'sync', {}), 300);
        }
      },

      handleClick(e) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        let found = null;
        for (const node of this.nodes) {
          const nx = node.x * rect.width;
          const ny = node.y * rect.height;
          const dist = Math.hypot(clickX - nx, clickY - ny);
          if (dist < 32) {
            found = node;
            break;
          }
        }

        if (found) {
          this.selectedNode = found;
          this.openInspector(found);
        } else {
          this.closeInspector();
        }
      },

      openInspector(node) {
        const ins = $('desktop-mesh-inspector');
        if (!ins) return;
        $('d-ins-name').textContent = node.name;
        $('d-ins-type').textContent = node.isLocal ? 'LOCAL PEER' : 'REMOTE PEER (' + node.type.toUpperCase() + ')';
        $('d-ins-channel').textContent = node.isLocal ? 'Local Enclave' : (node.status || 'Direct P2P');
        $('d-ins-latency').textContent = node.isLocal ? '0 ms' : node.latency + ' ms';
        $('d-ins-safe').textContent = node.safeHours > 48 ? Math.round(node.safeHours / 24) + 'd remaining' : node.safeHours.toFixed(1) + 'h remaining';
        $('d-ins-dot').style.backgroundColor = node.color;
        ins.style.display = 'block';

        const btn1w = $('d-btn-extend-1w');
        const btn1m = $('d-btn-extend-1m');
        const btnPrompt = $('d-btn-prompt');

        if (btn1w) btn1w.onclick = () => this.beamExtensionGrant(this.nodes.indexOf(node), '1week');
        if (btn1m) btn1m.onclick = () => this.beamExtensionGrant(this.nodes.indexOf(node), '1month');
        if (btnPrompt) btnPrompt.onclick = () => {
          this.showToast(`🔔 Prompted peer "${node.name}" to check in`);
          if (node.deviceId && window.electronAPI?.requestPeerToExtend) {
            window.electronAPI.requestPeerToExtend(node.deviceId, '1week').catch(() => {});
          }
        };
      },

      closeInspector() {
        const ins = $('desktop-mesh-inspector');
        if (ins) ins.style.display = 'none';
        this.selectedNode = null;
      },

      handleIncomingExtensionGrant(grant) {
        this.showToast(`⚡ Safe Period Extended by peer "${grant.granterDeviceName || 'Peer'}"!`, true);
        const rect = this.canvas ? this.canvas.getBoundingClientRect() : { width: 600, height: 380 };
        this.addRipple(this.nodes[0].x * rect.width, this.nodes[0].y * rect.height, '#10b981');
      },

      handleGrantAck(ack) {
        this.showToast(`✓ Peer confirmed safe period extension applied!`, true);
      },

      startLoop() {
        const loop = () => {
          this.frame++;
          if (this.canvas && this.ctx) {
            this.render();
          }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      },

      render() {
        if (!this.canvas || !this.ctx) return;
        const rect = this.canvas.getBoundingClientRect();
        const W = rect.width;
        const H = rect.height;
        if (W <= 0 || H <= 0) return; // Tab is hidden; skip rendering until visible

        const dpr = window.devicePixelRatio || 1;
        const targetW = Math.round(W * dpr);
        const targetH = Math.round(H * dpr);

        if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
          this.canvas.width = targetW;
          this.canvas.height = targetH;
        }

        const ctx = this.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);

        // Background subtle grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.lineWidth = 1;
        const gridSize = 36;
        for (let x = 0; x < W; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
        }
        for (let y = 0; y < H; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
        }

        // Draw true decentralized serverless peer-to-peer mesh links (interconnected, no central host)
        for (let i = 0; i < this.nodes.length; i++) {
          for (let j = i + 1; j < this.nodes.length; j++) {
            const n1 = this.nodes[i];
            const n2 = this.nodes[j];
            const x1 = n1.x * W;
            const y1 = n1.y * H;
            const x2 = n2.x * W;
            const y2 = n2.y * H;

            // Link line
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = (i === 0 || j === 0) ? 'rgba(16, 185, 129, 0.22)' : 'rgba(14, 165, 233, 0.15)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Animated peer pulse on link
            ctx.beginPath();
            ctx.setLineDash([4, 12]);
            ctx.lineDashOffset = -this.frame * 0.45;
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = 'rgba(0, 212, 255, 0.35)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }

        // Animated Ripples
        for (let i = this.ripples.length - 1; i >= 0; i--) {
          const r = this.ripples[i];
          r.radius += 1.2;
          r.alpha -= 0.02;
          if (r.alpha <= 0 || r.radius >= r.maxRadius) {
            this.ripples.splice(i, 1);
            continue;
          }
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
          ctx.strokeStyle = r.color;
          ctx.globalAlpha = Math.max(0, r.alpha);
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.globalAlpha = 1.0;
        }

        // In-flight P2P Packets
        for (let i = this.packets.length - 1; i >= 0; i--) {
          const p = this.packets[i];
          p.progress += p.speed;

          const x1 = p.from.x * W;
          const y1 = p.from.y * H;
          const x2 = p.to.x * W;
          const y2 = p.to.y * H;

          const curX = x1 + (x2 - x1) * p.progress;
          const curY = y1 + (y2 - y1) * p.progress;

          p.tail.push({ x: curX, y: curY });
          if (p.tail.length > 12) p.tail.shift();

          for (let t = 0; t < p.tail.length; t++) {
            const pt = p.tail[t];
            const alpha = (t / p.tail.length) * 0.7;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, p.size * (t / p.tail.length), 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = alpha;
            ctx.fill();
          }
          ctx.globalAlpha = 1.0;

          ctx.beginPath();
          ctx.arc(curX, curY, p.size, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 14;
          ctx.fill();
          ctx.shadowBlur = 0;

          if (p.progress >= 1.0) {
            this.addRipple(x2, y2, p.color);
            if (p.type === 'extension-grant') {
              this.showToast(`✓ Safe Period extended for peer "${p.to.name}" (${p.payload.durLabel})!`);
              p.to.safeHours += p.payload.duration === '1week' ? 168 : 720;
              this.packets.push({
                from: p.to, to: p.from, progress: 0, speed: 0.025, type: 'ack', size: 4, color: '#34d399', tail: []
              });
            } else if (p.type === 'ping') {
              this.packets.push({
                from: p.to, to: p.from, progress: 0, speed: 0.03, type: 'pong', size: 3, color: '#0ea5e9', tail: []
              });
            }
            this.packets.splice(i, 1);
          }
        }

        // Render Peer Nodes (Serverless equal peers)
        for (const node of this.nodes) {
          const nx = node.x * W;
          const ny = node.y * H;
          const isSelected = this.selectedNode === node;

          if (node.isLocal) {
            const pulse = Math.sin(this.frame * 0.05) * 5;
            ctx.beginPath();
            ctx.arc(nx, ny, 30 + pulse, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
            ctx.fill();
          }

          if (isSelected) {
            ctx.beginPath();
            ctx.arc(nx, ny, 26, 0, Math.PI * 2);
            ctx.strokeStyle = node.color;
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          ctx.beginPath();
          ctx.arc(nx, ny, 20, 0, Math.PI * 2);
          ctx.fillStyle = '#0f172a';
          ctx.shadowColor = node.color;
          ctx.shadowBlur = node.isLocal ? 16 : 8;
          ctx.fill();
          ctx.shadowBlur = 0;

          ctx.strokeStyle = node.color;
          ctx.lineWidth = node.isLocal ? 2.5 : 1.5;
          ctx.stroke();

          ctx.font = '15px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(node.icon, nx, ny);

          ctx.font = '11px -apple-system, sans-serif';
          ctx.fillStyle = '#ffffff';
          ctx.fillText(node.name, nx, ny + 32);

          ctx.font = '9px monospace';
          ctx.fillStyle = node.color;
          const sub = node.isLocal ? '● LOCAL PEER' : `● ${node.latency}ms P2P`;
          ctx.fillText(sub, nx, ny + 44);
        }

        // Periodically trigger background serverless peer sync packets
        if (this.frame % 150 === 0 && this.packets.length < 4 && this.nodes.length > 1) {
          const fromIdx = Math.floor(Math.random() * this.nodes.length);
          let toIdx = Math.floor(Math.random() * this.nodes.length);
          while (toIdx === fromIdx) {
            toIdx = Math.floor(Math.random() * this.nodes.length);
          }
          this.addPacket(fromIdx, toIdx, 'heartbeat', {});
        }
      }
    };

    async function removeTrustedDeviceUI(deviceId) {
      if (!confirm('Revoke trust for this device?')) return;
      try {
        await window.nexVault.removeTrustedDevice(deviceId);
        loadTrustedDevicesUI();
        gridLog('Revoked device ' + deviceId);
      } catch (err) { gridLog('Error: ' + err.message); }
    }

    // Security Diagnostics
    async function runIntegrityCheck() {
      log('Running integrity check...');
      try {
        const r = await window.nexVault.runIntegrityCheck();
        log(r.success ? 'Integrity verified: OK' : 'Error: ' + r.error);
      } catch (e) { log('Exception: ' + e.message); }
    }

    async function runTamperMonitor() {
      log('Starting tamper monitor...');
      try {
        const r = await window.nexVault.startTamperMonitor();
        log(r.success ? 'Tamper monitor active.' : 'Error: ' + r.error);
      } catch (e) { log('Exception: ' + e.message); }
    }

    async function triggerNuke() {
      return triggerImmediateNuke();
    }

    async function triggerImmediateNuke() {
      const first = confirm('☢️ EMERGENCY NUKE WARNING: This will permanently destroy all local encryption keys, shred the SQLCipher database, and close NexVault. Proceed?');
      if (!first) return;
      const second = confirm('FINAL VERIFICATION: Are you absolutely certain? This operation CANNOT be undone.');
      if (!second) return;
      try {
        setStatus('Executing Emergency Cryptographic Nuke...');
        await window.nexVault.triggerEmergencyNuke(true);
        lockVault();
        window.location.reload();
      } catch (e) {
        setStatus('Nuke error: ' + e.message);
      }
    }

    async function refreshSecurityStatus() {
      try {
        const s = await window.nexVault.getSecurityStatus();
        if (!s) return;
        const deadlineEl = $('security-deadline-countdown');
        const badgeEl = $('security-window-badge');
        const targetEl = $('security-deadline-target');
        
        let deadlineTime = null;
        if (s.offlineDeadline) {
          deadlineTime = new Date(s.offlineDeadline).getTime();
        } else if (s.windowEnd) {
          deadlineTime = new Date(s.windowEnd).getTime();
        } else if (s.lastActive) {
          deadlineTime = new Date(s.lastActive).getTime() + 24 * 3600 * 1000;
        }

        if (deadlineTime) {
          const diff = Math.max(0, Math.floor((deadlineTime - Date.now()) / 1000));
          const hours = Math.floor(diff / 3600);
          const mins = Math.floor((diff % 3600) / 60);
          const secs = diff % 60;
          const days = Math.floor(hours / 24);
          
          let formatted = '';
          if (days > 1) {
            formatted = `${days} days, ${hours % 24}h remaining`;
          } else {
            formatted = `${hours}h ${mins}m ${secs}s remaining`;
          }
          
          if (deadlineEl) deadlineEl.textContent = formatted;
          if (targetEl) targetEl.textContent = `Deadline: ${new Date(deadlineTime).toLocaleString()}`;
          if (badgeEl) {
            if (s.extension) {
              badgeEl.textContent = `Extended (${s.extension.duration})`;
              badgeEl.className = 'nv-badge success';
            } else {
              badgeEl.textContent = '24h Heartbeat Active';
              badgeEl.className = 'nv-badge';
            }
          }
        }
      } catch (err) {
        console.error('Failed to get security status', err);
      }
    }

    const incomingExtensionRequests = new Map();

    function renderIncomingExtensionRequests() {
      const container = $('incoming-extension-requests-container');
      const badge = $('sidebar-security-badge');
      if (!container) return;

      const requests = Array.from(incomingExtensionRequests.values());
      if (requests.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        if (badge) badge.style.display = 'none';
        return;
      }

      if (badge) {
        badge.style.display = 'inline-block';
        badge.textContent = String(requests.length);
      }

      container.style.display = 'block';
      container.innerHTML = requests.map(req => `
        <div class="nv-card" style="margin-bottom: 0.75rem; border-color: var(--nv-primary); background: rgba(16, 185, 129, 0.08); box-shadow: 0 0 15px rgba(16, 185, 129, 0.15);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; margin-bottom: 0.5rem;">
            <div>
              <div style="font-weight: 700; color: #fff; font-size: 0.95rem; display: flex; align-items: center; gap: 0.5rem;">
                <span>🔔</span>
                <span>Incoming Security Window Extension Request</span>
              </div>
              <div style="font-size: 0.8rem; color: var(--nv-text-secondary); margin-top: 0.25rem;">
                Device <strong>"${escapeHtml(req.deviceName || 'Mesh Peer')}"</strong> is requesting a <strong>${escapeHtml(req.duration)}</strong> offline security extension.
              </div>
            </div>
            <span class="nv-badge success" style="text-transform: uppercase;">${escapeHtml(req.duration)}</span>
          </div>
          <div style="font-size: 0.75rem; color: var(--nv-muted); font-family: var(--nv-font-mono); margin-bottom: 0.75rem;">
            Target Deadline: ${req.newDeadline ? new Date(req.newDeadline).toLocaleString() : 'Calculating...'}
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="nv-btn nv-btn-sm" onclick="approvePeerExtension('${req.peerId}', '${req.requestId}', '${req.duration}', '${req.newDeadline || ''}')">
              ✓ Approve &amp; Extend Peer
            </button>
            <button class="nv-btn nv-btn-ghost nv-btn-sm" style="color: var(--nv-danger);" onclick="rejectPeerExtension('${req.peerId}', '${req.requestId}')">
              ✕ Decline
            </button>
          </div>
        </div>
      `).join('');
    }

    async function approvePeerExtension(peerId, requestId, duration, newDeadline) {
      try {
        setStatus(`Approving ${duration} extension for peer...`);
        const r = await window.nexVault.approveExtension(peerId, requestId, duration, newDeadline);
        if (r.success) {
          incomingExtensionRequests.delete(requestId);
          renderIncomingExtensionRequests();
          setStatus(`Approved extension for peer device.`);
          loadTrustLedger();
        } else throw new Error(r.error);
      } catch (err) {
        setStatus('Error approving extension: ' + err.message);
      }
    }

    async function rejectPeerExtension(peerId, requestId) {
      try {
        await window.nexVault.rejectExtension(peerId, requestId, 'Declined by desktop user');
        incomingExtensionRequests.delete(requestId);
        renderIncomingExtensionRequests();
        setStatus('Declined peer extension request.');
      } catch (err) {
        setStatus('Error declining extension: ' + err.message);
      }
    }

    function showPendingExtensionBanner(duration, requestId, newDeadline, broadcastCount) {
      const banner = $('pending-extension-banner');
      const badge = $('pending-extension-duration-badge');
      const details = $('pending-extension-details');
      if (banner) {
        banner.style.display = 'block';
        if (badge) badge.textContent = duration;
        if (details) {
          const dateStr = newDeadline ? new Date(newDeadline).toLocaleString() : '';
          const peerNotice = (broadcastCount && broadcastCount > 0) ? `Broadcasted to ${broadcastCount} connected peer(s).` : 'Broadcasted across NexGrid mesh.';
          details.textContent = `${peerNotice} Target deadline: ${dateStr}`;
        }
      }
    }

    function hidePendingExtensionBanner() {
      const banner = $('pending-extension-banner');
      if (banner) banner.style.display = 'none';
    }

    function cancelPendingExtensionRequest() {
      hidePendingExtensionBanner();
      setStatus('Dismissed pending extension banner.');
    }

    async function checkInSecurityNow() {
      try {
        setStatus('Checking in security heartbeat...');
        await window.nexVault.startSecurityCountdown();
        refreshSecurityStatus();
        loadTrustLedger();
        setStatus('Security check-in successful. 24-hour heartbeat reset.');
      } catch (err) {
        setStatus('Check-in error: ' + err.message);
      }
    }

    async function loadTrustLedger() {
      const ledgerLog = $('security-ledger-log');
      if (!ledgerLog) return;
      try {
        const hist = await window.nexVault.getTrustHistory();
        if (hist && hist.events && hist.events.length > 0) {
          ledgerLog.innerHTML = hist.events.slice().reverse().map(e => `
            <div style="padding: 0.35rem 0; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span style="color: var(--nv-primary); font-weight: 600;">[${escapeHtml(e.eventType)}]</span>
                <span style="color: #fff; margin-left: 0.4rem;">${escapeHtml(JSON.stringify(e.payload || {}))}</span>
              </div>
              <span style="color: var(--nv-muted); font-size: 0.7rem;">${new Date(e.timestamp).toLocaleTimeString()}</span>
            </div>
          `).join('');
        } else {
          ledgerLog.innerHTML = '<div style="color: var(--nv-muted); padding: 0.5rem 0;">No ledger events recorded yet.</div>';
        }
      } catch (err) {
        ledgerLog.innerHTML = `<div style="color: var(--nv-danger);">Failed to load ledger: ${err.message}</div>`;
      }
    }

    async function requestSecurityExtension(forceLocal = false) {
      const sel = $('security-extension-select') || $('setting-security-extension-select');
      const dur = sel ? sel.value : '1week';
      setStatus('Requesting security window extension...');
      try {
        const r = await window.nexVault.extendSecurityWindow(dur, { mesh: !forceLocal, local: forceLocal });
        if (r.success) {
          if (r.pendingApproval) {
            setStatus(`Extension request broadcasted to mesh peers (${dur})`);
            showPendingExtensionBanner(dur, r.requestId, r.newDeadline, r.broadcastCount);
          } else {
            setStatus(`Security window extended to ${new Date(r.expiresAt).toLocaleDateString()}`);
            hidePendingExtensionBanner();
          }
          refreshSecurityStatus();
          loadTrustLedger();
        } else throw new Error(r.error);
      } catch (e) {
        setStatus('Extension error: ' + e.message);
      }
    }

    // App Updates Check & In-Place Auto-Updater
    let isApplyingUpdate = false;

    async function checkForUpdates(manual = false) {
      if (manual) setStatus('Checking GitHub for updates...');
      latestUpdateInfo = null;
      if ($('update-banner')) $('update-banner').style.display = 'none';
      try {
        const info = await window.nexVault.checkForUpdates();
        if (info && info.currentVersion) {
          if ($('settings-version-badge')) {
            $('settings-version-badge').textContent = `Current: v${info.currentVersion}`;
          }
          if ($('sidebar-version-badge')) {
            $('sidebar-version-badge').textContent = `v${info.currentVersion}`;
          }
        }
        if (info && info.hasUpdate) {
          latestUpdateInfo = info;
          const sizeStr = info.size ? ` · ${(info.size / 1048576).toFixed(1)} MB` : '';
          const shaStr = info.sha256 ? ` · SHA-256: ${info.sha256.slice(0, 10)}…` : '';
          $('update-version').textContent = info.latestVersion;
          $('update-desc').textContent = `${info.releaseName || 'v' + info.latestVersion} is available (Current: v${info.currentVersion}${sizeStr}${shaStr}). Click below to verify & upgrade in-place.`;
          $('update-action-btn').style.display = 'inline-flex';
          $('update-action-btn').disabled = false;
          $('update-action-btn').textContent = 'Update & Restart';
          $('update-banner').style.display = 'flex';

          if ($('settings-update-desc')) {
            $('settings-update-desc').textContent = `🚀 Update v${info.latestVersion} is ready to install! (Installed: v${info.currentVersion}${sizeStr}${shaStr})`;
          }
          if ($('settings-update-btn')) {
            $('settings-update-btn').style.display = 'inline-flex';
            $('settings-update-btn').disabled = false;
            $('settings-update-btn').textContent = `Install v${info.latestVersion} & Restart`;
          }
          setStatus(`Update available: ${info.latestVersion}`);
        } else if (info && info.success) {
          if (manual) setStatus(`Up to date: v${info.currentVersion}`);
          if ($('settings-update-desc')) {
            $('settings-update-desc').textContent = `✓ NextVault is up to date (running v${info.currentVersion}).`;
          }
          if ($('settings-update-btn')) {
            $('settings-update-btn').style.display = 'none';
          }
          if ($('update-action-btn')) $('update-action-btn').style.display = 'none';
          if ($('update-banner')) $('update-banner').style.display = 'none';
        } else if (info && !info.success) {
          if (manual) setStatus('Update check notice: ' + (info.message || info.error || 'Check failed'));
          if ($('settings-update-desc')) {
            $('settings-update-desc').textContent = info.message || 'Unable to check for updates right now.';
          }
          if ($('settings-update-btn')) $('settings-update-btn').style.display = 'none';
        }
      } catch (err) {
        if (manual) setStatus('Update check notice: ' + err.message);
        if ($('settings-update-btn')) $('settings-update-btn').style.display = 'none';
      }
    }

    async function applyAppUpdate() {
      if (isApplyingUpdate) return;
      isApplyingUpdate = true;
      const btn = $('update-action-btn');
      const settingsBtn = $('settings-update-btn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Downloading...';
      }
      if (settingsBtn) {
        settingsBtn.disabled = true;
        settingsBtn.textContent = 'Downloading...';
      }
      $('update-desc').textContent = 'Downloading update in background...';
      setStatus('Downloading update...');

      if (window.nexVault?.onUpdateProgress) {
        window.nexVault.onUpdateProgress((prog) => {
          const mbDown = (prog.downloadedBytes / (1024 * 1024)).toFixed(1);
          const mbTotal = (prog.totalBytes / (1024 * 1024)).toFixed(1);
          const progressMsg = `Downloading: ${prog.percent}% (${mbDown} MB / ${mbTotal} MB)...`;
          $('update-desc').textContent = progressMsg;
          if (btn) btn.textContent = `${prog.percent}%`;
          if (settingsBtn) settingsBtn.textContent = `${prog.percent}%`;
        });
      }

      try {
        const downloadUrl = latestUpdateInfo?.downloadUrl;
        const res = await window.nexVault.applyUpdate(downloadUrl);
        if (res && res.success) {
          $('update-desc').textContent = 'Update downloaded! Replacing old version and restarting...';
          setStatus('Restarting app with new version...');
        } else {
          isApplyingUpdate = false;
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Retry Update';
          }
          if (settingsBtn) {
            settingsBtn.disabled = false;
            settingsBtn.textContent = 'Retry Update';
          }
          $('update-desc').textContent = 'Update failed: ' + (res?.error || 'Unknown error');
          setStatus('Update error: ' + (res?.error || 'Failed'));
        }
      } catch (err) {
        isApplyingUpdate = false;
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Retry Update';
        }
        if (settingsBtn) {
          settingsBtn.disabled = false;
          settingsBtn.textContent = 'Retry Update';
        }
        $('update-desc').textContent = 'Update error: ' + err.message;
        setStatus('Update failed: ' + err.message);
      }
    }

    function dismissUpdate() {
      $('update-banner').style.display = 'none';
    }

    function escapeHtml(s) {
      if (!s) return '';
      return String(s).replace(/[&<>"']/g, c => {
        switch (c) {
          case '&': return '&amp;';
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '"': return '&quot;';
          case "'": return '&#39;';
          default: return c;
        }
      });
    }

    // Startup Initialization
    async function initStartup() {
      try {
        if (window.nexVault?.getAppVersion) {
          try {
            const ver = await window.nexVault.getAppVersion();
            if (ver) {
              if ($('settings-version-badge')) $('settings-version-badge').textContent = `Current: v${ver}`;
              if ($('sidebar-version-badge')) $('sidebar-version-badge').textContent = `v${ver}`;
            }
          } catch {}
        }
        if (window.nexVault?.getRelayUrl) {
          try {
            const r = await window.nexVault.getRelayUrl();
            if (r && r.relayUrl && $('grid-relay-url')) {
              $('grid-relay-url').value = r.relayUrl;
            }
          } catch {}
        } else {
          const savedRelay = localStorage.getItem('nexvault_relay_url');
          if (savedRelay && $('grid-relay-url')) $('grid-relay-url').value = savedRelay;
        }

        $('grid-relay-url')?.addEventListener('change', (e) => {
          const val = e.target.value.trim();
          if (val) {
            localStorage.setItem('nexvault_relay_url', val);
            if (window.nexVault?.setRelayUrl) window.nexVault.setRelayUrl(val);
          }
        });

        if (!window.nexVault?.getVaultProfile) return;
        const profile = await window.nexVault.getVaultProfile();
        if (profile && profile.hasUser && profile.bootstrapToken) {
          $('existing-token').value = JSON.stringify(profile.bootstrapToken, null, 2);
          $('settings-token-display').value = JSON.stringify(profile.bootstrapToken, null, 2);
          switchAuthTab('unlock');
          setStatus(`Vault profile found for ${profile.username || 'user'}.`);
          setTimeout(() => { $('existing-password')?.focus(); }, 100);
        }
        checkForUpdates(false);
        if (window.nexVault?.onTriggerUpdateCheck) {
          window.nexVault.onTriggerUpdateCheck(() => checkForUpdates(true));
        }
        checkExtensionStatus();
        if (typeof desktopMeshVisualizer !== 'undefined') {
          desktopMeshVisualizer.init();
        }
      } catch (err) {
        console.error('Startup profile check notice:', err);
      }
    }

    // Keyboard bindings
    $('new-password')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleNewUser(); });
    $('existing-password')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleExistingUser(); });
    $('vault-password')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') savePassword(); });

    document.addEventListener('DOMContentLoaded', initStartup);
    setTimeout(initStartup, 100);

    // Event listeners from backend
    if (window.nexVault) {
      if (window.nexVault.onIncomingPairRequest) {
        window.nexVault.onIncomingPairRequest(({ peerId, deviceName }) => {
          currentPendingPairPeerId = peerId;
          gridLog(`Incoming pairing request from "${deviceName}" (${peerId})`);
          $('pair-req-desc').innerText = `Device "${deviceName}" wants to link with your vault.`;
          $('pair-approval-box').style.display = 'block';
        });
      }
      if (window.nexVault.onPeerJoined) {
        window.nexVault.onPeerJoined((peer) => {
          gridLog(`Peer joined: ${peer.deviceName || 'Peer'} (${peer.deviceId})`);
          loadTrustedDevicesUI();
          if (typeof desktopMeshVisualizer !== 'undefined') {
            desktopMeshVisualizer.showToast(`📡 Mesh peer joined: ${peer.deviceName || 'Peer'}`);
          }
        });
      }
      if (window.nexVault.onPeerPaired) {
        window.nexVault.onPeerPaired(({ peerId, deviceName }) => {
          gridLog(`Device paired: "${deviceName}" (${peerId})`);
          loadTrustedDevicesUI();
          if (typeof desktopMeshVisualizer !== 'undefined') {
            desktopMeshVisualizer.showToast(`🎉 New peer linked to mesh: "${deviceName}"!`);
          }
        });
      }
      if (window.nexVault.onVaultUpdated) {
        window.nexVault.onVaultUpdated(() => {
          gridLog('Vault updated from peer sync.');
          listPasswords();
          listOTPs();
          loadTrustedDevicesUI();
          if (typeof desktopMeshVisualizer !== 'undefined') {
            desktopMeshVisualizer.simulateVaultSync();
          }
        });
      }
      if (window.nexVault.onVaultSyncedToPeers) {
        window.nexVault.onVaultSyncedToPeers(({ count }) => {
          gridLog(`Broadcasted updated credentials to ${count} mesh peer(s).`);
          if (typeof desktopMeshVisualizer !== 'undefined') {
            desktopMeshVisualizer.simulateVaultSync();
          }
        });
      }
      if (window.nexVault.onGridStatus) {
        window.nexVault.onGridStatus(({ status, relayUrl, peers }) => {
          if (status === 'connected') {
            $('grid-badge').innerHTML = '<span class="dot"></span>connected';
            $('grid-status-pill').textContent = 'Connected';
            gridLog('NexGrid connected to ' + relayUrl);
            if (peers && peers.length) {
              gridLog('Active peers in mesh: ' + peers.map(p => p.deviceName || p.deviceId).join(', '));
            }
          }
        });
      }
      if (window.nexVault.onPeerRequestsApproval) {
        window.nexVault.onPeerRequestsApproval((data) => {
          if (data && data.requestId) {
            incomingExtensionRequests.set(data.requestId, data);
            renderIncomingExtensionRequests();
            setStatus(`🔔 Incoming extension approval request from "${data.deviceName || 'Mesh Peer'}"`);
          }
        });
      }
      if (window.nexVault.onExtensionApproved) {
        window.nexVault.onExtensionApproved((data) => {
          hidePendingExtensionBanner();
          setStatus(`🎉 Extension approved! Security window extended (${data.duration})`);
          refreshSecurityStatus();
          loadTrustLedger();
        });
      }
      if (window.nexVault.onExtensionRejected) {
        window.nexVault.onExtensionRejected((data) => {
          hidePendingExtensionBanner();
          setStatus(`❌ Extension request declined: ${data.reason || 'Declined'}`);
        });
      }
      if (window.nexVault.onExtensionGrantReceived) {
        window.nexVault.onExtensionGrantReceived((grant) => {
          if (typeof desktopMeshVisualizer !== 'undefined') {
            desktopMeshVisualizer.handleIncomingExtensionGrant(grant);
          }
          setStatus(`⚡ Safe period extended by "${grant.grantedBy || grant.granterDeviceName || 'Peer'}" until ${new Date(grant.expiresAt).toLocaleDateString()}!`);
          refreshSecurityStatus();
          loadTrustLedger();
        });
      }
      if (window.nexVault.onExtensionGrantAcknowledged) {
        window.nexVault.onExtensionGrantAcknowledged((ack) => {
          if (typeof desktopMeshVisualizer !== 'undefined') {
            desktopMeshVisualizer.handleGrantAck(ack);
          }
          setStatus(`✓ Peer confirmed safe period extension applied!`);
        });
      }
      if (window.nexVault.onExtensionPromptReceived) {
        window.nexVault.onExtensionPromptReceived((prompt) => {
          if (typeof desktopMeshVisualizer !== 'undefined') {
            desktopMeshVisualizer.showToast(`🔔 Peer "${prompt.fromDeviceName || 'Peer'}" prompted you to check in!`);
          }
          setStatus(`🔔 Peer "${prompt.fromDeviceName || 'Peer'}" prompted you to check in`);
        });
      }
    }

    // Expose helpers
    window.desktopMeshVisualizer = desktopMeshVisualizer;
    window.grantPeerExtensionUI = grantPeerExtensionUI;
    window.requestPeerToExtendUI = requestPeerToExtendUI;
    window.grantPeerExtensionFromSelect = grantPeerExtensionFromSelect;
    window.navigateTo = navigateTo;
    window.approvePeerExtension = approvePeerExtension;
    window.rejectPeerExtension = rejectPeerExtension;
    window.cancelPendingExtensionRequest = cancelPendingExtensionRequest;
    window.checkInSecurityNow = checkInSecurityNow;
    window.loadTrustLedger = loadTrustLedger;
    window.switchAuthTab = switchAuthTab;
    window.toggleTokenView = toggleTokenView;
    window.handleNewUser = handleNewUser;
    window.handleExistingUser = handleExistingUser;
    window.lockVault = lockVault;
    window.toggleAddCredentialForm = toggleAddCredentialForm;
    window.generateRandomPassword = generateRandomPassword;
    window.savePassword = savePassword;
    window.listPasswords = listPasswords;
    window.filterVaultEntries = filterVaultEntries;
    window.copyUsername = copyUsername;
    window.copyPassword = copyPassword;
    window.editPassword = editPassword;
    window.deletePassword = deletePassword;
    window.deleteAllPasswords = deleteAllPasswords;
    window.toggleAddOtpForm = toggleAddOtpForm;
    window.saveOTP = saveOTP;
    window.listOTPs = listOTPs;
    window.filterOTPEntries = filterOTPEntries;
    window.copyOTP = copyOTP;
    window.editOTP = editOTP;
    window.deleteOTP = deleteOTP;
    window.deleteAllOTPs = deleteAllOTPs;
    window.deleteAllVault = deleteAllVault;
    window.changeAutoLockSetting = changeAutoLockSetting;
    window.requestSecurityExtension = requestSecurityExtension;
    window.triggerImmediateNuke = triggerImmediateNuke;
    window.refreshSecurityStatus = refreshSecurityStatus;
    window.startGrid = startGrid;
    window.stopGrid = stopGrid;
    window.requestPair = requestPair;
    window.approvePair = approvePair;
    window.rejectPair = rejectPair;
    window.syncAndRefreshVault = syncAndRefreshVault;
    window.loadTrustedDevicesUI = loadTrustedDevicesUI;
    window.removeTrustedDeviceUI = removeTrustedDeviceUI;
    window.runIntegrityCheck = runIntegrityCheck;
    window.runTamperMonitor = runTamperMonitor;
    window.triggerNuke = triggerNuke;
    window.checkForUpdates = checkForUpdates;
    window.applyAppUpdate = applyAppUpdate;
    window.dismissUpdate = dismissUpdate;
    window.copyTokenFromSettings = copyTokenFromSettings;
    window.openBulkImportModal = openBulkImportModal;
    window.closeBulkImportModal = closeBulkImportModal;
    window.reinstallBrowserExtension = reinstallBrowserExtension;

    async function checkExtensionStatus() {
      if (window.nexVault?.getBrowserExtensionStatus) {
        try {
          const res = await window.nexVault.getBrowserExtensionStatus();
          if (res && res.success && $('extension-detected-browsers')) {
            if (Array.isArray(res.browsers) && res.browsers.length > 0) {
              $('extension-detected-browsers').textContent = 'Active integration: ' + res.browsers.join(', ');
            } else {
              $('extension-detected-browsers').textContent = 'Registered for system default browsers.';
            }
          }
        } catch {}
      }
    }

    async function reinstallBrowserExtension() {
      if (window.nexVault?.installBrowserExtension) {
        try {
          setStatus('Registering extension in browsers...');
          const res = await window.nexVault.installBrowserExtension();
          if (res && res.success) {
            const count = res.browsers?.length || 0;
            setStatus(`Extension registered for ${count} browser(s)!`);
            if ($('extension-detected-browsers')) {
              $('extension-detected-browsers').textContent = count > 0 ? ('Active integration: ' + res.browsers.join(', ')) : 'Registered for system default Chromium & Firefox profiles.';
            }
          } else {
            setStatus('Registration completed.');
          }
        } catch (e) {
          setStatus('Error: ' + e.message);
        }
      }
    }
    window.handleDesktopImportFile = handleDesktopImportFile;
    window.handleDesktopImportTextChange = handleDesktopImportTextChange;
    window.executeDesktopBulkImport = executeDesktopBulkImport;

    let parsedImportData = { passwords: [], otps: [] };

    function openBulkImportModal(type = 'all') {
      parsedImportData = { passwords: [], otps: [] };
      if ($('desktop-import-textarea')) $('desktop-import-textarea').value = '';
      if ($('desktop-import-filename')) $('desktop-import-filename').textContent = 'No file selected';
      if ($('desktop-import-file')) $('desktop-import-file').value = '';
      if ($('desktop-import-preview-box')) $('desktop-import-preview-box').style.display = 'none';
      if ($('desktop-import-confirm-btn')) $('desktop-import-confirm-btn').disabled = true;
      if ($('desktop-import-title')) {
        $('desktop-import-title').textContent = type === 'otp' ? 'Bulk Import 2FA Accounts' : (type === 'vault' ? 'Bulk Import Passwords' : 'Bulk Import Credentials & 2FA');
      }
      if ($('desktop-import-modal')) $('desktop-import-modal').style.display = 'flex';
    }

    function closeBulkImportModal() {
      if ($('desktop-import-modal')) $('desktop-import-modal').style.display = 'none';
    }

    function handleDesktopImportFile(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      if ($('desktop-import-filename')) {
        $('desktop-import-filename').textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result;
        if (typeof text === 'string') {
          if ($('desktop-import-textarea')) $('desktop-import-textarea').value = text;
          handleDesktopImportTextChange();
        }
      };
      reader.readAsText(file);
    }

    async function handleDesktopImportTextChange() {
      const raw = $('desktop-import-textarea')?.value.trim() || '';
      if (!raw) {
        if ($('desktop-import-preview-box')) $('desktop-import-preview-box').style.display = 'none';
        if ($('desktop-import-confirm-btn')) $('desktop-import-confirm-btn').disabled = true;
        parsedImportData = { passwords: [], otps: [] };
        return;
      }

      try {
        let result;
        if (window.nexVault?.parseBulkImport) {
          result = await window.nexVault.parseBulkImport(raw);
        }
        if (!result || !result.success) {
          if ($('desktop-import-preview-box')) $('desktop-import-preview-box').style.display = 'none';
          if ($('desktop-import-confirm-btn')) $('desktop-import-confirm-btn').disabled = true;
          return;
        }

        parsedImportData = {
          passwords: result.passwords || [],
          otps: result.otps || []
        };

        const total = parsedImportData.passwords.length + parsedImportData.otps.length;
        if (total === 0) {
          if ($('desktop-import-preview-box')) $('desktop-import-preview-box').style.display = 'none';
          if ($('desktop-import-confirm-btn')) $('desktop-import-confirm-btn').disabled = true;
          return;
        }

        if ($('desktop-import-count-badge')) {
          $('desktop-import-count-badge').textContent = `${parsedImportData.passwords.length} Passwords, ${parsedImportData.otps.length} 2FA Accounts`;
        }
        const list = $('desktop-import-preview-list');
        if (list) {
          list.innerHTML = '';
          parsedImportData.passwords.slice(0, 40).forEach(p => {
            const item = document.createElement('div');
            item.className = 'nv-import-tag';
            item.innerHTML = `<span>🔑 <strong>${escapeHtml(p.service)}</strong> ${p.username ? '(' + escapeHtml(p.username) + ')' : ''}</span><span style="color:var(--nv-muted);">Password</span>`;
            list.appendChild(item);
          });

          parsedImportData.otps.slice(0, 40).forEach(o => {
            const item = document.createElement('div');
            item.className = 'nv-import-tag';
            item.innerHTML = `<span>⏳ <strong>${escapeHtml(o.service)}</strong></span><span style="color:var(--nv-primary);">2FA TOTP</span>`;
            list.appendChild(item);
          });

          if (total > 80) {
            const extra = document.createElement('div');
            extra.style.textAlign = 'center';
            extra.style.color = 'var(--nv-muted)';
            extra.style.padding = '0.25rem';
            extra.textContent = `+ ${total - 80} more items...`;
            list.appendChild(extra);
          }
        }

        if ($('desktop-import-preview-box')) $('desktop-import-preview-box').style.display = 'block';
        if ($('desktop-import-confirm-btn')) $('desktop-import-confirm-btn').disabled = false;
      } catch (err) {
        console.error('Import preview error:', err);
      }
    }

    async function executeDesktopBulkImport() {
      const btn = $('desktop-import-confirm-btn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Importing...';
      }

      let totalImported = 0;
      try {
        if (parsedImportData.passwords.length > 0 && window.nexVault?.bulkImportPasswords) {
          const rPass = await window.nexVault.bulkImportPasswords(parsedImportData.passwords);
          if (rPass && rPass.success) totalImported += rPass.count || parsedImportData.passwords.length;
        }
        if (parsedImportData.otps.length > 0 && window.nexVault?.bulkImportOTPs) {
          const rOtp = await window.nexVault.bulkImportOTPs(parsedImportData.otps);
          if (rOtp && rOtp.success) totalImported += rOtp.count || parsedImportData.otps.length;
        }

        setStatus(`Successfully imported ${totalImported} items into vault.`);
        gridLog(`Bulk imported ${totalImported} credentials and broadcasted to mesh.`);
        closeBulkImportModal();
        listPasswords();
        listOTPs();
      } catch (e) {
        setStatus('Import error: ' + e.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Import to Vault & Mesh';
        }
      }
    }
