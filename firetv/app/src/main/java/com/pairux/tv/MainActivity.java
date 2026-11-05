package com.pairux.tv;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.SearchManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;

import java.util.ArrayList;
import java.util.List;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;

/**
 * pairux.com on Fire TV: the site itself in a full-screen WebView, made usable
 * with a remote. assets/tv.js does the D-pad navigation inside each page; this
 * class routes keys to it and owns the things only native code can do well:
 * the TV keyboard, Back, full-screen video and the offline screen.
 */
public class MainActivity extends Activity {

    static final String HOME = "https://pairux.com/";
    static final String OFFLINE = "file:///android_asset/offline.html";

    private WebView web;
    private FrameLayout root;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenDone;
    private String tvJs = "";
    private AlertDialog keyboard;
    private PermissionRequest pending;

    static final int MEDIA_PERMISSIONS = 1;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        tvJs = readAsset("tv.js");

        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0F172A);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0F172A);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " pairux-tv");
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (state != null) web.restoreState(state);
        if (web.getUrl() == null) handle(getIntent(), true);
        web.requestFocus();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handle(intent, false);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (keyboard != null) keyboard.dismiss();
        web.destroy();
        super.onDestroy();
    }

    /** Launch, Alexa/system search and "share to pairux.com" all end up here. */
    private void handle(Intent intent, boolean launching) {
        String q = null;
        if (intent != null) {
            if (Intent.ACTION_SEARCH.equals(intent.getAction())) q = intent.getStringExtra(SearchManager.QUERY);
            else if (Intent.ACTION_SEND.equals(intent.getAction())) q = intent.getStringExtra(Intent.EXTRA_TEXT);
        }
        if (q != null && q.trim().length() > 0) search(q.trim());
        else if (launching) web.loadUrl(HOME);
    }

    /**
     * pairux.com has no search page: what someone types on a TV is a room to join.
     * A full link is loaded as given (an end-to-end encrypted room carries its key
     * in the URL fragment, so the link is the only way in); anything else is taken
     * for a room code.
     */
    private void search(String q) {
        if (q.startsWith("http://") || q.startsWith("https://")) {
            web.loadUrl(q);
            return;
        }
        try {
            web.loadUrl(HOME + "r/" + URLEncoder.encode(q, "UTF-8"));
        } catch (UnsupportedEncodingException e) {
            web.loadUrl(HOME);
        }
    }

    // ---- keys -------------------------------------------------------------

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (fullscreen != null || keyboard != null && keyboard.isShowing()) return super.dispatchKeyEvent(e);
        int code = e.getKeyCode();
        String dir = null;
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP: dir = "up"; break;
            case KeyEvent.KEYCODE_DPAD_DOWN: dir = "down"; break;
            case KeyEvent.KEYCODE_DPAD_LEFT: dir = "left"; break;
            case KeyEvent.KEYCODE_DPAD_RIGHT: dir = "right"; break;
            default: break;
        }
        if (dir != null) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) nav(dir, e);
            return true;
        }
        if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
                || code == KeyEvent.KEYCODE_NUMPAD_ENTER) {
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) enter();
            return true;
        }
        if (code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_SEARCH) {
            if (e.getAction() == KeyEvent.ACTION_UP) openKeyboard("", getString(R.string.search_hint), "search", true);
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override
    public void onBackPressed() {
        if (fullscreen != null) {
            exitFullscreen();
        } else if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private void nav(final String dir, final KeyEvent original) {
        web.evaluateJavascript(tvJs + "\n;pitNav('" + dir + "')", new android.webkit.ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                // No answer means the page is not scriptable (still loading, or
                // a PDF): give the arrow to the WebView so it at least scrolls.
                if (v == null || "null".equals(v)) {
                    web.dispatchKeyEvent(original);
                    web.dispatchKeyEvent(KeyEvent.changeAction(original, KeyEvent.ACTION_UP));
                }
            }
        });
    }

    private void enter() {
        web.evaluateJavascript(tvJs + "\n;pitEnter()", new android.webkit.ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                String r = unquote(v);
                if (r != null && r.startsWith("text:")) {
                    try {
                        JSONObject f = new JSONObject(r.substring(5));
                        openKeyboard(f.optString("value"), f.optString("hint"), f.optString("type"), false);
                    } catch (Exception ignored) {
                        openKeyboard("", getString(R.string.search_hint), "search", true);
                    }
                } else if (r == null || "native".equals(r) || "none".equals(r)) {
                    long t = android.os.SystemClock.uptimeMillis();
                    web.dispatchKeyEvent(new KeyEvent(t, t, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER, 0));
                    web.dispatchKeyEvent(new KeyEvent(t, t, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER, 0));
                }
            }
        });
    }

    /**
     * A native text box, because it is the one thing guaranteed to bring up the
     * Fire TV keyboard (and its microphone button). {@code standalone} searches
     * pairux.com directly; otherwise the text goes back into the page's field.
     */
    private void openKeyboard(String value, String hint, String type, final boolean standalone) {
        if (keyboard != null && keyboard.isShowing()) return;
        final EditText box = new EditText(this);
        box.setSingleLine(true);
        box.setText(value);
        box.setSelection(box.getText().length());
        box.setHint(hint.length() > 0 ? hint : getString(R.string.search_hint));
        box.setTextSize(22);
        int input = InputType.TYPE_CLASS_TEXT;
        if ("email".equals(type)) input |= InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS;
        else if ("url".equals(type)) input |= InputType.TYPE_TEXT_VARIATION_URI;
        else if ("password".equals(type)) input |= InputType.TYPE_TEXT_VARIATION_PASSWORD;
        else if ("number".equals(type) || "tel".equals(type)) input = InputType.TYPE_CLASS_NUMBER;
        box.setInputType(input);
        box.setImeOptions(EditorInfo.IME_ACTION_SEARCH | EditorInfo.IME_FLAG_NO_EXTRACT_UI);

        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        FrameLayout wrap = new FrameLayout(this);
        wrap.setPadding(pad, pad / 2, pad, 0);
        wrap.addView(box);

        final Runnable submit = new Runnable() {
            @Override
            public void run() {
                String text = box.getText().toString();
                if (keyboard != null) keyboard.dismiss();
                if (standalone) {
                    if (text.trim().length() > 0) search(text.trim());
                } else {
                    web.evaluateJavascript(tvJs + "\n;pitFill(" + JSONObject.quote(text) + ")", null);
                }
                web.requestFocus();
            }
        };

        keyboard = new AlertDialog.Builder(this, R.style.PxDialog)
                .setTitle(R.string.app_name)
                .setView(wrap)
                .setPositiveButton(R.string.search_go, new android.content.DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(android.content.DialogInterface d, int w) { submit.run(); }
                })
                .create();
        box.setOnEditorActionListener(new android.widget.TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(android.widget.TextView v, int action, KeyEvent ev) {
                submit.run();
                return true;
            }
        });
        keyboard.setOnShowListener(new android.content.DialogInterface.OnShowListener() {
            @Override
            public void onShow(android.content.DialogInterface d) {
                box.requestFocus();
                InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                if (imm != null) imm.showSoftInput(box, InputMethodManager.SHOW_IMPLICIT);
            }
        });
        if (keyboard.getWindow() != null) {
            keyboard.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        }
        keyboard.show();
    }

    // ---- web clients --------------------------------------------------------

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return route(url);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            return route(req.getUrl().toString());
        }

        /** The web stays in the app; mailto:, market:, intent: and the like go to the system. */
        private boolean route(String url) {
            Uri u = Uri.parse(url);
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(java.util.Locale.ROOT);
            if (scheme.equals("https") || scheme.equals("http")) return false;
            try {
                Intent i = scheme.equals("intent") ? Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                        : new Intent(Intent.ACTION_VIEW, u);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
                startActivity(i);
            } catch (Exception ignored) {
                // Nothing on a TV handles it; staying put beats an error page.
            }
            return true;
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            view.evaluateJavascript(tvJs, null);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            view.evaluateJavascript(tvJs, null);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame()) offline();
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView view, int code, String description, String failingUrl) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) offline();
        }

        private void offline() {
            web.loadUrl(OFFLINE);
        }
    }

    private class Chrome extends WebChromeClient {
        /**
         * A call asks for the microphone (and a camera, on the few Fire devices that
         * have one). WebView denies by default, which would make every room silent.
         * Grant only what Android has already granted us; otherwise ask for it and
         * answer the page when the viewer has decided.
         */
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    List<String> grant = new ArrayList<>();
                    List<String> need = new ArrayList<>();
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                            if (held(Manifest.permission.RECORD_AUDIO)) grant.add(r);
                            else need.add(Manifest.permission.RECORD_AUDIO);
                        } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                            if (held(Manifest.permission.CAMERA)) grant.add(r);
                            else need.add(Manifest.permission.CAMERA);
                        }
                    }
                    if (!need.isEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        pending = request;
                        requestPermissions(need.toArray(new String[0]), MEDIA_PERMISSIONS);
                        return;
                    }
                    if (grant.isEmpty()) request.deny();
                    else request.grant(grant.toArray(new String[0]));
                }
            });
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pending == request) pending = null;
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback done) {
            if (fullscreen != null) {
                done.onCustomViewHidden();
                return;
            }
            fullscreen = view;
            fullscreenDone = done;
            root.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.setVisibility(View.GONE);
        }

        @Override
        public void onHideCustomView() {
            exitFullscreen();
        }
    }

    private void exitFullscreen() {
        if (fullscreen == null) return;
        root.removeView(fullscreen);
        fullscreen = null;
        web.setVisibility(View.VISIBLE);
        if (fullscreenDone != null) fullscreenDone.onCustomViewHidden();
        fullscreenDone = null;
        web.requestFocus();
    }

    private boolean held(String permission) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code != MEDIA_PERMISSIONS || pending == null) return;
        PermissionRequest request = pending;
        pending = null;
        List<String> grant = new ArrayList<>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && held(Manifest.permission.RECORD_AUDIO))
                grant.add(r);
            else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && held(Manifest.permission.CAMERA))
                grant.add(r);
        }
        if (grant.isEmpty()) request.deny();
        else request.grant(grant.toArray(new String[0]));
    }

    // ---- helpers ------------------------------------------------------------

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (IOException e) {
            return "";
        }
    }

    /** evaluateJavascript hands back a JSON value; our functions return strings. */
    static String unquote(String v) {
        if (v == null || "null".equals(v)) return null;
        try {
            return new JSONObject("{\"v\":" + v + "}").optString("v", null);
        } catch (Exception e) {
            return null;
        }
    }
}
