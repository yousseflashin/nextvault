/**
 * qrScanner.ts - Universal QR code scanner for 2FA TOTP authenticator keys.
 *
 * Uses pure JS `jsQR` engine for 100% reliable scanning in any Android WebView,
 * Capacitor environment, or browser, with native BarcodeDetector acceleration
 * when available.
 */
import jsQR from 'jsqr';

export interface QrScanResult {
  raw: string;
  isOtpAuth: boolean;
  otpData?: {
    service: string;
    account?: string;
    secret: string;
    algorithm?: string;
    digits?: number;
    period?: number;
  };
}

/**
 * Request camera permission from native Android Capacitor plugin or web mediaDevices.
 */
export async function requestCameraPermission(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  // 1. Check native Capacitor plugin
  const plugins = (window as any).Capacitor?.Plugins;
  if (plugins?.CameraPermission?.requestCameraPermission) {
    try {
      const res = await plugins.CameraPermission.requestCameraPermission();
      if (res && res.granted) return true;
    } catch (err) {
      console.warn('[QR] Capacitor CameraPermission error:', err);
    }
  }

  // 2. Standard Web mediaDevices permission request
  try {
    if (navigator?.mediaDevices?.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }
      });
      stream.getTracks().forEach(t => t.stop());
      return true;
    }
  } catch (err: any) {
    console.warn('[QR] getUserMedia permission check error:', err?.message || err);
  }

  return false;
}

/**
 * Scan a QR code from an image File or Blob.
 */
export async function scanQrFromImageSource(source: File | Blob): Promise<string | null> {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    let width = 0;
    let height = 0;

    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(source);
      width = bitmap.width;
      height = bitmap.height;
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(bitmap, 0, 0);
    } else {
      const img = new Image();
      const url = URL.createObjectURL(source);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = url;
      });
      URL.revokeObjectURL(url);
      width = img.naturalWidth || img.width;
      height = img.naturalHeight || img.height;
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0);
    }

    if (width === 0 || height === 0) return null;

    // 1. Try native BarcodeDetector if available
    if ('BarcodeDetector' in window) {
      try {
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        const barcodes = await detector.detect(canvas);
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          return barcodes[0].rawValue.trim();
        }
      } catch {}
    }

    // 2. Guaranteed jsQR fallback on pixel data
    const imgData = ctx.getImageData(0, 0, width, height);
    const code = jsQR(imgData.data, width, height, {
      inversionAttempts: 'attemptBoth'
    });
    if (code && code.data) {
      return code.data.trim();
    }
  } catch (err) {
    console.warn('[QR] Error scanning image source:', err);
  }
  return null;
}

/**
 * Start real-time camera scanning on a <video> element.
 * Uses native BarcodeDetector when available and jsQR frame analysis.
 */
export async function startCameraQrScanner(
  videoElement: HTMLVideoElement,
  onDetected: (result: string) => void,
  onError?: (err: Error) => void
): Promise<() => void> {
  let active = true;
  let stream: MediaStream | null = null;
  let animId: number | null = null;

  try {
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (!active) {
      stream.getTracks().forEach(t => t.stop());
      return () => {};
    }

    videoElement.srcObject = stream;
    videoElement.setAttribute('playsinline', 'true');
    videoElement.muted = true;
    await videoElement.play();

    // Prepare offscreen canvas for frame capture
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let detector: any = null;
    if ('BarcodeDetector' in window) {
      try {
        detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
      } catch {}
    }

    let isScanning = false;
    let lastScanTime = 0;

    const processFrame = async (timestamp: number) => {
      if (!active) return;

      // Scan every ~120ms to save CPU & battery
      if (timestamp - lastScanTime >= 120 && !isScanning && videoElement.readyState >= videoElement.HAVE_CURRENT_DATA) {
        isScanning = true;
        lastScanTime = timestamp;

        try {
          let detectedText: string | null = null;

          // Strategy A: Native BarcodeDetector
          if (detector) {
            try {
              const barcodes = await detector.detect(videoElement);
              if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                detectedText = barcodes[0].rawValue.trim();
              }
            } catch {}
          }

          // Strategy B: jsQR on canvas frame (bulletproof fallback)
          if (!detectedText && ctx && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
            const vw = videoElement.videoWidth;
            const vh = videoElement.videoHeight;

            // Scale down high-res video to ~640px for faster QR recognition
            const maxDim = 640;
            const scale = Math.min(1, maxDim / Math.max(vw, vh));
            const cw = Math.floor(vw * scale);
            const ch = Math.floor(vh * scale);

            if (canvas.width !== cw || canvas.height !== ch) {
              canvas.width = cw;
              canvas.height = ch;
            }

            ctx.drawImage(videoElement, 0, 0, cw, ch);
            const imgData = ctx.getImageData(0, 0, cw, ch);
            const qr = jsQR(imgData.data, cw, ch, {
              inversionAttempts: 'dontInvert'
            });

            if (qr && qr.data) {
              detectedText = qr.data.trim();
            }
          }

          if (detectedText && active) {
            // Haptic feedback
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              try { navigator.vibrate(80); } catch {}
            }
            onDetected(detectedText);
            return; // Stop scanning loop on detection
          }
        } catch {
          // ignore transient frame decode errors
        } finally {
          isScanning = false;
        }
      }

      if (active) {
        animId = requestAnimationFrame(processFrame);
      }
    };

    animId = requestAnimationFrame(processFrame);
  } catch (err: any) {
    console.error('[QR] Camera access error:', err);
    onError?.(err);
  }

  return () => {
    active = false;
    if (animId) cancelAnimationFrame(animId);
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
    if (videoElement) {
      videoElement.srcObject = null;
    }
  };
}
