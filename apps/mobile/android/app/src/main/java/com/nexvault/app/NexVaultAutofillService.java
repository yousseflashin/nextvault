package com.nexvault.app;

import android.app.assist.AssistStructure;
import android.content.Context;
import android.content.ComponentName;
import android.service.autofill.AutofillService;
import android.service.autofill.Dataset;
import android.service.autofill.FillCallback;
import android.service.autofill.FillContext;
import android.service.autofill.FillRequest;
import android.service.autofill.FillResponse;
import android.service.autofill.SaveInfo;
import android.view.View;
import android.view.autofill.AutofillId;
import android.view.autofill.AutofillValue;
import android.widget.RemoteViews;
import android.os.CancellationSignal;
import android.os.Build;
import android.util.Pair;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class NexVaultAutofillService extends AutofillService {
    private static final String PREFS = "nexvault_autofill";

    private static final Set<String> EXCLUDED_PACKAGES = new HashSet<>(Arrays.asList(
        // Messaging & Chat applications (must NEVER trigger autofill or save on chat boxes)
        "com.whatsapp",
        "com.whatsapp.w4b",
        "org.telegram.messenger",
        "org.telegram.messenger.web",
        "org.thoughtcrime.securesms", // Signal
        "com.facebook.orca",          // Facebook Messenger
        "com.facebook.mlite",
        "com.google.android.apps.messaging", // SMS
        "com.samsung.android.messaging",
        "com.discord",
        "com.slack",
        "com.viber.voip",
        "com.skype.raider",
        "com.google.android.talk",
        "com.snapchat.android",
        // System tools, utilities, launchers
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

    @Override
    public void onFillRequest(FillRequest request, CancellationSignal cancellationSignal, FillCallback callback) {
        try {
            List<FillContext> contexts = request.getFillContexts();
            if (contexts == null || contexts.isEmpty()) {
                callback.onSuccess(null);
                return;
            }

            AssistStructure structure = contexts.get(contexts.size() - 1).getStructure();
            ComponentName activity = structure.getActivityComponent();
            String activityPackage = activity != null ? activity.getPackageName() : "";

            // Strict protection: completely silence autofill in chat, messaging, and system utility apps
            if (isExcludedPackage(activityPackage)) {
                callback.onSuccess(null);
                return;
            }

            List<Field> fields = new ArrayList<>();
            String domain = "";

            int windowCount = structure.getWindowNodeCount();
            for (int w = 0; w < windowCount; w++) {
                AssistStructure.WindowNode window = structure.getWindowNodeAt(w);
                if (window != null && window.getRootViewNode() != null) {
                    String foundDomain = collectFields(window.getRootViewNode(), fields);
                    if (domain.isEmpty() && !foundDomain.isEmpty()) {
                        domain = foundDomain;
                    }
                }
            }

            // Check if there is an actual password field
            boolean hasActualPassword = false;
            for (Field f : fields) {
                if (f.password) {
                    hasActualPassword = true;
                    break;
                }
            }

            // Post-process fields: ONLY if an actual password field is present on the screen,
            // an editable field immediately preceding the password can be treated as username.
            boolean hasUsername = false;
            for (Field f : fields) {
                if (f.username) {
                    hasUsername = true;
                    break;
                }
            }
            if (!hasUsername && hasActualPassword) {
                for (int i = 0; i < fields.size(); i++) {
                    if (fields.get(i).password && i > 0) {
                        fields.get(i - 1).username = true;
                        hasUsername = true;
                        break;
                    }
                }
            }
            fields.removeIf(field -> !field.password && !field.username);

            // Fallback for native apps: use hosting activity package name
            if (domain.isEmpty() && activity != null) {
                domain = activity.getPackageName();
            }

            // If no password or username fields are found, do not trigger autofill
            if (fields.isEmpty() || (!hasActualPassword && !hasUsername)) {
                callback.onSuccess(null);
                return;
            }

            JSONArray credentials = new JSONArray(NativeCredentialStore.read(this));
            FillResponse.Builder response = new FillResponse.Builder();
            boolean matched = false;
            boolean hasDatasets = false;

            // 1. Direct domain match
            for (int i = 0; i < credentials.length(); i++) {
                JSONObject credential = credentials.getJSONObject(i);
                String service = credential.optString("service");
                if (!matches(domain, service)) continue;

                Dataset.Builder dataset = createDataset(service, credential.optString("username"), credential.optString("password"), fields);
                response.addDataset(dataset.build());
                matched = true;
                hasDatasets = true;
            }

            // 2. 1Password Fallback Method:
            // Only offer fallback credentials inside browsers when a credential field is present,
            // or in native apps that are not excluded.
            if (!matched && (hasActualPassword || hasUsername) && credentials.length() > 0 && !isExcludedPackage(domain)) {
                int limit = Math.min(credentials.length(), 10);
                for (int i = 0; i < limit; i++) {
                    JSONObject credential = credentials.getJSONObject(i);
                    String service = credential.optString("service", "Saved Login");
                    Dataset.Builder dataset = createDataset(service, credential.optString("username"), credential.optString("password"), fields);
                    response.addDataset(dataset.build());
                    hasDatasets = true;
                }
            }

            // 3. ONLY provide "⚡ Generate strong password" dataset if an actual password field exists!
            if (hasActualPassword) {
                Dataset.Builder generator = createGeneratorDataset(fields);
                response.addDataset(generator.build());
                hasDatasets = true;
            }

            // 4. ONLY configure SaveInfo if an actual password field exists on the screen!
            // This completely eliminates false-positive save popups on search bars, notes, and messages.
            List<AutofillId> passwordIds = new ArrayList<>();
            List<AutofillId> usernameIds = new ArrayList<>();

            for (Field field : fields) {
                if (field.password) passwordIds.add(field.id);
                if (field.username) usernameIds.add(field.id);
            }

            if (hasActualPassword && !passwordIds.isEmpty()) {
                int saveType = SaveInfo.SAVE_DATA_TYPE_PASSWORD;
                if (!usernameIds.isEmpty()) {
                    saveType |= SaveInfo.SAVE_DATA_TYPE_USERNAME;
                }

                AutofillId[] requiredIds = passwordIds.toArray(new AutofillId[0]);
                AutofillId[] optionalIds = !usernameIds.isEmpty() ? usernameIds.toArray(new AutofillId[0]) : null;

                SaveInfo.Builder saveInfoBuilder = new SaveInfo.Builder(saveType, requiredIds);
                if (optionalIds != null && optionalIds.length > 0) {
                    saveInfoBuilder.setOptionalIds(optionalIds);
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    saveInfoBuilder.setFlags(SaveInfo.FLAG_SAVE_ON_ALL_VIEWS_INVISIBLE);
                }
                response.setSaveInfo(saveInfoBuilder.build());
            }

            if (hasDatasets) {
                callback.onSuccess(response.build());
            } else {
                callback.onSuccess(null);
            }
        } catch (Exception error) {
            callback.onFailure("NexVault autofill is unavailable");
        }
    }

    private Dataset.Builder createDataset(String service, String username, String password, List<Field> fields) {
        RemoteViews rv = presentation(service, username, false);
        Dataset.Builder dataset = new Dataset.Builder(rv);

        for (Field field : fields) {
            String value = field.password ? password : username;
            if (!value.isEmpty()) {
                dataset.setValue(field.id, AutofillValue.forText(value));
            } else if (!password.isEmpty()) {
                dataset.setValue(field.id, AutofillValue.forText(""));
            }
        }

        return dataset;
    }

    private Dataset.Builder createGeneratorDataset(List<Field> fields) {
        RemoteViews rv = presentation("NexVault", "Generate Strong Password", true);
        Dataset.Builder dataset = new Dataset.Builder(rv);
        String generated = generatePassword();

        boolean bound = false;
        for (Field field : fields) {
            if (field.password) {
                dataset.setValue(field.id, AutofillValue.forText(generated));
                bound = true;
            }
        }
        if (!bound && !fields.isEmpty()) {
            Field target = fields.get(fields.size() - 1);
            dataset.setValue(target.id, AutofillValue.forText(generated));
        }

        return dataset;
    }

    private String collectFields(AssistStructure.ViewNode node, List<Field> fields) {
        String domain = normalize(node.getWebDomain());

        // Check for URL address bar in Chrome/Chromium, Firefox, Brave, Edge, and other browsers
        String idEntry = node.getIdEntry();
        if (domain.isEmpty() && idEntry != null) {
            String lowerId = idEntry.toLowerCase(Locale.ROOT);
            if (lowerId.contains("url_bar") || lowerId.contains("location_bar") 
                || lowerId.contains("search_box") || lowerId.contains("omnibox") 
                || lowerId.contains("address_bar") || lowerId.contains("toolbar")
                || lowerId.contains("mozac_browser_toolbar_url_view")) {
                CharSequence text = node.getText();
                if (text == null || text.length() == 0) text = node.getContentDescription();
                if (text != null && text.length() > 0) {
                    String urlCandidate = normalize(text.toString());
                    if (!urlCandidate.isEmpty() && urlCandidate.contains(".")) {
                        domain = urlCandidate;
                    }
                }
            }
        }

        int inputType = node.getInputType();

        // 1. Skip multi-line inputs (chat messages in WhatsApp, comments, bio, notes)
        if ((inputType & 0x00020000) != 0 || (inputType & 0x00040000) != 0) {
            for (int i = 0; i < node.getChildCount(); i++) {
                String childDomain = collectFields(node.getChildAt(i), fields);
                if (domain.isEmpty() && !childDomain.isEmpty()) domain = childDomain;
            }
            return domain;
        }

        // 2. Skip HTML textarea elements
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.getHtmlInfo() != null) {
            String tag = node.getHtmlInfo().getTag();
            if ("textarea".equalsIgnoreCase(tag)) {
                for (int i = 0; i < node.getChildCount(); i++) {
                    String childDomain = collectFields(node.getChildAt(i), fields);
                    if (domain.isEmpty() && !childDomain.isEmpty()) domain = childDomain;
                }
                return domain;
            }
        }

        String[] hints = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? node.getAutofillHints() : null;
        String hintText = hints == null ? "" : String.join(" ", hints).toLowerCase(Locale.ROOT);

        String fieldName = ((node.getHint() == null ? "" : node.getHint()) + " "
            + (node.getIdEntry() == null ? "" : node.getIdEntry()) + " "
            + (node.getContentDescription() == null ? "" : node.getContentDescription()))
            .toLowerCase(Locale.ROOT).replace('_', ' ').replace('-', ' ').replace('.', ' ');

        boolean blacklisted = isBlacklistedField(fieldName, hintText);

        boolean password = false;
        boolean username = false;

        // 3. Inspect HTML Info if available (Chrome and WebViews)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.getHtmlInfo() != null) {
            try {
                android.view.ViewStructure.HtmlInfo htmlInfo = node.getHtmlInfo();
                String tag = htmlInfo.getTag();
                if ("input".equalsIgnoreCase(tag)) {
                    List<Pair<String, String>> attrs = htmlInfo.getAttributes();
                    if (attrs != null) {
                        for (Pair<String, String> attr : attrs) {
                            String key = attr.first != null ? attr.first.toLowerCase(Locale.ROOT) : "";
                            String val = attr.second != null ? attr.second.toLowerCase(Locale.ROOT) : "";
                            if ("type".equals(key)) {
                                if (val.contains("password")) password = true;
                                if (val.contains("email")) username = true;
                            } else if ("autocomplete".equals(key)) {
                                if (val.contains("password")) password = true;
                                if (val.contains("username") || val.contains("email") || val.contains("login")) username = true;
                            } else if ("name".equals(key) || "id".equals(key) || "placeholder".equals(key) || "aria-label".equals(key)) {
                                String norm = val.replace('_', ' ').replace('-', ' ').replace('.', ' ');
                                if (norm.matches(".*\\b(pass|password|passwd|pwd|secret)\\b.*")) password = true;
                                if (norm.matches(".*\\b(user|username|email|login|account|identifier|userid)\\b.*")) username = true;
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
        }

        // 4. Inspect Android InputType
        int variation = inputType & 0x00000ff0;
        if (variation == 0x80 || variation == 0x90 || variation == 0xe0 || variation == 0x10 || (inputType & 0x00000081) != 0) {
            password = true;
        }
        if (variation == 0x20 || variation == 0xd0) {
            username = true;
        }

        // 5. Inspect AutofillHints
        if (hintText.contains("password")) password = true;
        if (hintText.contains("username") || hintText.contains("email") || hintText.contains("login") || hintText.contains("user")) username = true;

        // 6. Inspect field name probe
        if (fieldName.matches(".*\\b(pass|password|passwd|pwd|secret)\\b.*")) password = true;
        if (fieldName.matches(".*\\b(user|username|email|login|account|identifier|userid|user id)\\b.*")) username = true;

        if (password) username = false;

        // Add ONLY verified credential fields
        if (!blacklisted && node.getAutofillId() != null && (password || username)) {
            fields.add(new Field(node.getAutofillId(), password, username, node.isFocused()));
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            String childDomain = collectFields(node.getChildAt(i), fields);
            if (domain.isEmpty() && !childDomain.isEmpty()) {
                domain = childDomain;
            }
        }
        return domain;
    }

    private static boolean isBlacklistedField(String probe, String hintText) {
        if (probe == null) probe = "";
        if (hintText == null) hintText = "";
        String combined = (probe + " " + hintText).toLowerCase(Locale.ROOT);

        // Explicitly protect login and credential fields from blacklist
        if (combined.contains("email") || combined.contains("mail") || combined.contains("login")
            || combined.contains("user") || combined.contains("pass") || combined.contains("account")) {
            return false;
        }

        String blacklistPattern = ".*\\b("
            + "address|addr|street|city|state|zip|zipcode|postal|postcode|country|province|region|county|"
            + "apt|suite|unit|floor|building|po_box|pobox|delivery|shipping|billing|destination|location|"
            + "search|query|filter|find|keyword|"
            + "first_name|firstname|fname|last_name|lastname|lname|middle_name|full_name|fullname|cardholder|bday|birthday|gender|sex|tax|vat|company|"
            + "card|cvv|cvc|exp|coupon|promo|discount|voucher|"
            + "comment|message|chat|note|notes|bio|description|feedback|review|subject|qty|quantity|amount|price"
            + ")\\b.*";

        return combined.matches(blacklistPattern);
    }

    private RemoteViews presentation(String service, String username, boolean isGenerator) {
        RemoteViews views = new RemoteViews(getPackageName(), com.nexvault.app.R.layout.autofill_dataset);
        if (isGenerator) {
            views.setImageViewResource(com.nexvault.app.R.id.autofill_icon, com.nexvault.app.R.drawable.ic_nexvault_generator);
            views.setTextViewText(com.nexvault.app.R.id.autofill_title, "Generate Strong Password");
            views.setTextViewText(com.nexvault.app.R.id.autofill_subtitle, "24-character cryptographic password");
            views.setTextViewText(com.nexvault.app.R.id.autofill_badge, "⚡ GENERATE");
        } else {
            views.setImageViewResource(com.nexvault.app.R.id.autofill_icon, com.nexvault.app.R.drawable.ic_nexvault_key);
            String title = service.isEmpty() ? "Saved Login" : formatServiceName(service);
            views.setTextViewText(com.nexvault.app.R.id.autofill_title, title);
            views.setTextViewText(com.nexvault.app.R.id.autofill_subtitle, username.isEmpty() ? "Autofill credentials" : username);
            views.setTextViewText(com.nexvault.app.R.id.autofill_badge, "NEXVAULT");
        }
        return views;
    }

    private String formatServiceName(String raw) {
        if (raw == null || raw.isEmpty()) return "Saved Login";
        String clean = normalize(raw);
        int lastDot = clean.lastIndexOf('.');
        if (lastDot > 0) {
            String name = clean.substring(0, lastDot);
            int prevDot = name.lastIndexOf('.');
            if (prevDot >= 0) name = name.substring(prevDot + 1);
            if (name.length() > 0) {
                return Character.toUpperCase(name.charAt(0)) + name.substring(1) + " (" + clean + ")";
            }
        }
        if (clean.length() > 0) {
            return Character.toUpperCase(clean.charAt(0)) + clean.substring(1);
        }
        return "Saved Login";
    }

    private boolean matches(String domain, String service) {
        if (domain == null || domain.isEmpty() || service == null || service.isEmpty()) return false;
        String normDomain = normalize(domain);
        String normService = normalize(service);

        // 1. Direct host match or subdomain match
        if (normDomain.equals(normService)
            || normDomain.endsWith("." + normService)
            || normService.endsWith("." + normDomain)) {
            return true;
        }

        // 2. Base stem match (e.g. "github" matches "github.com", "google" matches "accounts.google.com")
        String stemDomain = extractStem(normDomain);
        String stemService = extractStem(normService);
        if (!stemDomain.isEmpty() && !stemService.isEmpty()) {
            if (stemDomain.equalsIgnoreCase(stemService)
                || normDomain.contains(stemService)
                || normService.contains(stemDomain)) {
                return true;
            }
        }

        // 3. Package segment matching for native Android applications (e.g. "com.spotify.music" -> "spotify")
        if (normDomain.contains(".")) {
            String[] segments = normDomain.split("\\.");
            for (String segment : segments) {
                if (segment.length() > 2
                    && !segment.equals("com") && !segment.equals("android") && !segment.equals("app") && !segment.equals("org") && !segment.equals("google")
                    && (segment.equalsIgnoreCase(stemService) || segment.contains(stemService) || stemService.contains(segment))) {
                    return true;
                }
            }
        }

        return false;
    }

    private boolean isBrowserPackage(String value) {
        String normalized = normalize(value);
        return normalized.contains("chrome")
            || normalized.contains("firefox")
            || normalized.contains("brave")
            || normalized.contains("opera")
            || normalized.contains("edge")
            || normalized.contains("browser");
    }

    private String extractStem(String host) {
        if (host == null || host.isEmpty()) return "";
        int lastDot = host.lastIndexOf('.');
        String withoutTld = (lastDot > 0) ? host.substring(0, lastDot) : host;
        int prevDot = withoutTld.lastIndexOf('.');
        return (prevDot >= 0) ? withoutTld.substring(prevDot + 1) : withoutTld;
    }

    private String normalize(String value) {
        if (value == null) return "";
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        normalized = normalized.replaceFirst("^https?://", "");
        normalized = normalized.replaceFirst("^www\\.", "");
        int slash = normalized.indexOf('/');
        if (slash >= 0) normalized = normalized.substring(0, slash);
        int colon = normalized.indexOf(':');
        if (colon >= 0) normalized = normalized.substring(0, colon);
        return normalized;
    }

    @Override
    public void onSaveRequest(android.service.autofill.SaveRequest request, android.service.autofill.SaveCallback callback) {
        try {
            SavedValues values = new SavedValues();
            List<FillContext> contexts = request.getFillContexts();
            if (contexts != null && !contexts.isEmpty()) {
                AssistStructure structure = contexts.get(contexts.size() - 1).getStructure();
                ComponentName activity = structure.getActivityComponent();
                String activityPackage = activity != null ? activity.getPackageName() : "";

                // Never prompt to save in excluded messaging or utility apps
                if (isExcludedPackage(activityPackage)) {
                    callback.onSuccess();
                    return;
                }

                int windowCount = structure.getWindowNodeCount();
                for (int w = 0; w < windowCount; w++) {
                    AssistStructure.WindowNode window = structure.getWindowNodeAt(w);
                    if (window != null && window.getRootViewNode() != null) {
                        collectSavedValues(window.getRootViewNode(), values);
                    }
                }
                if (values.domain.isEmpty() && activity != null) {
                    values.domain = activity.getPackageName();
                }
            }

            // Save ONLY if an actual password was entered and domain is not excluded
            if (!values.domain.isEmpty() && !values.password.isEmpty() && !isExcludedPackage(values.domain)) {
                JSONArray credentials = new JSONArray(NativeCredentialStore.read(this));
                JSONObject entry = null;
                for (int i = 0; i < credentials.length(); i++) {
                    JSONObject candidate = credentials.getJSONObject(i);
                    if (matches(values.domain, candidate.optString("service"))) {
                        entry = candidate;
                        break;
                    }
                }
                if (entry == null) {
                    entry = new JSONObject();
                    entry.put("service", values.domain);
                    credentials.put(entry);
                }
                if (!values.username.isEmpty()) {
                    entry.put("username", values.username);
                }
                entry.put("password", values.password);
                NativeCredentialStore.write(this, credentials.toString());
            }
            callback.onSuccess();
        } catch (Exception error) {
            callback.onFailure("Could not save credential");
        }
    }

    private void collectSavedValues(AssistStructure.ViewNode node, SavedValues values) {
        String domain = normalize(node.getWebDomain());
        if (!domain.isEmpty()) values.domain = domain;

        String idEntry = node.getIdEntry();
        if (values.domain.isEmpty() && idEntry != null) {
            String lowerId = idEntry.toLowerCase(Locale.ROOT);
            if (lowerId.contains("url_bar") || lowerId.contains("location_bar") || lowerId.contains("search_box") || lowerId.contains("omnibox") || lowerId.contains("address_bar")) {
                CharSequence text = node.getText();
                if (text == null || text.length() == 0) text = node.getContentDescription();
                if (text != null && text.length() > 0) {
                    String urlCandidate = normalize(text.toString());
                    if (!urlCandidate.isEmpty() && urlCandidate.contains(".")) {
                        values.domain = urlCandidate;
                    }
                }
            }
        }

        int inputType = node.getInputType();
        // Skip multi-line inputs
        if ((inputType & 0x00020000) != 0 || (inputType & 0x00040000) != 0) {
            for (int i = 0; i < node.getChildCount(); i++) collectSavedValues(node.getChildAt(i), values);
            return;
        }

        String textVal = "";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.getAutofillValue() != null && node.getAutofillValue().isText()) {
            CharSequence cs = node.getAutofillValue().getTextValue();
            if (cs != null) textVal = cs.toString().trim();
        }
        if (textVal.isEmpty() && node.getText() != null) {
            textVal = node.getText().toString().trim();
        }

        if (!textVal.isEmpty()) {
            boolean isPassword = false;
            boolean isUsername = false;

            int variation = inputType & 0x00000ff0;
            if (variation == 0x80 || variation == 0x90 || variation == 0xe0 || variation == 0x10 || (inputType & 0x00000081) != 0) {
                isPassword = true;
            }
            if (variation == 0x20 || variation == 0xd0) {
                isUsername = true;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                String[] hints = node.getAutofillHints();
                if (hints != null) {
                    for (String h : hints) {
                        String lower = h.toLowerCase(Locale.ROOT);
                        if (lower.contains("password")) isPassword = true;
                        if (lower.contains("username") || lower.contains("email") || lower.contains("login") || lower.contains("user")) isUsername = true;
                    }
                }
            }

            String probe = ((node.getHint() == null ? "" : node.getHint()) + " "
                + (node.getIdEntry() == null ? "" : node.getIdEntry()) + " "
                + (node.getContentDescription() == null ? "" : node.getContentDescription()))
                .toLowerCase(Locale.ROOT).replace('_', ' ').replace('-', ' ').replace('.', ' ');

            if (probe.matches(".*\\b(pass|password|passwd|pwd|secret)\\b.*")) isPassword = true;
            if (probe.matches(".*\\b(user|username|email|login|account|identifier)\\b.*")) isUsername = true;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.getHtmlInfo() != null) {
                try {
                    android.view.ViewStructure.HtmlInfo html = node.getHtmlInfo();
                    if ("input".equalsIgnoreCase(html.getTag())) {
                        List<Pair<String, String>> attrs = html.getAttributes();
                        if (attrs != null) {
                            for (Pair<String, String> attr : attrs) {
                                String k = attr.first != null ? attr.first.toLowerCase(Locale.ROOT) : "";
                                String v = attr.second != null ? attr.second.toLowerCase(Locale.ROOT) : "";
                                if ("type".equals(k) && v.contains("password")) isPassword = true;
                                if ("autocomplete".equals(k) && v.contains("password")) isPassword = true;
                                if ("autocomplete".equals(k) && (v.contains("username") || v.contains("email"))) isUsername = true;
                                if ("name".equals(k) || "id".equals(k) || "placeholder".equals(k)) {
                                    String nv = v.replace('_', ' ').replace('-', ' ');
                                    if (nv.matches(".*\\b(pass|password|passwd|pwd)\\b.*")) isPassword = true;
                                    if (nv.matches(".*\\b(user|username|email|login)\\b.*")) isUsername = true;
                                }
                            }
                        }
                    }
                } catch (Exception ignored) {}
            }

            if (isPassword) {
                values.password = textVal;
            } else if (isUsername && values.username.isEmpty()) {
                values.username = textVal;
            }
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            collectSavedValues(node.getChildAt(i), values);
        }
    }

    private String generatePassword() {
        String charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*-_+=";
        java.security.SecureRandom random = new java.security.SecureRandom();
        StringBuilder password = new StringBuilder(24);
        for (int i = 0; i < 24; i++) password.append(charset.charAt(random.nextInt(charset.length())));
        return password.toString();
    }

    private static class SavedValues {
        String domain = "";
        String username = "";
        String password = "";
    }

    private static class Field {
        final AutofillId id;
        boolean password;
        boolean username;
        final boolean focused;
        Field(AutofillId id, boolean password, boolean username, boolean focused) {
            this.id = id;
            this.password = password;
            this.username = username;
            this.focused = focused;
        }
    }
}
