package com.pairux.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import android.Manifest;
import android.content.pm.PackageManager;

import java.util.ArrayList;
import java.util.List;

/**
 * PairUX (pairux.com) on Android: the web app in a full-screen WebView.
 *
 * The site is already responsive and installable, so this adds only what a
 * browser tab cannot: a launcher entry, $DOMAIN links opening here, the system
 * Back button walking the page's own history, file uploads, full-screen video,
 * and an offline screen instead of Chrome's dinosaur.
 */
public class MainActivity extends Activity {

    static final String HOME = "https://pairux.com/";
    static final String OFFLINE = "file:///android_asset/offline.html";
    static final int MEDIA_PERMISSIONS = 1;
    static final int FILE_CHOOSER = 2;

    private WebView web;
    private FrameLayout root;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenDone;
    private PermissionRequest pendingPermission;
    private ValueCallback<Uri[]> pendingFiles;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0F172A);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0F172A);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " pairux-android");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (state != null) web.restoreState(state);
        else handle(getIntent(), true);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handle(intent, false);
    }

    /** A tapped pairux.com link opens that page; the launcher icon opens the home page. */
    private void handle(Intent intent, boolean launching) {
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && "pairux.com".equalsIgnoreCase(data.getHost())) web.loadUrl(data.toString());
        else if (launching) web.loadUrl(HOME);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (fullscreen != null) { exitFullscreen(); return; }
        if (web.canGoBack()) { web.goBack(); return; }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    private class Client extends WebViewClient {
        /** Our own pages stay in the app; anything else is someone else's site. */
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            String host = url.getHost();
            if (host == null || host.equalsIgnoreCase("pairux.com") || host.endsWith(".pairux.com")) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) view.loadUrl(OFFLINE);
        }
    }

    private class Chrome extends WebChromeClient {
        /** getUserMedia: grant only what Android already granted us, else ask first. */
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
                        pendingPermission = request;
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
            if (pendingPermission == request) pendingPermission = null;
        }

        /** Without this an <input type=file> does nothing at all in a WebView. */
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> files,
                                         FileChooserParams params) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = files;
            try {
                startActivityForResult(params.createIntent(), FILE_CHOOSER);
                return true;
            } catch (Exception e) {
                pendingFiles = null;
                return false;
            }
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback done) {
            if (fullscreen != null) { done.onCustomViewHidden(); return; }
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
    }

    private boolean held(String permission) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code != MEDIA_PERMISSIONS || pendingPermission == null) return;
        PermissionRequest request = pendingPermission;
        pendingPermission = null;
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

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code != FILE_CHOOSER) { super.onActivityResult(code, result, data); return; }
        if (pendingFiles == null) return;
        pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
        pendingFiles = null;
    }
}
