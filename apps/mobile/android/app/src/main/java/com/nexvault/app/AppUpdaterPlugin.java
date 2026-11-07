package com.nexvault.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * In-app updater for sideloaded (GitHub Releases) builds.
 *
 * Security model — an APK is only handed to the system installer when ALL hold:
 *   1. Every URL in the redirect chain is HTTPS on github.com / *.githubusercontent.com.
 *   2. The downloaded size and SHA-256 match the release manifest.
 *   3. The APK's package name equals ours and its versionCode is newer.
 *   4. Its signing certificate matches the installed app (otherwise Android would
 *      refuse the update anyway — we report it clearly instead).
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static final String[] ALLOWED_HOST_SUFFIXES = { "github.com", "githubusercontent.com" };
    private static final int MAX_REDIRECTS = 10;
    private static final String UPDATE_FILE_NAME = "nexvault-update.apk";

    // ------------------------------------------------------------------ info

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo info = pm.getPackageInfo(getContext().getPackageName(), 0);
            JSObject ret = new JSObject();
            ret.put("packageName", info.packageName);
            ret.put("versionName", info.versionName);
            ret.put("versionCode", versionCodeOf(info));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Unable to read app info: " + e.getMessage());
        }
    }

    @PluginMethod
    public void canInstallUnknownApps(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("canInstall", canInstallPackages());
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        openUnknownSourcesSettings();
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    // --------------------------------------------------------------- install

    @PluginMethod
    public void installApk(PluginCall call) {
        final String downloadUrl = call.getString("url");
        final String expectedSha256 = call.getString("sha256", "");
        final long expectedSize = call.getLong("size", 0L);

        if (downloadUrl == null || downloadUrl.trim().isEmpty()) {
            call.reject("Download URL is required");
            return;
        }
        if (expectedSha256 == null || !expectedSha256.matches("(?i)^[a-f0-9]{64}$")) {
            resolveFailure(call, "Update rejected: the release has no valid SHA-256 checksum.", null);
            return;
        }
        try {
            if (!isAllowedUrl(new URL(downloadUrl))) {
                resolveFailure(call, "Update rejected: download host is not an official GitHub release host.", null);
                return;
            }
        } catch (IOException e) {
            call.reject("Invalid download URL");
            return;
        }

        if (!canInstallPackages()) {
            openUnknownSourcesSettings();
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("needPermission", true);
            ret.put("message", "Permission required: enable 'Allow from this source' for NexVault in Android Settings, then tap Install again.");
            call.resolve(ret);
            return;
        }

        new Thread(() -> {
            File apkFile = new File(getContext().getCacheDir(), UPDATE_FILE_NAME);
            try {
                String actualSha256 = download(downloadUrl, apkFile, expectedSize);

                if (expectedSize > 0 && apkFile.length() != expectedSize) {
                    throw new IOException("Size mismatch: expected " + expectedSize + " bytes, got " + apkFile.length());
                }
                if (!actualSha256.equalsIgnoreCase(expectedSha256)) {
                    throw new IOException("Checksum mismatch — the download is corrupted or was tampered with.");
                }

                String packageProblem = verifyPackage(apkFile);
                if (packageProblem != null) {
                    //noinspection ResultOfMethodCallIgnored
                    apkFile.delete();
                    boolean signatureMismatch = packageProblem.startsWith("SIGNATURE:");
                    resolveFailure(call, packageProblem.replaceFirst("^SIGNATURE:", ""), signatureMismatch);
                    return;
                }

                launchInstaller(apkFile);
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("message", "Verified update. Confirm in the Android installer to finish updating.");
                call.resolve(ret);
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                apkFile.delete();
                call.reject("Update failed: " + e.getMessage());
            }
        }).start();
    }

    // ---------------------------------------------------------------- helpers

    /** Downloads with manual, allowlist-checked redirects. Returns the SHA-256 hex digest. */
    private String download(String startUrl, File target, long expectedSize) throws IOException, NoSuchAlgorithmException {
        HttpURLConnection connection = null;
        URL current = new URL(startUrl);
        try {
            for (int hop = 0; ; hop++) {
                if (hop > MAX_REDIRECTS) throw new IOException("Too many redirects");
                if (!isAllowedUrl(current)) throw new IOException("Redirected to untrusted host: " + current.getHost());

                connection = (HttpURLConnection) current.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setRequestProperty("User-Agent", "NexVault-Mobile-Updater");
                connection.setRequestProperty("Accept", "application/octet-stream");

                int code = connection.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String location = connection.getHeaderField("Location");
                    connection.disconnect();
                    if (location == null) throw new IOException("Redirect without Location header");
                    current = new URL(current, location);
                    continue;
                }
                if (code != HttpURLConnection.HTTP_OK) {
                    throw new IOException("Server returned HTTP " + code);
                }
                break;
            }

            long total = connection.getContentLengthLong();
            if (total <= 0) total = expectedSize;
            if (target.exists()) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
            }

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                long done = 0;
                int lastPercent = -1;
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    digest.update(buffer, 0, read);
                    done += read;
                    if (expectedSize > 0 && done > expectedSize) {
                        throw new IOException("Download exceeds the expected size");
                    }
                    if (total > 0) {
                        int percent = (int) Math.min(100, (done * 100) / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            JSObject progress = new JSObject();
                            progress.put("percent", percent);
                            progress.put("downloadedBytes", done);
                            progress.put("totalBytes", total);
                            notifyListeners("downloadProgress", progress);
                        }
                    }
                }
                out.getFD().sync();
            }
            return toHex(digest.digest());
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** Returns null when the APK is a valid upgrade, otherwise a user-facing reason. */
    @SuppressWarnings("deprecation")
    private String verifyPackage(File apkFile) throws PackageManager.NameNotFoundException {
        PackageManager pm = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;

        PackageInfo archive = pm.getPackageArchiveInfo(apkFile.getAbsolutePath(), flags);
        if (archive == null) return "The downloaded file is not a valid Android package.";

        String ourPackage = getContext().getPackageName();
        if (!ourPackage.equals(archive.packageName)) {
            return "The downloaded package (" + archive.packageName + ") is not NexVault.";
        }

        PackageInfo installed = pm.getPackageInfo(ourPackage, flags);
        if (versionCodeOf(archive) <= versionCodeOf(installed)) {
            return "This version is not newer than the installed app.";
        }

        Set<String> newCerts = certificateDigests(archive);
        Set<String> currentCerts = certificateDigests(installed);
        if (!newCerts.isEmpty() && !currentCerts.isEmpty() && Collections.disjoint(newCerts, currentCerts)) {
            return "SIGNATURE:This update is signed with a different key than your installed app "
                + "(e.g. upgrading from an old debug build). Android cannot update it in place: "
                + "export a backup, uninstall NexVault, then install the new APK from the website.";
        }
        return null;
    }

    private void launchInstaller(File apkFile) {
        Uri apkUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apkFile);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        List<ResolveInfo> handlers = getContext().getPackageManager().queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
        for (ResolveInfo handler : handlers) {
            getContext().grantUriPermission(handler.activityInfo.packageName, apkUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
        getContext().startActivity(intent);
    }

    private void resolveFailure(PluginCall call, String message, Boolean signatureMismatch) {
        JSObject ret = new JSObject();
        ret.put("success", false);
        ret.put("message", message);
        if (signatureMismatch != null && signatureMismatch) ret.put("signatureMismatch", true);
        call.resolve(ret);
    }

    private boolean canInstallPackages() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void openUnknownSourcesSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            settingsIntent.setData(Uri.parse("package:" + getContext().getPackageName()));
            settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settingsIntent);
        }
    }

    private static boolean isAllowedUrl(URL url) {
        if (!"https".equalsIgnoreCase(url.getProtocol())) return false;
        String host = url.getHost().toLowerCase(Locale.ROOT);
        for (String suffix : ALLOWED_HOST_SUFFIXES) {
            if (host.equals(suffix) || host.endsWith("." + suffix)) return true;
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    private static long versionCodeOf(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    @SuppressWarnings("deprecation")
    private static Set<String> certificateDigests(PackageInfo info) {
        Set<String> out = new HashSet<>();
        Signature[] signatures = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null) {
            signatures = info.signingInfo.hasMultipleSigners()
                ? info.signingInfo.getApkContentsSigners()
                : info.signingInfo.getSigningCertificateHistory();
        } else if (info.signatures != null) {
            signatures = info.signatures;
        }
        if (signatures == null) return out;
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            for (Signature s : signatures) {
                out.add(toHex(md.digest(s.toByteArray())));
            }
        } catch (NoSuchAlgorithmException ignored) {
            // SHA-256 is always available on Android.
        }
        return out;
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }
}
