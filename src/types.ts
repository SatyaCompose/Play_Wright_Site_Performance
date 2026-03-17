export interface ApiCall {
  url: string;
  status: number;
  duration: number;
  type: "ssr" | "csr"; // server-side rendered (intercepted at network) vs client-side (resource timing)
  initiator?: string;
  serverTiming?: string; // Server-Timing header if present
}

export interface WebVitals {
  lcp?: number; // Largest Contentful Paint (ms)
  cls?: number; // Cumulative Layout Shift (score)
  fcp?: number; // First Contentful Paint (ms)
  ttfb?: number; // Time To First Byte (ms)
  tbt?: number; // Total Blocking Time (ms, approx)
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
}

export type AuditStatus = "pending" | "running" | "done" | "failed";

export interface AuditProgress {
  url: string;
  status: AuditStatus;
  result?: PageResult;
}
