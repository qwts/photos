import { contextBridge } from 'electron';

// contextBridge is the only thing that belongs in this process. The typed IPC
// surface arrives with the contract layer (#49); reserving the namespace now
// keeps `window.overlook` the renderer's single, stable global from the first
// build.
contextBridge.exposeInMainWorld('overlook', Object.freeze({}));
