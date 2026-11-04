/**
 * qrScanner.ts - Mobile camera & image QR code reader for 2FA OTP codes.
 * Uses the Web standard BarcodeDetector API (native in Chromium / Android WebView)
 * with support for live camera scanning and file/image upload fallback.
 */

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

export async function isBarcodeDetectorSupported(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('BarcodeDetector' in window)) return false;
  try {
    const formats = await (window as any).BarcodeDetector.getSupportedFormats();
    return Array.isArray(formats) && formats.includes('qr_code');
  } catch {
    return 'BarcodeDetector' in window;
  }
}

/**
 * Scan a QR code from a File / Blob / Image element
 */
export async function scanQrFromImageSource(source: File | Blob | HTMLImageElement | HTMLCanvasElement): Promise<string | null> {
  try {
    let target: any = source;

    if (source instanceof Blob || source instanceof File) {
      if ('createImageBitmap' in window) {
        target = await createImageBitmap(source);
      } else {
        target = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = URL.createObjectURL(source);
        });
      }
    }

    if ('BarcodeDetector' in window) {
      const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
      const barcodes = await detector.detect(target);
      if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
        return barcodes[0].rawValue;
      }
    }
  } catch (err) {
    console.warn('[QR] Error scanning image source:', err);
  }
  return null;
}

/**
 * Start real-time camera scanning on a <video> element
 */
export async function startCameraQrScanner(
  videoElement: HTMLVideoElement,
  onDetected: (result: string) => void,
  onError?: (err: Error) => void
): Promise<() => void> {
  let active = true;
  let stream: MediaStream | null = null;
  let rafId: number | null = null;

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
    await videoElement.play();

    const detector = ('BarcodeDetector' in window)
      ? new (window as any).BarcodeDetector({ formats: ['qr_code'] })
      : null;

    let isScanning = false;

    const scanFrame = async () => {
      if (!active) return;

      if (!isScanning && videoElement.readyState >= videoElement.HAVE_CURRENT_DATA) {
        isScanning = true;
        try {
          if (detector) {
            const barcodes = await detector.detect(videoElement);
            if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
              const code = barcodes[0].rawValue.trim();
              if (code) {
                // Vibrate if supported for haptic feedback
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                  try { navigator.vibrate(100); } catch {}
                }
                onDetected(code);
                return; // Stop scanning once detected
              }
            }
          }
        } catch {
          // Frame detection error, continue next frame
        } finally {
          isScanning = false;
        }
      }

      if (active) {
        rafId = requestAnimationFrame(scanFrame);
      }
    };

    rafId = requestAnimationFrame(scanFrame);
  } catch (err: any) {
    console.error('[QR] Camera access error:', err);
    onError?.(err);
  }

  return () => {
    active = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
    if (videoElement) {
      videoElement.srcObject = null;
    }
  };
}

