'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.cjs': 'application/javascript',
  '.mjs': 'application/javascript',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime'
};

function defaultBaseDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(appData, 'EstebanCloud');
}

function createHttpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function sanitizeFileName(fileName) {
  const raw = String(fileName || '').replace(/\\/g, '/');
  let base = path.basename(raw);
  // Strip control characters and filesystem-dangerous characters
  base = base
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .trim();

  if (!base || base === '.' || base === '..') {
    return 'archivo';
  }

  if (base.length > 160) {
    const ext = path.extname(base).slice(0, 24);
    const stem = base.slice(0, Math.max(1, 160 - ext.length));
    base = `${stem}${ext}`;
  }

  return base;
}

function detectMime(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function isImageAttachment(mime, fileName) {
  const cleanMime = String(mime || '').trim().toLowerCase();
  if (cleanMime.startsWith('image/')) return true;
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function buildMessagePreview(message) {
  if (!message) return '';
  const text = String(message.text || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text) {
    return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  }
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const active = attachments.filter((a) => !a.deleted);
  if (active.length === 1) {
    const label = active[0].isImage ? '[Imagen]' : '[Archivo]';
    return `${label} ${active[0].name}`;
  }
  if (active.length > 1) {
    return `[${active.length} adjuntos]`;
  }
  if (attachments.length > 0) {
    return '[Adjunto eliminado]';
  }
  return '';
}

function createDefaultData() {
  return {
    version: 1,
    chats: [],
    attachments: {}
  };
}

class ChatStore {
  constructor(customBaseDir) {
    this.baseDir = path.resolve(customBaseDir || defaultBaseDir());
    this.filePath = path.join(this.baseDir, 'chat-data.json');
    this.attachmentsDir = path.join(this.baseDir, 'chat-attachments');
    this.data = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          version: Number(parsed.version) || 1,
          chats: Array.isArray(parsed.chats) ? parsed.chats.map((c) => ({
            id: String(c.id || ''),
            title: String(c.title || 'Chat'),
            type: String(c.type || 'direct'),
            peerNode: String(c.peerNode || ''),
            peerUrl: String(c.peerUrl || ''),
            createdAt: c.createdAt || new Date().toISOString(),
            updatedAt: c.updatedAt || c.createdAt || new Date().toISOString(),
            unreadCount: Number(c.unreadCount) || 0,
            lastMessagePreview: String(c.lastMessagePreview || ''),
            messages: Array.isArray(c.messages) ? c.messages : []
          })) : [],
          attachments: parsed.attachments && typeof parsed.attachments === 'object' && !Array.isArray(parsed.attachments)
            ? parsed.attachments
            : {}
        };
      }
    } catch {
      // Fall back to fresh empty store if corrupted
    }
    const fresh = createDefaultData();
    this.data = fresh;
    this.save();
    return fresh;
  }

  save() {
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.mkdirSync(this.attachmentsDir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  _chatSummary(chat) {
    return {
      id: chat.id,
      title: chat.title,
      type: chat.type,
      peerNode: chat.peerNode,
      peerUrl: chat.peerUrl,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      unreadCount: Number(chat.unreadCount) || 0,
      messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
      lastMessagePreview: String(chat.lastMessagePreview || '')
    };
  }

  _cloneMessage(msg) {
    return {
      id: msg.id,
      chatId: msg.chatId,
      senderNode: msg.senderNode,
      text: msg.text,
      format: msg.format,
      attachments: Array.isArray(msg.attachments)
        ? msg.attachments.map((a) => ({
          id: a.id,
          name: a.name,
          mime: a.mime,
          size: a.size,
          isImage: Boolean(a.isImage),
          deleted: Boolean(a.deleted)
        }))
        : [],
      createdAt: msg.createdAt,
      incoming: Boolean(msg.incoming)
    };
  }

  _findChat(chatId) {
    const id = String(chatId || '').trim();
    const chat = this.data.chats.find((c) => c.id === id);
    if (!chat) {
      throw createHttpError(`Chat no encontrado: ${id}`, 404);
    }
    return chat;
  }

  _resolveAttachmentPath(storedFileName) {
    const root = path.resolve(this.attachmentsDir);
    const full = path.resolve(root, path.basename(String(storedFileName || '')));
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw createHttpError('Ruta de adjunto inválida.', 400);
    }
    return full;
  }

  _removeAttachmentFile(attachmentId) {
    const id = String(attachmentId || '').trim();
    if (!id) return false;
    let removed = false;

    const record = this.data.attachments[id];
    if (record && record.storedFileName) {
      try {
        const fp = this._resolveAttachmentPath(record.storedFileName);
        if (fs.existsSync(fp)) {
          fs.unlinkSync(fp);
          removed = true;
        }
      } catch {
        // Ignore cleanup errors for missing/inaccessible files
      }
    }

    // Fallback prefix match in chat-attachments/ in case index was missing storedFileName
    try {
      if (fs.existsSync(this.attachmentsDir)) {
        const prefix = `${id}__`;
        for (const entry of fs.readdirSync(this.attachmentsDir)) {
          if (entry.startsWith(prefix)) {
            const fp = this._resolveAttachmentPath(entry);
            try {
              fs.unlinkSync(fp);
              removed = true;
            } catch {
              // Ignore ENOENT
            }
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }

    return removed;
  }

  _refreshLastMessagePreview(chat) {
    const last = chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null;
    chat.lastMessagePreview = buildMessagePreview(last);
  }

  listChats() {
    return this.data.chats
      .slice()
      .sort((a, b) => {
        const ta = Date.parse(a.updatedAt) || 0;
        const tb = Date.parse(b.updatedAt) || 0;
        if (tb !== ta) return tb - ta;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      })
      .map((c) => this._chatSummary(c));
  }

  createChat({ id, title, type = 'direct', peerNode = '', peerUrl = '' } = {}) {
    const cleanId = id !== undefined && id !== null ? String(id).trim() : '';
    if (cleanId) {
      const existing = this.data.chats.find((c) => c.id === cleanId);
      if (existing) {
        return this._chatSummary(existing);
      }
    }

    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) {
      throw createHttpError('El título del chat no puede estar vacío.', 400);
    }

    const now = new Date().toISOString();
    const chat = {
      id: cleanId || `chat-${crypto.randomBytes(6).toString('hex')}`,
      title: cleanTitle,
      type: String(type || 'direct').trim() || 'direct',
      peerNode: String(peerNode || '').trim(),
      peerUrl: String(peerUrl || '').trim(),
      createdAt: now,
      updatedAt: now,
      unreadCount: 0,
      lastMessagePreview: '',
      messages: []
    };

    this.data.chats.push(chat);
    this.save();
    return this._chatSummary(chat);
  }

  deleteChat(chatId) {
    const chat = this._findChat(chatId);
    const attIds = new Set();

    for (const msg of chat.messages) {
      if (Array.isArray(msg.attachments)) {
        for (const att of msg.attachments) {
          if (att && att.id) attIds.add(att.id);
        }
      }
    }

    for (const attId of attIds) {
      this._removeAttachmentFile(attId);
      delete this.data.attachments[attId];
    }

    this.data.chats = this.data.chats.filter((c) => c.id !== chat.id);
    this.save();
    return { ok: true, id: chat.id, deletedAttachments: attIds.size };
  }

  getChat(chatId) {
    const chat = this._findChat(chatId);
    return {
      chat: this._chatSummary(chat),
      messages: chat.messages.map((m) => this._cloneMessage(m))
    };
  }

  addMessage({
    id,
    chatId,
    chatTitle,
    chatType = 'direct',
    peerNode = '',
    peerUrl = '',
    senderNode,
    text = '',
    format = 'markdown',
    attachments = [],
    createdAt,
    incoming = false
  } = {}) {
    const cleanChatId = String(chatId || '').trim();
    if (!cleanChatId) {
      throw createHttpError('chatId es obligatorio.', 400);
    }

    let chat = this.data.chats.find((c) => c.id === cleanChatId);
    if (!chat) {
      const cleanChatTitle = String(chatTitle || '').trim();
      if (!cleanChatTitle) {
        throw createHttpError(`Chat no encontrado: ${cleanChatId}`, 404);
      }
      this.createChat({
        id: cleanChatId,
        title: cleanChatTitle,
        type: chatType,
        peerNode: peerNode || (incoming ? String(senderNode || '').trim() : ''),
        peerUrl
      });
      chat = this.data.chats.find((c) => c.id === cleanChatId);
    }

    const cleanId = id !== undefined && id !== null ? String(id).trim() : '';
    if (cleanId) {
      const existing = chat.messages.find((m) => m.id === cleanId);
      if (existing) {
        return this._cloneMessage(existing);
      }
    }

    const msgId = cleanId || `msg-${crypto.randomBytes(6).toString('hex')}`;
    const msgCreatedAt = createdAt ? String(createdAt) : new Date().toISOString();
    const normalizedAttachments = Array.isArray(attachments)
      ? attachments.map((att) => {
        const attId = String(att && att.id ? att.id : '').trim();
        const stored = attId ? this.data.attachments[attId] : null;
        const name = String((att && att.name) || (stored && stored.name) || 'archivo');
        const mime = String((att && att.mime) || (stored && stored.mime) || detectMime(name));
        const size = att && att.size !== undefined
          ? Number(att.size) || 0
          : (stored ? Number(stored.size) || 0 : 0);
        const isImage = att && typeof att.isImage === 'boolean'
          ? att.isImage
          : (stored ? Boolean(stored.isImage) : isImageAttachment(mime, name));
        const deleted = att && typeof att.deleted === 'boolean'
          ? att.deleted
          : false;
        return {
          id: attId,
          name,
          mime,
          size,
          isImage,
          deleted
        };
      })
      : [];

    const message = {
      id: msgId,
      chatId: chat.id,
      senderNode: String(senderNode || '').trim(),
      text: String(text === undefined || text === null ? '' : text),
      format: String(format || 'markdown').trim() || 'markdown',
      attachments: normalizedAttachments,
      createdAt: msgCreatedAt,
      incoming: Boolean(incoming)
    };

    chat.messages.push(message);
    chat.updatedAt = msgCreatedAt;
    chat.lastMessagePreview = buildMessagePreview(message);
    if (incoming === true) {
      chat.unreadCount = (Number(chat.unreadCount) || 0) + 1;
    }

    this.save();
    return this._cloneMessage(message);
  }

  saveAttachment({ fileName, mime, buffer, id } = {}) {
    if (buffer === undefined || buffer === null) {
      throw createHttpError('buffer es obligatorio para guardar un adjunto.', 400);
    }
    const buf = Buffer.isBuffer(buffer)
      ? buffer
      : (buffer instanceof Uint8Array ? Buffer.from(buffer) : null);
    if (!buf) {
      throw createHttpError('buffer debe ser un Buffer o Uint8Array.', 400);
    }

    let attId;
    if (id !== undefined && id !== null && String(id).trim() !== '') {
      attId = String(id).trim();
      if (!/^[a-zA-Z0-9_-]{2,80}$/.test(attId)) {
        throw createHttpError('ID de adjunto inválido.', 400);
      }
    } else {
      attId = `att-${crypto.randomBytes(8).toString('hex')}`;
    }

    const cleanName = sanitizeFileName(fileName);
    const resolvedMime = (mime && String(mime).trim())
      ? String(mime).trim().toLowerCase()
      : detectMime(cleanName);
    const isImage = isImageAttachment(resolvedMime, cleanName);

    fs.mkdirSync(this.attachmentsDir, { recursive: true });
    const storedFileName = `${attId}__${cleanName}`;
    const filePath = this._resolveAttachmentPath(storedFileName);
    fs.writeFileSync(filePath, buf);

    const record = {
      id: attId,
      name: cleanName,
      mime: resolvedMime,
      size: buf.length,
      isImage,
      deleted: false,
      storedFileName,
      createdAt: new Date().toISOString()
    };

    this.data.attachments[attId] = record;
    this.save();

    return {
      id: record.id,
      name: record.name,
      mime: record.mime,
      size: record.size,
      isImage: record.isImage,
      deleted: false
    };
  }

  getAttachmentInfo(attachmentId) {
    const id = String(attachmentId || '').trim();
    if (!id) {
      throw createHttpError('Adjunto no encontrado.', 404);
    }

    const record = this.data.attachments[id];
    if (!record || record.deleted) {
      throw createHttpError(`Adjunto no encontrado o eliminado: ${id}`, 404);
    }

    const filePath = this._resolveAttachmentPath(record.storedFileName);
    if (!fs.existsSync(filePath)) {
      throw createHttpError(`Archivo de adjunto no encontrado en disco: ${id}`, 404);
    }

    return {
      meta: {
        id: record.id,
        name: record.name,
        mime: record.mime,
        size: record.size,
        isImage: Boolean(record.isImage),
        deleted: false
      },
      filePath
    };
  }

  deleteAttachment(chatId, messageId, attachmentId) {
    const chat = this._findChat(chatId);
    const msg = chat.messages.find((m) => m.id === String(messageId || '').trim());
    if (!msg) {
      throw createHttpError(`Mensaje no encontrado: ${messageId}`, 404);
    }

    const attId = String(attachmentId || '').trim();
    const att = Array.isArray(msg.attachments) ? msg.attachments.find((a) => a.id === attId) : null;
    if (!att) {
      throw createHttpError(`Adjunto no encontrado en el mensaje: ${attId}`, 404);
    }

    this._removeAttachmentFile(attId);
    att.deleted = true;
    att.size = 0;

    if (this.data.attachments[attId]) {
      this.data.attachments[attId].deleted = true;
      this.data.attachments[attId].size = 0;
    }

    this._refreshLastMessagePreview(chat);
    this.save();
    return this._cloneMessage(msg);
  }

  deleteMessage(chatId, messageId) {
    const chat = this._findChat(chatId);
    const msgId = String(messageId || '').trim();
    const idx = chat.messages.findIndex((m) => m.id === msgId);
    if (idx < 0) {
      throw createHttpError(`Mensaje no encontrado: ${msgId}`, 404);
    }

    const [removed] = chat.messages.splice(idx, 1);
    if (Array.isArray(removed.attachments)) {
      for (const att of removed.attachments) {
        if (att && att.id) {
          this._removeAttachmentFile(att.id);
          delete this.data.attachments[att.id];
        }
      }
    }

    this._refreshLastMessagePreview(chat);
    this.save();
    return { ok: true };
  }

  markRead(chatId) {
    const chat = this._findChat(chatId);
    chat.unreadCount = 0;
    this.save();
    return this._chatSummary(chat);
  }

  getTotalUnread() {
    return this.data.chats.reduce((sum, chat) => sum + (Number(chat.unreadCount) || 0), 0);
  }
}

module.exports = {
  ChatStore,
  defaultBaseDir,
  sanitizeFileName,
  detectMime,
  isImageAttachment
};
