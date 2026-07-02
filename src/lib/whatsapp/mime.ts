/**
 * Best-effort MIME type → file extension mapping for inbound WhatsApp
 * media. Meta gives us a MIME type on every media message but never a
 * filename (except documents, which carry their own). Used to build a
 * sane object path when persisting inbound media to Storage.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/amr': 'amr',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
};

/**
 * Meta sometimes appends codec parameters (e.g. "audio/ogg;
 * codecs=opus") — strip everything after the first `;` before
 * looking up the map or falling back to the subtype.
 */
export function extensionForMimeType(mimeType: string | null | undefined): string {
  if (!mimeType) return 'bin';
  const base = mimeType.split(';')[0].trim().toLowerCase();
  if (EXTENSION_BY_MIME[base]) return EXTENSION_BY_MIME[base];
  const subtype = base.split('/')[1];
  return subtype ? subtype.replace(/[^a-z0-9]/g, '') || 'bin' : 'bin';
}
