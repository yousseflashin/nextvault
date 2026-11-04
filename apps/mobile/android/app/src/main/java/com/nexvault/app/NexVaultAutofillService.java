package com.nexvault.app;

import android.app.assist.AssistStructure;
import android.content.Context;
import android.service.autofill.AutofillService;
import android.service.autofill.Dataset;
import android.service.autofill.FillCallback;
import android.service.autofill.FillContext;
import android.service.autofill.FillRequest;
import android.service.autofill.FillResponse;
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
            if (domain.isEmpty() || fields.isEmpty()) {
                callback.onSuccess(null);
                return;
            }

            JSONArray credentials = new JSONArray(getSharedPreferences(PREFS, 0).getString("credentials", "[]"));
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
        if (node.getAutofillId() != null && (password || username)) {
            fields.add(new Field(node.getAutofillId(), password));
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
        callback.onSuccess();
    }

    private static class Field {
        final AutofillId id;
        final boolean password;
        Field(AutofillId id, boolean password) { this.id = id; this.password = password; }
    }
}