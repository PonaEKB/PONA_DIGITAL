@echo off
echo ==================================
echo PONA DIGITAL - Setup
echo ==================================
echo.

mkdir src 2>nul

echo Создаю package.json...
(
echo {
echo   "name": "pona-digital",
echo   "private": true,
echo   "version": "1.0.0",
echo   "type": "module",
echo   "scripts": {
echo     "dev": "vite",
echo     "build": "vite build",
echo     "preview": "vite preview"
echo   },
echo   "dependencies": {
echo     "@supabase/supabase-js": "^2.45.0",
echo     "react": "^18.3.1",
echo     "react-dom": "^18.3.1"
echo   },
echo   "devDependencies": {
echo     "@vitejs/plugin-react": "^4.3.1",
echo     "vite": "^5.4.2"
echo   }
echo }
) > package.json

echo Создаю vite.config.js...
(
echo import { defineConfig } from 'vite';
echo import react from '@vitejs/plugin-react';
echo.
echo export default defineConfig({
echo   plugins: [react()],
echo   server: {
echo     port: 3000,
echo     open: true
echo   }
echo });
) > vite.config.js

echo Создаю index.html...
(
echo ^<!DOCTYPE html^>
echo ^<html lang="ru"^>
echo ^<head^>
echo   ^<meta charset="UTF-8"^>
echo   ^<meta name="viewport" content="width=device-width, initial-scale=1.0"^>
echo   ^<title^>PONA DIGITAL^</title^>
echo   ^<link href="https://fonts.googleapis.com/css2?family=Dosis:wght@300;400;500;600^&display=swap" rel="stylesheet"^>
echo ^</head^>
echo ^<body^>
echo   ^<div id="root"^>^</div^>
echo   ^<script type="module" src="/src/main.jsx"^>^</script^>
echo ^</body^>
echo ^</html^>
) > index.html

echo Создаю src/main.jsx...
(
echo import React from 'react';
echo import ReactDOM from 'react-dom/client';
echo import App from './App';
echo import './index.css';
echo.
echo ReactDOM.createRoot(document.getElementById('root')).render(
echo   ^<React.StrictMode^>
echo     ^<App /^>
echo   ^</React.StrictMode^>
echo );
) > src\main.jsx

echo Создаю src/index.css...
(
echo * {
echo   margin: 0;
echo   padding: 0;
echo   box-sizing: border-box;
echo }
echo.
echo body {
echo   font-family: 'Dosis', sans-serif;
echo   background: #0f0f1a;
echo   color: #fff;
echo   min-height: 100vh;
echo }
echo.
echo #root {
echo   min-height: 100vh;
echo }
) > src\index.css

echo Создаю src/supabaseClient.js...
(
echo import { createClient } from '@supabase/supabase-js';
echo.
echo const supabaseUrl = 'https://uvzbhdxgijqxstompgus.supabase.co';
echo const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2emJoZHhnaWpxeHN0b21wZ3VzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwMDI0NjcsImV4cCI6MjEwMjU3ODQ2N30.VetRNQCHPvU0riB_cJMaYJ329jjMWvl0lI52radR-ls';
echo.
echo export const supabase = createClient(supabaseUrl, supabaseAnonKey);
) > src\supabaseClient.js

echo Создаю src/App.css...
(
echo .loading {
echo   display: flex;
echo   align-items: center;
echo   justify-content: center;
echo   height: 100vh;
echo   font-size: 24px;
echo   color: #a855f7;
echo }
echo.
echo .auth-screen {
echo   display: flex;
echo   align-items: center;
echo   justify-content: center;
echo   min-height: 100vh;
echo   background: linear-gradient(135deg, #0c1445 0%%, #1a3a8a 50%%, #2563eb 100%%);
echo }
echo.
echo .auth-card {
echo   background: rgba(255, 255, 255, 0.1);
echo   border: 1px solid rgba(255, 255, 255, 0.3);
echo   border-radius: 20px;
echo   padding: 40px;
echo   width: 90%%;
echo   max-width: 400px;
echo   text-align: center;
echo   backdrop-filter: blur(15px);
echo }
echo.
echo .auth-logo {
echo   font-size: 32px;
echo   font-weight: 300;
echo   letter-spacing: 6px;
echo   margin-bottom: 10px;
echo }
echo.
echo .auth-subtitle {
echo   color: #c4b5fd;
echo   margin-bottom: 25px;
echo   font-size: 18px;
echo }
echo.
echo .auth-input {
echo   width: 100%%;
echo   padding: 14px 18px;
echo   margin-bottom: 15px;
echo   border-radius: 12px;
echo   border: 1px solid rgba(255, 255, 255, 0.3);
echo   background: rgba(255, 255, 255, 0.1);
echo   color: #fff;
echo   font-size: 16px;
echo   outline: none;
echo   font-family: 'Dosis', sans-serif;
echo }
echo.
echo .auth-input::placeholder {
echo   color: rgba(255, 255, 255, 0.5);
echo }
echo.
echo .auth-btn {
echo   width: 100%%;
echo   padding: 14px;
echo   border-radius: 12px;
echo   border: none;
echo   background: linear-gradient(135deg, #667eea, #a855f7);
echo   color: #fff;
echo   font-size: 18px;
echo   cursor: pointer;
echo   font-family: 'Dosis', sans-serif;
echo   letter-spacing: 1px;
echo   margin-bottom: 10px;
echo   transition: all 0.3s;
echo }
echo.
echo .auth-btn:hover {
echo   transform: scale(1.02);
echo   box-shadow: 0 10px 30px rgba(168, 85, 247, 0.4);
echo }
echo.
echo .auth-link {
echo   background: none;
echo   border: none;
echo   color: #c4b5fd;
echo   cursor: pointer;
echo   font-size: 14px;
echo   font-family: 'Dosis', sans-serif;
echo }
echo.
echo .app {
echo   display: flex;
echo   flex-direction: column;
echo   min-height: 100vh;
echo }
echo.
echo .header {
echo   display: flex;
echo   align-items: center;
echo   justify-content: space-between;
echo   padding: 15px 30px;
echo   background: rgba(0, 0, 0, 0.5);
echo   border-bottom: 1px solid rgba(255, 255, 255, 0.1);
echo   backdrop-filter: blur(15px);
echo }
echo.
echo .header .logo {
echo   font-size: 24px;
echo   font-weight: 300;
echo   letter-spacing: 5px;
echo }
echo.
echo .nav {
echo   display: flex;
echo   gap: 5px;
echo }
echo.
echo .nav-btn {
echo   padding: 10px 18px;
echo   border-radius: 10px;
echo   border: none;
echo   background: transparent;
echo   color: #c4b5fd;
echo   cursor: pointer;
echo   font-size: 15px;
echo   font-family: 'Dosis', sans-serif;
echo   transition: all 0.3s;
echo }
echo.
echo .nav-btn:hover, .nav-btn.active {
echo   background: rgba(255, 255, 255, 0.1);
echo   color: #fff;
echo }
echo.
echo .logout-btn {
echo   padding: 10px 20px;
echo   border-radius: 10px;
echo   border: 1px solid rgba(255, 255, 255, 0.3);
echo   background: rgba(255, 0, 0, 0.2);
echo   color: #fff;
echo   cursor: pointer;
echo   font-size: 14px;
echo   font-family: 'Dosis', sans-serif;
echo   transition: all 0.3s;
echo }
echo.
echo .logout-btn:hover {
echo   background: rgba(255, 0, 0, 0.4);
echo }
echo.
echo .main {
echo   display: flex;
echo   flex: 1;
echo   overflow: hidden;
echo }
echo.
echo .sidebar {
echo   width: 300px;
echo   background: rgba(0, 0, 0, 0.3);
echo   border-right: 1px solid rgba(255, 255, 255, 0.1);
echo   padding: 20px;
echo   overflow-y: auto;
echo }
echo.
echo .sidebar-header {
echo   display: flex;
echo   justify-content: space-between;
echo   align-items: center;
echo   margin-bottom: 15px;
echo }
echo.
echo .sidebar-header h2 {
echo   font-size: 20px;
echo   font-weight: 400;
echo }
echo.
echo .add-btn {
echo   width: 35px;
echo   height: 35px;
echo   border-radius: 50%%;
echo   border: none;
echo   background: linear-gradient(135deg, #667eea, #a855f7);
echo   color: #fff;
echo   font-size: 20px;
echo   cursor: pointer;
echo   transition: all 0.3s;
echo }
echo.
echo .add-btn:hover {
echo   transform: scale(1.1);
echo }
echo.
echo .project-list {
echo   display: flex;
echo   flex-direction: column;
echo   gap: 8px;
echo }
echo.
echo .project-item {
echo   display: flex;
echo   align-items: center;
echo   gap: 12px;
echo   padding: 12px 15px;
echo   border-radius: 12px;
echo   cursor: pointer;
echo   transition: all 0.3s;
echo   border: 1px solid transparent;
echo }
echo.
echo .project-item:hover {
echo   background: rgba(255, 255, 255, 0.05);
echo }
echo.
echo .project-item.active {
echo   background: rgba(255, 255, 255, 0.1);
echo   border-color: rgba(255, 255, 255, 0.2);
echo }
echo.
echo .project-color {
echo   width: 12px;
echo   height: 12px;
echo   border-radius: 50%%;
echo   flex-shrink: 0;
echo }
echo.
echo .project-name {
echo   flex: 1;
echo   font-size: 16px;
echo }
echo.
echo .project-status {
echo   font-size: 12px;
echo   color: #c4b5fd;
echo   background: rgba(255, 255, 255, 0.1);
echo   padding: 4px 10px;
echo   border-radius: 20px;
echo }
echo.
echo .content {
echo   flex: 1;
echo   padding: 30px;
echo   overflow-y: auto;
echo }
echo.
echo .project-header {
echo   display: flex;
echo   align-items: center;
echo   gap: 15px;
echo   margin-bottom: 10px;
echo }
echo.
echo .project-header h1 {
echo   font-size: 32px;
echo   font-weight: 400;
echo }
echo.
echo .delete-btn {
echo   background: none;
echo   border: none;
echo   font-size: 20px;
echo   cursor: pointer;
echo }
echo.
echo .project-desc {
echo   color: #c4b5fd;
echo   margin-bottom: 25px;
echo   font-size: 16px;
echo }
echo.
echo .task-section {
echo   margin-top: 20px;
echo }
echo.
echo .task-header {
echo   display: flex;
echo   justify-content: space-between;
echo   align-items: center;
echo   margin-bottom: 15px;
echo }
echo.
echo .task-header h2 {
echo   font-size: 22px;
echo   font-weight: 400;
echo }
echo.
echo .task-list {
echo   display: flex;
echo   flex-direction: column;
echo   gap: 10px;
echo }
echo.
echo .task-item {
echo   display: flex;
echo   align-items: center;
echo   gap: 15px;
echo   padding: 14px 18px;
echo   background: rgba(255, 255, 255, 0.05);
echo   border-radius: 12px;
echo   border: 1px solid rgba(255, 255, 255, 0.1);
echo }
echo.
echo .task-title {
echo   flex: 1;
echo   font-size: 16px;
echo }
echo.
echo .task-status {
echo   padding: 8px 12px;
echo   border-radius: 8px;
echo   border: 1px solid rgba(255, 255, 255, 0.2);
echo   background: rgba(0, 0, 0, 0.3);
echo   color: #fff;
echo   font-size: 14px;
echo   font-family: 'Dosis', sans-serif;
echo   cursor: pointer;
echo   outline: none;
echo }
echo.
echo .empty {
echo   color: #666;
echo   text-align: center;
echo   padding: 20px;
echo   font-size: 15px;
echo }
echo.
echo .welcome {
echo   text-align: center;
echo   padding: 60px 20px;
echo }
echo.
echo .welcome h1 {
echo   font-size: 32px;
echo   font-weight: 300;
echo   margin-bottom: 15px;
echo }
echo.
echo .welcome p {
echo   color: #c4b5fd;
echo   font-size: 18px;
echo }
) > src\App.css

echo ==================================
echo Все файлы созданы!
echo ==================================
echo.
echo Теперь выполни:
echo npm install
echo npm run dev
echo.
pause