import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Check,
  Code,
  Copy,
  Download,
  Eye,
  File,
  FileArchive,
  FileCode,
  FileText,
  FileX,
  Image,
  Italic,
  Link2,
  List,
  MessageSquare,
  Monitor,
  Paperclip,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  Search,
  Send,
  SquareCode,
  StickyNote,
  Trash2,
  Upload,
  X,
  ZoomIn
} from 'lucide-react';

const MAX_INLINE_DROP_BYTES = 45 * 1024 * 1024; // 45 MB safeguard for base64 fallback

function fmtSize(bytes) {
  if (bytes == null || Number.isNaN(Number(bytes))) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Number(bytes);
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function fmtMsgTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isSafeHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`No se pudo leer ${file?.name || 'el archivo'}`));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBase64(dataUrl) {
  const idx = String(dataUrl || '').indexOf(',');
  return idx >= 0 ? dataUrl.slice(idx + 1) : '';
}

function getFileIcon(mime = '', name = '') {
  const lowerMime = String(mime).toLowerCase();
  const lowerName = String(name).toLowerCase();
  if (lowerMime.startsWith('image/')) return <Image size={16} color="var(--accent)" />;
  if (/\.(zip|rar|7z|tar|gz)$/.test(lowerName) || lowerMime.includes('zip') || lowerMime.includes('compressed')) {
    return <FileArchive size={16} color="var(--warn)" />;
  }
  if (/\.(js|jsx|ts|tsx|py|json|cjs|mjs|html|css|sh|ps1|cmd|bat|sql|md)$/.test(lowerName)) {
    return <FileCode size={16} color="var(--cyan)" />;
  }
  if (/\.(pdf|txt|doc|docx|csv|xlsx|log)$/.test(lowerName) || lowerMime.startsWith('text/')) {
    return <FileText size={16} color="var(--accent)" />;
  }
  return <File size={16} color="var(--muted)" />;
}

/**
 * Pure React safe Markdown inline renderer (renders React elements directly).
 */
function renderInlineMarkdown(text, onOpenUrl, keyPrefix = 'in') {
  if (!text) return null;
  const nodes = [];
  // Matches: `code`, [label](url), **bold**, *italic*, ~~strike~~, bare https?://url
  const tokenRegex =
    /(`[^`\n]+`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*\n]+)\*\*)|(\*([^*\n]+)\*)|(~~([^~\n]+)~~)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

  let lastIndex = 0;
  let match;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const key = `${keyPrefix}-${idx++}`;
    if (match[1]) {
      const codeText = match[1].slice(1, -1);
      nodes.push(
        <code
          key={key}
          className="mono"
          style={{
            padding: '1.5px 5px',
            borderRadius: 5,
            background: 'rgba(8, 11, 17, 0.85)',
            border: '1px solid var(--border)',
            color: '#bae6fd',
            fontSize: '0.9em'
          }}
        >
          {codeText}
        </code>
      );
    } else if (match[2]) {
      const label = match[3];
      const href = match[4];
      if (isSafeHttpUrl(href)) {
        nodes.push(
          <a
            key={key}
            href={href}
            onClick={(e) => {
              e.preventDefault();
              onOpenUrl(href);
            }}
            style={{
              color: 'var(--accent)',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
              cursor: 'pointer',
              wordBreak: 'break-all'
            }}
          >
            {renderInlineMarkdown(label, onOpenUrl, `${key}-l`)}
          </a>
        );
      } else {
        nodes.push(match[2]);
      }
    } else if (match[5]) {
      nodes.push(
        <strong key={key} style={{ fontWeight: 700, color: '#f8fafc' }}>
          {renderInlineMarkdown(match[6], onOpenUrl, `${key}-b`)}
        </strong>
      );
    } else if (match[7]) {
      nodes.push(
        <em key={key} style={{ fontStyle: 'italic' }}>
          {renderInlineMarkdown(match[8], onOpenUrl, `${key}-i`)}
        </em>
      );
    } else if (match[9]) {
      nodes.push(
        <del key={key} style={{ opacity: 0.72 }}>
          {renderInlineMarkdown(match[10], onOpenUrl, `${key}-s`)}
        </del>
      );
    } else if (match[11]) {
      const href = match[11];
      if (isSafeHttpUrl(href)) {
        nodes.push(
          <a
            key={key}
            href={href}
            onClick={(e) => {
              e.preventDefault();
              onOpenUrl(href);
            }}
            style={{
              color: 'var(--accent)',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
              cursor: 'pointer',
              wordBreak: 'break-all'
            }}
          >
            {href}
          </a>
        );
      } else {
        nodes.push(href);
      }
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function CodeBlock({ lang, code, onCopy }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy?.(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      style={{
        margin: '6px 0',
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid var(--border-strong)',
        background: '#070a10'
      }}
    >
      <div
        className="between"
        style={{
          padding: '5px 10px',
          background: 'rgba(24, 33, 49, 0.75)',
          borderBottom: '1px solid var(--border)',
          fontSize: 11
        }}
      >
        <span className="mono muted">{lang || 'código'}</span>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            color: copied ? 'var(--ok)' : 'var(--muted)',
            cursor: 'pointer',
            fontSize: 11,
            padding: '1px 4px'
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre
        className="mono"
        style={{
          margin: 0,
          padding: '10px 12px',
          overflowX: 'auto',
          fontSize: 12.2,
          lineHeight: 1.5,
          color: '#e2e8f0',
          whiteSpace: 'pre'
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MarkdownContent({ text, onOpenUrl, onCopyCode }) {
  const blocks = useMemo(() => {
    const raw = String(text || '').replace(/\r\n/g, '\n');
    if (!raw.trim()) return [];

    const out = [];
    const lines = raw.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block
      const fenceMatch = line.match(/^```([\w+-]*)\s*$/);
      if (fenceMatch) {
        const lang = fenceMatch[1] || '';
        const codeLines = [];
        i += 1;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1; // skip closing fence
        out.push({ type: 'code', lang, content: codeLines.join('\n') });
        continue;
      }

      // Blank line
      if (!line.trim()) {
        i += 1;
        continue;
      }

      // Heading
      const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        out.push({ type: 'heading', level: headingMatch[1].length, content: headingMatch[2] });
        i += 1;
        continue;
      }

      // Blockquote
      if (/^>\s?/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''));
          i += 1;
        }
        out.push({ type: 'quote', lines: quoteLines });
        continue;
      }

      // Unordered list
      if (/^\s*[-*•]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*•]\s+/, ''));
          i += 1;
        }
        out.push({ type: 'ul', items });
        continue;
      }

      // Ordered list
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i += 1;
        }
        out.push({ type: 'ol', items });
        continue;
      }

      // Regular paragraph lines until blank or special block
      const paraLines = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^```/.test(lines[i]) &&
        !/^(#{1,3})\s+/.test(lines[i]) &&
        !/^>\s?/.test(lines[i]) &&
        !/^\s*[-*•]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i])
      ) {
        paraLines.push(lines[i]);
        i += 1;
      }
      if (paraLines.length) {
        out.push({ type: 'p', lines: paraLines });
      }
    }

    return out;
  }, [text]);

  if (!blocks.length) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, lineHeight: 1.52, wordBreak: 'break-word' }}>
      {blocks.map((block, bIdx) => {
        if (block.type === 'code') {
          return <CodeBlock key={bIdx} lang={block.lang} code={block.content} onCopy={onCopyCode} />;
        }
        if (block.type === 'heading') {
          const sizes = { 1: 17, 2: 15.5, 3: 14.5 };
          return (
            <div key={bIdx} style={{ fontSize: sizes[block.level] || 14.5, fontWeight: 700, marginTop: 2 }}>
              {renderInlineMarkdown(block.content, onOpenUrl, `h-${bIdx}`)}
            </div>
          );
        }
        if (block.type === 'quote') {
          return (
            <blockquote
              key={bIdx}
              style={{
                margin: '2px 0',
                padding: '6px 11px',
                borderLeft: '3px solid var(--accent)',
                background: 'rgba(56, 189, 248, 0.06)',
                borderRadius: '0 8px 8px 0',
                color: '#cbd5e1'
              }}
            >
              {block.lines.map((ql, qi) => (
                <div key={qi}>{renderInlineMarkdown(ql, onOpenUrl, `q-${bIdx}-${qi}`)}</div>
              ))}
            </blockquote>
          );
        }
        if (block.type === 'ul') {
          return (
            <ul key={bIdx} style={{ margin: '2px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {block.items.map((item, ii) => (
                <li key={ii}>{renderInlineMarkdown(item, onOpenUrl, `ul-${bIdx}-${ii}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ol') {
          return (
            <ol key={bIdx} style={{ margin: '2px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {block.items.map((item, ii) => (
                <li key={ii}>{renderInlineMarkdown(item, onOpenUrl, `ol-${bIdx}-${ii}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={bIdx} style={{ margin: 0 }}>
            {block.lines.map((pl, pi) => (
              <React.Fragment key={pi}>
                {pi > 0 && <br />}
                {renderInlineMarkdown(pl, onOpenUrl, `p-${bIdx}-${pi}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function ImageAttachmentCard({ attachment, cachedDataUrl, onLoadDataUrl, onPreview, onDownload, onDelete }) {
  const attId = attachment.id || attachment.attachmentId;
  const attName = attachment.name || attachment.fileName || 'imagen';
  const [loadingImg, setLoadingImg] = useState(false);
  const [failed, setFailed] = useState(false);

  const src = attachment.previewDataUrl || attachment.dataUrl || cachedDataUrl || '';

  useEffect(() => {
    let active = true;
    if (src || !attId || failed) return;
    setLoadingImg(true);
    onLoadDataUrl(attId)
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoadingImg(false);
      });
    return () => {
      active = false;
    };
  }, [attId, src, failed, onLoadDataUrl]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 7,
        borderRadius: 11,
        background: 'rgba(8, 11, 17, 0.72)',
        border: '1px solid var(--border)',
        maxWidth: 280
      }}
    >
      {src ? (
        <button
          type="button"
          onClick={() => onPreview({ src, name: attName, size: attachment.size, attachment })}
          title="Ampliar imagen"
          style={{
            position: 'relative',
            padding: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'zoom-in',
            borderRadius: 8,
            overflow: 'hidden',
            display: 'block'
          }}
        >
          <img
            src={src}
            alt={attName}
            style={{
              display: 'block',
              width: '100%',
              maxWidth: 264,
              maxHeight: 200,
              objectFit: 'cover',
              borderRadius: 8
            }}
          />
          <span
            style={{
              position: 'absolute',
              right: 6,
              bottom: 6,
              background: 'rgba(8, 11, 17, 0.78)',
              border: '1px solid var(--border-strong)',
              borderRadius: 7,
              padding: '3px 6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: '#f8fafc'
            }}
          >
            <ZoomIn size={12} /> Ver
          </span>
        </button>
      ) : (
        <div
          style={{
            width: 220,
            height: 110,
            borderRadius: 8,
            background: 'var(--panel-2)',
            border: '1px dashed var(--border-strong)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--muted)',
            fontSize: 12
          }}
        >
          {loadingImg ? 'Cargando vista previa...' : failed ? 'Vista previa no disponible' : 'Imagen adjunta'}
        </div>
      )}

      <div className="between" style={{ gap: 6 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
            title={attName}
          >
            {attName}
          </div>
          {attachment.size != null && (
            <div className="muted" style={{ fontSize: 11 }}>
              {fmtSize(attachment.size)}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button
            type="button"
            className="btn btn-sm"
            title="Descargar imagen"
            onClick={onDownload}
            style={{ padding: '4px 7px' }}
          >
            <Download size={12} />
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            title="Eliminar archivo"
            onClick={onDelete}
            style={{ padding: '4px 7px' }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatView({ api, state, flash, onUnreadChange }) {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState('');
  const [messages, setMessages] = useState([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);

  // Sidebar search & new chat panel
  const [chatSearch, setChatSearch] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatTitle, setNewChatTitle] = useState('');
  const [newChatTarget, setNewChatTarget] = useState('local');
  const [customPeerNode, setCustomPeerNode] = useState('');
  const [customPeerUrl, setCustomPeerUrl] = useState('');
  const [creatingChat, setCreatingChat] = useState(false);
  const [confirmDeleteChatId, setConfirmDeleteChatId] = useState('');

  // Composer state
  const [draft, setDraft] = useState('');
  const [composerTab, setComposerTab] = useState('write'); // 'write' | 'preview'
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [draggingFiles, setDraggingFiles] = useState(false);

  // Inline image cache & Lightbox modal
  const [imageCache, setImageCache] = useState({});
  const imageCacheRef = useRef({});
  const imageRequestsRef = useRef(new Map());
  const [lightbox, setLightbox] = useState(null);

  const activeChatIdRef = useRef('');
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const mountedRef = useRef(true);

  const localNodeName = state?.config?.nodeName || '';
  const defaultPort = state?.config?.port || 4789;

  // Build deduplicated list of available Tailscale / saved peers
  const peerOptions = useMemo(() => {
    const map = new Map();
    const localIp = state?.env?.tailscale?.ip || '';

    const tsPeers = state?.env?.tailscale?.peers || [];
    for (const p of tsPeers) {
      const name = String(p.hostName || p.dnsName || '').replace(/\.$/, '');
      if (!name) continue;
      if (localNodeName && name.toLowerCase() === localNodeName.toLowerCase() && (!p.ip || p.ip === localIp)) {
        continue;
      }
      const key = name.toLowerCase();
      map.set(key, {
        key,
        nodeName: name,
        ip: p.ip || '',
        url: p.ip ? `http://${p.ip}:${defaultPort}` : '',
        online: Boolean(p.online),
        source: 'Tailscale'
      });
    }

    const savedPeers = state?.config?.savedPeers || [];
    for (const sp of savedPeers) {
      const name = sp.nodeName || sp.label || '';
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = map.get(key);
      const ip = sp.tailscaleIp || sp.lanIp || existing?.ip || '';
      const url = sp.baseUrl || (ip ? `http://${ip}:${sp.port || defaultPort}` : existing?.url || '');
      map.set(key, {
        key,
        nodeName: name,
        ip,
        url,
        online: existing ? existing.online : false,
        source: existing ? 'Tailscale · Guardado' : 'Guardado'
      });
    }

    const sessions = state?.activeClientSessions || [];
    for (const sess of sessions) {
      const name = sess.nodeName || '';
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = map.get(key);
      map.set(key, {
        key,
        nodeName: name,
        ip: existing?.ip || '',
        url: sess.baseUrl || existing?.url || '',
        online: true,
        source: 'Sesión activa'
      });
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.nodeName.localeCompare(b.nodeName);
    });
  }, [state, localNodeName, defaultPort]);

  const activeChat = useMemo(
    () => chats.find((c) => (c.id || c.chatId) === activeChatId) || null,
    [chats, activeChatId]
  );

  const activePeerOnline = useMemo(() => {
    if (!activeChat?.peerNode) return null;
    const match = peerOptions.find((p) => p.nodeName.toLowerCase() === String(activeChat.peerNode).toLowerCase());
    return match ? match.online : null;
  }, [activeChat, peerOptions]);

  const filteredChats = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => {
      const title = String(c.title || '').toLowerCase();
      const peer = String(c.peerNode || '').toLowerCase();
      const preview = String(c.lastMessagePreview || c.lastMessage?.text || '').toLowerCase();
      return title.includes(q) || peer.includes(q) || preview.includes(q);
    });
  }, [chats, chatSearch]);

  const totalUnread = useMemo(
    () => chats.reduce((sum, c) => sum + Number(c.unreadCount ?? c.unread ?? 0), 0),
    [chats]
  );

  const reportUnread = useCallback(
    (count) => {
      if (typeof count === 'number' && onUnreadChange) {
        onUnreadChange(count);
      }
    },
    [onUnreadChange]
  );

  const loadMessages = useCallback(
    async (chatId, { silent = false } = {}) => {
      if (!api?.chatGetMessages || !chatId) {
        setMessages([]);
        return;
      }
      if (!silent) setLoadingMsgs(true);
      try {
        const res = await api.chatGetMessages(chatId);
        if (!mountedRef.current) return;
        if (activeChatIdRef.current !== chatId) return;
        setMessages(Array.isArray(res?.messages) ? res.messages : []);
        if (res?.chat) {
          setChats((prev) =>
            prev.map((c) => ((c.id || c.chatId) === chatId ? { ...c, ...res.chat, unreadCount: 0, unread: 0 } : c))
          );
        }
        if (typeof res?.totalUnread === 'number') {
          reportUnread(res.totalUnread);
        }
      } catch (err) {
        if (!silent) flash?.('error', err?.message || 'No se pudieron cargar los mensajes.');
      } finally {
        if (mountedRef.current && !silent) setLoadingMsgs(false);
      }
    },
    [api, flash, reportUnread]
  );

  const loadChats = useCallback(
    async ({ selectFirstIfEmpty = false, silent = false } = {}) => {
      if (!api?.chatList) {
        setLoadingChats(false);
        return;
      }
      if (!silent) setLoadingChats(true);
      try {
        const res = await api.chatList();
        if (!mountedRef.current) return;
        const list = Array.isArray(res?.chats) ? res.chats : [];
        setChats(list);
        if (typeof res?.totalUnread === 'number') {
          reportUnread(res.totalUnread);
        }

        const currentId = activeChatIdRef.current;
        const stillExists = list.some((c) => (c.id || c.chatId) === currentId);
        if (currentId && stillExists) {
          // keep current selection
        } else if (selectFirstIfEmpty && list.length > 0) {
          const firstId = list[0].id || list[0].chatId;
          activeChatIdRef.current = firstId;
          setActiveChatId(firstId);
          loadMessages(firstId, { silent: false });
        } else if (!stillExists) {
          activeChatIdRef.current = '';
          setActiveChatId('');
          setMessages([]);
        }
      } catch (err) {
        if (!silent) flash?.('error', err?.message || 'No se pudo cargar la lista de chats.');
      } finally {
        if (mountedRef.current) setLoadingChats(false);
      }
    },
    [api, flash, loadMessages, reportUnread]
  );

  useEffect(() => {
    mountedRef.current = true;
    loadChats({ selectFirstIfEmpty: true, silent: false });

    const unsub = api?.onChatEvent
      ? api.onChatEvent((evt) => {
          if (!mountedRef.current) return;
          loadChats({ selectFirstIfEmpty: false, silent: true });
          const currentId = activeChatIdRef.current;
          if (currentId && (!evt?.chatId || evt.chatId === currentId)) {
            loadMessages(currentId, { silent: true });
          }
        })
      : null;

    return () => {
      mountedRef.current = false;
      if (typeof unsub === 'function') unsub();
    };
  }, [api, loadChats, loadMessages]);

  // Auto-scroll to bottom when messages list grows or active chat changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, activeChatId]);

  // Close Lightbox on Escape
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const handleSelectChat = (chatId) => {
    setConfirmDeleteChatId('');
    activeChatIdRef.current = chatId;
    setActiveChatId(chatId);
    loadMessages(chatId, { silent: false });
  };

  const handleCreateChat = async (e) => {
    e.preventDefault();
    if (!api?.chatCreate) return;

    let type = 'local';
    let peerNode = '';
    let peerUrl = '';
    let fallbackTitle = 'Notas locales';

    if (newChatTarget === 'custom') {
      type = 'peer';
      peerNode = customPeerNode.trim();
      peerUrl = customPeerUrl.trim();
      if (!peerNode && !peerUrl) {
        flash?.('error', 'Indica el nombre o la URL del equipo remoto.');
        return;
      }
      fallbackTitle = peerNode || 'Equipo remoto';
    } else if (newChatTarget !== 'local') {
      const selected = peerOptions.find((p) => p.key === newChatTarget);
      if (selected) {
        type = 'peer';
        peerNode = selected.nodeName;
        peerUrl = selected.url;
        fallbackTitle = selected.nodeName;
      }
    }

    const title = newChatTitle.trim() || fallbackTitle;
    setCreatingChat(true);
    try {
      const res = await api.chatCreate({ title, type, peerNode, peerUrl });
      if (!mountedRef.current) return;
      if (Array.isArray(res?.chats)) setChats(res.chats);
      if (typeof res?.totalUnread === 'number') reportUnread(res.totalUnread);
      const createdId = res?.chat?.id || res?.chat?.chatId;
      if (createdId) {
        activeChatIdRef.current = createdId;
        setActiveChatId(createdId);
        loadMessages(createdId, { silent: false });
      }
      setShowNewChat(false);
      setNewChatTitle('');
      setNewChatTarget('local');
      setCustomPeerNode('');
      setCustomPeerUrl('');
      flash?.('ok', `Chat "${title}" creado.`);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo crear el chat.');
    } finally {
      if (mountedRef.current) setCreatingChat(false);
    }
  };

  const handleDeleteChat = async (chatId) => {
    if (!api?.chatDelete) return;
    try {
      const res = await api.chatDelete(chatId);
      if (!mountedRef.current) return;
      const nextChats = Array.isArray(res?.chats) ? res.chats : chats.filter((c) => (c.id || c.chatId) !== chatId);
      setChats(nextChats);
      if (typeof res?.totalUnread === 'number') reportUnread(res.totalUnread);
      setConfirmDeleteChatId('');
      if (activeChatIdRef.current === chatId) {
        const nextId = nextChats[0]?.id || nextChats[0]?.chatId || '';
        activeChatIdRef.current = nextId;
        setActiveChatId(nextId);
        if (nextId) {
          loadMessages(nextId, { silent: false });
        } else {
          setMessages([]);
        }
      }
      flash?.('ok', 'Chat eliminado.');
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo eliminar el chat.');
    }
  };

  const handleOpenExternal = useCallback(
    (url) => {
      if (!isSafeHttpUrl(url)) return;
      if (api?.openExternal) {
        api.openExternal(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
    [api]
  );

  const handleCopyText = useCallback(
    (text) => {
      if (api?.copyText) {
        api.copyText(text);
      } else if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      flash?.('ok', 'Código copiado al portapapeles.');
    },
    [api, flash]
  );

  const loadAttachmentDataUrl = useCallback(
    async (attachmentId) => {
      if (!attachmentId) return '';
      if (imageCacheRef.current[attachmentId]) return imageCacheRef.current[attachmentId];
      if (!api?.chatGetAttachmentDataUrl) return '';

      if (imageRequestsRef.current.has(attachmentId)) {
        return imageRequestsRef.current.get(attachmentId);
      }

      const promise = api
        .chatGetAttachmentDataUrl(attachmentId)
        .then((res) => {
          const url = res?.dataUrl || '';
          if (url) {
            imageCacheRef.current = { ...imageCacheRef.current, [attachmentId]: url };
            if (mountedRef.current) {
              setImageCache((prev) => ({ ...prev, [attachmentId]: url }));
            }
          }
          return url;
        })
        .finally(() => {
          imageRequestsRef.current.delete(attachmentId);
        });

      imageRequestsRef.current.set(attachmentId, promise);
      return promise;
    },
    [api]
  );

  const handlePickAttachments = async () => {
    if (!api?.chatPickAttachments) return;
    try {
      const picked = await api.chatPickAttachments();
      if (!Array.isArray(picked) || picked.length === 0) return;
      const normalized = picked.map((f, idx) => ({
        tempId: `pick-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        filePath: f.filePath,
        name: f.name || 'archivo',
        size: f.size,
        mime: f.mime || 'application/octet-stream',
        isImage: Boolean(f.isImage ?? String(f.mime || '').startsWith('image/')),
        previewDataUrl: f.previewDataUrl || ''
      }));
      setPendingAttachments((prev) => [...prev, ...normalized]);
    } catch (err) {
      flash?.('error', err?.message || 'No se pudieron adjuntar los archivos.');
    }
  };

  const ingestBrowserFiles = useCallback(
    async (fileList, { fromPaste = false } = {}) => {
      const files = Array.from(fileList || []);
      if (!files.length) return;

      const added = [];
      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        const mime = file.type || 'application/octet-stream';
        const isImage = mime.startsWith('image/');
        const ext = isImage ? (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') : '';
        const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
        const name = file.name || (fromPaste ? `imagen-pegada-${stamp}.${ext || 'png'}` : `archivo-${stamp}`);
        const hasNativePath = Boolean(file.path);

        if (!hasNativePath && file.size > MAX_INLINE_DROP_BYTES) {
          flash?.('error', `"${name}" supera ${fmtSize(MAX_INLINE_DROP_BYTES)}. Usa "Adjuntar imagen / archivo" para archivos grandes.`);
          continue;
        }

        let previewDataUrl = '';
        let base64;

        try {
          if (!hasNativePath || fromPaste || (isImage && file.size <= 15 * 1024 * 1024)) {
            const dataUrl = await readFileAsDataUrl(file);
            if (isImage) previewDataUrl = dataUrl;
            if (!hasNativePath || fromPaste) {
              base64 = dataUrlToBase64(dataUrl);
            }
          }
        } catch (err) {
          flash?.('error', err?.message || `Error al leer ${name}`);
          continue;
        }

        added.push({
          tempId: `file-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
          filePath: hasNativePath && !fromPaste ? file.path : undefined,
          name,
          size: file.size,
          mime,
          isImage,
          previewDataUrl,
          base64
        });
      }

      if (added.length > 0) {
        setPendingAttachments((prev) => [...prev, ...added]);
        if (fromPaste) {
          flash?.('ok', added.length === 1 ? 'Imagen pegada lista para enviar.' : `${added.length} imágenes pegadas.`);
        }
      }
    },
    [flash]
  );

  const handlePaste = async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles = items
      .filter((it) => it.kind === 'file' && String(it.type || '').startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter(Boolean);

    if (imageFiles.length > 0) {
      e.preventDefault();
      await ingestBrowserFiles(imageFiles, { fromPaste: true });
    }
  };

  const handleDropFiles = async (e) => {
    e.preventDefault();
    setDraggingFiles(false);
    if (!activeChat) return;
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      await ingestBrowserFiles(files, { fromPaste: false });
    }
  };

  const removePendingAttachment = (tempId) => {
    setPendingAttachments((prev) => prev.filter((a) => a.tempId !== tempId));
  };

  const applyFormat = (kind) => {
    if (composerTab !== 'write') {
      setComposerTab('write');
    }
    const el = textareaRef.current;
    const start = el ? el.selectionStart : draft.length;
    const end = el ? el.selectionEnd : draft.length;
    const selected = draft.slice(start, end);
    const before = draft.slice(0, start);
    const after = draft.slice(end);

    let inserted = '';
    let selStart = start;
    let selEnd = start;

    if (kind === 'bold') {
      const inner = selected || 'negrita';
      inserted = `**${inner}**`;
      selStart = start + 2;
      selEnd = selStart + inner.length;
    } else if (kind === 'italic') {
      const inner = selected || 'cursiva';
      inserted = `*${inner}*`;
      selStart = start + 1;
      selEnd = selStart + inner.length;
    } else if (kind === 'code') {
      const inner = selected || 'código';
      inserted = `\`${inner}\``;
      selStart = start + 1;
      selEnd = selStart + inner.length;
    } else if (kind === 'codeBlock') {
      const inner = selected || 'código aquí';
      const prefix = before && !before.endsWith('\n') ? '\n' : '';
      inserted = `${prefix}\`\`\`\n${inner}\n\`\`\`\n`;
      selStart = start + prefix.length + 4;
      selEnd = selStart + inner.length;
    } else if (kind === 'list') {
      const inner = selected || 'Elemento de lista';
      const lines = inner.split('\n').map((l) => (l.startsWith('- ') ? l : `- ${l}`)).join('\n');
      const prefix = before && !before.endsWith('\n') ? '\n' : '';
      inserted = `${prefix}${lines}`;
      selStart = start + prefix.length;
      selEnd = selStart + lines.length;
    } else if (kind === 'quote') {
      const inner = selected || 'Cita o nota importante';
      const lines = inner.split('\n').map((l) => (l.startsWith('> ') ? l : `> ${l}`)).join('\n');
      const prefix = before && !before.endsWith('\n') ? '\n' : '';
      inserted = `${prefix}${lines}`;
      selStart = start + prefix.length;
      selEnd = selStart + lines.length;
    } else if (kind === 'link') {
      if (selected && /^https?:\/\//i.test(selected.trim())) {
        inserted = `[enlace](${selected.trim()})`;
        selStart = start + 1;
        selEnd = start + 7;
      } else {
        const label = selected || 'texto del enlace';
        inserted = `[${label}](https://)`;
        selStart = start + label.length + 3;
        selEnd = selStart + 8;
      }
    }

    const next = `${before}${inserted}${after}`;
    setDraft(next);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
    });
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if (!api?.chatSendMessage || !activeChatId || sending) return;
    const trimmed = draft.trim();
    if (!trimmed && pendingAttachments.length === 0) return;

    setSending(true);
    try {
      const attachmentFiles = pendingAttachments.map((a) => ({
        filePath: a.filePath,
        name: a.name,
        mime: a.mime,
        base64: a.base64
      }));

      const res = await api.chatSendMessage({
        chatId: activeChatId,
        text: trimmed,
        format: 'markdown',
        attachmentFiles
      });
      if (!mountedRef.current) return;

      if (Array.isArray(res?.messages)) {
        setMessages(res.messages);
      } else if (res?.message) {
        setMessages((prev) => [...prev, res.message]);
      }

      setDraft('');
      setPendingAttachments([]);
      setComposerTab('write');
      loadChats({ selectFirstIfEmpty: false, silent: true });

      if (res?.deliveryStatus === 'failed' || res?.deliveryStatus === 'error') {
        flash?.('error', 'Guardado localmente, pero el equipo remoto no respondió todavía.');
      }
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo enviar el mensaje.');
    } finally {
      if (mountedRef.current) setSending(false);
    }
  };

  const handleComposerKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDownloadAttachment = async (messageId, att) => {
    if (!api?.chatDownloadAttachment || !activeChatId) return;
    const attachmentId = att.id || att.attachmentId;
    const fileName = att.name || att.fileName || 'archivo';
    try {
      const res = await api.chatDownloadAttachment({
        chatId: activeChatId,
        messageId,
        attachmentId,
        fileName
      });
      if (!res?.canceled) {
        flash?.('ok', `Archivo guardado: ${res?.savedPath || fileName}`);
      }
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo descargar el archivo.');
    }
  };

  const handleDeleteAttachment = async (messageId, att) => {
    if (!api?.chatDeleteAttachment || !activeChatId) return;
    const attachmentId = att.id || att.attachmentId;
    try {
      const res = await api.chatDeleteAttachment({
        chatId: activeChatId,
        messageId,
        attachmentId
      });
      if (!mountedRef.current) return;
      if (Array.isArray(res?.messages)) {
        setMessages(res.messages);
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            (m.id || m.messageId) === messageId
              ? {
                  ...m,
                  attachments: (m.attachments || []).map((a) =>
                    (a.id || a.attachmentId) === attachmentId ? { ...a, deleted: true } : a
                  )
                }
              : m
          )
        );
      }
      if (lightbox && (lightbox.attachment?.id || lightbox.attachment?.attachmentId) === attachmentId) {
        setLightbox(null);
      }
      flash?.('ok', 'Archivo adjunto eliminado.');
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo eliminar el archivo.');
    }
  };

  const handleDeleteMessage = async (messageId) => {
    if (!api?.chatDeleteMessage || !activeChatId) return;
    try {
      const res = await api.chatDeleteMessage({ chatId: activeChatId, messageId });
      if (!mountedRef.current) return;
      if (Array.isArray(res?.messages)) {
        setMessages(res.messages);
      } else {
        setMessages((prev) => prev.filter((m) => (m.id || m.messageId) !== messageId));
      }
      loadChats({ selectFirstIfEmpty: false, silent: true });
      flash?.('ok', 'Mensaje eliminado.');
    } catch (err) {
      flash?.('error', err?.message || 'No se pudo eliminar el mensaje.');
    }
  };

  const renderDeliveryBadge = (status) => {
    const s = String(status || '').toLowerCase();
    if (!s || s === 'local') return null;
    if (s === 'delivered' || s === 'entregado') {
      return <span className="badge ok" style={{ padding: '1px 6px', fontSize: 10 }}>Entregado</span>;
    }
    if (s === 'sent' || s === 'enviado') {
      return <span className="badge accent" style={{ padding: '1px 6px', fontSize: 10 }}>Enviado</span>;
    }
    if (s === 'pending' || s === 'queued') {
      return <span className="badge warn" style={{ padding: '1px 6px', fontSize: 10 }}>En cola</span>;
    }
    if (s === 'failed' || s === 'error') {
      return <span className="badge danger" style={{ padding: '1px 6px', fontSize: 10 }}>Sin entrega</span>;
    }
    return <span className="badge" style={{ padding: '1px 6px', fontSize: 10 }}>{status}</span>;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Chat y notas entre equipos</h1>
          <p>
            Envía mensajes con formato Markdown, capturas de pantalla y archivos directo entre tus PCs de Tailscale o guarda notas locales.
          </p>
        </div>
        <div className="row">
          {totalUnread > 0 && (
            <span className="badge accent">{totalUnread} sin leer</span>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              loadChats({ selectFirstIfEmpty: false, silent: false });
              if (activeChatId) loadMessages(activeChatId, { silent: false });
            }}
          >
            <RefreshCw size={14} /> Actualizar
          </button>
        </div>
      </div>

      {/* 2-Column Messenger Workspace */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '270px minmax(0, 1fr)',
          gap: 14,
          height: 'calc(100vh - 165px)',
          minHeight: 520
        }}
      >
        {/* LEFT COLUMN: Multi-chat Sidebar */}
        <aside
          className="card"
          style={{
            padding: 14,
            gap: 10,
            height: '100%',
            minHeight: 0,
            overflow: 'hidden'
          }}
        >
          <div className="between" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 6 }}>
              <MessageSquare size={16} color="var(--accent)" />
              <strong style={{ fontSize: 14.5 }}>Conversaciones</strong>
              <span className="badge" style={{ padding: '1px 6px', fontSize: 10.5 }}>{chats.length}</span>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setShowNewChat((v) => !v)}
            >
              {showNewChat ? <X size={13} /> : <Plus size={13} />}
              {showNewChat ? 'Cerrar' : 'Nuevo chat'}
            </button>
          </div>

          {/* Inline "+ Nuevo chat" Panel */}
          {showNewChat && (
            <form
              onSubmit={handleCreateChat}
              style={{
                padding: 11,
                borderRadius: 12,
                background: 'rgba(10, 15, 24, 0.85)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              <div className="field" style={{ gap: 4 }}>
                <label htmlFor="ec-new-chat-target">Destino</label>
                <select
                  id="ec-new-chat-target"
                  value={newChatTarget}
                  onChange={(e) => setNewChatTarget(e.target.value)}
                  style={{ padding: '7px 9px', fontSize: 12.5 }}
                >
                  <option value="local">Solo local / Notas</option>
                  {peerOptions.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.nodeName} ({p.online ? 'En línea' : p.source}{p.ip ? ` · ${p.ip}` : ''})
                    </option>
                  ))}
                  <option value="custom">Otro equipo (URL manual)...</option>
                </select>
              </div>

              {newChatTarget === 'custom' && (
                <>
                  <div className="field" style={{ gap: 4 }}>
                    <label htmlFor="ec-custom-node">Nombre del equipo</label>
                    <input
                      id="ec-custom-node"
                      type="text"
                      value={customPeerNode}
                      onChange={(e) => setCustomPeerNode(e.target.value)}
                      placeholder="Ej. PRO-NICOLA"
                      style={{ padding: '7px 9px', fontSize: 12.5 }}
                    />
                  </div>
                  <div className="field" style={{ gap: 4 }}>
                    <label htmlFor="ec-custom-url">URL Tailscale o LAN</label>
                    <input
                      id="ec-custom-url"
                      type="text"
                      value={customPeerUrl}
                      onChange={(e) => setCustomPeerUrl(e.target.value)}
                      placeholder={`http://100.x.x.x:${defaultPort}`}
                      style={{ padding: '7px 9px', fontSize: 12.5 }}
                    />
                  </div>
                </>
              )}

              <div className="field" style={{ gap: 4 }}>
                <label htmlFor="ec-new-chat-title">Título del chat (opcional)</label>
                <input
                  id="ec-new-chat-title"
                  type="text"
                  value={newChatTitle}
                  onChange={(e) => setNewChatTitle(e.target.value)}
                  placeholder={
                    newChatTarget === 'local'
                      ? 'Ej. Notas rápidas'
                      : `Ej. ${peerOptions.find((p) => p.key === newChatTarget)?.nodeName || 'Proyecto'}`
                  }
                  style={{ padding: '7px 9px', fontSize: 12.5 }}
                />
              </div>

              <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setShowNewChat(false)}
                  disabled={creatingChat}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-sm btn-primary" disabled={creatingChat}>
                  {creatingChat ? 'Creando...' : 'Crear chat'}
                </button>
              </div>
            </form>
          )}

          {/* Search Filter */}
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--muted)',
                pointerEvents: 'none'
              }}
            />
            <input
              type="text"
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
              placeholder="Buscar chats..."
              style={{
                padding: '7.5px 28px 7.5px 30px',
                fontSize: 12.5
              }}
            />
            {chatSearch && (
              <button
                type="button"
                onClick={() => setChatSearch('')}
                aria-label="Limpiar búsqueda"
                style={{
                  position: 'absolute',
                  right: 6,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  padding: 3,
                  display: 'grid',
                  placeItems: 'center'
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Chat List */}
          <div
            className="list"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              paddingRight: 2,
              gap: 6
            }}
          >
            {loadingChats ? (
              <p className="muted" style={{ fontSize: 12.5, padding: '8px 4px', margin: 0 }}>
                Cargando chats...
              </p>
            ) : filteredChats.length === 0 ? (
              <div
                style={{
                  padding: '16px 10px',
                  textAlign: 'center',
                  color: 'var(--muted)',
                  fontSize: 12.5,
                  borderRadius: 11,
                  border: '1px dashed var(--border)'
                }}
              >
                {chats.length === 0
                  ? 'Aún no tienes chats. Pulsa "+ Nuevo chat" para empezar.'
                  : 'Sin resultados para tu búsqueda.'}
              </div>
            ) : (
              filteredChats.map((chat) => {
                const cid = chat.id || chat.chatId;
                const isActive = cid === activeChatId;
                const unread = Number(chat.unreadCount ?? chat.unread ?? 0);
                const isLocal = chat.type === 'local' || chat.type === 'notes' || !chat.peerNode;
                const preview = chat.lastMessagePreview || chat.lastMessage?.text || (isLocal ? 'Notas locales' : `Nodo: ${chat.peerNode}`);
                const confirming = confirmDeleteChatId === cid;

                return (
                  <div
                    key={cid}
                    onClick={() => {
                      if (!confirming) handleSelectChat(cid);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && !confirming) {
                        e.preventDefault();
                        handleSelectChat(cid);
                      }
                    }}
                    style={{
                      padding: '10px 11px',
                      borderRadius: 11,
                      cursor: 'pointer',
                      border: `1px solid ${isActive ? 'rgba(56, 189, 248, 0.42)' : 'var(--border)'}`,
                      background: isActive
                        ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.14), rgba(37, 99, 235, 0.1))'
                        : 'var(--panel-2)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      transition: 'border-color 0.14s ease, background 0.14s ease'
                    }}
                  >
                    <div className="between" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          minWidth: 0,
                          flex: 1
                        }}
                      >
                        {isLocal ? (
                          <StickyNote size={14} color="var(--warn)" style={{ flexShrink: 0 }} />
                        ) : (
                          <Monitor size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                        )}
                        <span
                          style={{
                            fontWeight: 650,
                            fontSize: 13,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                          title={chat.title}
                        >
                          {chat.title || 'Sin título'}
                        </span>
                      </div>

                      <div className="row" style={{ gap: 4, flexWrap: 'nowrap', flexShrink: 0 }}>
                        {unread > 0 && (
                          <span
                            className="badge accent"
                            style={{ padding: '1px 6px', fontSize: 10.5, fontWeight: 700 }}
                          >
                            {unread}
                          </span>
                        )}
                        {!confirming && (
                          <button
                            type="button"
                            title="Eliminar chat"
                            aria-label={`Eliminar chat ${chat.title || ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteChatId(cid);
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--muted)',
                              cursor: 'pointer',
                              padding: 3,
                              borderRadius: 6,
                              display: 'grid',
                              placeItems: 'center'
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {confirming ? (
                      <div
                        className="between"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          marginTop: 4,
                          paddingTop: 6,
                          borderTop: '1px solid var(--border)',
                          gap: 6
                        }}
                      >
                        <span style={{ fontSize: 11.5, color: 'var(--danger)', fontWeight: 600 }}>
                          ¿Eliminar chat?
                        </span>
                        <div className="row" style={{ gap: 4 }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ padding: '3px 7px', fontSize: 11 }}
                            onClick={() => setConfirmDeleteChatId('')}
                          >
                            No
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            style={{ padding: '3px 8px', fontSize: 11 }}
                            onClick={() => handleDeleteChat(cid)}
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="between" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <span
                          className="muted"
                          style={{
                            fontSize: 11.5,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            flex: 1
                          }}
                        >
                          {preview}
                        </span>
                        {(chat.updatedAt || chat.lastMessageAt) && (
                          <span className="muted" style={{ fontSize: 10.5, flexShrink: 0 }}>
                            {fmtMsgTime(chat.updatedAt || chat.lastMessageAt)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* RIGHT COLUMN: Conversation Feed & Rich Composer */}
        <section
          className="card"
          style={{
            padding: 0,
            gap: 0,
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {!activeChat ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                padding: 32,
                textAlign: 'center'
              }}
            >
              <div className="icon-chip" style={{ width: 46, height: 46, borderRadius: 14 }}>
                <MessageSquare size={22} />
              </div>
              <h2 style={{ justifyContent: 'center' }}>Selecciona o crea una conversación</h2>
              <p className="muted" style={{ maxWidth: 420, margin: 0 }}>
                Chatea con tus otros equipos en Tailscale, pega capturas con <code>Ctrl+V</code>, comparte archivos y escribe notas en Markdown.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowNewChat(true)}
              >
                <Plus size={15} /> Crear primer chat
              </button>
            </div>
          ) : (
            <>
              {/* Active Chat Header */}
              <div
                className="between"
                style={{
                  padding: '13px 18px',
                  borderBottom: '1px solid var(--border)',
                  background: 'rgba(12, 17, 27, 0.72)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div className={`icon-chip ${activeChat.peerNode ? '' : 'warn'}`}>
                    {activeChat.peerNode ? <Monitor size={15} /> : <StickyNote size={15} />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 7 }}>
                      <strong style={{ fontSize: 15 }}>{activeChat.title}</strong>
                      {activeChat.peerNode ? (
                        <span className={`badge ${activePeerOnline ? 'ok' : 'accent'}`}>
                          {activePeerOnline !== null && (
                            <span className={`dot ${activePeerOnline ? 'ok' : ''}`} style={{ width: 6, height: 6 }} />
                          )}
                          {activeChat.peerNode}
                        </span>
                      ) : (
                        <span className="badge warn">Solo local / Notas</span>
                      )}
                    </div>
                    {activeChat.peerUrl && (
                      <div className="muted mono" style={{ fontSize: 11.5, marginTop: 1 }}>
                        {activeChat.peerUrl}
                      </div>
                    )}
                  </div>
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {messages.length} {messages.length === 1 ? 'mensaje' : 'mensajes'}
                  </span>
                </div>
              </div>

              {/* Message Feed */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  padding: '16px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12
                }}
              >
                {loadingMsgs ? (
                  <div className="muted" style={{ textAlign: 'center', padding: 24 }}>
                    Cargando mensajes...
                  </div>
                ) : messages.length === 0 ? (
                  <div
                    style={{
                      margin: 'auto',
                      textAlign: 'center',
                      maxWidth: 380,
                      padding: 20,
                      borderRadius: 14,
                      border: '1px dashed var(--border)',
                      background: 'rgba(10, 15, 24, 0.45)'
                    }}
                  >
                    <p className="muted" style={{ margin: 0 }}>
                      Esta conversación está vacía. Escribe un mensaje, pega una captura con <strong>Ctrl+V</strong> o arrastra archivos al editor abajo.
                    </p>
                  </div>
                ) : (
                  messages.map((msg, idx) => {
                    const msgId = msg.id || msg.messageId || `m-${idx}`;
                    const senderName = msg.senderNode || msg.sender || (msg.isOwn ? localNodeName || 'Tú' : activeChat.peerNode || 'Remoto');
                    const isOwn =
                      msg.isOwn === true ||
                      msg.direction === 'outgoing' ||
                      msg.direction === 'local' ||
                      (Boolean(localNodeName) &&
                        (String(msg.senderNode || '').toLowerCase() === localNodeName.toLowerCase() ||
                          String(msg.sender || '').toLowerCase() === localNodeName.toLowerCase()));
                    const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];

                    return (
                      <div
                        key={msgId}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: isOwn ? 'flex-end' : 'flex-start'
                        }}
                      >
                        <div
                          style={{
                            maxWidth: '82%',
                            minWidth: 180,
                            padding: '10px 13px',
                            borderRadius: isOwn ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                            background: isOwn
                              ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.14), rgba(37, 99, 235, 0.12))'
                              : 'var(--panel-2)',
                            border: `1px solid ${isOwn ? 'rgba(56, 189, 248, 0.3)' : 'var(--border-strong)'}`,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8
                          }}
                        >
                          {/* Message Header */}
                          <div className="between" style={{ gap: 10, flexWrap: 'nowrap' }}>
                            <div className="row" style={{ gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: isOwn ? '#bae6fd' : 'var(--text)' }}>
                                {senderName}
                              </span>
                              <span className="muted" style={{ fontSize: 11 }}>
                                {fmtMsgTime(msg.createdAt || msg.timestamp)}
                              </span>
                              {renderDeliveryBadge(msg.deliveryStatus || msg.status)}
                            </div>

                            <button
                              type="button"
                              title="Eliminar mensaje"
                              aria-label="Eliminar mensaje"
                              onClick={() => handleDeleteMessage(msgId)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--muted)',
                                cursor: 'pointer',
                                padding: '2px 4px',
                                borderRadius: 6,
                                display: 'inline-flex',
                                alignItems: 'center',
                                opacity: 0.75
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>

                          {/* Markdown Body */}
                          {msg.text && (
                            <MarkdownContent
                              text={msg.text}
                              onOpenUrl={handleOpenExternal}
                              onCopyCode={handleCopyText}
                            />
                          )}

                          {/* Attachments */}
                          {attachments.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
                              {attachments.map((att, ai) => {
                                const attId = att.id || att.attachmentId || `${msgId}-att-${ai}`;
                                const attName = att.name || att.fileName || 'Archivo';
                                const attMime = att.mime || att.mimeType || '';
                                const isImg = att.isImage ?? String(attMime).startsWith('image/');
                                const isDeleted = Boolean(att.deleted || att.isDeleted);

                                if (isDeleted) {
                                  return (
                                    <div
                                      key={attId}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 7,
                                        padding: '7px 11px',
                                        borderRadius: 10,
                                        background: 'rgba(10, 15, 24, 0.55)',
                                        border: '1px dashed var(--border-strong)',
                                        color: 'var(--muted)',
                                        fontSize: 12,
                                        fontStyle: 'italic'
                                      }}
                                    >
                                      <FileX size={14} />
                                      <span>Archivo eliminado{attName ? ` (${attName})` : ''}</span>
                                    </div>
                                  );
                                }

                                if (isImg) {
                                  return (
                                    <ImageAttachmentCard
                                      key={attId}
                                      attachment={att}
                                      cachedDataUrl={imageCache[attId]}
                                      onLoadDataUrl={loadAttachmentDataUrl}
                                      onPreview={(info) => setLightbox({ ...info, messageId: msgId })}
                                      onDownload={() => handleDownloadAttachment(msgId, att)}
                                      onDelete={() => handleDeleteAttachment(msgId, att)}
                                    />
                                  );
                                }

                                return (
                                  <div
                                    key={attId}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 10,
                                      padding: '8px 11px',
                                      borderRadius: 11,
                                      background: 'rgba(8, 11, 17, 0.76)',
                                      border: '1px solid var(--border)',
                                      minWidth: 210,
                                      maxWidth: 340
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: 32,
                                        height: 32,
                                        borderRadius: 8,
                                        background: 'var(--panel-2)',
                                        border: '1px solid var(--border)',
                                        display: 'grid',
                                        placeItems: 'center',
                                        flexShrink: 0
                                      }}
                                    >
                                      {getFileIcon(attMime, attName)}
                                    </div>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                      <div
                                        style={{
                                          fontSize: 12.5,
                                          fontWeight: 600,
                                          whiteSpace: 'nowrap',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis'
                                        }}
                                        title={attName}
                                      >
                                        {attName}
                                      </div>
                                      {att.size != null && (
                                        <div className="muted" style={{ fontSize: 11 }}>
                                          {fmtSize(att.size)}
                                        </div>
                                      )}
                                    </div>
                                    <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                                      <button
                                        type="button"
                                        className="btn btn-sm"
                                        title="Descargar archivo"
                                        onClick={() => handleDownloadAttachment(msgId, att)}
                                        style={{ padding: '4px 8px' }}
                                      >
                                        <Download size={12} /> Descargar
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-danger"
                                        title="Eliminar archivo"
                                        aria-label="Eliminar archivo"
                                        onClick={() => handleDeleteAttachment(msgId, att)}
                                        style={{ padding: '4px 7px' }}
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Rich Text Composer */}
              <form
                onSubmit={handleSend}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!draggingFiles) setDraggingFiles(true);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setDraggingFiles(false);
                  }
                }}
                onDrop={handleDropFiles}
                style={{
                  borderTop: '1px solid var(--border)',
                  background: draggingFiles ? 'rgba(56, 189, 248, 0.09)' : 'rgba(10, 15, 24, 0.84)',
                  padding: '10px 14px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  position: 'relative',
                  transition: 'background 0.15s ease'
                }}
              >
                {draggingFiles && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 8,
                      zIndex: 5,
                      borderRadius: 12,
                      border: '2px dashed var(--accent)',
                      background: 'rgba(8, 13, 22, 0.9)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10,
                      color: '#bae6fd',
                      fontWeight: 650,
                      fontSize: 14,
                      pointerEvents: 'none'
                    }}
                  >
                    <Upload size={18} /> Suelta tus imágenes o archivos aquí para adjuntarlos
                  </div>
                )}

                {/* Pending Attachments Preview Strip */}
                {pendingAttachments.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      overflowX: 'auto',
                      paddingBottom: 4
                    }}
                  >
                    {pendingAttachments.map((att) => (
                      <div
                        key={att.tempId}
                        style={{
                          position: 'relative',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 9px',
                          borderRadius: 10,
                          background: 'var(--panel-2)',
                          border: '1px solid var(--border-strong)',
                          flexShrink: 0,
                          maxWidth: 230
                        }}
                      >
                        {att.isImage && att.previewDataUrl ? (
                          <img
                            src={att.previewDataUrl}
                            alt={att.name}
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 6,
                              objectFit: 'cover',
                              flexShrink: 0
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: 7,
                              background: 'rgba(8, 11, 17, 0.7)',
                              display: 'grid',
                              placeItems: 'center',
                              flexShrink: 0
                            }}
                          >
                            {getFileIcon(att.mime, att.name)}
                          </div>
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                            title={att.name}
                          >
                            {att.name}
                          </div>
                          {att.size != null && (
                            <div className="muted" style={{ fontSize: 10.5 }}>
                              {fmtSize(att.size)}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removePendingAttachment(att.tempId)}
                          title="Quitar adjunto"
                          aria-label={`Quitar ${att.name}`}
                          style={{
                            background: 'rgba(248, 113, 113, 0.14)',
                            border: '1px solid rgba(248, 113, 113, 0.3)',
                            color: '#fca5a5',
                            borderRadius: 999,
                            width: 20,
                            height: 20,
                            display: 'grid',
                            placeItems: 'center',
                            cursor: 'pointer',
                            padding: 0,
                            flexShrink: 0
                          }}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Formatting Toolbar */}
                <div className="between" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 4 }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Negrita (**texto**)"
                      aria-label="Negrita"
                      onClick={() => applyFormat('bold')}
                      style={{ padding: '4px 7px' }}
                    >
                      <Bold size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Cursiva (*texto*)"
                      aria-label="Cursiva"
                      onClick={() => applyFormat('italic')}
                      style={{ padding: '4px 7px' }}
                    >
                      <Italic size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Código en línea (`código`)"
                      aria-label="Código en línea"
                      onClick={() => applyFormat('code')}
                      style={{ padding: '4px 7px' }}
                    >
                      <Code size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Bloque de código"
                      aria-label="Bloque de código"
                      onClick={() => applyFormat('codeBlock')}
                      style={{ padding: '4px 7px' }}
                    >
                      <SquareCode size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Lista con viñetas"
                      aria-label="Lista"
                      onClick={() => applyFormat('list')}
                      style={{ padding: '4px 7px' }}
                    >
                      <List size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Cita (> texto)"
                      aria-label="Cita"
                      onClick={() => applyFormat('quote')}
                      style={{ padding: '4px 7px' }}
                    >
                      <Quote size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Insertar enlace"
                      aria-label="Enlace"
                      onClick={() => applyFormat('link')}
                      style={{ padding: '4px 7px' }}
                    >
                      <Link2 size={13} />
                    </button>
                  </div>

                  {/* Write / Preview Toggle */}
                  <div
                    style={{
                      display: 'inline-flex',
                      borderRadius: 9,
                      padding: 2,
                      background: 'rgba(17, 23, 35, 0.9)',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setComposerTab('write')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '4px 9px',
                        borderRadius: 7,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 11.5,
                        fontWeight: 600,
                        background: composerTab === 'write' ? 'rgba(56, 189, 248, 0.18)' : 'transparent',
                        color: composerTab === 'write' ? '#bae6fd' : 'var(--muted)'
                      }}
                    >
                      <Pencil size={12} /> Escribir
                    </button>
                    <button
                      type="button"
                      onClick={() => setComposerTab('preview')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '4px 9px',
                        borderRadius: 7,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 11.5,
                        fontWeight: 600,
                        background: composerTab === 'preview' ? 'rgba(56, 189, 248, 0.18)' : 'transparent',
                        color: composerTab === 'preview' ? '#bae6fd' : 'var(--muted)'
                      }}
                    >
                      <Eye size={12} /> Vista previa
                    </button>
                  </div>
                </div>

                {/* Editor or Live Markdown Preview */}
                {composerTab === 'write' ? (
                  <textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    onPaste={handlePaste}
                    placeholder="Escribe un mensaje en Markdown... (Ctrl+V para pegar imágenes, arrastra archivos o Ctrl+Enter para enviar)"
                    style={{
                      minHeight: 74,
                      maxHeight: 190,
                      resize: 'vertical',
                      lineHeight: 1.48
                    }}
                  />
                ) : (
                  <div
                    style={{
                      minHeight: 74,
                      maxHeight: 190,
                      overflowY: 'auto',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--border-strong)',
                      background: '#0a0f18'
                    }}
                  >
                    {draft.trim() ? (
                      <MarkdownContent
                        text={draft}
                        onOpenUrl={handleOpenExternal}
                        onCopyCode={handleCopyText}
                      />
                    ) : (
                      <span className="muted" style={{ fontSize: 12.5 }}>
                        Nada que previsualizar todavía. Cambia a "Escribir" para redactar tu mensaje.
                      </span>
                    )}
                  </div>
                )}

                {/* Bottom Action Bar */}
                <div className="between" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={handlePickAttachments}
                      disabled={sending}
                    >
                      <Paperclip size={13} /> Adjuntar imagen / archivo
                    </button>
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      Ctrl+V pega imágenes · Ctrl+Enter envía
                    </span>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={sending || (!draft.trim() && pendingAttachments.length === 0)}
                    style={{ padding: '7px 14px' }}
                  >
                    <Send size={13} />
                    {sending ? 'Enviando...' : 'Enviar'}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>

      {/* Image Lightbox Preview Modal */}
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Vista previa de ${lightbox.name}`}
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(5, 8, 14, 0.9)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            flexDirection: 'column',
            padding: 24,
            gap: 14
          }}
        >
          <div
            className="between"
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              background: 'rgba(17, 23, 35, 0.92)',
              border: '1px solid var(--border-strong)'
            }}
          >
            <div className="row" style={{ gap: 10 }}>
              <Image size={16} color="var(--accent)" />
              <strong style={{ fontSize: 14 }}>{lightbox.name}</strong>
              {lightbox.size != null && (
                <span className="badge">{fmtSize(lightbox.size)}</span>
              )}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => handleDownloadAttachment(lightbox.messageId, lightbox.attachment)}
              >
                <Download size={13} /> Descargar
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => handleDeleteAttachment(lightbox.messageId, lightbox.attachment)}
              >
                <Trash2 size={13} /> Eliminar archivo
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setLightbox(null)}
              >
                <X size={14} /> Cerrar
              </button>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              placeItems: 'center'
            }}
          >
            <img
              src={lightbox.src}
              alt={lightbox.name}
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: '92vw',
                maxHeight: '78vh',
                objectFit: 'contain',
                borderRadius: 12,
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.65)',
                border: '1px solid var(--border-strong)'
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
