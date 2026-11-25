'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('estebanCloud', {
  getState: () => ipcRenderer.invoke('cloud:getState'),
  updateSettings: (patch) => ipcRenderer.invoke('cloud:updateSettings', patch),
  startServer: () => ipcRenderer.invoke('cloud:startServer'),
  stopServer: () => ipcRenderer.invoke('cloud:stopServer'),

  // Enterprise Fleet & Mass Disk Provisioning
  fleetScanNow: () => ipcRenderer.invoke('fleet:scanNow'),
  fleetCollectLocalInventory: () => ipcRenderer.invoke('fleet:collectLocalInventory'),
  fleetImportUsbInventories: () => ipcRenderer.invoke('fleet:importUsbInventories'),
  fleetUpdateNodeMeta: (payload) => ipcRenderer.invoke('fleet:updateNodeMeta', payload),
  fleetRemoveNode: (id) => ipcRenderer.invoke('fleet:removeNode', id),
  fleetExportCsv: () => ipcRenderer.invoke('fleet:exportCsv'),
  fleetExportHtmlReport: () => ipcRenderer.invoke('fleet:exportHtmlReport'),
  fleetBroadcastAnnouncement: (payload) => ipcRenderer.invoke('fleet:broadcastAnnouncement', payload),
  fleetWakeAll: () => ipcRenderer.invoke('fleet:wakeAll'),

  shareAllFixedDisks: (payload) => ipcRenderer.invoke('bulk:shareAllFixedDisks', payload),
  pickBulkFiles: () => ipcRenderer.invoke('bulk:pickFiles'),
  bulkDistributeFiles: (payload) => ipcRenderer.invoke('bulk:distributeFiles', payload),
  exportEnterpriseDeployKit: (payload) => ipcRenderer.invoke('bulk:exportEnterpriseDeployKit', payload),

  // Enterprise Ops v1.1.0 (Resumable TUS Transfers, Real-Time Sync, Multi-PC Presets, Audit Log)
  resumableDistributeFiles: (payload) => ipcRenderer.invoke('ops:resumableDistributeFiles', payload),
  onResumableProgress: (cb) => {
    const handler = (_event, p) => cb(p);
    ipcRenderer.on('office:resumableProgress', handler);
    return () => ipcRenderer.removeListener('office:resumableProgress', handler);
  },
  startRealtimeWatch: (payload) => ipcRenderer.invoke('ops:startRealtimeWatch', payload),
  stopRealtimeWatch: (id) => ipcRenderer.invoke('ops:stopRealtimeWatch', id),
  runPresetAcrossFleet: (payload) => ipcRenderer.invoke('ops:runPresetAcrossFleet', payload),
  refreshAuditLogs: (opts) => ipcRenderer.invoke('ops:refreshAuditLogs', opts),
  exportAuditCsv: () => ipcRenderer.invoke('ops:exportAuditCsv'),

  // Shared Folders & Keys
  pickShareFolder: () => ipcRenderer.invoke('shares:pickFolder'),
  addShare: (payload) => ipcRenderer.invoke('shares:add', payload),
  updateShare: (id, patch) => ipcRenderer.invoke('shares:update', { id, patch }),
  removeShare: (id) => ipcRenderer.invoke('shares:remove', id),
  openLocalFolder: (folderPath) => ipcRenderer.invoke('shares:openLocal', folderPath),

  generateKey: (payload) => ipcRenderer.invoke('keys:generate', payload),
  pickSaveFolder: () => ipcRenderer.invoke('keys:pickSaveFolder'),
  saveKeyToLocations: (payload) => ipcRenderer.invoke('keys:saveToLocations', payload),
  copyText: (text) => ipcRenderer.invoke('keys:copyText', text),
  readClipboardText: () => ipcRenderer.invoke('keys:readClipboardText'),
  revokeKey: (keyId) => ipcRenderer.invoke('keys:revoke', keyId),
  deleteKey: (keyId) => ipcRenderer.invoke('keys:delete', keyId),
  saveKeyPassphrase: (payload) => ipcRenderer.invoke('keys:savePassphrase', payload),
  syncKeyToAllUsb: (keyId) => ipcRenderer.invoke('keys:syncToAllUsb', keyId),

  // Power Tools
  runFolderSync: (payload) => ipcRenderer.invoke('tools:runFolderSync', payload),
  deleteSyncProfile: (id) => ipcRenderer.invoke('tools:deleteSyncProfile', id),
  pickFileForHash: () => ipcRenderer.invoke('tools:pickFileForHash'),
  computeFileHash: (filePath) => ipcRenderer.invoke('tools:computeFileHash', filePath),
  scanSharedStorage: (payload) => ipcRenderer.invoke('tools:scanSharedStorage', payload),
  diagnosePeer: (payload) => ipcRenderer.invoke('tools:diagnosePeer', payload),
  launchRdp: (host) => ipcRenderer.invoke('tools:launchRdp', host),
  openSmbShare: (host) => ipcRenderer.invoke('tools:openSmbShare', host),
  pushMeshClipboard: (payload) => ipcRenderer.invoke('tools:pushMeshClipboard', payload),
  deleteClipboardItem: (id) => ipcRenderer.invoke('tools:deleteClipboardItem', id),
  setKeepAwake: (enabled) => ipcRenderer.invoke('tools:setKeepAwake', enabled),
  sendAirDropFiles: (payload) => ipcRenderer.invoke('tools:sendAirDropFiles', payload),
  openAirDropFolder: () => ipcRenderer.invoke('tools:openAirDropFolder'),
  fetchRemoteScreen: (payload) => ipcRenderer.invoke('tools:fetchRemoteScreen', payload),
  fetchRemoteProcesses: (payload) => ipcRenderer.invoke('tools:fetchRemoteProcesses', payload),
  killRemoteProcess: (payload) => ipcRenderer.invoke('tools:killRemoteProcess', payload),
  runRemoteSystemAction: (payload) => ipcRenderer.invoke('tools:runRemoteSystemAction', payload),
  vaultList: () => ipcRenderer.invoke('tools:vaultList'),
  vaultUpsert: (item) => ipcRenderer.invoke('tools:vaultUpsert', item),
  vaultDelete: (id) => ipcRenderer.invoke('tools:vaultDelete', id),
  vaultSyncPeers: () => ipcRenderer.invoke('tools:vaultSyncPeers'),
  pickAndEncryptFileUsb: (payload) => ipcRenderer.invoke('tools:pickAndEncryptFileUsb', payload),
  pickAndDecryptFileUsb: (payload) => ipcRenderer.invoke('tools:pickAndDecryptFileUsb', payload),
  pickAndConvertImage: (payload) => ipcRenderer.invoke('tools:pickAndConvertImage', payload),
  scanGitProjects: () => ipcRenderer.invoke('tools:scanGitProjects'),
  gitQuickCommitPush: (payload) => ipcRenderer.invoke('tools:gitQuickCommitPush', payload),
  winOptGetCatalog: () => ipcRenderer.invoke('winopt:getCatalog'),
  winOptPreviewScript: (payload) => ipcRenderer.invoke('winopt:previewScript', payload),
  winOptExportScript: (payload) => ipcRenderer.invoke('winopt:exportScript', payload),
  winOptExecute: (payload) => ipcRenderer.invoke('winopt:execute', payload),

  // Client / Mounts / Updates / Metrics / Chat
  pickKeyFile: () => ipcRenderer.invoke('client:pickKeyFile'),
  scanUsbKeys: () => ipcRenderer.invoke('client:scanUsbKeys'),
  unlockAndConnect: (payload) => ipcRenderer.invoke('client:unlockAndConnect', payload),
  disconnectClient: (sessionId) => ipcRenderer.invoke('client:disconnect', sessionId),
  listRemoteFiles: (payload) => ipcRenderer.invoke('client:listFiles', payload),
  createRemoteFolder: (payload) => ipcRenderer.invoke('client:mkdir', payload),
  renameRemoteItem: (payload) => ipcRenderer.invoke('client:renameItem', payload),
  deleteRemoteItem: (payload) => ipcRenderer.invoke('client:deleteItem', payload),
  downloadRemoteFile: (payload) => ipcRenderer.invoke('client:downloadFile', payload),
  uploadRemoteFiles: (payload) => ipcRenderer.invoke('client:uploadFiles', payload),
  mountDrive: (payload) => ipcRenderer.invoke('client:mountDrive', payload),
  updateMountOrg: (payload) => ipcRenderer.invoke('client:updateMountOrg', payload),
  reassignDriveLetter: (payload) => ipcRenderer.invoke('client:reassignDriveLetter', payload),
  removeDriveProfile: (id) => ipcRenderer.invoke('client:removeDriveProfile', id),
  optimizeRoute: (payload) => ipcRenderer.invoke('client:optimizeRoute', payload),
  unmountDrive: (driveLetter) => ipcRenderer.invoke('client:unmountDrive', driveLetter),

  optimizeMemoryNow: () => ipcRenderer.invoke('memory:optimizeNow'),
  setUltraLightMode: (enabled) => ipcRenderer.invoke('memory:setUltraLightMode', enabled),
  createPairingCode: () => ipcRenderer.invoke('pairing:createCode'),
  connectWithPairingCode: (payload) => ipcRenderer.invoke('pairing:connectWithCode', payload),
  getMiniInternetState: () => ipcRenderer.invoke('mini:getState'),
  upsertNetwork: (net) => ipcRenderer.invoke('mini:upsertNetwork', net),
  deleteNetwork: (id) => ipcRenderer.invoke('mini:deleteNetwork', id),
  openMiniPortal: (payload) => ipcRenderer.invoke('mini:openPortal', payload),
  upsertPackage: (pkg) => ipcRenderer.invoke('mini:upsertPackage', pkg),
  deletePackage: (id) => ipcRenderer.invoke('mini:deletePackage', id),
  executeSmartPackage: (payload) => ipcRenderer.invoke('mini:executePackage', payload),
  openDrive: (driveLetter) => ipcRenderer.invoke('client:openDrive', driveLetter),
  removePeer: (id) => ipcRenderer.invoke('client:removePeer', id),

  launchTailscale: () => ipcRenderer.invoke('system:launchTailscale'),
  openScriptsFolder: () => ipcRenderer.invoke('system:openScriptsFolder'),
  openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  pushUpdateToConnectedPeers: () => ipcRenderer.invoke('updates:pushToConnectedPeers'),
  downloadAndInstallUpdate: (candidate) => ipcRenderer.invoke('updates:downloadAndInstall', candidate),

  getGlobalMetrics: (opts) => ipcRenderer.invoke('metrics:getGlobal', opts),
  runDiskBenchmark: () => ipcRenderer.invoke('metrics:runDiskBenchmark'),
  updateMetricThresholds: (patch) => ipcRenderer.invoke('metrics:updateThresholds', patch),

  chatList: () => ipcRenderer.invoke('chat:list'),
  chatCreate: (payload) => ipcRenderer.invoke('chat:create', payload),
  chatDelete: (chatId) => ipcRenderer.invoke('chat:delete', chatId),
  chatGetMessages: (chatId) => ipcRenderer.invoke('chat:getMessages', chatId),
  chatPickAttachments: () => ipcRenderer.invoke('chat:pickAttachments'),
  chatSendMessage: (payload) => ipcRenderer.invoke('chat:sendMessage', payload),
  chatGetAttachmentDataUrl: (attachmentId) => ipcRenderer.invoke('chat:getAttachmentDataUrl', attachmentId),
  chatDownloadAttachment: (payload) => ipcRenderer.invoke('chat:downloadAttachment', payload),
  chatDeleteAttachment: (payload) => ipcRenderer.invoke('chat:deleteAttachment', payload),
  chatDeleteMessage: (payload) => ipcRenderer.invoke('chat:deleteMessage', payload),

  onChatEvent: (cb) => {
    const handler = (_event, evt) => cb(evt);
    ipcRenderer.on('cloud:chatEvent', handler);
    return () => ipcRenderer.removeListener('cloud:chatEvent', handler);
  },
  onUpdateAvailable: (cb) => {
    const handler = (_event, info) => cb(info);
    ipcRenderer.on('cloud:updateAvailable', handler);
    return () => ipcRenderer.removeListener('cloud:updateAvailable', handler);
  },
  onUpdateProgress: (cb) => {
    const handler = (_event, progress) => cb(progress);
    ipcRenderer.on('cloud:updateProgress', handler);
    return () => ipcRenderer.removeListener('cloud:updateProgress', handler);
  },
  onBulkProgress: (cb) => {
    const handler = (_event, progress) => cb(progress);
    ipcRenderer.on('office:bulkProgress', handler);
    return () => ipcRenderer.removeListener('office:bulkProgress', handler);
  },
  onTransferProgress: (cb) => {
    const handler = (_event, progress) => cb(progress);
    ipcRenderer.on('cloud:transferProgress', handler);
    return () => ipcRenderer.removeListener('cloud:transferProgress', handler);
  },
  onLog: (cb) => {
    const handler = (_event, entry) => cb(entry);
    ipcRenderer.on('cloud:log', handler);
    return () => ipcRenderer.removeListener('cloud:log', handler);
  }
});
