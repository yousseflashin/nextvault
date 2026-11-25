package com.nexvault.app;

import android.content.Context;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class NativeCredentialStore {
    private static final String PREFS = "nexvault_autofill";
    private static final String DATA = "credentials";
    private static final String PENDING_DATA = "pending_credentials";
    private static final String KEY_ALIAS = "nexvault.autofill.credentials";

    private NativeCredentialStore() {}

    private static void writeKeyed(Context context, String key, String value) throws Exception {
        byte[] iv = new byte[12];
        new java.security.SecureRandom().nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getKey(), new GCMParameterSpec(128, iv));
        byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] payload = new byte[iv.length + ciphertext.length];
        System.arraycopy(iv, 0, payload, 0, iv.length);
        System.arraycopy(ciphertext, 0, payload, iv.length, ciphertext.length);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(key, Base64.encodeToString(payload, Base64.NO_WRAP))
            .commit();
    }

    private static String readKeyed(Context context, String key) {
        String stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, "[]");
        if (stored == null || stored.isEmpty()) return "[]";
        try {
            byte[] payload = Base64.decode(stored, Base64.NO_WRAP);
            byte[] iv = new byte[12];
            byte[] ciphertext = new byte[payload.length - iv.length];
            System.arraycopy(payload, 0, iv, 0, iv.length);
            System.arraycopy(payload, iv.length, ciphertext, 0, ciphertext.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getKey(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            return stored.startsWith("[") ? stored : "[]";
        }
    }

    static void write(Context context, String value) throws Exception {
        writeKeyed(context, DATA, value);
    }

    static String read(Context context) {
        return readKeyed(context, DATA);
    }

    static String readCredentials(Context context) {
        return read(context);
    }

    static void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(DATA).commit();
    }

    static void writePending(Context context, String value) throws Exception {
        writeKeyed(context, PENDING_DATA, value);
    }

    static String readPending(Context context) {
        return readKeyed(context, PENDING_DATA);
    }

    static void clearPending(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(PENDING_DATA).commit();
    }

    private static SecretKey getKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        generator.init(new android.security.keystore.KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            android.security.keystore.KeyProperties.PURPOSE_ENCRYPT | android.security.keystore.KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
         .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
         .build());
        return generator.generateKey();
    }
}