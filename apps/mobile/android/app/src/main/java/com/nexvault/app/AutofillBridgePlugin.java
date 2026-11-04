package com.nexvault.app;

import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AutofillBridge")
public class AutofillBridgePlugin extends Plugin {
    private static final String PREFS = "nexvault_autofill";

    @PluginMethod
    public void syncCredentials(PluginCall call) {
        String credentialsJson = call.getString("credentialsJson", "[]");
        getContext().getSharedPreferences(PREFS, 0)
            .edit()
            .putString("credentials", credentialsJson)
            .apply();
        call.resolve();
    }

    @PluginMethod
    public void clearCredentials(PluginCall call) {
        getContext().getSharedPreferences(PREFS, 0).edit().clear().apply();
        call.resolve();
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE);
            intent.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        boolean enabled = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.view.autofill.AutofillManager manager =
                (android.view.autofill.AutofillManager) getContext().getSystemService("autofill");
            enabled = manager != null && manager.hasEnabledAutofillServices();
        }
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }
}