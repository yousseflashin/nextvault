package com.nexvault.app;

import android.app.assist.AssistStructure;
import android.content.Context;
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
import java.util.List;
import java.util.Locale;

public class NexVaultAutofillService extends AutofillService {
    private static final String PREFS = "nexvault_autofill";

    @Override
    public void onFillRequest(FillRequest request, CancellationSignal cancellationSignal, FillCallback callback) {
        try {
            List<FillContext> contexts = request.getFillContexts();
            if (contexts == null || contexts.isEmpty()) {
                callback.onSuccess(null);
                return;
            }

            AssistStructure structure = contexts.get(contexts.size() - 1).getStructure();
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

            boolean hasPassword = false;
            boolean hasUsername = false;
            for (Field field : fields) {
                hasPassword |= field.password;
                hasUsername |= field.username;
            }
            fields.removeIf(field -> !field.password && !field.username);

            if (domain.isEmpty() || fields.isEmpty()) {
                callback.onSuccess(null);
                return;
            }

            JSONArray credentials = new JSONArray(NativeCredentialStore.read(this));
            FillResponse.Builder response = new FillResponse.Builder();
            boolean matched = false;
            for (int i = 0; i < credentials.length(); i++) {
                JSONObject credential = credentials.getJSONObject(i);
                String service = credential.optString("service");
                if (!matches(domain, service)) continue;

                Dataset.Builder dataset = new Dataset.Builder(presentation(service, credential.optString("username")));
                for (Field field : fields) {
                    String value = field.password ? credential.optString("password") : credential.optString("username");
                    if (!value.isEmpty()) dataset.setValue(field.id, AutofillValue.forText(value));
                }
                response.addDataset(dataset.build());
                matched = true;
            }

            if (hasPasswordField(fields)) {
                Dataset.Builder generator = new Dataset.Builder(presentation("NEXVAULT", "Generate strong password"));
                String generated = generatePassword();
                for (Field field : fields) {
                    if (field.password) generator.setValue(field.id, AutofillValue.forText(generated));
                }
                response.addDataset(generator.build());
                matched = true;

                AutofillId[] saveIds = new AutofillId[fields.size()];
                for (int i = 0; i < fields.size(); i++) saveIds[i] = fields.get(i).id;
                response.setSaveInfo(new SaveInfo.Builder(
                    SaveInfo.SAVE_DATA_TYPE_USERNAME | SaveInfo.SAVE_DATA_TYPE_PASSWORD,
                    saveIds
                ).build());
            }

            callback.onSuccess(matched ? response.build() : null);
        } catch (Exception error) {
            callback.onFailure("NexVault autofill is unavailable");
        }
    }

    private String collectFields(AssistStructure.ViewNode node, List<Field> fields) {
        String domain = normalize(node.getWebDomain());

        // Check for URL address bar in Chrome/Chromium and other browsers
        String idEntry = node.getIdEntry();
        if (domain.isEmpty() && idEntry != null) {
            String lowerId = idEntry.toLowerCase(Locale.ROOT);
            if (lowerId.contains("url_bar") || lowerId.contains("location_bar") || lowerId.contains("search_box")) {
                CharSequence text = node.getText();
                if (text != null && text.length() > 0) {
                    String urlCandidate = normalize(text.toString());
                    if (!urlCandidate.isEmpty() && urlCandidate.contains(".")) {
                        domain = urlCandidate;
                    }
                }
            }
        }

        String[] hints = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? node.getAutofillHints() : null;
        String hintText = hints == null ? "" : String.join(" ", hints).toLowerCase(Locale.ROOT);

        String fieldName = ((node.getHint() == null ? "" : node.getHint()) + " "
            + (node.getIdEntry() == null ? "" : node.getIdEntry()) + " "
            + (node.getContentDescription() == null ? "" : node.getContentDescription())).toLowerCase(Locale.ROOT);

        // Check if field is blacklisted (address, shipping, billing, search, notes, etc.)
        boolean blacklisted = isBlacklistedField(fieldName, hintText);

        boolean password = false;
        boolean username = false;

        // Inspect HTML Info if available (Chrome and WebViews)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.getHtmlInfo() != null) {
            try {
                android.view.ViewStructure.HtmlInfo htmlInfo = node.getHtmlInfo();
                String tag = htmlInfo.getTag();
                if ("input".equalsIgnoreCase(tag)) {
                    List<Pair<String, String>> attrs = htmlInfo.getAttributes();
                    if (attrs != null) {
                        StringBuilder htmlProbe = new StringBuilder();
                        for (Pair<String, String> attr : attrs) {
                            String key = attr.first != null ? attr.first.toLowerCase(Locale.ROOT) : "";
                            String val = attr.second != null ? attr.second.toLowerCase(Locale.ROOT) : "";
                            htmlProbe.append(" ").append(key).append("=").append(val);
                            if ("type".equals(key)) {
                                if (val.contains("password")) password = true;
                                if (val.contains("email")) username = true;
                            } else if ("autocomplete".equals(key)) {
                                if (val.contains("password")) password = true;
                                if (val.contains("username") || val.contains("email")) username = true;
                            } else if ("name".equals(key) || "id".equals(key) || "placeholder".equals(key)) {
                                if (val.matches(".*\\b(pass|password|passwd|pwd)\\b.*")) password = true;
                                if (val.matches(".*\\b(user|username|email|login|userid|user_id)\\b.*")) username = true;
                            }
                        }
                        if (isBlacklistedField(htmlProbe.toString(), "")) {
                            blacklisted = true;
                        }
                    }
                }
            } catch (Exception ignored) {}
        }

        if (!blacklisted) {
            int inputType = node.getInputType();
            if (hintText.contains("password")
                || (inputType & 0x00000081) != 0
                || (inputType & 0x000000e0) != 0) {
                password = true;
            }

            if (hintText.contains("username") || hintText.contains("email")
                || fieldName.matches(".*\\b(user|username|email|login|account|identifier|userid|user_id)\\b.*")) {
                username = true;
            }

            // Only recognize phone in explicit auth/login context
            if (fieldName.matches(".*\\b(phone|mobile)\\b.*") && fieldName.matches(".*\\b(login|auth|signin|account)\\b.*")) {
                username = true;
            }

            if (password) username = false;

            if (node.getAutofillId() != null && (password || username)) {
                fields.add(new Field(node.getAutofillId(), password, username));
            }
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

        // Strict blacklist for addresses, shipping, search, personal info, financial, etc.
        String blacklistPattern = ".*\\b("
            + "address|addr|street|city|state|zip|zipcode|postal|postcode|country|province|region|county|"
            + "apt|suite|unit|floor|building|po_box|pobox|delivery|shipping|billing|destination|location|"
            + "search|query|filter|find|keyword|"
            + "first_name|firstname|fname|last_name|lastname|lname|middle_name|full_name|fullname|cardholder|bday|birthday|gender|sex|tax|vat|company|"
            + "card|cvv|cvc|exp|coupon|promo|discount|voucher|"
            + "comment|message|note|notes|bio|description|feedback|review|subject|qty|quantity|amount|price"
            + ")\\b.*";

        if (combined.matches(blacklistPattern)) {
            return true;
        }

        // Check autofill hints
        if (combined.contains("postaladdress") || combined.contains("postalcode") || combined.contains("streetaddress")
            || combined.contains("addressline") || combined.contains("creditcard") || combined.contains("birthdate")) {
            return true;
        }

        return false;
    }

    private RemoteViews presentation(String service, String username) {
        RemoteViews views = new RemoteViews(getPackageName(), com.nexvault.app.R.layout.autofill_dataset);
        views.setTextViewText(com.nexvault.app.R.id.autofill_title, "NEXVAULT  •  " + (service.isEmpty() ? "Saved login" : service));
        views.setTextViewText(com.nexvault.app.R.id.autofill_subtitle, username.isEmpty() ? "Autofill credentials" : username);
        return views;
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

        return false;
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
                int windowCount = structure.getWindowNodeCount();
                for (int w = 0; w < windowCount; w++) {
                    AssistStructure.WindowNode window = structure.getWindowNodeAt(w);
                    if (window != null && window.getRootViewNode() != null) {
                        collectSavedValues(window.getRootViewNode(), values);
                    }
                }
            }

            if (!values.domain.isEmpty() && !values.password.isEmpty()) {
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
            if (lowerId.contains("url_bar") || lowerId.contains("location_bar") || lowerId.contains("search_box")) {
                CharSequence text = node.getText();
                if (text != null && text.length() > 0) {
                    String urlCandidate = normalize(text.toString());
                    if (!urlCandidate.isEmpty() && urlCandidate.contains(".")) {
                        values.domain = urlCandidate;
                    }
                }
            }
        }

        String hints = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.getAutofillHints() != null
            ? String.join(" ", node.getAutofillHints()).toLowerCase(Locale.ROOT)
            : "";
        String name = ((node.getHint() == null ? "" : node.getHint()) + " " + (node.getIdEntry() == null ? "" : node.getIdEntry())).toLowerCase(Locale.ROOT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.getAutofillValue() != null && node.getAutofillValue().isText()) {
            String value = node.getAutofillValue().getTextValue().toString();
            if (hints.contains("password") || name.matches(".*(password|passcode|passwd).*")) values.password = value;
            else if (hints.contains("username") || hints.contains("email") || name.matches(".*(user|email|login|account).*")) values.username = value;
        }
        for (int i = 0; i < node.getChildCount(); i++) collectSavedValues(node.getChildAt(i), values);
    }

    private boolean hasPasswordField(List<Field> fields) {
        for (Field field : fields) if (field.password) return true;
        return false;
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
        final boolean password;
        boolean username;
        Field(AutofillId id, boolean password, boolean username) {
            this.id = id;
            this.password = password;
            this.username = username;
        }
    }
}
