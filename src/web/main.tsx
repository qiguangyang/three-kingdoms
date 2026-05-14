import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { setInitialLocale } from '../state/store.js';
import './styles.css';

// Parse a couple of query-string conveniences:  ?lang=en   ?seed=42
// ?scenario=s1-dongzhuo&faction=caocao  — auto-starts the game.
const params = new URLSearchParams(window.location.search);
const lang = params.get('lang');
if (lang === 'en' || lang === 'zh') setInitialLocale(lang);

const mount = document.getElementById('root');
if (!mount) throw new Error('Missing #root container in index.html');
createRoot(mount).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
