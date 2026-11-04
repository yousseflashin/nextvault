package com.nexvault.app;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(CameraPermissionPlugin.class);
        registerPlugin(AutofillBridgePlugin.class);
        super.onCreate(savedInstanceState);
        // Block screenshots and hide contents in the recent-apps switcher.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    }
}
