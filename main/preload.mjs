import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('bfia', { desktop: true });
