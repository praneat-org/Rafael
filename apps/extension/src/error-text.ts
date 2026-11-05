import type { ErrorCode } from '@rafael/protocol';

export type ErrorKey = ErrorCode | 'CONNECTION_CLOSED';
export type ErrorText = { what: string; todo: string };

/** FE-50: every server error code -> what happened + what to do next (Thai). Record keeps it exhaustive with the protocol. */
export const ERROR_TEXT: Record<ErrorKey, ErrorText> = {
  BAD_MESSAGE: {
    what: 'extension กับ server คุยกันไม่รู้เรื่อง',
    todo: 'จบ session แล้วเริ่มใหม่ ถ้ายังเป็นอีกให้แจ้งทีมพัฒนา',
  },
  VERSION_MISMATCH: {
    what: 'extension กับ server คนละเวอร์ชัน',
    todo: 'อัปเดต extension เป็นเวอร์ชันล่าสุด แล้วเปิด panel ใหม่',
  },
  UNAUTHORIZED: {
    what: 'server ไม่ยอมรับการลงชื่อเข้าใช้',
    todo: 'ใช้ได้เฉพาะบัญชี @praneat.com — สลับ Chrome profile แล้วลงชื่อเข้าใช้ใหม่',
  },
  PACK_TOO_LARGE: {
    what: 'pack ใหญ่เกินไป',
    todo: 'ติ๊กไฟล์ที่จะตัดออก แล้วสร้าง pack ใหม่',
  },
  PACK_BUILD_FAILED: {
    what: 'สร้าง pack ไม่สำเร็จ',
    todo: 'กดลองใหม่ ถ้ายังไม่ได้ ตรวจสิทธิ์โฟลเดอร์ Drive',
  },
  PACK_NOT_READY: {
    what: 'กำลังเตรียมเอกสาร',
    todo: 'รอสักครู่แล้วถามใหม่',
  },
  SESSION_NOT_FOUND: {
    what: 'session เดิมหายไปแล้ว (server เริ่มใหม่)',
    todo: 'กดเริ่ม session ใหม่อีกครั้ง',
  },
  STT_UNAVAILABLE: {
    what: 'ระบบถอดเสียงใช้ไม่ได้ชั่วคราว จึงไม่มี cue จากเสียงที่พูด',
    todo: 'พิมพ์คำถามในช่องด้านล่างแทนได้ ถ้ายังไม่กลับมาให้จบแล้วเริ่ม session ใหม่',
  },
  LLM_UNAVAILABLE: {
    what: 'ระบบสร้างคำตอบใช้ไม่ได้ชั่วคราว',
    todo: 'รอสักครู่แล้วถามใหม่ ถ้ายังไม่ได้ให้เปิดเอกสารดูเอง',
  },
  CONNECTION_CLOSED: {
    what: 'การเชื่อมต่อถูกปิด (ยืนยันตัวตนไม่ผ่านหรือ server ปฏิเสธ)',
    todo: 'ใช้ได้เฉพาะบัญชี @praneat.com ลองสลับ Chrome profile แล้วลงชื่อเข้าใช้ใหม่',
  },
};

const UNKNOWN: ErrorText = { what: 'เกิดข้อผิดพลาดที่ไม่รู้จัก', todo: 'จบ session แล้วเริ่มใหม่' };

export const errorText = (code: string): ErrorText =>
  (ERROR_TEXT as Record<string, ErrorText | undefined>)[code] ?? UNKNOWN;

/** Mic permission failure from the audio pipeline (CaptureError 'mic-permission'). */
export const MIC_DENIED: ErrorText = {
  what: 'ใช้ไมค์ไม่ได้ เพราะยังไม่ได้อนุญาตไมค์ให้ Rafael',
  todo: 'อนุญาตไมค์ใน Chrome (chrome://settings/content/microphone) หรือเอาติ๊ก "ไมค์" ออก',
};
