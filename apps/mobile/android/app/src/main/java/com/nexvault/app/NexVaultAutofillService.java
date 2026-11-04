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
            AssistStructure structure = request.getFillContexts().get(request.getFillContexts().size() - 1).getStructure();
            List<Field> fields = new ArrayList<>();
            String domain = collectFields(structure.getWindowNodeAt(0).getRootViewNode(), fields);
            boolean hasPassword = false;
            boolean hasUsername = false;
            for (Field field : fields) {
                hasPassword |= field.password;
                hasUsername |= field.username;
            }
            if (hasPassword && !hasUsername) {
                for (Field field : fields) {
                    if (!field.password) {
                        field.username = true;
                        break;
                    }
                }
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
                String service = normalize(credential.optString("service"));
                if (!matches(domain, service)) continue;

                Dataset.Builder dataset = new Dataset.Builder(presentation(credential.optString("service"), credential.optString("username")));
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
        String[] hints = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? node.getAutofillHints() : null;
        String hintText = hints == null ? "" : String.join(" ", hints).toLowerCase(Locale.ROOT);
        boolean password = hintText.contains("password") || (node.getInputType() & 0x00000081) != 0;
        String fieldName = ((node.getHint() == null ? "" : node.getHint()) + " "
            + (node.getIdEntry() == null ? "" : node.getIdEntry())).toLowerCase(Locale.ROOT);
        boolean username = hintText.contains("username") || hintText.contains("email") || hintText.contains("phone")
            || fieldName.matches(".*(user|email|login|account|phone|identifier).*" );
        boolean ordinaryTextInput = node.getAutofillId() != null && node.getInputType() != 0 && node.getChildCount() == 0;
        if (node.getAutofillId() != null && (password || username || ordinaryTextInput)) {
            fields.add(new Field(node.getAutofillId(), password, username));
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            String childDomain = collectFields(node.getChildAt(i), fields);
            if (domain.isEmpty()) domain = childDomain;
        }
        return domain;
    }

    private RemoteViews presentation(String service, String username) {
        RemoteViews views = new RemoteViews(getPackageName(), com.nexvault.app.R.layout.autofill_dataset);
        views.setTextViewText(com.nexvault.app.R.id.autofill_title, "NEXVAULT  •  " + (service.isEmpty() ? "Saved login" : service));
        views.setTextViewText(com.nexvault.app.R.id.autofill_subtitle, username.isEmpty() ? "Autofill credentials" : username);
        return views;
    }

    private boolean matches(String domain, String service) {
        return !service.isEmpty() && (domain.equals(service) || domain.endsWith("." + service) || service.endsWith("." + domain));
    }

    private String normalize(String value) {
        if (value == null) return "";
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        normalized = normalized.replaceFirst("^https?://", "").replaceFirst("^www\\.", "");
        int slash = normalized.indexOf('/');
        return slash >= 0 ? normalized.substring(0, slash) : normalized;
    }

    @Override public void onSaveRequest(android.service.autofill.SaveRequest request, android.service.autofill.SaveCallback callback) {
        try {
            SavedValues values = new SavedValues();
            AssistStructure.ViewNode root = request.getFillContexts().get(request.getFillContexts().size() - 1)
                .getStructure().getWindowNodeAt(0).getRootViewNode();
            collectSavedValues(root, values);
            if (!values.domain.isEmpty() && !values.password.isEmpty()) {
                JSONArray credentials = new JSONArray(NativeCredentialStore.read(this));
                JSONObject entry = null;
                for (int i = 0; i < credentials.length(); i++) {
                    JSONObject candidate = credentials.getJSONObject(i);
                    if (matches(values.domain, normalize(candidate.optString("service")))) {
                        entry = candidate;
                        break;
                    }
                }
                if (entry == null) {
                    entry = new JSONObject();
                    entry.put("service", values.domain);
                    credentials.put(entry);
                }
                entry.put("username", values.username);
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