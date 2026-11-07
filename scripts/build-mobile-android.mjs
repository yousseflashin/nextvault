// Orchestrates building the mobile app, syncing assets to Capacitor Android,
// detecting compatible JDK (17/21) and Android SDK paths, and compiling the APK with Gradle.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const HOME = homedir();

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...opts.env }
  });
  if (res.error) throw res.error;
  return res.status;
}

// 1. Build mobile web assets
console.log('[1/3] Building mobile web app (Vite)...');
const buildCode = run('npm', ['--prefix', 'apps/mobile', 'run', 'build']);
if (buildCode !== 0) {
  process.exit(buildCode);
}

// 2. Sync Capacitor Android from apps/mobile directory
console.log('[2/3] Syncing Capacitor Android assets...');
const syncCode = run('npm', ['--prefix', 'apps/mobile', 'run', 'cap:sync']);
if (syncCode !== 0) {
  process.exit(syncCode);
}

// 3. Find compatible Java home (Gradle 8 requires Java <= 21, fails on Java 25)
console.log('[3/3] Assembling Android APK with Gradle...');
let javaHome = process.env.JAVA_HOME;

function isValidJdk(p) {
  try {
    return existsSync(join(p, 'bin', 'javac')) && existsSync(join(p, 'bin', 'java'));
  } catch {
    return false;
  }
}

let needJavaFallback = !javaHome;
if (javaHome && isValidJdk(javaHome)) {
  const check = spawnSync(join(javaHome, 'bin', 'java'), ['-version'], { encoding: 'utf8' });
  const verOutput = (check.stderr || '') + (check.stdout || '');
  if (/version "(?:2[5-9]|[3-9]\d)/.test(verOutput)) {
    needJavaFallback = true;
  }
} else {
  const check = spawnSync('java', ['-version'], { encoding: 'utf8' });
  const verOutput = (check.stderr || '') + (check.stdout || '');
  if (/version "(?:2[5-9]|[3-9]\d)/.test(verOutput)) {
    needJavaFallback = true;
  }
}

if (needJavaFallback) {
  const candidateDirs = [
    join(HOME, '.jdks'),
    join(HOME, 'tools'),
    '/usr/lib/jvm',
    join(HOME, '.sdkman', 'candidates', 'java'),
    '/opt'
  ];

  // Prefer Java 21, then Java 17
  for (const preferredVer of ['21', '17']) {
    for (const parent of candidateDirs) {
      if (!existsSync(parent)) continue;
      try {
        const entries = readdirSync(parent);
        for (const entry of entries) {
          if (entry.includes(preferredVer)) {
            const fullPath = join(parent, entry);
            if (isValidJdk(fullPath)) {
              javaHome = fullPath;
              break;
            }
          }
        }
      } catch {}
      if (javaHome) break;
    }
    if (javaHome) break;
  }
}

// 4. Find Android SDK
let androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!androidHome || !existsSync(androidHome)) {
  const sdkCandidates = [
    join(HOME, 'Android', 'Sdk'),
    join(HOME, 'Library', 'Android', 'sdk'),
    join(HOME, 'android-sdk'),
    '/usr/local/share/android-sdk',
    '/opt/android-sdk'
  ];
  for (const candidate of sdkCandidates) {
    if (existsSync(candidate)) {
      androidHome = candidate;
      break;
    }
  }
}

const env = { ...process.env };
if (javaHome) {
  console.log(`Using JAVA_HOME: ${javaHome}`);
  env.JAVA_HOME = javaHome;
  env.PATH = `${join(javaHome, 'bin')}:${env.PATH || ''}`;
}
if (androidHome) {
  console.log(`Using ANDROID_HOME: ${androidHome}`);
  env.ANDROID_HOME = androidHome;
  env.ANDROID_SDK_ROOT = androidHome;
}

let gradlewPath = join(ROOT, 'apps', 'mobile', 'android', 'gradlew');

// On Java 25+, Gradle 8's Groovy fails with class version 69. Prefer Gradle 9 if available in ~/.gradle cache
const checkJava = spawnSync('java', ['-version'], { encoding: 'utf8' });
const verOut = (checkJava.stderr || '') + (checkJava.stdout || '');
if (/version "(?:2[5-9]|[3-9]\d)/.test(verOut)) {
  const gradleDistsDir = join(HOME, '.gradle', 'wrapper', 'dists');
  if (existsSync(gradleDistsDir)) {
    try {
      const dists = readdirSync(gradleDistsDir).filter(d => d.startsWith('gradle-9'));
      for (const d of dists) {
        const sub = readdirSync(join(gradleDistsDir, d));
        for (const s of sub) {
          const cand = join(gradleDistsDir, d, s, d.replace('-bin', '').replace('-all', ''), 'bin', 'gradle');
          if (existsSync(cand)) {
            gradlewPath = cand;
            console.log(`Detected Java 25+: Using compatible Gradle 9 binary: ${gradlewPath}`);
            break;
          }
        }
        if (gradlewPath !== join(ROOT, 'apps', 'mobile', 'android', 'gradlew')) break;
      }
    } catch {}
  }
}

const keystorePropsPath = join(ROOT, 'apps', 'mobile', 'android', 'keystore.properties');
const hasReleaseSigning = Boolean(
  (process.env.NEXVAULT_KEYSTORE_PATH && existsSync(process.env.NEXVAULT_KEYSTORE_PATH)) ||
  existsSync(keystorePropsPath)
);
const gradleTask = hasReleaseSigning ? 'assembleRelease' : 'assembleDebug';
console.log(
  hasReleaseSigning
    ? '[Android] Release signing detected — building signed release APK (assembleRelease).'
    : '[Android] No release keystore configured — building debug APK (assembleDebug) for local testing.'
);

const androidDir = join(ROOT, 'apps', 'mobile', 'android');
const gradleResult = run(gradlewPath, ['-p', androidDir, '--no-daemon', 'clean', gradleTask], { env });

const apkPath = hasReleaseSigning
  ? join(ROOT, 'apps', 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
  : join(ROOT, 'apps', 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

if (gradleResult !== 0) {
  if (existsSync(apkPath)) {
    console.warn(`\n[WARNING] Gradle build failed with code ${gradleResult}, but an existing APK was found at:`);
    console.warn(`  ${apkPath}`);
    console.warn('Proceeding with the existing APK for release packaging.\n');
  } else {
    console.error(`\n[ERROR] Gradle ${gradleTask} failed with exit code ${gradleResult} and no pre-built APK exists.`);
    process.exit(gradleResult);
  }
} else {
  const metadataPath = join(
    ROOT,
    'apps',
    'mobile',
    'android',
    'app',
    'build',
    'outputs',
    'apk',
    hasReleaseSigning ? 'release' : 'debug',
    'output-metadata.json'
  );
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const builtVersion = metadata.elements?.[0]?.versionName;
  const expectedVersion = JSON.parse(readFileSync(join(ROOT, 'apps', 'mobile', 'package.json'), 'utf8')).version;
  if (builtVersion !== expectedVersion) {
    throw new Error(`Android APK version mismatch: built ${builtVersion}, expected ${expectedVersion}`);
  }
  console.log(`\n✓ Android APK successfully built: ${apkPath}`);
}
