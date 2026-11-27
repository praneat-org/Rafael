export type Unsupported = 'mobile' | 'not-chrome' | 'no-display-media';

export type NavLike = {
  userAgent: string;
  userAgentData?: { mobile?: boolean };
  mediaDevices?: { getDisplayMedia?: unknown };
};

/**
 * Rafael web runs on Chrome desktop. Mobile and a missing getDisplayMedia cannot work -> `blocked`.
 * Another desktop browser only gets a warning: Edge (Chromium) works, others may lack tab audio,
 * which the capture guard reports clearly when it happens.
 */
export function checkSupport(nav: NavLike): { reasons: Unsupported[]; blocked: boolean } {
  const ua = nav.userAgent;
  const reasons: Unsupported[] = [];
  if (nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobi/i.test(ua)) {
    reasons.push('mobile');
  }
  if (!/Chrome\/\d/.test(ua) || /Edg\/|OPR\/|Vivaldi\/|SamsungBrowser/.test(ua)) {
    reasons.push('not-chrome');
  }
  if (typeof nav.mediaDevices?.getDisplayMedia !== 'function') reasons.push('no-display-media');
  return { reasons, blocked: reasons.some((r) => r !== 'not-chrome') };
}

export const SUPPORT_TEXT: Record<Unsupported, string> = {
  mobile: 'ใช้บนมือถือไม่ได้ — เปิดด้วย Chrome บนคอมพิวเตอร์',
  'not-chrome': 'Rafael รองรับ Chrome บนคอมพิวเตอร์ — เบราว์เซอร์อื่นอาจแชร์เสียงแท็บไม่ได้',
  'no-display-media': 'เบราว์เซอร์นี้แชร์แท็บ/เสียงไม่ได้ — เปิดด้วย Chrome บนคอมพิวเตอร์',
};
