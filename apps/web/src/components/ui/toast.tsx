'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type ToastVariant = 'info' | 'success' | 'warning' | 'danger';

interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (props: { variant: ToastVariant; title: string; description?: string }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((props: { variant: ToastVariant; title: string; description?: string }) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...props, id }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 5000);
    return () => clearTimeout(timer);
  }, [toasts]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-20 right-4 z-50 flex flex-col gap-2 lg:bottom-4" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
};

const styles = {
  info: 'bg-info-surface border-info/20 text-info',
  success: 'bg-success-surface border-success/20 text-success',
  warning: 'bg-warning-surface border-warning/20 text-warning',
  danger: 'bg-danger-surface border-danger/20 text-danger',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = icons[toast.variant];

  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 rounded-card border p-4 shadow-card min-w-72 max-w-sm animate-in slide-in-from-bottom-2',
        styles[toast.variant],
      )}
    >
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-ink">{toast.title}</p>
        {toast.description && <p className="mt-1 text-xs text-ink-muted">{toast.description}</p>}
      </div>
      <button onClick={onDismiss} className="shrink-0 rounded-lg p-1 text-ink-muted hover:text-ink" aria-label="Dismiss">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
