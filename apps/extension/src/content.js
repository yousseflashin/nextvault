/**
 * NexVault Browser Extension — Premium In-Field Autofill (1Password-Style)
 * 
 * Injects a sleek in-field shield badge into login/registration inputs.
 * Clicking or focusing displays an isolated floating glassmorphic dropdown
 * to autofill credentials or generate strong passwords.
 */
(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__NEXVAULT_EXTENSION_LOADED__) return;
  window.__NEXVAULT_EXTENSION_LOADED__ = true;

  const currentHostname = window.location.hostname.replace(/^www\./, '');

  // Create isolated Shadow DOM container for all extension UI
  const hostEl = document.createElement('nexvault-infield-host');
  hostEl.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  document.documentElement.appendChild(hostEl);
  const shadow = hostEl.attachShadow({ mode: 'closed' });

  // Add styles to Shadow DOM
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "JetBrains Mono", monospace;
    }

    .nv-badge-btn {
      position: absolute;
      width: 22px;
      height: 22px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(4, 8, 16, 0.85);
      border: 1px solid rgba(0, 255, 157, 0.5);
      border-radius: 5px;
      box-shadow: 0 0 10px rgba(0, 255, 157, 0.3);
      transition: left 0.22s cubic-bezier(0.16, 1, 0.3, 1), top 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s, box-shadow 0.2s, background 0.2s;
      z-index: 2147483646;
      user-select: none;
      outline: none;
    }

    .nv-badge-btn:hover {
      transform: scale(1.1);
      border-color: #00ff9d;
      box-shadow: 0 0 14px rgba(0, 255, 157, 0.6);
      background: rgba(0, 255, 157, 0.15);
    }

    .nv-badge-btn svg {
      width: 14px;
      height: 14px;
      filter: drop-shadow(0 0 3px #00ff9d);
    }

    .nv-dropdown {
      position: absolute;
      width: 290px;
      background: rgba(4, 8, 16, 0.94);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(0, 255, 157, 0.45);
      border-radius: 10px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.75), 0 0 20px rgba(0, 255, 157, 0.18);
      color: #e0e8f5;
      font-size: 12px;
      overflow: hidden;
      z-index: 2147483647;
      animation: nv-fade-in 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
    }

    @keyframes nv-fade-in {
      from { opacity: 0; transform: translateY(-6px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .nv-dropdown-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      background: linear-gradient(180deg, rgba(0, 255, 157, 0.08), transparent);
      border-bottom: 1px solid rgba(0, 255, 157, 0.15);
    }

    .nv-brand-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 800;
      font-size: 11px;
      letter-spacing: 0.05em;
      color: #fff;
    }

    .nv-brand-title span {
      color: #00ff9d;
    }

    .nv-status-indicator {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      color: #8da4be;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .nv-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #00ff9d;
      box-shadow: 0 0 6px #00ff9d;
    }

    .nv-dropdown-body {
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .nv-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 10px;
      border-radius: 6px;
      cursor: pointer;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid transparent;
      transition: all 0.15s ease;
    }

    .nv-item:hover {
      background: rgba(0, 255, 157, 0.08);
      border-color: rgba(0, 255, 157, 0.3);
      transform: translateX(2px);
    }

    .nv-item-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .nv-item-domain {
      font-weight: 600;
      color: #ffffff;
      font-size: 12px;
    }

    .nv-item-sub {
      font-size: 10px;
      color: #8da4be;
    }

    .nv-btn-pill {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 4px 8px;
      background: linear-gradient(180deg, #00ff9d 0%, #00d4ff 100%);
      color: #04120a;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }

    .nv-action-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      color: #00d4ff;
      font-weight: 600;
      font-size: 11px;
      transition: all 0.15s;
    }

    .nv-action-row:hover {
      background: rgba(0, 212, 255, 0.1);
      color: #b6f4ff;
    }

    .nv-action-row svg {
      width: 14px;
      height: 14px;
    }

    .nv-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: rgba(4, 8, 16, 0.95);
      border: 1px solid #00ff9d;
      border-radius: 6px;
      padding: 8px 14px;
      color: #00ff9d;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      box-shadow: 0 4px 18px rgba(0, 255, 157, 0.25);
      z-index: 2147483647;
      animation: nv-fade-in 0.2s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }
  `;
  shadow.appendChild(styleEl);

  const shieldSvg = `
    <svg viewBox="0 0 64 74" fill="none">
      <path d="M32 2 60 14v22c0 18-12.6 30.4-28 36C16.6 66.4 4 54 4 36V14L32 2z" stroke="#00ff9d" stroke-width="3" fill="rgba(0,255,157,0.15)"/>
      <path d="M22 36l7 7 14-15" stroke="#00d4ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  let activeDropdown = null;
  let activeTargetInput = null;

  function showToast(msg) {
    const existing = shadow.querySelector('.nv-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'nv-toast';
    toast.innerHTML = `${shieldSvg}<span>${escapeHtml(msg)}</span>`;
    shadow.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  function generateSecurePassword(length = 24) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+~`|}{[]:;?><,./-=';
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    let pw = '';
    for (let i = 0; i < length; i++) pw += charset[arr[i] % charset.length];
    return pw;
  }

  // Explicit non-credential blacklist: addresses, shipping, billing, search, notes, etc.
  const NON_CREDENTIAL_KEYWORDS = [
    // Address & Location fields
    'address', 'addr', 'street', 'city', 'state', 'zip', 'zipcode', 'postal', 'postcode',
    'country', 'province', 'region', 'county', 'apt', 'suite', 'unit', 'floor', 'building',
    'po_box', 'pobox', 'door', 'delivery', 'shipping', 'billing', 'destination', 'location',
    // Search, Query & Filters
    'search', 'query', 'filter', 'keyword', 'find',
    // Non-credential Personal info
    'first_name', 'firstname', 'first-name', 'fname', 'last_name', 'lastname', 'last-name', 'lname',
    'middle_name', 'middlename', 'full_name', 'fullname', 'cardholder', 'bday', 'birthday', 'birthdate',
    'gender', 'sex', 'ssn', 'tax', 'vat', 'company', 'organization', 'department',
    // Financial / Payment
    'card', 'cc-', 'cc_', 'cvv', 'cvc', 'exp', 'expiry', 'coupon', 'promo', 'discount', 'voucher',
    // Generic Content / Communication
    'comment', 'message', 'note', 'notes', 'bio', 'description', 'feedback', 'review', 'subject', 'topic', 'qty', 'quantity', 'amount', 'price'
  ];

  const NON_CREDENTIAL_AUTOCOMPLETE = [
    'street-address', 'address-line1', 'address-line2', 'address-line3',
    'address-level1', 'address-level2', 'address-level3', 'address-level4',
    'country', 'country-name', 'postal-code', 'cc-name', 'cc-given-name',
    'cc-family-name', 'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year',
    'cc-csc', 'cc-type', 'shipping', 'billing', 'given-name', 'family-name',
    'additional-name', 'honorific-prefix', 'honorific-suffix', 'organization',
    'bday', 'sex', 'transaction-currency', 'transaction-amount'
  ];

  function isBlacklistedNonCredentialInput(el) {
    if (!el || el.tagName !== 'INPUT') return true;

    // Reject non-textual input types
    const type = (el.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset', 'search', 'date', 'datetime-local', 'month', 'week', 'time', 'number', 'range', 'color'].includes(type)) {
      return true;
    }

    // Reject known non-credential autocomplete attributes
    const auto = (el.getAttribute('autocomplete') || '').toLowerCase();
    for (const val of NON_CREDENTIAL_AUTOCOMPLETE) {
      if (auto.includes(val)) return true;
    }

    // Build probe text from attributes, label texts, and aria annotations
    const labels = Array.from(el.labels || []).map(l => l.innerText || l.textContent || '').join(' ');
    const probe = [
      el.name,
      el.id,
      el.placeholder,
      el.getAttribute('aria-label'),
      el.getAttribute('aria-description'),
      labels
    ].filter(Boolean).join(' ').toLowerCase();

    // Check against blacklisted keywords using word boundary or token boundary
    for (const keyword of NON_CREDENTIAL_KEYWORDS) {
      const regex = new RegExp(`(^|[^a-z0-9])${keyword}([^a-z0-9]|$)`, 'i');
      if (regex.test(probe)) {
        return true;
      }
    }

    return false;
  }

  function isPasswordInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.disabled || el.readOnly || el.type === 'hidden') return false;
    if (isBlacklistedNonCredentialInput(el)) return false;

    if (el.type === 'password') return true;
    const auto = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (auto === 'current-password' || auto === 'new-password') return true;

    const probe = [
      el.name,
      el.id,
      el.placeholder,
      el.getAttribute('aria-label')
    ].filter(Boolean).join(' ').toLowerCase();

    return /\b(password|passwd|pwd|passcode|secret_key|master_key)\b/i.test(probe);
  }

  function isIdentifierInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.disabled || el.readOnly || el.type === 'hidden') return false;
    if (isPasswordInput(el)) return false;
    if (isBlacklistedNonCredentialInput(el)) return false;

    const type = (el.type || '').toLowerCase();
    if (type !== 'text' && type !== 'email' && type !== 'tel' && type !== '') return false;

    const auto = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (auto.includes('username') || auto.includes('email')) return true;

    const labels = Array.from(el.labels || []).map(l => l.innerText || l.textContent || '').join(' ');
    const probe = [
      el.name,
      el.id,
      el.placeholder,
      el.getAttribute('aria-label'),
      labels
    ].filter(Boolean).join(' ').toLowerCase();

    // Strict positive credential check: username, email, user_id, login, signin, member_id, handle
    const isCred = /\b(username|user_id|userid|user_name|login_id|login|signin|sign_in|auth|member_id|handle|email)\b/i.test(probe);
    if (isCred) return true;

    if (type === 'email') return true;

    // Only accept tel/phone if the input specifically occurs in an auth context
    if (type === 'tel' || /\b(phone|mobile)\b/i.test(probe)) {
      if (/\b(login|auth|signin|sign_in|account|credential)\b/i.test(probe) || auto.includes('username')) {
        return true;
      }
    }

    return false;
  }

  function isLoginInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.disabled || el.readOnly || el.type === 'hidden') return false;
    return isPasswordInput(el) || isIdentifierInput(el);
  }

  function findFormContext(targetInput) {
    return targetInput.form ||
           targetInput.closest('form') ||
           targetInput.closest('[role="form"]') ||
           targetInput.closest('fieldset') ||
           targetInput.closest('.login-form, .signin-form, .auth-form, .signup-form') ||
           targetInput.closest('div, section, main') ||
           document.body;
  }

  function findPasswordField(context) {
    const passCandidates = Array.from(context.querySelectorAll('input[type="password"], input[autocomplete="current-password"], input[autocomplete="new-password"], input[type="text"]'));
    for (const cand of passCandidates) {
      if (isPasswordInput(cand)) return cand;
    }
    return null;
  }

  function findUsernameField(context, passField) {
    // 1. Direct positive match for username/email
    const inputs = Array.from(context.querySelectorAll('input:not([type="hidden"]):not([disabled]):not([readonly])'));
    for (const input of inputs) {
      if (input !== passField && isIdentifierInput(input)) {
        return input;
      }
    }

    // 2. Preceding input before password ONLY if it strictly qualifies as an identifier
    // (Never blindly select an address, name, or arbitrary text input!)
    if (passField) {
      const idx = inputs.indexOf(passField);
      if (idx > 0) {
        for (let i = idx - 1; i >= 0; i--) {
          const inp = inputs[i];
          if (isIdentifierInput(inp)) {
            return inp;
          }
        }
      }
    }

    return null;
  }

  function setNativeValue(input, value) {
    if (!input || value === undefined || value === null) return;
    input.focus();

    // Call native prototype setter to support React, Vue, Angular synthetic event loops
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (valueSetter) {
      valueSetter.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    input.blur();
  }

  function autofillCredentials(targetInput, { username, password }) {
    if (!targetInput) return;
    const context = findFormContext(targetInput);

    const passField = isPasswordInput(targetInput)
      ? targetInput
      : findPasswordField(context);

    const userField = (!isPasswordInput(targetInput) && isIdentifierInput(targetInput))
      ? targetInput
      : findUsernameField(context, passField);

    let filledUser = false;
    let filledPass = false;

    // Fill username / email / phone
    if (userField && username) {
      setNativeValue(userField, username);
      filledUser = true;
    }

    // Fill password
    if (passField && password) {
      setNativeValue(passField, password);
      filledPass = true;
    }

    // Direct fallback if target was clicked directly and not filled yet
    if (!filledUser && !filledPass) {
      if (isPasswordInput(targetInput) && password) {
        setNativeValue(targetInput, password);
        filledPass = true;
      } else if (username) {
        setNativeValue(targetInput, username);
        filledUser = true;
      }
    }

    const labels = [];
    if (filledUser) labels.push('username');
    if (filledPass) labels.push('password');
    const labelStr = labels.length ? labels.join(' & ') : 'credentials';

    showToast(`NexVault: Filled ${labelStr} for ${currentHostname}`);
    closeDropdown();
  }

  function closeDropdown() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
      activeTargetInput = null;
    }
  }

  async function openDropdown(inputEl, buttonEl) {
    if (activeDropdown) {
      closeDropdown();
      return;
    }

    activeTargetInput = inputEl;
    const rect = inputEl.getBoundingClientRect();

    const dropdown = document.createElement('div');
    dropdown.className = 'nv-dropdown';
    dropdown.style.left = `${window.scrollX + rect.left}px`;
    dropdown.style.top = `${window.scrollY + rect.bottom + 5}px`;

    dropdown.innerHTML = `
      <div class="nv-dropdown-header">
        <div class="nv-brand-title">
          ${shieldSvg}
          NEX<span>VAULT</span>
        </div>
        <div class="nv-status-indicator">
          <span class="nv-dot"></span>
          <span>Vault Active</span>
        </div>
      </div>
      <div class="nv-dropdown-body">
        <div class="nv-item" id="nv-matched-item">
          <div class="nv-item-info">
            <span class="nv-item-domain">${escapeHtml(currentHostname)}</span>
            <span class="nv-item-sub" id="nv-sub-text">Fetching vault credentials...</span>
          </div>
          <button class="nv-btn-pill" id="nv-fill-btn" type="button">Autofill</button>
        </div>
        <div class="nv-action-row" id="nv-gen-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          <span>Generate Strong Password</span>
        </div>
      </div>
    `;

    shadow.appendChild(dropdown);
    activeDropdown = dropdown;

    // Check credentials from desktop app
    chrome.runtime.sendMessage({
      action: 'get-password',
      serviceName: currentHostname
    }, (res) => {
      const subText = dropdown.querySelector('#nv-sub-text');
      const fillBtn = dropdown.querySelector('#nv-fill-btn');
      const matchedItem = dropdown.querySelector('#nv-matched-item');

      if (res && res.success && (res.password || res.username)) {
        if (subText) {
          if (res.username) {
            subText.textContent = `👤 ${res.username}`;
            subText.style.color = '#00ff9d';
          } else {
            subText.textContent = 'Saved credentials ready';
          }
        }
        matchedItem.onclick = () => autofillCredentials(inputEl, res);
        if (fillBtn) fillBtn.onclick = (e) => {
          e.stopPropagation();
          autofillCredentials(inputEl, res);
        };
      } else {
        if (subText) {
          subText.textContent = res?.error || ('No stored credentials for ' + currentHostname);
          if (res?.error) subText.style.color = '#ff6b81';
        }
        if (fillBtn) fillBtn.style.display = 'none';
        matchedItem.style.opacity = '0.7';
      }
    });

    // Generate strong password on click
    const genRow = dropdown.querySelector('#nv-gen-row');
    if (genRow) {
      genRow.onclick = () => {
        const generated = generateSecurePassword();
        autofillCredentials(inputEl, { password: generated, username: '' });
        navigator.clipboard.writeText(generated);
        showToast('Generated strong password & copied to clipboard');
      };
    }
  }

  // Detects if a "show/hide password" button, eye icon, or clear button is present near the right edge of the input
  function detectRightOffset(inputEl, inputRect) {
    let offset = 28; // Default margin from right edge

    // 1. Check computed padding-right of the input element
    try {
      const cs = window.getComputedStyle(inputEl);
      const pr = parseFloat(cs.paddingRight) || 0;
      if (pr >= 32) {
        offset = Math.max(offset, pr + 16);
      }
    } catch {}

    // 2. Scan parent and container for visible toggle/reveal button or icon
    const container = inputEl.parentElement;
    if (!container) return offset;

    const scanRoots = [container];
    if (container.parentElement && !['FORM', 'BODY', 'HTML'].includes(container.parentElement.tagName)) {
      scanRoots.push(container.parentElement);
    }

    let maxElementOffset = 0;

    for (const root of scanRoots) {
      const candidates = root.querySelectorAll('button, [role="button"], svg, i, span, div, a');
      for (const el of candidates) {
        if (el === inputEl || el.contains(inputEl)) continue;

        // Skip hidden or collapsed elements
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) continue;

        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;

        // Verify vertical alignment with the input field
        const inputMidY = (inputRect.top + inputRect.bottom) / 2;
        const elMidY = (r.top + r.bottom) / 2;
        if (Math.abs(inputMidY - elMidY) > inputRect.height * 0.6) continue;

        // Check if element is positioned within the right section of the input
        if (r.right <= inputRect.right + 12 && r.left >= inputRect.right - 95 && r.left < inputRect.right - 4) {
          const text = (el.textContent || '').trim().toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          const title = (el.getAttribute('title') || '').toLowerCase();
          const className = String(el.className || '').toLowerCase();

          const isActionIndicator = 
            text === 'show' || text === 'hide' || text.includes('reveal') || text.includes('view') ||
            aria.includes('show') || aria.includes('hide') || aria.includes('password') ||
            aria.includes('reveal') || aria.includes('view') || aria.includes('toggle') ||
            title.includes('show') || title.includes('hide') || title.includes('password') ||
            className.includes('show') || className.includes('hide') || className.includes('eye') ||
            className.includes('reveal') || className.includes('toggle') || className.includes('view') ||
            el.tagName === 'BUTTON' || el.tagName === 'SVG' || s.cursor === 'pointer';

          if (isActionIndicator) {
            // Position NexVault badge cleanly to the left of this reveal button
            const neededOffset = (inputRect.right - r.left) + 26;
            if (neededOffset > maxElementOffset) {
              maxElementOffset = neededOffset;
            }
          }
        }
      }
    }

    if (maxElementOffset > offset) {
      offset = maxElementOffset;
    }

    return offset;
  }

  // Position badge inside the right side of the input field with dynamic collision avoidance
  function updateBadgePosition(inputEl, badgeEl) {
    if (!document.contains(inputEl)) {
      badgeEl.remove();
      return;
    }
    const rect = inputEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || window.getComputedStyle(inputEl).display === 'none') {
      badgeEl.style.display = 'none';
      return;
    }
    const rightOffset = detectRightOffset(inputEl, rect);
    badgeEl.style.display = 'flex';
    badgeEl.style.left = `${window.scrollX + rect.right - rightOffset}px`;
    badgeEl.style.top = `${window.scrollY + rect.top + (rect.height - 22) / 2}px`;
  }

  const trackedInputs = new Set();

  function attachInFieldBadge(inputEl) {
    if (trackedInputs.has(inputEl)) return;
    trackedInputs.add(inputEl);

    const badge = document.createElement('div');
    badge.className = 'nv-badge-btn';
    badge.title = 'NexVault: Click to autofill username & password';
    badge.innerHTML = shieldSvg;
    shadow.appendChild(badge);

    const updatePos = () => updateBadgePosition(inputEl, badge);
    updatePos();

    badge.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDropdown(inputEl, badge);
    });

    window.addEventListener('resize', updatePos, { passive: true });
    window.addEventListener('scroll', updatePos, { passive: true });

    // Dynamic repositioning on user interaction (typing, focus, change)
    inputEl.addEventListener('input', () => {
      updatePos();
      setTimeout(updatePos, 40);
      setTimeout(updatePos, 150);
    });
    inputEl.addEventListener('keyup', updatePos);
    inputEl.addEventListener('change', updatePos);

    // Watch for dynamic DOM changes inside parent container (e.g. Instagram adding "Show" button on input)
    if (inputEl.parentElement && typeof MutationObserver !== 'undefined') {
      const containerObserver = new MutationObserver(() => updatePos());
      containerObserver.observe(inputEl.parentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden']
      });
    }

    // Focus triggers badge highlight
    inputEl.addEventListener('focus', () => {
      updatePos();
      badge.style.borderColor = '#00ff9d';
      badge.style.boxShadow = '0 0 12px rgba(0, 255, 157, 0.6)';
    });

    inputEl.addEventListener('blur', () => {
      badge.style.borderColor = 'rgba(0, 255, 157, 0.5)';
      badge.style.boxShadow = '0 0 8px rgba(0, 255, 157, 0.3)';
    });
  }

  function scanInputs() {
    const selector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])';
    document.querySelectorAll(selector).forEach((input) => {
      if (input.offsetWidth < 50 || input.offsetHeight < 18) return;
      if (isLoginInput(input)) {
        attachInFieldBadge(input);
      }
    });
  }

  // Initial scan & dynamic observer for Single Page Apps (React/Next/Vue)
  scanInputs();
  const observer = new MutationObserver(() => scanInputs());
  observer.observe(document.body, { childList: true, subtree: true });

  // Close dropdown on click outside
  document.addEventListener('mousedown', (e) => {
    if (!activeDropdown) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (!path.includes(hostEl)) {
      closeDropdown();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDropdown();
  });

  // Message listener from popup / background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fill-credentials' && (request.password || request.username)) {
      const activeInput = document.activeElement && document.activeElement.tagName === 'INPUT'
        ? document.activeElement
        : (document.querySelector('input[type="password"]') || document.querySelector('input[type="email"], input[autocomplete="username"]'));

      if (activeInput) {
        autofillCredentials(activeInput, request);
        sendResponse({ success: true });
      } else {
        showToast('NexVault: No target login field found on page');
        sendResponse({ success: false });
      }
      return true;
    }
  });

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": "'" }[c]));
  }
})();
