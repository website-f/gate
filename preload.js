// preload.js

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // API handlers
    getDeviceStatus: (ip) => ipcRenderer.invoke('api:getDeviceStatus', ip),
    addUserToAllDevices: (user) => ipcRenderer.invoke('api:addUserToAllDevices', user),
    deleteUserFromAllDevices: (idno) => ipcRenderer.invoke('api:deleteUserFromAllDevices', idno),
    openGate: (deviceId) => ipcRenderer.invoke('api:openGate', deviceId),
    restartDevice: (deviceId) => ipcRenderer.invoke('api:restartDevice', deviceId),

    performSync: () => ipcRenderer.invoke('api:performSync'),
    addUserToDevices: (user) => ipcRenderer.invoke('addUserToDevices', user),
    updateUserStatus: (userId, status) => ipcRenderer.invoke('updateUserStatus', userId, status),
    
    // File System Handlers
    savePhoto: (photoData) => ipcRenderer.invoke('fs:savePhoto', photoData),
    deletePhoto: (path) => ipcRenderer.invoke('fs:deletePhoto', path),
    getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),

    // SQLite DB handlers
    getUsers: () => ipcRenderer.invoke('db:getUsers'),
    addUser: (user) => ipcRenderer.invoke('db:addUser', user),
    deleteUser: (id) => ipcRenderer.invoke('db:deleteUser', id),
     bulkDeleteUsers: (ids) => ipcRenderer.invoke('db:bulkDeleteUsers', ids),
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