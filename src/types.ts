export interface ApiCall {
  url: string;
  status: number;
  duration: number;
  type: "ssr" | "csr";
  initiator?: string;
  serverTiming?: string;
}

export interface WebVitals {
  lcp?: number;
  cls?: number;
  fcp?: number;
  ttfb?: number;
  totalTime?: number;
}

export interface PageResult {
  url: string;
  status?: number;
  vitals: WebVitals;
  apiCalls: ApiCall[];
  errors: string[];
  videoPath?: string;
  error?: string;
  auditedAt: string;
  profile: DeviceProfile;
  engine?: string;
}

export type AuditStatus = "pending" | "running" | "done" | "failed";

export interface AuditProgress {
  url: string;
  status: AuditStatus;
  results?: PageResult[];
  screenshots?: Record<string, string>;
}

export interface DeviceProfile {
  id: string;
  label: string;
  icon: string;
  frameType: "desktop" | "macbook" | "iphone" | "android";
  playwrightDevice?: string;
  engine?: "chromium" | "webkit" | "firefox";
  viewport?: { width: number; height: number };
  userAgent?: string;
  isMobile?: boolean;
  hasTouch?: boolean;
  deviceScaleFactor?: number;
}

export const DEVICE_PROFILES: DeviceProfile[] = [
  {
    id: "desktop-chrome",
    label: "Chrome 141",
    icon: "🖥",
    frameType: "desktop",
    engine: "chromium",
    viewport: { width: 1440, height: 900 },
    // Chrome 141 — matches Pixel 7's shipped version
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  },
  {
    id: "desktop-safari",
    label: "Safari 17",
    icon: "🧭",
    frameType: "macbook",
    engine: "webkit",
    viewport: { width: 1440, height: 900 },
    // Safari 17.5 on macOS Sonoma
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 2,
  },
  {
    id: "mobile-ios",
    label: "iPhone 15 Pro",
    icon: "📱",
    frameType: "iphone",
    // iOS 17.5, Safari — webkit auto-detected from device descriptor
    playwrightDevice: "iPhone 15 Pro",
  },
  {
    id: "mobile-android",
    label: "Pixel 7",
    icon: "🤖",
    frameType: "android",
    // Android 14, Chrome 141 — chromium auto-detected
    playwrightDevice: "Pixel 7",
  },
];
