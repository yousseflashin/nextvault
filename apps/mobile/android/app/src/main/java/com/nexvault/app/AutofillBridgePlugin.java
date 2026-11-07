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
    @PluginMethod
    public void syncCredentials(PluginCall call) {
        String credentialsJson = call.getString("credentialsJson", "[]");
        try {
            NativeCredentialStore.write(getContext(), credentialsJson);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not protect autofill credentials");
        }
    }

    @PluginMethod
    public void clearCredentials(PluginCall call) {
        NativeCredentialStore.clear(getContext());
        call.resolve();
    }
    @PluginMethod
    public void readCredentials(PluginCall call) {
        JSObject result = new JSObject();
        result.put("credentialsJson", NativeCredentialStore.readCredentials(getContext()));
        call.resolve(result);
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

    @PluginMethod
    public void isAccessibilityEnabled(PluginCall call) {
        boolean enabled = false;
        try {
            android.view.accessibility.AccessibilityManager am =
                (android.view.accessibility.AccessibilityManager) getContext().getSystemService(android.content.Context.ACCESSIBILITY_SERVICE);
            if (am != null) {
                java.util.List<android.accessibilityservice.AccessibilityServiceInfo> list =
                    am.getEnabledAccessibilityServiceList(android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
                String expected = getContext().getPackageName() + "/" + NexVaultAccessibilityService.class.getName();
                String shortExpected = getContext().getPackageName() + "/.NexVaultAccessibilityService";
                if (list != null) {
                    for (android.accessibilityservice.AccessibilityServiceInfo info : list) {
                        String id = info.getId();
                        if (id != null && (id.equals(expected) || id.equals(shortExpected) || id.contains("NexVaultAccessibilityService"))) {
                            enabled = true;
                            break;
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void openAppDetailsSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(android.net.Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception error) {
            try {
                // Fallback to generic application settings
                Intent fallback = new Intent(Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
            } catch (Exception ignored) {}
        }
        call.resolve();
    }

    @PluginMethod
    public void getDiagnosticStatus(PluginCall call) {
        JSObject result = new JSObject();
        int sdk = Build.VERSION.SDK_INT;
        result.put("sdkInt", sdk);
        // Android 13 (API 33) and Android 14 (API 34) enforce Restricted Settings on sideloaded apps
        result.put("hasRestrictedSettings", sdk >= 33);
        result.put("packageName", getContext().getPackageName());

        boolean a11y = false;
        try {
            android.view.accessibility.AccessibilityManager am =
                (android.view.accessibility.AccessibilityManager) getContext().getSystemService(android.content.Context.ACCESSIBILITY_SERVICE);
            if (am != null) {
                java.util.List<android.accessibilityservice.AccessibilityServiceInfo> list =
                    am.getEnabledAccessibilityServiceList(android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
                String expected = getContext().getPackageName() + "/" + NexVaultAccessibilityService.class.getName();
                String shortExpected = getContext().getPackageName() + "/.NexVaultAccessibilityService";
                if (list != null) {
                    for (android.accessibilityservice.AccessibilityServiceInfo info : list) {
                        String id = info.getId();
                        if (id != null && (id.equals(expected) || id.equals(shortExpected) || id.contains("NexVaultAccessibilityService"))) {
                            a11y = true;
                            break;
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        result.put("isAccessibilityEnabled", a11y);

        boolean autofill = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.view.autofill.AutofillManager manager =
                (android.view.autofill.AutofillManager) getContext().getSystemService("autofill");
            autofill = manager != null && manager.hasEnabledAutofillServices();
        }
        result.put("isAutofillEnabled", autofill);

        call.resolve(result);
    }

    @PluginMethod
    public void openChrome(PluginCall call) {
        try {
            Intent intent = getContext().getPackageManager().getLaunchIntentForPackage("com.android.chrome");
            if (intent == null) {
                intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://google.com"));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void setSecureWindow(PluginCall call) {
        boolean enable = call.getBoolean("enable", true);
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                try {
                    if (enable) {
                        getActivity().getWindow().setFlags(
                            android.view.WindowManager.LayoutParams.FLAG_SECURE,
                            android.view.WindowManager.LayoutParams.FLAG_SECURE
                        );
                    } else {
                        getActivity().getWindow().clearFlags(
                            android.view.WindowManager.LayoutParams.FLAG_SECURE
                        );
                    }
                } catch (Exception ignored) {}
            });
        }
        call.resolve();
    }
}