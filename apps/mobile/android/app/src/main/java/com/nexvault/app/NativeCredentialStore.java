package com.nexvault.app;

import android.content.Context;
import android.util.Base64;
import android.util.Log;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class NativeCredentialStore {
    private static final String TAG = "NexVaultStore";
    private static final String PREFS = "nexvault_autofill";
    private static final String DATA = "credentials";
    private static final String PENDING_DATA = "pending_credentials";
    private static final String KEY_ALIAS = "nexvault.autofill.credentials";

    private NativeCredentialStore() {}

    private static void writeKeyed(Context context, String key, String value) {
        if (context == null || key == null) return;
        if (value == null) value = "[]";

        try {
            byte[] iv = new byte[12];
            new java.security.SecureRandom().nextBytes(iv);
            SecretKey secretKey = getKey();
            if (secretKey != null) {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, secretKey, new GCMParameterSpec(128, iv));
                byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
                byte[] payload = new byte[iv.length + ciphertext.length];
                System.arraycopy(iv, 0, payload, 0, iv.length);
                System.arraycopy(ciphertext, 0, payload, iv.length, ciphertext.length);
                String encoded = Base64.encodeToString(payload, Base64.NO_WRAP);
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(key, encoded)
                    .commit();
                Log.d(TAG, "Successfully encrypted and stored " + key + " (" + value.length() + " chars)");
                return;
            }
        } catch (Exception e) {
            Log.e(TAG, "AES KeyStore encryption failed for " + key + "; falling back to sandbox storage", e);
        }

        // Fallback: Store directly in private SharedPreferences (protected by Linux UID sandbox)
        try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(key, value)
                .commit();
            Log.d(TAG, "Stored " + key + " via sandbox fallback");
        } catch (Exception e) {
            Log.e(TAG, "Fatal: unable to write " + key, e);
        }
    }

    private static String readKeyed(Context context, String key) {
        if (context == null || key == null) return "[]";
        String stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, "[]");
        if (stored == null || stored.isEmpty() || stored.equals("[]")) return "[]";

        // If it starts with JSON array bracket, it was stored via plaintext sandbox fallback
        if (stored.startsWith("[")) {
            return stored;
        }

        try {
            byte[] payload = Base64.decode(stored, Base64.NO_WRAP);
            if (payload == null || payload.length <= 12) {
                return stored.startsWith("[") ? stored : "[]";
            }
            byte[] iv = new byte[12];
            byte[] ciphertext = new byte[payload.length - iv.length];
            System.arraycopy(payload, 0, iv, 0, iv.length);
            System.arraycopy(payload, iv.length, ciphertext, 0, ciphertext.length);
            SecretKey secretKey = getKey();
            if (secretKey != null) {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(128, iv));
                return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
            }
        } catch (Exception e) {
            Log.e(TAG, "Decryption error for " + key + "; returning raw if JSON", e);
        }
        return stored.startsWith("[") ? stored : "[]";
    }

    static void write(Context context, String value) {
        writeKeyed(context, DATA, value);
    }

    static String read(Context context) {
        return readKeyed(context, DATA);
    }

    static String readCredentials(Context context) {
        return read(context);
    }

    static void clear(Context context) {
        if (context != null) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(DATA).commit();
        }
    }

    static void writePending(Context context, String value) {
        writeKeyed(context, PENDING_DATA, value);
    }

    static String readPending(Context context) {
        return readKeyed(context, PENDING_DATA);
    }

    static void clearPending(Context context) {
        if (context != null) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(PENDING_DATA).commit();
        }
    }

    private static SecretKey getKey() {
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (keyStore.containsAlias(KEY_ALIAS)) {
                java.security.Key k = keyStore.getKey(KEY_ALIAS, null);
                if (k instanceof SecretKey) {
                    return (SecretKey) k;
                }
            }
            KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
            generator.init(new android.security.keystore.KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                android.security.keystore.KeyProperties.PURPOSE_ENCRYPT | android.security.keystore.KeyProperties.PURPOSE_DECRYPT
            ).setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
             .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
             .build());
            return generator.generateKey();
        } catch (Exception e) {
            Log.e(TAG, "AndroidKeyStore getKey error", e);
            return null;
        }
    }
}
