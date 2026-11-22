import { useEffect, useState } from 'react';
import { StorefrontView } from './components/StorefrontView';
import { AdminDashboard } from './components/AdminDashboard';

export default function App() {
  const [mode, setMode] = useState<'store' | 'admin'>(() =>
    window.location.hash === '#admin' ? 'admin' : 'store'
  );

  const [isDark, setIsDark] = useState<boolean>(() =>
    document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem('bibis_theme', isDark ? 'dark' : 'light');
    } catch {
      // Ignore storage restrictions
    }
  }, [isDark]);

  const toggleTheme = () => setIsDark((prev) => !prev);

  const openAdmin = () => {
    window.location.hash = 'admin';
    setMode('admin');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const backToStore = () => {
    window.location.hash = '';
    setMode('store');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (mode === 'admin') {
    return (
      <AdminDashboard
        onBackToStore={backToStore}
        isDark={isDark}
        onToggleTheme={toggleTheme}
      />
    );
  }

  return (
    <StorefrontView
      onOpenAdmin={openAdmin}
      isDark={isDark}
      onToggleTheme={toggleTheme}
    />
  );
}
