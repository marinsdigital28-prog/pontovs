package com.marinsdigital.pontoprogredir;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String NATIVE_MARKER = "PontoProgredirNative/1.0";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebSettings settings = getBridge().getWebView().getSettings();
            String currentUserAgent = settings.getUserAgentString();
            if (currentUserAgent != null && !currentUserAgent.contains(NATIVE_MARKER)) {
                settings.setUserAgentString(currentUserAgent + " " + NATIVE_MARKER);
            }
        }
    }
}
