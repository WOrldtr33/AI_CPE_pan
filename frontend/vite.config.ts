import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins:[react()], base:'/ui/', build:{outDir:'../media/dashboard-ui',emptyOutDir:true}, server:{proxy:{'/api':'http://127.0.0.1:18790','/recorder.js':'http://127.0.0.1:18790'}} });
