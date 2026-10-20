import React, { useState } from 'react';
import { FlaskConical, Menu, Moon, Sun, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui';

export const PublicNavbar: React.FC = () => {
  const { navigate, theme, setTheme, user } = useApp();
  const [open, setOpen] = useState(false);
  const links: [string, string][] = [['Features', 'features'], ['How it works', 'how-it-works'], ['Security', 'security'], ['About', 'about'], ['Contact', 'contact']];
  return (
    <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-950/90 backdrop-blur border-b border-slate-200 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <button onClick={() => navigate('landing')} className="flex items-center gap-2.5" aria-label="LabSync AI home">
          <span className="w-8 h-8 rounded-lg bg-blue-900 flex items-center justify-center text-white"><FlaskConical className="w-4 h-4" aria-hidden /></span>
          <span className="font-heading font-bold text-slate-900 dark:text-white">LabSync <span className="text-cyan-600">AI</span></span>
        </button>
        <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
          {links.map(([l, v]) => <button key={v} onClick={() => navigate(v)} className="px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-blue-900 dark:hover:text-cyan-400 rounded-lg">{l}</button>)}
        </nav>
        <div className="flex items-center gap-2">
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme" className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">{theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</button>
          {user ? <Button size="sm" onClick={() => navigate('dashboard')}>Open dashboard</Button> : (
            <>
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => navigate('login')}>Sign in</Button>
              <Button size="sm" onClick={() => navigate('register')}>Get started</Button>
            </>
          )}
          <button onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open} className="md:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300">{open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}</button>
        </div>
      </div>
      {open && (
        <div className="md:hidden border-t border-slate-200 dark:border-slate-800 px-4 py-3 flex flex-col gap-1 bg-white dark:bg-slate-950">
          {links.map(([l, v]) => <button key={v} onClick={() => { setOpen(false); navigate(v); }} className="text-left px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">{l}</button>)}
          {!user && <button onClick={() => { setOpen(false); navigate('login'); }} className="text-left px-3 py-2.5 text-sm font-medium text-blue-900 dark:text-cyan-400">Sign in</button>}
        </div>
      )}
    </header>
  );
};

export const PublicFooter: React.FC = () => {
  const { navigate } = useApp();
  return (
    <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-500">
        <p>© {new Date().getFullYear()} LabSync AI. Built for college computer laboratories.</p>
        <div className="flex gap-4">
          {([['Privacy', 'privacy'], ['Terms', 'terms'], ['Security', 'security'], ['Contact', 'contact']] as const).map(([l, v]) => <button key={v} onClick={() => navigate(v)} className="hover:text-blue-900 dark:hover:text-cyan-400">{l}</button>)}
        </div>
      </div>
    </footer>
  );
};
