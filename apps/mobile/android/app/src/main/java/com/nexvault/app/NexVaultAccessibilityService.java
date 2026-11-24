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
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.ImageView;
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

    private static final Set<String> EXCLUDED_PACKAGES = new HashSet<>(Arrays.asList(
        "com.whatsapp",
        "com.whatsapp.w4b",
        "org.telegram.messenger",
        "org.telegram.messenger.web",
        "org.thoughtcrime.securesms",
        "com.facebook.orca",
        "com.facebook.mlite",
        "com.google.android.apps.messaging",
        "com.samsung.android.messaging",
        "com.discord",
        "com.slack",
        "com.viber.voip",
        "com.skype.raider",
        "com.google.android.talk",
        "com.snapchat.android",
        "com.google.android.googlequicksearchbox",
        "com.google.android.dialer",
        "com.android.dialer",
        "com.samsung.android.dialer",
        "com.android.calculator2",
        "com.google.android.calculator",
        "com.google.android.keep",
        "com.google.android.calendar",
        "com.google.android.apps.maps",
        "com.google.android.youtube",
        "com.android.systemui",
        "com.android.settings"
    ));

    private boolean isExcludedPackage(String pkg) {
        if (pkg == null || pkg.isEmpty()) return false;
        String lower = pkg.toLowerCase(Locale.ROOT);
        if (EXCLUDED_PACKAGES.contains(lower)) return true;
        if (lower.contains("launcher") || lower.contains("inputmethod") || lower.contains("keyboard")) return true;
        return false;
    }

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

        // 0. Completely silence overlay in excluded messaging and utility apps
        if (isExcludedPackage(packageName)) {
            hideOverlay();
            return;
        }

        // Skip multi-line inputs (chat messages, comments, notes)
        if (node.isMultiLine() || (node.getInputType() & 0x00020000) != 0 || (node.getInputType() & 0x00040000) != 0) {
            hideOverlay();
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

        // 4. Query credentials matching this domain/package
        List<JSONObject> matchingCreds = findCredentialsForDomain(targetDomain);
        if (matchingCreds.isEmpty()) {
            matchingCreds = getAllCredentials();
        }
        Rect nodeBounds = new Rect();
        node.getBoundsInScreen(nodeBounds);

        if (!matchingCreds.isEmpty()) {
            final String resolvedDomain = targetDomain;
            JSONObject topCred = matchingCreds.get(0);
            String serviceName = topCred.optString("service", resolvedDomain);
            String username = topCred.optString("username", "");
            String password = topCred.optString("password", "");

            showOverlay(serviceName, username, false, nodeBounds, (view) -> {
                performAutofill(resolvedDomain, username, password, isPass);
                hideOverlay();
            });
        } else if (isPass) {
            // Option to generate strong password anchored relative to this password field
            showOverlay(targetDomain.isEmpty() ? "NexVault" : targetDomain, "⚡ Generate Strong Password", true, nodeBounds, (view) -> {
                String generated = generateStrongPassword(24);
                fillNodeText(node, generated);
                hideOverlay();
            });
        } else {
            hideOverlay();
        }
    }

    private boolean isBlacklistedNode(AccessibilityNodeInfo node) {
        if (node == null) return true;

        // 1. Check Class Name for SearchView or SearchBar widgets
        CharSequence className = node.getClassName();
        if (className != null) {
            String cls = className.toString().toLowerCase(Locale.ROOT);
            if (cls.contains("searchview") || cls.contains("searchbar") || cls.contains("searchautocomplete")) {
                return true;
            }
        }

        // 2. Reject search / filter input variations
        int inputType = node.getInputType();
        int variation = inputType & 0x00000ff0;
        if (variation == 0x000000b0 // TYPE_TEXT_VARIATION_FILTER
            || variation == 0x000000c0 // TYPE_TEXT_VARIATION_WEB_SEARCH_RESULT
            || variation == 0x000000a0 // TYPE_TEXT_VARIATION_POSTAL_ADDRESS
        ) {
            return true;
        }

        String probe = getNodeProbe(node);
        if (probe.contains("search") || probe.contains("query") || probe.contains("filter") || probe.contains("find") || probe.contains("keyword") || probe.contains("lookup")) {
            return true;
        }

        if (probe.matches(BLACKLIST_REGEX)) {
            return true;
        }

        // Check view IDs
        String viewId = node.getViewIdResourceName();
        if (viewId != null) {
            String lowerId = viewId.toLowerCase(Locale.ROOT);
            if (lowerId.contains("search") || lowerId.contains("query") || lowerId.contains("filter")
                || lowerId.contains("find") || lowerId.contains("lookup") || lowerId.contains("keyword")
                || lowerId.contains("omnibox") || lowerId.contains("url_bar") || lowerId.contains("address_bar")) {
                return true;
            }
            if (lowerId.matches(BLACKLIST_REGEX)) {
                return true;
            }
        }

        return false;
    }

    private boolean isPasswordNode(AccessibilityNodeInfo node) {
        if (isBlacklistedNode(node)) return false;
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
        if (node == null || !node.isEditable()) return false;
        if (isPasswordNode(node)) return false;
        if (isBlacklistedNode(node)) return false;

        int inputType = node.getInputType();
        int variation = inputType & 0x00000ff0;
        if (variation == 0x00000020 // TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            || variation == 0x000000d0 // TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS
        ) {
            return true;
        }

        String probe = getNodeProbe(node);
        if (probe.matches(".*\\b(username|user_id|userid|user_name|login_id|login|signin|sign_in|member_id|handle|email)\\b.*")) {
            return true;
        }

        // Only allow phone if specifically coupled with login context
        if (probe.matches(".*\\b(phone|mobile)\\b.*") && probe.matches(".*\\b(login|auth|signin|account)\\b.*")) {
            return true;
        }

        // If the form/window contains an editable password field, this editable field is the username field
        if (hasAdjacentPasswordField()) {
            return true;
        }

        return false;
    }

    private boolean hasAdjacentPasswordField() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        try {
            List<AccessibilityNodeInfo> editables = new ArrayList<>();
            collectEditableNodes(root, editables);
            for (AccessibilityNodeInfo e : editables) {
                if (e != null && isPasswordNode(e)) {
                    return true;
                }
            }
        } catch (Exception ignored) {
        } finally {
            root.recycle();
        }
        return false;
    }

    private String getNodeProbe(AccessibilityNodeInfo node) {
        StringBuilder sb = new StringBuilder();
        if (node.getViewIdResourceName() != null) sb.append(node.getViewIdResourceName()).append(" ");
        if (node.getContentDescription() != null) sb.append(node.getContentDescription()).append(" ");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.getHintText() != null) {
            sb.append(node.getHintText()).append(" ");
        }
        // Inspect placeholder/text if short and indicative of credentials
        CharSequence text = node.getText();
        if (text != null && text.length() > 0 && text.length() <= 40) {
            String lower = text.toString().toLowerCase(Locale.ROOT);
            if (lower.contains("user") || lower.contains("email") || lower.contains("login")
                || lower.contains("pass") || lower.contains("sign in") || lower.contains("account")) {
                sb.append(lower).append(" ");
            }
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
        CharSequence text = node.getText();
        CharSequence hint = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? node.getHintText() : null;
        String textValue = text == null ? "" : text.toString();
        String hintValue = hint == null ? "" : hint.toString().toLowerCase(Locale.ROOT);
        if (resId != null) {
            String lower = resId.toLowerCase(Locale.ROOT);
            if (lower.contains("url_bar") || lower.contains("location_bar") || lower.contains("search_box")
                || lower.contains("omnibox") || lower.contains("mozac_browser_toolbar_url_view")
                || lower.contains("toolbar_title") || lower.contains("address_bar")) {
                out.add(node);
                return;
            }
        }
        if (!textValue.isEmpty() && isLikelyUrl(textValue)) {
            out.add(node);
            return;
        }

        CharSequence desc = node.getContentDescription();
        String descValue = desc == null ? "" : desc.toString();
        if (!descValue.isEmpty() && isLikelyUrl(descValue)) {
            out.add(node);
            return;
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                findUrlBarNodes(child, out);
            }
        }
    }

    private boolean isLikelyUrl(String value) {
        String candidate = value.trim().toLowerCase(Locale.ROOT);
        return candidate.matches("^(https?://)?[a-z0-9][a-z0-9.-]+\\.[a-z]{2,}([/:].*)?$");
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
            String targetStem = extractStem(normTarget);

            for (int i = 0; i < array.length(); i++) {
                JSONObject cred = array.getJSONObject(i);
                String service = cleanUrl(cred.optString("service", ""));
                if (service.isEmpty()) continue;

                String serviceStem = extractStem(service);
                boolean matched = false;

                // 1. Direct or subdomain match
                if (service.equalsIgnoreCase(normTarget)
                    || normTarget.endsWith("." + service)
                    || service.endsWith("." + normTarget)
                    || (!serviceStem.isEmpty() && !targetStem.isEmpty() && serviceStem.equalsIgnoreCase(targetStem))) {
                    matched = true;
                }

                // 2. Package segment matching for native apps (e.g. "com.spotify.music" -> "spotify")
                if (!matched && normTarget.contains(".")) {
                    String[] segments = normTarget.split("\\.");
                    for (String seg : segments) {
                        if (seg.length() > 2 && !isGenericSegment(seg)) {
                            if (seg.equalsIgnoreCase(serviceStem) || service.toLowerCase(Locale.ROOT).contains(seg)) {
                                matched = true;
                                break;
                            }
                        }
                    }
                }

                if (!matched && service.contains(".")) {
                    String[] segments = service.split("\\.");
                    for (String seg : segments) {
                        if (seg.length() > 2 && !isGenericSegment(seg)) {
                            if (seg.equalsIgnoreCase(targetStem) || normTarget.toLowerCase(Locale.ROOT).contains(seg)) {
                                matched = true;
                                break;
                            }
                        }
                    }
                }

                if (matched) {
                    matches.add(cred);
                }
            }
        } catch (Exception ignored) {}

        return matches;
    }

    private List<JSONObject> getAllCredentials() {
        List<JSONObject> list = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(NativeCredentialStore.read(this));
            for (int i = 0; i < array.length(); i++) {
                JSONObject credential = array.getJSONObject(i);
                if (!credential.optString("username").isEmpty() || !credential.optString("password").isEmpty()) {
                    list.add(credential);
                }
            }
        } catch (Exception ignored) {}
        return list;
    }

    private static boolean isGenericSegment(String seg) {
        String s = seg.toLowerCase(Locale.ROOT);
        return s.equals("com") || s.equals("android") || s.equals("app") || s.equals("org")
            || s.equals("net") || s.equals("io") || s.equals("co") || s.equals("google")
            || s.equals("mobile") || s.equals("client") || s.equals("ui") || s.equals("main");
    }

    private static String extractStem(String host) {
        if (host == null || host.isEmpty()) return "";
        String clean = host.toLowerCase(Locale.ROOT).replaceAll("^(https?://)?(www\\.)?", "");
        int slash = clean.indexOf('/');
        if (slash >= 0) clean = clean.substring(0, slash);
        int colon = clean.indexOf(':');
        if (colon >= 0) clean = clean.substring(0, colon);

        int lastDot = clean.lastIndexOf('.');
        String withoutTld = (lastDot > 0) ? clean.substring(0, lastDot) : clean;
        int prevDot = withoutTld.lastIndexOf('.');
        return (prevDot >= 0) ? withoutTld.substring(prevDot + 1) : withoutTld;
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
                } else if (usernameNode == null && !isPasswordNode(node)) {
                    // Some native apps expose no username hint or resource id.
                    // Once a password field exists, the remaining editable login
                    // field is the safest username candidate.
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

    private void showOverlay(String title, String subtitle, boolean isGenerator, Rect nodeBounds, View.OnClickListener onAutofillClick) {
        mainHandler.post(() -> {
            try {
                if (overlayView == null) {
                    LayoutInflater inflater = LayoutInflater.from(this);
                    overlayView = inflater.inflate(R.layout.autofill_overlay_pill, null);
                    setupDraggableOverlay();
                }

                ImageView iconIv = overlayView.findViewById(R.id.overlay_icon);
                TextView titleTv = overlayView.findViewById(R.id.overlay_title);
                TextView subtitleTv = overlayView.findViewById(R.id.overlay_subtitle);
                View closeBtn = overlayView.findViewById(R.id.overlay_close);

                if (isGenerator) {
                    if (iconIv != null) iconIv.setImageResource(R.drawable.ic_nexvault_generator);
                    titleTv.setText("Generate Strong Password");
                    subtitleTv.setText(subtitle.isEmpty() ? "⚡ 24-char cryptographic password" : subtitle);
                } else {
                    if (iconIv != null) iconIv.setImageResource(R.drawable.ic_nexvault_key);
                    titleTv.setText("NEXVAULT  •  " + title);
                    subtitleTv.setText(subtitle.isEmpty() ? "Autofill credentials" : subtitle);
                }

                overlayView.setOnClickListener(onAutofillClick);
                closeBtn.setOnClickListener((v) -> hideOverlay());

                // Calculate relative position based on the focused input field bounds
                android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
                int screenWidth = dm.widthPixels;
                int screenHeight = dm.heightPixels;

                overlayView.measure(
                    View.MeasureSpec.makeMeasureSpec(screenWidth, View.MeasureSpec.AT_MOST),
                    View.MeasureSpec.makeMeasureSpec(screenHeight, View.MeasureSpec.AT_MOST)
                );
                int pillWidth = overlayView.getMeasuredWidth();
                int pillHeight = overlayView.getMeasuredHeight();
                if (pillWidth <= 0) pillWidth = dpToPx(240);
                if (pillHeight <= 0) pillHeight = dpToPx(48);

                int margin = dpToPx(8);
                int targetX;
                int targetY;

                if (nodeBounds != null && nodeBounds.width() > 0 && nodeBounds.height() > 0) {
                    // Position vertically: prefer directly ABOVE the field so soft keyboard does not cover it
                    if (nodeBounds.top >= pillHeight + margin + dpToPx(36)) {
                        targetY = nodeBounds.top - pillHeight - margin;
                    } else {
                        // Near the top of the screen: position directly BELOW the field
                        targetY = nodeBounds.bottom + margin;
                    }

                    // Position horizontally: align with the start of the field
                    targetX = nodeBounds.left;
                } else {
                    targetX = (screenWidth - pillWidth) / 2;
                    targetY = screenHeight / 3;
                }

                // Clamp to safe screen margins
                int minX = dpToPx(12);
                int maxX = Math.max(minX, screenWidth - pillWidth - dpToPx(12));
                if (targetX < minX) targetX = minX;
                if (targetX > maxX) targetX = maxX;

                int minY = dpToPx(36); // below status bar
                int maxY = Math.max(minY, screenHeight - pillHeight - dpToPx(96)); // above nav bar
                if (targetY < minY) targetY = minY;
                if (targetY > maxY) targetY = maxY;

                WindowManager.LayoutParams params;
                if (!isOverlayShowing || overlayView.getParent() == null) {
                    params = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                        PixelFormat.TRANSLUCENT
                    );
                    params.gravity = Gravity.TOP | Gravity.START;
                    params.x = targetX;
                    params.y = targetY;

                    windowManager.addView(overlayView, params);
                    isOverlayShowing = true;
                } else {
                    params = (WindowManager.LayoutParams) overlayView.getLayoutParams();
                    params.gravity = Gravity.TOP | Gravity.START;
                    params.x = targetX;
                    params.y = targetY;
                    windowManager.updateViewLayout(overlayView, params);
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

    private void setupDraggableOverlay() {
        if (overlayView == null) return;
        overlayView.setOnTouchListener(new View.OnTouchListener() {
            private int initialX;
            private int initialY;
            private float initialTouchX;
            private float initialTouchY;
            private boolean isDragging = false;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                if (overlayView == null || overlayView.getLayoutParams() == null) return false;
                WindowManager.LayoutParams lp = (WindowManager.LayoutParams) overlayView.getLayoutParams();

                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialX = lp.x;
                        initialY = lp.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        isDragging = false;
                        return false;
                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - initialTouchX;
                        float dy = event.getRawY() - initialTouchY;
                        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                            isDragging = true;
                        }
                        if (isDragging) {
                            lp.x = initialX + (int) dx;
                            lp.y = initialY + (int) dy;
                            try {
                                windowManager.updateViewLayout(overlayView, lp);
                            } catch (Exception ignored) {}
                            return true;
                        }
                        return false;
                    case MotionEvent.ACTION_UP:
                        return isDragging;
                }
                return false;
            }
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
