package ai.deepseek.harness.mobile;

import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /**
     * When the WebView has no history (the remote GUI's entry page), the back
     * button returns to the bundled setup page instead of exiting, so the
     * saved server address can be changed without clearing app data. The
     * setup page itself keeps the normal back-to-exit behavior.
     */
    @Override
    public void onBackPressed() {
        WebView webView = this.bridge.getWebView();
        String current = webView.getUrl();
        boolean onLocalSetup = current != null && current.startsWith("https://localhost/");
        if (webView.canGoBack() || onLocalSetup) {
            super.onBackPressed();
            return;
        }
        webView.loadUrl("https://localhost/");
    }
}
