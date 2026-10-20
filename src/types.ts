export type Role = 'student' | 'staff' | 'admin';
export interface User {
  id: string; name: string; email: string; role: Role; department: string; studentOrStaffId: string;
  status: 'active' | 'pending' | 'suspended'; emailVerified: boolean; avatarUrl: string | null; createdAt: string;
  prefs: { notify: { message: boolean; file: boolean; announcement: boolean; attendance: boolean }; aiAssistance: boolean };
}
export interface Lab {
  id: string; name: string; code: string; description: string; course: string; building: string; roomNumber: string; capacity: number;
  schedule: string; startsOn: string | null; endsOn: string | null; status: 'active' | 'archived'; createdAt: string;
  staff: { id: string; name: string }[]; memberCount: number; activeSession: { id: string; startAt: string; title: string } | null;
  checkedInCount: number; unread: number;
  myAttendance?: { id: string; status: string; checkInAt: string; checkOutAt: string | null; verificationStatus: string } | null;
}
export interface Attendance {
  id: string; labId: string; labName: string; labCode: string; sessionId: string; sessionTitle: string; sessionStart: string;
  studentId: string; studentName: string; studentNumber: string; department: string; checkInAt: string; checkOutAt: string | null;
  durationMinutes: number; status: 'checked_in' | 'checked_out' | 'missing_checkout'; method: string; verificationStatus: 'pending' | 'verified' | 'corrected';
}
export interface Message {
  id: string; labId: string; senderId: string; senderName: string; senderRole: Role; content: string; kind: 'text' | 'announcement' | 'file';
  replyTo: string | null; clientId: string | null; createdAt: string; editedAt: string | null; deleted: boolean;
  attachment: { id: string; name: string; size: number; contentType: string } | null;
  replyPreview: { senderName: string; content: string } | null;
  status?: 'sending' | 'failed';
}
export interface LabFile {
  id: string; labId: string; labName: string; name: string; size: number; contentType: string; uploaderId: string; uploaderName: string;
  createdAt: string; scanStatus: string; indexed: boolean; previewable: boolean;
}
export interface Notice { id: string; type: string; title: string; message: string; link: string | null; readAt: string | null; createdAt: string }
export interface Alert {
  id: string; labId: string | null; labName: string | null; type: string; detectionMethod: 'rule' | 'ai'; severity: 'low' | 'medium' | 'high' | 'critical';
  title: string; evidence: Record<string, unknown>; status: 'open' | 'reviewing' | 'resolved' | 'dismissed'; createdAt: string;
  review: { reviewer: string; decision: string; notes: string; reviewedAt: string } | null;
}
export interface AiSource { fileId: string; name: string; section: string }
