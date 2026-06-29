'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

const THEME_KEY = 'mj_theme';

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'dark';
}

function applyTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    applyTheme(stored);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };

  return (
    <button className="theme-toggle" onClick={toggle} title={`切换到${theme === 'dark' ? '浅色' : '深色'}主题`}>
      {theme === 'dark' ? '☀️ 浅色' : '🌙 深色'}
    </button>
  );
}
