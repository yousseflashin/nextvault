package com.nexvault.app;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Context;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * NexVault Accessibility Service
 * 
 * Provides resilient, system-wide autofill and floating overlay on top of web browsers
 * (Chrome, Brave, Firefox, Edge, Opera, Samsung Internet) and native Android applications.
 * 
 * Strictly excludes addresses, shipping/billing fields, search boxes, and non-credential inputs.
 */
public class NexVaultAccessibilityService extends AccessibilityService {
    private static final String TAG = "NexVaultA11y";

    private WindowManager windowManager;
    private View overlayView;
    private boolean isOverlayShowing = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable autoDismissRunnable;

    private static final Set<String> BROWSER_PACKAGES = new HashSet<>(Arrays.asList(
        "com.android.chrome",
        "com.chrome.beta",
        "com.chrome.dev",
        "com.chrome.canary",
        "org.chromium.chrome",
        "com.brave.browser",
        "org.mozilla.firefox",
        "org.mozilla.fenix",
        "com.microsoft.emmx",
        "com.sec.android.app.sbrowser",
        "com.opera.browser",
        "com.opera.mini.native",
        "com.opera.touch",
        "com.duckduckgo.mobile.android",
        "com.vivaldi.browser"
    ));

    private static final String BLACKLIST_REGEX = ".*\\b("
        + "address|addr|street|city|state|zip|zipcode|postal|postcode|country|province|region|county|"
        + "apt|suite|unit|floor|building|po_box|pobox|door|delivery|shipping|billing|destination|location|"
        + "search|query|filter|find|keyword|"
        + "first_name|firstname|fname|last_name|lastname|lname|middle_name|full_name|fullname|cardholder|bday|birthday|gender|sex|tax|vat|company|"
        + "card|cvv|cvc|exp|coupon|promo|discount|voucher|"
        + "comment|message|note|notes|bio|description|feedback|review|subject|qty|quantity|amount|price"
        + ")\\b.*";

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        AccessibilityServiceInfo info = getServiceInfo();
        if (info != null) {
            info.eventTypes = AccessibilityEvent.TYPE_VIEW_FOCUSED
                | AccessibilityEvent.TYPE_VIEW_CLICKED
                | AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED
                | AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                | AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED;
            info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
            info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
                | AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
                | AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
            info.notificationTimeout = 100;
            setServiceInfo(info);
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        int eventType = event.getEventType();

        if (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            CharSequence pkg = event.getPackageName();
            if (pkg != null && pkg.toString().equals(getPackageName())) {
                // Don't show overlay inside NexVault itself
                hideOverlay();
                return;
            }
        }

        if (eventType == AccessibilityEvent.TYPE_VIEW_FOCUSED
            || eventType == AccessibilityEvent.TYPE_VIEW_CLICKED
            || eventType == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED
            || eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            AccessibilityNodeInfo source = event.getSource();
            if (source != null) {
                try {
                    String packageName = event.getPackageName() != null ? event.getPackageName().toString() : "";
                    AccessibilityNodeInfo focused = source.isEditable() ? source : findFocusedEditable(source);
                    if (focused == null) {
                        AccessibilityNodeInfo root = getRootInActiveWindow();
                        focused = findFocusedEditable(root);
                        if (root != null && root != focused) root.recycle();
                    }
                    if (focused != null) {
                        handleFocusedNode(focused, packageName);
                        if (focused != source) focused.recycle();
                    } else {
                        hideOverlay();
                    }
                } finally {
                    source.recycle();
                }
            }
        }
    }

    private void handleFocusedNode(AccessibilityNodeInfo node, String packageName) {
        if (node == null || !node.isEditable()) {
            return;
        }

        // 1. Strict blacklist check: skip addresses, search boxes, shipping, etc.
        if (isBlacklistedNode(node)) {
            hideOverlay();
            return;
        }

        // 2. Identify if this is a credential field
        boolean isPass = isPasswordNode(node);
        boolean isUser = isUsernameNode(node);

        if (!isPass && !isUser) {
            hideOverlay();
            return;
        }

        // 3. Extract web domain if running inside a browser, or use package name for native apps
        String targetDomain = "";
        boolean isBrowser = BROWSER_PACKAGES.contains(packageName);
        if (isBrowser) {
            targetDomain = extractBrowserDomain();
        }
        if (targetDomain.isEmpty()) {
            targetDomain = normalizePackageName(packageName);
        }

        if (targetDomain.isEmpty()) {
            hideOverlay();
            return;
        }

        // 4. Query credentials matching this domain/package
        List<JSONObject> matchingCreds = findCredentialsForDomain(targetDomain);
        if (!matchingCreds.isEmpty()) {
            final String resolvedDomain = targetDomain;
            JSONObject topCred = matchingCreds.get(0);
            String serviceName = topCred.optString("service", resolvedDomain);
            String username = topCred.optString("username", "");
            String password = topCred.optString("password", "");

            showOverlay(serviceName, username, (view) -> {
                performAutofill(resolvedDomain, username, password, isPass);
                hideOverlay();
            });
        } else if (isPass) {
            // Option to generate strong password
            showOverlay(targetDomain, "Generate Strong Password", (view) -> {
                String generated = generateStrongPassword(20);
                fillNodeText(node, generated);
                hideOverlay();
            });
        } else {
            hideOverlay();
        }
    }

    private boolean isBlacklistedNode(AccessibilityNodeInfo node) {
        if (node == null) return true;

        String probe = getNodeProbe(node);
        if (probe.matches(BLACKLIST_REGEX)) {
            return true;
        }

        // Check view IDs and class names
        String viewId = node.getViewIdResourceName();
        if (viewId != null && viewId.toLowerCase(Locale.ROOT).matches(BLACKLIST_REGEX)) {
            return true;
        }

        return false;
    }

    private boolean isPasswordNode(AccessibilityNodeInfo node) {
        if (node.isPassword()) return true;

        int inputType = node.getInputType();
        int variation = inputType & 0x00000ff0;
        if (variation == 0x00000080
            || variation == 0x00000090
            || variation == 0x000000e0
            || variation == 0x00000010) {
            return true;
        }

        String probe = getNodeProbe(node);
        return probe.matches(".*\\b(password|passwd|pwd|passcode|secret_key|master_key)\\b.*");
    }

    private boolean isUsernameNode(AccessibilityNodeInfo node) {
        if (isPasswordNode(node)) return false;

        String probe = getNodeProbe(node);
        if (probe.matches(".*\\b(username|user_id|userid|user_name|login_id|login|signin|sign_in|auth|member_id|handle|email|user)\\b.*")) {
            return true;
        }

        // Only allow phone if specifically coupled with login context
        if (probe.matches(".*\\b(phone|mobile)\\b.*") && probe.matches(".*\\b(login|auth|signin|account)\\b.*")) {
            return true;
        }

        return false;
    }

    private String getNodeProbe(AccessibilityNodeInfo node) {
        StringBuilder sb = new StringBuilder();
        if (node.getViewIdResourceName() != null) sb.append(node.getViewIdResourceName()).append(" ");
        if (node.getText() != null) sb.append(node.getText()).append(" ");
        if (node.getContentDescription() != null) sb.append(node.getContentDescription()).append(" ");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.getHintText() != null) {
            sb.append(node.getHintText()).append(" ");
        }
        return sb.toString().toLowerCase(Locale.ROOT);
    }

    private String extractBrowserDomain() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return "";

        try {
            // Find address / URL bar node
            List<AccessibilityNodeInfo> candidates = new ArrayList<>();
            findUrlBarNodes(root, candidates);

            for (AccessibilityNodeInfo candidate : candidates) {
                CharSequence text = candidate.getText();
                if (text != null && text.length() > 0) {
                    String domain = cleanUrl(text.toString());
                    if (!domain.isEmpty() && domain.contains(".")) {
                        return domain;
                    }
                }
            }
        } catch (Exception ignored) {
        } finally {
            root.recycle();
        }
        return "";
    }

    private void findUrlBarNodes(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> out) {
        if (node == null || out.size() >= 3) return;

        String resId = node.getViewIdResourceName();
        if (resId != null) {
            String lower = resId.toLowerCase(Locale.ROOT);
            if (lower.contains("url_bar") || lower.contains("location_bar") || lower.contains("search_box")
                || lower.contains("omnibox") || lower.contains("mozac_browser_toolbar_url_view")
                || lower.contains("toolbar_title") || lower.contains("address_bar")) {
                out.add(node);
                return;
            }
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                findUrlBarNodes(child, out);
            }
        }
    }

    private String cleanUrl(String raw) {
        if (raw == null) return "";
        String s = raw.trim().toLowerCase(Locale.ROOT);
        s = s.replaceFirst("^[a-z]+://", "");
        s = s.replaceFirst("^www\\.", "");
        int slashIdx = s.indexOf('/');
        if (slashIdx >= 0) {
            s = s.substring(0, slashIdx);
        }
        int queryIdx = s.indexOf('?');
        if (queryIdx >= 0) {
            s = s.substring(0, queryIdx);
        }
        return s;
    }

    private String normalizePackageName(String pkg) {
        if (pkg == null) return "";
        String s = pkg.trim().toLowerCase(Locale.ROOT);
        return s;
    }

    private List<JSONObject> findCredentialsForDomain(String domain) {
        List<JSONObject> matches = new ArrayList<>();
        if (domain == null || domain.isEmpty()) return matches;

        try {
            String jsonStr = NativeCredentialStore.read(this);
            JSONArray array = new JSONArray(jsonStr);
            String normTarget = cleanUrl(domain);
            String targetStem = packageStem(normTarget);

            for (int i = 0; i < array.length(); i++) {
                JSONObject cred = array.getJSONObject(i);
                String service = cleanUrl(cred.optString("service", ""));
                if (service.isEmpty()) continue;

                String serviceStem = packageStem(service);
                if (service.equals(normTarget)
                    || service.contains(normTarget)
                    || normTarget.contains(service)
                    || (!targetStem.isEmpty() && targetStem.equals(serviceStem))) {
                    matches.add(cred);
                }
            }
        } catch (Exception ignored) {}

        return matches;
    }

    private String packageStem(String value) {
        if (value == null || value.isEmpty()) return "";
        String[] parts = value.toLowerCase(Locale.ROOT).split("\\.");
        for (int i = parts.length - 1; i >= 0; i--) {
            String part = parts[i];
            if (!part.isEmpty()
                && !part.equals("android")
                && !part.equals("app")
                && !part.equals("com")
                && !part.equals("org")
                && !part.equals("net")
                && !part.equals("io")
                && !part.equals("co")) return part;
        }
        return "";
    }

    private AccessibilityNodeInfo findFocusedEditable(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isEditable() && node.isFocused()) return node;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            AccessibilityNodeInfo focused = findFocusedEditable(child);
            if (focused != null) return focused;
            if (child != null) child.recycle();
        }
        return null;
    }

    private void performAutofill(String domain, String username, String password, boolean isPassFocused) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;

        try {
            List<AccessibilityNodeInfo> editables = new ArrayList<>();
            collectEditableNodes(root, editables);

            AccessibilityNodeInfo usernameNode = null;
            AccessibilityNodeInfo passwordNode = null;

            for (AccessibilityNodeInfo node : editables) {
                if (isBlacklistedNode(node)) continue;

                if (passwordNode == null && isPasswordNode(node)) {
                    passwordNode = node;
                } else if (usernameNode == null && isUsernameNode(node)) {
                    usernameNode = node;
                }
            }

            if (usernameNode != null && !username.isEmpty()) {
                fillNodeText(usernameNode, username);
            }
            if (passwordNode != null && !password.isEmpty()) {
                fillNodeText(passwordNode, password);
            }
        } catch (Exception ignored) {
        } finally {
            root.recycle();
        }
    }

    private void collectEditableNodes(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> out) {
        if (node == null) return;
        if (node.isEditable()) {
            out.add(node);
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectEditableNodes(child, out);
            }
        }
    }

    private void fillNodeText(AccessibilityNodeInfo node, String text) {
        if (node == null || text == null) return;
        node.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        Bundle arguments = new Bundle();
        arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments);
    }

    private void showOverlay(String title, String subtitle, View.OnClickListener onAutofillClick) {
        mainHandler.post(() -> {
            try {
                if (overlayView == null) {
                    LayoutInflater inflater = LayoutInflater.from(this);
                    overlayView = inflater.inflate(R.layout.autofill_overlay_pill, null);
                }

                TextView titleTv = overlayView.findViewById(R.id.overlay_title);
                TextView subtitleTv = overlayView.findViewById(R.id.overlay_subtitle);
                View closeBtn = overlayView.findViewById(R.id.overlay_close);

                titleTv.setText("NEXVAULT  •  " + title);
                subtitleTv.setText(subtitle);

                overlayView.setOnClickListener(onAutofillClick);
                closeBtn.setOnClickListener((v) -> hideOverlay());

                if (!isOverlayShowing) {
                    WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                        PixelFormat.TRANSLUCENT
                    );
                    params.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
                    params.y = dpToPx(72); // Floating neatly above typical navigation / keyboard bar

                    windowManager.addView(overlayView, params);
                    isOverlayShowing = true;
                }

                // Schedule auto dismiss in 12 seconds
                if (autoDismissRunnable != null) {
                    mainHandler.removeCallbacks(autoDismissRunnable);
                }
                autoDismissRunnable = this::hideOverlay;
                mainHandler.postDelayed(autoDismissRunnable, 12000);

            } catch (Exception ignored) {}
        });
    }

    private void hideOverlay() {
        mainHandler.post(() -> {
            try {
                if (isOverlayShowing && overlayView != null && overlayView.getParent() != null) {
                    windowManager.removeView(overlayView);
                    isOverlayShowing = false;
                }
                if (autoDismissRunnable != null) {
                    mainHandler.removeCallbacks(autoDismissRunnable);
                    autoDismissRunnable = null;
                }
            } catch (Exception ignored) {}
        });
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }

    private String generateStrongPassword(int length) {
        String chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+~=";
        SecureRandom random = new SecureRandom();
        StringBuilder sb = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            sb.append(chars.charAt(random.nextInt(chars.length())));
        }
        return sb.toString();
    }

    @Override
    public void onInterrupt() {
        hideOverlay();
    }

    @Override
    public void onDestroy() {
        hideOverlay();
        super.onDestroy();
    }
}
