// preload.js - Complete updated version
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // API handlers
    getDeviceStatus: (ip) => ipcRenderer.invoke('api:getDeviceStatus', ip),
    addUserToAllDevices: (user) => ipcRenderer.invoke('api:addUserToAllDevices', user),
    deleteUserFromAllDevices: (idno) => ipcRenderer.invoke('api:deleteUserFromAllDevices', idno),
    openGate: (deviceId) => ipcRenderer.invoke('api:openGate', deviceId),
    restartDevice: (deviceId) => ipcRenderer.invoke('api:restartDevice', deviceId),
    
    performSync: () => ipcRenderer.invoke('api:performSync'),
    addUserToDevices: (recordId) => ipcRenderer.invoke('addUserToDevices', recordId),
    updateUserStatus: (recordId, status) => ipcRenderer.invoke('updateUserStatus', recordId, status),
    
    // File System Handlers
    savePhoto: (photoData) => ipcRenderer.invoke('fs:savePhoto', photoData),
    deletePhoto: (path) => ipcRenderer.invoke('fs:deletePhoto', path),
    getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),
    
    // SQLite DB handlers - now with record_id support
    getUsers: () => ipcRenderer.invoke('db:getUsers'),
    addUser: (user) => ipcRenderer.invoke('db:addUser', user),
    updateUser: (user) => ipcRenderer.invoke('db:updateUser', user),
    deleteUser: (recordId) => ipcRenderer.invoke('db:deleteUser', recordId),
    
    bulkDeleteUsers: (recordIds) => ipcRenderer.invoke('db:bulkDeleteUsers', recordIds),
    
    getSettings: () => ipcRenderer.invoke('db:getSettings'),
    setSetting: (key, value) => ipcRenderer.invoke('db:setSetting', key, value),
    
    getAreas: () => ipcRenderer.invoke('db:getAreas'),
    addArea: (area) => ipcRenderer.invoke('db:addArea', area),
    updateArea: (area) => ipcRenderer.invoke('db:updateArea', area),
    deleteArea: (id) => ipcRenderer.invoke('db:deleteArea', id),
    
    getDevices: () => ipcRenderer.invoke('db:getDevices'),
    addDevice: (device) => ipcRenderer.invoke('db:addDevice', device),
    updateDevice: (device) => ipcRenderer.invoke('db:updateDevice', device),
    deleteDevice: (id) => ipcRenderer.invoke('db:deleteDevice', id),
});