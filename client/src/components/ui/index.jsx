import { forwardRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus, Star, X, AlertCircle } from 'lucide-react';
import { formatPrice } from '../../lib/format';

const cx = (...c) => c.filter(Boolean).join(' ');
export { cx };

/* --------------------------------- Button -------------------------------- */
const VARIANTS = {
  primary: 'bg-accent text-white hover:bg-accent-dark shadow-sm',
  dark: 'bg-ink text-paper hover:bg-ink-soft shadow-sm',
  secondary: 'bg-white text-ink border border-line hover:border-ink/30 hover:bg-cream/60',
  ghost: 'text-ink-soft hover:bg-cream hover:text-ink',
  danger: 'bg-danger text-white hover:bg-[#8f1c13]',
  'danger-ghost': 'text-danger hover:bg-danger-soft',
};
const SIZES = {
  sm: 'h-9 px-3.5 text-sm gap-1.5',
  md: 'h-11 px-5 text-[15px] gap-2',
  lg: 'h-12 px-6 text-base gap-2',
  icon: 'size-10 justify-center',
};

export const Button = forwardRef(function Button(
  { as: As = 'button', variant = 'primary', size = 'md', loading = false, disabled, className, children, ...props },
  ref,
) {
  const Comp = As === 'link' ? Link : As;
  return (
    <Comp
      ref={ref}
      disabled={As === 'button' ? disabled || loading : undefined}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex select-none items-center justify-center rounded-full font-semibold transition duration-200 active:scale-[0.98] disabled:opacity-55 disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Comp>
  );
});

export const Spinner = ({ className = 'size-6' }) => <Loader2 className={cx('animate-spin text-accent', className)} aria-label="Loading" />;

export const Skeleton = ({ className }) => <div className={cx('skeleton', className)} />;

export function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="size-8" />
    </div>
  );
}

/* --------------------------------- Fields -------------------------------- */
export const Field = forwardRef(function Field({ label, error, hint, as = 'input', className, children, ...props }, ref) {
  const id = useId();
  const Comp = as;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="field-label">
          {label}
        </label>
      )}
      <Comp
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className={cx('field', error && 'border-danger focus:border-danger focus:ring-danger/10', as === 'textarea' && 'min-h-28 resize-y')}
        {...props}
      >
        {children}
      </Comp>
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 flex items-center gap-1 text-sm text-danger">
          <AlertCircle className="size-3.5" /> {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>
      )}
    </div>
  );
});

export function Checkbox({ label, checked, onChange, count, id }) {
  const auto = useId();
  const cid = id || auto;
  return (
    <label htmlFor={cid} className="group flex cursor-pointer items-center gap-3 rounded-lg py-1.5 text-[15px] text-ink-soft hover:text-ink">
      <input id={cid} type="checkbox" checked={checked} onChange={onChange} className="size-4 rounded border-line accent-[#6b1e2b]" />
      <span className="flex-1">{label}</span>
      {count != null && <span className="text-xs text-muted">{count}</span>}
    </label>
  );
}

/* --------------------------------- Display ------------------------------- */
export function Badge({ children, tone = 'bg-cream text-ink-soft', className }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold', tone, className)}>{children}</span>;
}

export function Stars({ value = 0, size = 'size-4', className }) {
  return (
    <span className={cx('inline-flex items-center gap-0.5', className)} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - (i - 1)));
        return (
          <span key={i} className="relative inline-block">
            <Star className={cx(size, 'text-sand')} fill="currentColor" strokeWidth={0} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className={cx(size, 'text-brass')} fill="currentColor" strokeWidth={0} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function StarInput({ value, onChange }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} star${i > 1 ? 's' : ''}`}
          onClick={() => onChange(i)}
          className="rounded-md p-0.5 transition hover:scale-110"
        >
          <Star className={cx('size-7', i <= value ? 'text-brass' : 'text-sand')} fill="currentColor" strokeWidth={0} />
        </button>
      ))}
    </div>
  );
}

export function Price({ price, mrp, size = 'md' }) {
  const big = size === 'lg';
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className={cx('font-semibold text-ink', big ? 'text-3xl font-display' : 'text-base')}>{formatPrice(price)}</span>
      {mrp > price && (
        <>
          <span className={cx('text-muted line-through', big ? 'text-base' : 'text-sm')}>{formatPrice(mrp)}</span>
          <span className={cx('font-semibold text-forest', big ? 'text-base' : 'text-xs')}>{Math.round(((mrp - price) / mrp) * 100)}% off</span>
        </>
      )}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-line bg-white/50 px-6 py-16 text-center animate-fade-up">
      {Icon && (
        <div className="mb-5 grid size-16 place-items-center rounded-full bg-cream">
          <Icon className="size-7 text-accent" strokeWidth={1.5} />
        </div>
      )}
      <h3 className="text-2xl">{title}</h3>
      {description && <p className="mt-2 max-w-md text-ink-soft">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'We couldn’t load this' }) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-danger/20 bg-danger-soft/50 px-6 py-12 text-center">
      <AlertCircle className="mb-3 size-8 text-danger" />
      <h3 className="text-xl">{title}</h3>
      <p className="mt-1 text-sm text-ink-soft">{error?.message || 'Please try again.'}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function SectionHeading({ eyebrow, title, action, className }) {
  return (
    <div className={cx('mb-6 flex items-end justify-between gap-4', className)}>
      <div>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h2 className="text-3xl sm:text-[2.1rem]">{title}</h2>
      </div>
      {action}
    </div>
  );
}

/* ------------------------------ Interactions ----------------------------- */
export function QuantityStepper({ value, onChange, min = 1, max = 10, disabled, size = 'md' }) {
  const s = size === 'sm' ? 'h-9' : 'h-11';
  return (
    <div className={cx('inline-flex items-center rounded-full border border-line bg-white', s)}>
      <button
        type="button"
        aria-label="Decrease quantity"
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
        className="grid h-full w-9 place-items-center rounded-l-full text-ink-soft hover:text-ink disabled:opacity-40"
      >
        <Minus className="size-4" />
      </button>
      <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
        className="grid h-full w-9 place-items-center rounded-r-full text-ink-soft hover:text-ink disabled:opacity-40"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

export function Pagination({ meta, onChange }) {
  if (!meta || meta.pages <= 1) return null;
  const { page, pages } = meta;
  const nums = [];
  for (let i = 1; i <= pages; i += 1) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  const btn = 'grid size-10 place-items-center rounded-full text-sm font-semibold transition';
  return (
    <nav className="mt-10 flex items-center justify-center gap-1.5" aria-label="Pagination">
      <button className={cx(btn, 'hover:bg-cream disabled:opacity-40')} disabled={!meta.hasPrev} onClick={() => onChange(page - 1)} aria-label="Previous page">
        <ChevronLeft className="size-4" />
      </button>
      {nums.map((n, i) =>
        n === '…' ? (
          <span key={`e${i}`} className="px-1 text-muted">
            …
          </span>
        ) : (
          <button
            key={n}
            onClick={() => onChange(n)}
            aria-current={n === page ? 'page' : undefined}
            className={cx(btn, n === page ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-cream')}
          >
            {n}
          </button>
        ),
      )}
      <button className={cx(btn, 'hover:bg-cream disabled:opacity-40')} disabled={!meta.hasNext} onClick={() => onChange(page + 1)} aria-label="Next page">
        <ChevronRight className="size-4" />
      </button>
    </nav>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
          <motion.div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className={cx('relative flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-paper shadow-lift sm:rounded-3xl', size)}
          >
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="text-xl">{title}</h2>
              <button onClick={onClose} className="rounded-full p-2 text-muted hover:bg-cream hover:text-ink" aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function ConfirmModal({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', loading, danger }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="max-w-md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Keep it
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} size="sm" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-ink-soft">{message}</p>
    </Modal>
  );
}
