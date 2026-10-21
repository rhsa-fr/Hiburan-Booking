/**
 * central visual layer — restyle here
 *
 * Every visual primitive of the Tarlink admin panel lives in this file.
 * Route files and feature components compose from these exports only: no raw
 * `<button>`, `<table>`, or ad-hoc control markup outside this module.
 *
 * The palette follows the product owner's reference (index.html + style.css)
 * through the Tailwind tokens in tailwind.config.ts: page / sidebar / subtle
 * / surface / primary / textMain / textSecondary / textMuted / border.
 *
 * When the visual reference changes again, restyle the primitives below — the
 * routes should not need edits.
 */
'use client';

import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowUpDown,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Inbox,
  Info,
  LayoutPanelLeft,
  Lock,
  LogOut,
  MapPin,
  RotateCw,
  Search,
  X
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps, MouseEventHandler, ReactNode } from 'react';
import { axisLabel, statusLabel } from '@/lib/format';
import type { StatusAxis } from '@/lib/types';

export { axisLabel, statusLabel };

/* -------------------------------------------------------------------------- */
/* Buttons                                                                    */
/* -------------------------------------------------------------------------- */

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-field font-semibold transition-colors disabled:cursor-not-allowed';

const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white hover:bg-primary/90 active:bg-primary/80 disabled:bg-border disabled:text-textMuted',
  outline:
    'border border-border bg-surface text-textMain hover:bg-subtle hover:border-textMuted/40 disabled:border-border disabled:text-textMuted',
  ghost:
    'text-primary hover:bg-primary/10 active:bg-primary/15 disabled:text-textMuted',
  danger:
    'bg-danger text-white hover:bg-danger/90 active:bg-danger/80 disabled:bg-border disabled:text-textMuted'
};

const BUTTON_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-12 px-3.5 text-sm',
  md: 'min-h-12 px-4 text-base'
};

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: 'button' | 'submit' | 'reset';
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
  icon?: ReactNode;
  iconAfter?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  href,
  onClick,
  disabled,
  title,
  ariaLabel,
  ariaExpanded,
  ariaControls,
  icon,
  iconAfter,
  fullWidth,
  className,
  children
}: ButtonProps) {
  const classes = clsx(
    BUTTON_BASE,
    BUTTON_VARIANT_CLASSES[variant],
    BUTTON_SIZE_CLASSES[size],
    fullWidth && 'w-full',
    className
  );

  const content = (
    <>
      {icon}
      {children}
      {iconAfter}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        title={title}
        aria-label={ariaLabel}
        aria-expanded={ariaExpanded}
        aria-controls={ariaControls}
        className={classes}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      className={classes}
    >
      {content}
    </button>
  );
}

export function IconButton({
  label,
  title,
  icon,
  variant = 'outline',
  size = 'md',
  disabled,
  onClick,
  className
}: {
  label: string;
  title?: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLElement>;
  className?: string;
}) {
  return (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      ariaLabel={label}
      className={clsx('w-12 shrink-0 px-0', className)}
    >
      <span aria-hidden className="inline-flex">
        {icon}
      </span>
    </Button>
  );
}

/**
 * A control that is intentionally not implemented in this build. It always
 * explains itself: the native tooltip carries the reason and the reason is
 * also visible, so keyboard and screen-reader users get the same information.
 */
export function DisabledAction({
  label,
  reason,
  icon: Icon,
  className
}: {
  label: string;
  reason: string;
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  className?: string;
}) {
  return (
    <div className={className}>
      <span title={reason} className="inline-flex">
        <button
          type="button"
          disabled
          className="inline-flex min-h-12 cursor-not-allowed items-center justify-center gap-2 rounded-field border border-border bg-subtle px-3.5 text-sm font-semibold text-textMuted"
        >
          {Icon ? <Icon aria-hidden className="h-4 w-4" /> : null}
          {label}
        </button>
      </span>
      <p className="mt-1.5 max-w-[42ch] text-sm leading-snug text-textSecondary">{reason}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  className,
  labelledBy
}: {
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={clsx(
        'rounded-card border border-border bg-surface shadow-soft',
        className
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  icon,
  action,
  className
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'flex flex-wrap items-center justify-between gap-3 px-5 py-4',
        className
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon ? (
            <span aria-hidden className="inline-flex text-textSecondary">
              {icon}
            </span>
          ) : null}
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-textMain">{title}</h2>
        </div>
        {description ? (
          <p className="mt-1 text-sm leading-snug text-textSecondary">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function CardBody({
  children,
  className,
  padded = true
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={clsx(padded && 'px-5 py-4', className)}>{children}</div>;
}

export function CardFooter({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('border-t border-border px-4 py-3 text-sm text-textSecondary', className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  meta
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-textMain md:text-[30px]">
          {title}
        </h1>
        {description ? (
          <div className="mt-2 max-w-[68ch] text-base leading-relaxed text-textSecondary">
            {description}
          </div>
        ) : null}
        {meta ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-textSecondary">
            {meta}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Status badges                                                              */
/* -------------------------------------------------------------------------- */

export type BadgeTone = 'primary' | 'soft' | 'ok' | 'danger' | 'muted';

const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  primary: 'bg-primary/10 text-primary',
  soft: 'bg-primary-soft/45 text-textMain',
  ok: 'bg-ok/10 text-ok',
  danger: 'bg-danger/10 text-danger',
  muted: 'bg-textMuted/15 text-textSecondary'
};

export function StatusBadge({
  children,
  tone = 'muted',
  className
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold leading-none',
        BADGE_TONE_CLASSES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

const LIFECYCLE_TONES: Record<string, BadgeTone> = {
  requested: 'soft',
  countered: 'primary',
  accepted: 'primary',
  confirmed: 'ok',
  in_progress: 'primary',
  completed: 'ok',
  cancelled: 'muted',
  rejected: 'danger',
  expired: 'muted',
  no_show: 'danger'
};

const PAYMENT_TONES: Record<string, BadgeTone> = {
  unpaid: 'muted',
  dp_paid: 'primary',
  fully_paid: 'ok',
  partially_refunded: 'soft',
  refunded: 'muted'
};

const SETTLEMENT_TONES: Record<string, BadgeTone> = {
  not_eligible: 'muted',
  held: 'soft',
  disputed: 'danger',
  released: 'ok',
  clawed_back: 'danger'
};

export function statusTone(axis: StatusAxis, value: string): BadgeTone {
  if (axis === 'lifecycle') return LIFECYCLE_TONES[value] ?? 'muted';
  if (axis === 'payment') return PAYMENT_TONES[value] ?? 'muted';
  return SETTLEMENT_TONES[value] ?? 'muted';
}

export function StatusPill({
  axis,
  value,
  className
}: {
  axis: StatusAxis;
  value: string;
  className?: string;
}) {
  return (
    <StatusBadge tone={statusTone(axis, value)} className={className}>
      {statusLabel(axis, value)}
    </StatusBadge>
  );
}

export function toneForVerification(status: string): BadgeTone {
  if (status === 'verified') return 'ok';
  if (status === 'pending') return 'soft';
  if (status === 'rejected') return 'danger';
  return 'muted';
}

export function verificationLabel(status: string): string {
  if (status === 'verified') return 'Terverifikasi';
  if (status === 'pending') return 'Menunggu verifikasi';
  if (status === 'rejected') return 'Ditolak';
  return status;
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                     */
/* -------------------------------------------------------------------------- */

export function Table({
  children,
  label,
  className,
  maxHeight = 'max-h-[70vh]'
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  maxHeight?: string | null;
}) {
  return (
    <div className={clsx('overflow-auto', maxHeight)}>
      <table className={clsx('w-full border-collapse text-left', className)}>
        {label ? <caption className="sr-only">{label}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="sticky top-0 z-10 bg-subtle">{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function TableFoot({ children }: { children: ReactNode }) {
  return <tfoot className="border-t border-border bg-subtle">{children}</tfoot>;
}

export function TableRow({
  children,
  className,
  onClick,
  selected
}: {
  children: ReactNode;
  className?: string;
  onClick?: MouseEventHandler<HTMLTableRowElement>;
  selected?: boolean;
}) {
  return (
    <tr
      onClick={onClick}
      className={clsx(
        'transition-colors',
        onClick ? 'cursor-pointer hover:bg-subtle' : '',
        selected ? 'bg-primary/5' : '',
        className
      )}
    >
      {children}
    </tr>
  );
}

export function TableHeadCell({
  children,
  align = 'left',
  className,
  sort,
  onSort
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  sort?: 'asc' | 'desc' | 'none';
  onSort?: () => void;
}) {
  const content = onSort ? (
    <button
      type="button"
      onClick={onSort}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-sm text-[13px] font-medium text-textSecondary transition-colors hover:text-textMain"
    >
      {children}
      <ArrowUpDown aria-hidden className="h-3.5 w-3.5" />
    </button>
  ) : (
    children
  );

  return (
    <th
      scope="col"
      aria-sort={
        sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : undefined
      }
      className={clsx(
        'bg-subtle px-4 py-3 text-[13px] font-medium text-textSecondary',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className
      )}
    >
      {content}
    </th>
  );
}

export function TableCell({
  children,
  align = 'left',
  className,
  colSpan
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={clsx(
        'px-4 py-3.5 text-[15px] text-textMain',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className
      )}
    >
      {children}
    </td>
  );
}

/* -------------------------------------------------------------------------- */
/* Calendar                                                                   */
/* -------------------------------------------------------------------------- */

export interface CalendarGridCell {
  key: string;
  day: number;
  ariaLabel: string;
  /** Isi ringkas di bawah angka tanggal, mis. badge sesi. */
  content?: ReactNode;
  /** Tanggal di luar bulan yang ditampilkan. */
  muted?: boolean;
  /** Tanggal berada di rentang yang sedang disiapkan. */
  highlighted?: boolean;
  /** Tanggal terkunci (held/booked) dan tidak boleh dipilih. */
  locked?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}

export function CalendarGrid({
  label,
  cells,
  leadingBlanks = 0,
  trailingBlanks = 0,
  weekdays = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
}: {
  label: string;
  cells: CalendarGridCell[];
  leadingBlanks?: number;
  trailingBlanks?: number;
  weekdays?: string[];
}) {
  const slots: Array<CalendarGridCell | null> = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...cells,
    ...Array.from({ length: trailingBlanks }, () => null)
  ];
  const rows: Array<Array<CalendarGridCell | null>> = [];
  for (let index = 0; index < slots.length; index += 7) {
    rows.push(slots.slice(index, index + 7));
  }

  function renderCell(cell: CalendarGridCell | null) {
    if (!cell) return null;

    const base =
      'flex min-h-[86px] w-full flex-col rounded-field border p-2 text-left transition-colors';
    const stateClass = cell.locked
      ? 'cursor-not-allowed border-border bg-subtle text-textMuted'
      : cell.selected
        ? 'border-primary bg-primary/10 text-textMain ring-1 ring-primary/40'
        : cell.highlighted
          ? 'border-border bg-primary/[0.045] text-textMain'
          : cell.muted
            ? 'border-transparent bg-subtle/60 text-textMuted'
            : 'border-border bg-surface text-textMain hover:border-primary/40';

    const inner = (
      <>
        <span className="flex items-center justify-between gap-1">
          <span className="tnum text-[13px] font-semibold">{cell.day}</span>
          {cell.locked ? (
            <Lock aria-hidden className="h-3.5 w-3.5 shrink-0" />
          ) : null}
        </span>
        {cell.content ? (
          <span className="mt-1.5 flex flex-col items-start gap-1">{cell.content}</span>
        ) : null}
      </>
    );

    if (cell.locked || !cell.onSelect) {
      return (
        <div
          aria-label={cell.ariaLabel}
          title={cell.locked ? `${cell.ariaLabel} — terkunci` : cell.ariaLabel}
          className={clsx(base, stateClass)}
        >
          {inner}
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={cell.onSelect}
        aria-label={cell.ariaLabel}
        aria-pressed={cell.selected}
        title={cell.ariaLabel}
        className={clsx(base, stateClass, 'focus-visible:outline-none')}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-separate border-spacing-1">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {weekdays.map((weekday) => (
              <th
                key={weekday}
                scope="col"
                className="px-1 pb-1 text-left text-[12px] font-semibold uppercase tracking-[0.06em] text-textMuted"
              >
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`week-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={cell?.key ?? `blank-${rowIndex}-${cellIndex}`} className="align-top">
                  {renderCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Forms                                                                      */
/* -------------------------------------------------------------------------- */

const CONTROL_BASE =
  'w-full rounded-field border border-border bg-surface px-3.5 text-base text-textMain transition-colors placeholder:text-textMuted hover:border-textMuted/50 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:cursor-not-allowed disabled:bg-subtle disabled:text-textMuted';

export const inputClass = clsx(CONTROL_BASE, 'h-12');
export const selectClass = clsx(CONTROL_BASE, 'h-12 pr-9');
export const textareaClass = clsx(CONTROL_BASE, 'min-h-[112px] py-3 leading-relaxed');
export const checkboxClass =
  'h-5 w-5 rounded-sm border-border accent-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2';

export function Checkbox({
  id,
  checked,
  onChange,
  disabled,
  label,
  hideLabel = false,
  title
}: {
  id: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
  hideLabel?: boolean;
  title?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2" title={title}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className={checkboxClass}
      />
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-[14px] text-textSecondary'}>
        {label}
      </label>
    </span>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
  className
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-textMain">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[13px] leading-snug text-textSecondary">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-[13px] font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint: boolean, error: boolean): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export function Input({
  id,
  label,
  hint,
  error,
  leadingIcon,
  className,
  ...rest
}: Omit<ComponentProps<'input'>, 'id'> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  leadingIcon?: ReactNode;
}) {
  const control = (
    <input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, Boolean(hint), Boolean(error))}
      className={clsx(inputClass, leadingIcon ? 'pl-10' : '', className)}
      {...rest}
    />
  );

  return (
    <Field id={id} label={label} hint={hint} error={error}>
      {leadingIcon ? (
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-textMuted"
          >
            {leadingIcon}
          </span>
          {control}
        </div>
      ) : (
        control
      )}
    </Field>
  );
}

export function Select({
  id,
  label,
  hint,
  error,
  className,
  children,
  ...rest
}: Omit<ComponentProps<'select'>, 'id'> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, Boolean(hint), Boolean(error))}
        className={clsx(selectClass, className)}
        {...rest}
      >
        {children}
      </select>
    </Field>
  );
}

export function InlineSelect({
  id,
  label,
  value,
  onChange,
  options,
  className
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <label htmlFor={id} className="whitespace-nowrap text-[13px] text-textSecondary">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-field border border-border bg-surface px-2.5 text-[13px] text-textMain transition-colors hover:border-textMuted/50 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Textarea({
  id,
  label,
  hint,
  error,
  className,
  ...rest
}: Omit<ComponentProps<'textarea'>, 'id'> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, Boolean(hint), Boolean(error))}
        className={clsx(textareaClass, className)}
        {...rest}
      />
    </Field>
  );
}

/* -------------------------------------------------------------------------- */
/* Overlay surfaces                                                           */
/* -------------------------------------------------------------------------- */

export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  className,
  size = 'md'
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // `onClose` sering diberikan sebagai arrow inline, sehingga identitasnya
  // berubah pada SETIAP render. Kalau dipakai sebagai dependency effect,
  // effect jalan ulang setiap ketikan dan `panelRef.focus()` mencuri fokus
  // dari input di dalam modal (bug: field tidak bisa diketik).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  const sizeClass =
    size === 'sm' ? 'sm:max-w-md' : size === 'lg' ? 'sm:max-w-5xl' : 'sm:max-w-3xl';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div aria-hidden onClick={onClose} className="absolute inset-0 animate-fade-in bg-textMain/40" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={clsx(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-card border border-border bg-surface shadow-soft focus:outline-none sm:rounded-card',
          sizeClass,
          className
        )}
      >
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">{children}</div>
        <IconButton
          label="Tutup dialog"
          icon={<X aria-hidden className="h-5 w-5" />}
          onClick={onClose}
          className="absolute right-3 top-3 bg-surface/95"
        />
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  consequence,
  confirmLabel,
  cancelLabel = 'Batal',
  tone = 'danger',
  pending = false,
  error,
  labelledBy = 'confirm-dialog-title',
  onConfirm
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  consequence?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  pending?: boolean;
  error?: string | null;
  labelledBy?: string;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={pending ? () => undefined : onClose}
      labelledBy={labelledBy}
      size="sm"
    >
      <h2
        id={labelledBy}
        className="pr-10 text-xl font-bold tracking-[-0.01em] text-textMain"
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-2 text-base leading-relaxed text-textSecondary">{description}</p>
      ) : null}
      {consequence ? (
        <Alert tone={tone === 'danger' ? 'danger' : 'info'} className="mt-4">
          {consequence}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Perubahan gagal" className="mt-3">
          {error}
        </Alert>
      ) : null}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button
          variant={tone === 'danger' ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? 'Memproses…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function Drawer({
  open,
  onClose,
  labelledBy,
  title,
  eyebrow = 'Detail',
  children
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // `onClose` sering diberikan sebagai arrow inline, sehingga identitasnya
  // berubah pada SETIAP render. Kalau dipakai sebagai dependency effect,
  // effect jalan ulang setiap ketikan dan `panelRef.focus()` mencuri fokus
  // dari input di dalam modal (bug: field tidak bisa diketik).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-textMain/35"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-[600px] animate-drawer-in flex-col border-l border-border bg-surface shadow-soft focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-textMuted">
              {eyebrow}
            </p>
            <div id={labelledBy} className="mt-1 truncate text-xl font-bold tracking-[-0.01em]">
              {title}
            </div>
          </div>
          <IconButton
            label="Tutup panel detail"
            icon={<X aria-hidden className="h-5 w-5" />}
            onClick={onClose}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                       */
/* -------------------------------------------------------------------------- */

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export function Tabs({
  items,
  value,
  onChange,
  ariaLabel = 'Pilih tampilan'
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex gap-1 overflow-x-auto border-b border-border"
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={active}
            aria-controls={`tabpanel-${item.id}`}
            onClick={() => onChange(item.id)}
            className={clsx(
              'inline-flex min-h-12 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 text-base font-semibold transition-colors',
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-textSecondary hover:border-border hover:text-textMain'
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span
                className={clsx(
                  'tnum rounded-full px-2 py-0.5 text-[13px] font-semibold',
                  active ? 'bg-primary/10 text-primary' : 'bg-subtle text-textSecondary'
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Compact segmented control, mengikuti kartu periode di referensi. */
export function PeriodTabs({
  items,
  value,
  onChange,
  ariaLabel = 'Pilih periode'
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex gap-1 rounded-field bg-subtle p-1"
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={clsx(
              'inline-flex min-h-10 items-center gap-1.5 rounded-sm px-3 text-[13px] font-medium transition-colors',
              active
                ? 'bg-surface font-semibold text-textMain shadow-soft'
                : 'text-textSecondary hover:text-textMain'
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className="tnum text-textMuted">{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                   */
/* -------------------------------------------------------------------------- */

export type AlertTone = 'info' | 'ok' | 'warning' | 'danger';

const ALERT_TONE_CLASSES: Record<AlertTone, string> = {
  info: 'border-primary/20 bg-primary/10 text-primary',
  ok: 'border-ok/20 bg-ok/10 text-ok',
  warning: 'border-primary-soft/60 bg-primary-soft/30 text-textMain',
  danger: 'border-danger/20 bg-danger/10 text-danger'
};

function AlertIcon({ tone }: { tone: AlertTone }) {
  if (tone === 'ok') return <CheckCircle2 aria-hidden className="h-5 w-5 shrink-0" />;
  if (tone === 'danger' || tone === 'warning') {
    return <AlertTriangle aria-hidden className="h-5 w-5 shrink-0" />;
  }
  return <Info aria-hidden className="h-5 w-5 shrink-0" />;
}

export function Alert({
  tone = 'info',
  title,
  children,
  className
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={clsx(
        'flex items-start gap-3 rounded-field border px-3.5 py-3',
        ALERT_TONE_CLASSES[tone],
        className
      )}
    >
      <AlertIcon tone={tone} />
      <div className="min-w-0">
        {title ? <p className="text-sm font-semibold">{title}</p> : null}
        {children ? (
          <div className={clsx('text-sm leading-relaxed', title ? 'mt-0.5' : '', 'text-textMain')}>
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Toast({
  tone = 'ok',
  title,
  description,
  onDismiss
}: {
  tone?: AlertTone;
  title: string;
  description?: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[60] w-[min(360px,calc(100vw-2rem))] rounded-card border border-border bg-surface p-4 shadow-soft"
    >
      <div className="flex items-start gap-3">
        <span
          className={clsx(
            'grid h-9 w-9 shrink-0 place-items-center rounded-field border',
            ALERT_TONE_CLASSES[tone]
          )}
        >
          <AlertIcon tone={tone} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-textMain">{title}</p>
          {description ? (
            <p className="mt-0.5 text-sm leading-snug text-textSecondary">{description}</p>
          ) : null}
        </div>
        {onDismiss ? (
          <IconButton
            label="Tutup notifikasi"
            icon={<X aria-hidden className="h-4 w-4" />}
            variant="ghost"
            onClick={onDismiss}
            className="h-9 w-9"
          />
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-card border border-border bg-subtle text-textMuted">
        {icon ?? <Inbox aria-hidden className="h-6 w-6" />}
      </div>
      <h3 className="mt-4 text-lg font-semibold tracking-[-0.01em] text-textMain">{title}</h3>
      <p className="mt-1 max-w-[46ch] text-base leading-relaxed text-textSecondary">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  retrying = false,
  title = 'Data gagal dimuat'
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  title?: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-card border border-danger/20 bg-danger/10 text-danger">
        <AlertTriangle aria-hidden className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-lg font-semibold tracking-[-0.01em] text-textMain">{title}</h3>
      <p className="mt-1 max-w-[52ch] text-base leading-relaxed text-textSecondary">{message}</p>
      <Button
        variant="outline"
        onClick={onRetry}
        icon={<RotateCw aria-hidden className="h-4 w-4" />}
        className="mt-5"
      >
        {retrying ? 'Mencoba ulang…' : 'Coba lagi'}
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeletons                                                                  */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx(
        'animate-pulse rounded-field bg-border motion-reduce:animate-none',
        className
      )}
    />
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Memuat data">
      <span className="sr-only">Memuat data…</span>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 px-5 py-4">
            <Skeleton className="h-9 w-9 shrink-0 rounded-sm" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-32 sm:block" />
            <Skeleton className="hidden h-7 w-24 rounded-full md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Memuat ringkasan"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <span className="sr-only">Memuat ringkasan…</span>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-card bg-subtle p-5">
          <Skeleton className="h-10 w-10 rounded-field" />
          <Skeleton className="mt-4 h-3 w-28" />
          <Skeleton className="mt-2 h-7 w-20" />
        </div>
      ))}
    </div>
  );
}

export function BlockSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Memuat data" className={clsx('px-5 py-4', className)}>
      <span className="sr-only">Memuat data…</span>
      <div className="space-y-4">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-start gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* KPI + activity                                                             */
/* -------------------------------------------------------------------------- */

export type StatTone = 'default' | 'primary' | 'soft' | 'ok' | 'danger';

const KPI_TONE_CLASSES: Record<StatTone, string> = {
  default: 'bg-subtle text-textSecondary',
  primary: 'bg-primary/10 text-primary',
  soft: 'bg-primary-soft/45 text-textMain',
  ok: 'bg-ok/10 text-ok',
  danger: 'bg-danger/10 text-danger'
};

export function StatGrid({
  children,
  className,
  columns = 4
}: {
  children: ReactNode;
  className?: string;
  columns?: 2 | 4;
}) {
  return (
    <div
      className={clsx(
        'grid grid-cols-1 gap-4 sm:grid-cols-2',
        columns === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-2',
        className
      )}
    >
      {children}
    </div>
  );
}

/** Kartu KPI: chip ikon berbentuk persegi, label kecil, nilai besar. */
export function KpiCard({
  label,
  value,
  note,
  icon,
  tone = 'primary'
}: {
  label: string;
  value: string;
  note?: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
}) {
  return (
    <div className="flex items-center gap-4 rounded-card bg-subtle p-5">
      {icon ? (
        <span
          aria-hidden
          className={clsx(
            'grid h-10 w-10 shrink-0 place-items-center rounded-field',
            KPI_TONE_CLASSES[tone]
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        <span className="line-clamp-2 block h-8 text-[12px] font-semibold uppercase leading-4 tracking-[0.05em] text-textSecondary">
          {label}
        </span>
        <p className="tnum mt-1 text-kpi font-bold leading-none tracking-[-0.02em] text-textMain">
          {value}
        </p>
        {note ? (
          <p
            className={clsx(
              'mt-1.5 line-clamp-2 min-h-[2.1rem] text-[13px] leading-snug',
              tone === 'danger' && 'font-semibold text-danger',
              tone === 'ok' && 'font-medium text-ok',
              tone === 'primary' && 'font-medium text-primary',
              tone === 'soft' && 'font-medium text-textMain',
              tone === 'default' && 'text-textSecondary'
            )}
          >
            {note}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface ActivityItemData {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  tone?: StatTone;
  badge?: ReactNode;
  href?: string;
  action?: ReactNode;
}

export function ActivityList({
  items,
  emptyTitle = 'Belum ada aktivitas',
  emptyDescription = 'Item terbaru akan muncul di sini.',
  className
}: {
  items: ActivityItemData[];
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}) {
  if (items.length === 0) {
    return (
      <p className={clsx('px-5 py-6 text-sm text-textSecondary', className)}>{emptyDescription}</p>
    );
  }

  return (
    <ul className={clsx('flex flex-col gap-3 px-5 pb-5', className)}>
      {items.map((item) => {
        const content = (
          <>
            <span
              aria-hidden
              className={clsx(
                'grid h-9 w-9 shrink-0 place-items-center rounded-full',
                KPI_TONE_CLASSES[item.tone ?? 'primary']
              )}
            >
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-textMain">
                {item.title}
              </span>
              <span className="mt-0.5 block truncate text-[13px] text-textSecondary">
                {item.description}
              </span>
            </span>
          </>
        );

        return (
          <li
            key={item.id}
            className="flex items-center gap-3 rounded-field bg-subtle px-4 py-3"
          >
            {item.href ? (
              <Link
                href={item.href}
                className="flex min-w-0 flex-1 items-center gap-3 transition-opacity hover:opacity-75"
              >
                {content}
              </Link>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-3">{content}</span>
            )}
            {item.badge}
            {item.action}
            {item.href ? (
              <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-textMuted" />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Charts                                                                     */
/* -------------------------------------------------------------------------- */

export interface BarChartDatum {
  label: string;
  value: number;
  highlight?: boolean;
}

/**
 * Bar chart sederhana: nol = track kosong tanpa garis, nilai > 0 = satu bar
 * utuh dari baseline. Tinggi bar proporsional linear terhadap nilai maks.
 */
export function BarChart({
  data,
  unit = 'booking',
  height = 200,
  emptyNote = 'Belum ada data untuk periode ini.'
}: {
  data: BarChartDatum[];
  unit?: string;
  height?: number;
  emptyNote?: string;
}) {
  const max = data.reduce((peak, item) => Math.max(peak, item.value), 0);

  if (data.length === 0 || max === 0) {
    return (
      <p className="rounded-field bg-subtle px-4 py-6 text-center text-sm text-textSecondary">
        {emptyNote}
      </p>
    );
  }

  const barArea = height - 26;
  const mid = Math.max(1, Math.ceil(max / 2));
  const columns = `repeat(${data.length}, minmax(0, 1fr))`;

  return (
    <div className="flex gap-3">
      <div
        className="flex w-9 shrink-0 flex-col justify-between text-right text-[11px] leading-none text-textMuted"
        style={{ height: `${barArea}px` }}
        aria-hidden
      >
        <span>{max}</span>
        <span>{mid}</span>
        <span>0</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="grid gap-2 sm:gap-3" style={{ gridTemplateColumns: columns }}>
          {data.map((item) => (
            <div
              key={item.label}
              className="flex w-full max-w-[38px] justify-self-center items-end overflow-hidden rounded-field bg-subtle ring-1 ring-inset ring-border/70"
              style={{ height: `${barArea}px` }}
            >
              {item.value > 0 ? (
                <div
                  className={clsx(
                    'w-full rounded-sm',
                    item.highlight ? 'bg-primary' : 'bg-primary/70'
                  )}
                  style={{ height: `${(item.value / max) * 100}%` }}
                  title={`${item.label}: ${item.value} ${unit}`}
                />
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-2 grid gap-2 sm:gap-3" style={{ gridTemplateColumns: columns }}>
          {data.map((item) => (
            <span
              key={`label-${item.label}`}
              className="text-center text-[11.5px] leading-none text-textSecondary"
            >
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export type DonutColor = 'primary' | 'soft' | 'ok' | 'danger' | 'muted';

export interface DonutSegment {
  id: string;
  label: string;
  value: number;
  color: DonutColor;
  href?: string;
}

const DONUT_COLORS: Record<DonutColor, string> = {
  primary: 'var(--tl-primary)',
  soft: 'var(--tl-primary-soft)',
  ok: 'var(--tl-ok)',
  danger: 'var(--tl-danger)',
  muted: 'var(--tl-text-muted)'
};

export function DonutChart({
  segments,
  centerLabel,
  centerValue,
  unit = 'booking',
  emptyNote = 'Belum ada data untuk ditampilkan.'
}: {
  segments: DonutSegment[];
  centerLabel: string;
  centerValue: string;
  unit?: string;
  emptyNote?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  if (total === 0) {
    return (
      <p className="rounded-field bg-subtle px-4 py-6 text-center text-sm text-textSecondary">
        {emptyNote}
      </p>
    );
  }

  let cursor = 0;
  const stops = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const start = cursor;
      cursor += (segment.value / total) * 360;
      return `${DONUT_COLORS[segment.color]} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`;
    });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">      <div
        role="img"
        aria-label={`${centerLabel}: ${centerValue}`}
        className="grid h-[156px] w-[156px] shrink-0 place-items-center rounded-full"
        style={{ background: `conic-gradient(${stops.join(', ')})` }}
      >
        <div className="grid h-[118px] w-[118px] place-items-center rounded-full bg-surface text-center">
          <div>
            <p className="text-[11.5px] text-textSecondary">{centerLabel}</p>
            <p className="tnum mt-0.5 text-[18px] font-bold text-textMain">{centerValue}</p>
          </div>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-2.5">
        {segments.map((segment) => {
          const label = segment.href ? (
            <Link
              href={segment.href}
              className="text-textMain underline decoration-textMuted/40 underline-offset-2 transition-colors hover:text-primary hover:decoration-primary"
            >
              {segment.label}
            </Link>
          ) : (
            <span className="text-textMain">{segment.label}</span>
          );
          return (
            <li key={segment.id} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: DONUT_COLORS[segment.color] }}
                />
                {label}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="tnum w-8 text-right text-textSecondary">{segment.value}</span>
                <span className="tnum w-10 text-right font-bold text-textMain">
                  {Math.round((segment.value / total) * 100)}%
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Meter({
  percent,
  tone = 'ok',
  className
}: {
  percent: number;
  tone?: 'ok' | 'primary' | 'danger';
  className?: string;
}) {
  const width = Math.min(100, Math.max(0, percent));
  return (
    <div
      role="presentation"
      className={clsx('h-1.5 overflow-hidden rounded-full bg-border', className)}
    >
      <div
        className={clsx(
          'h-full rounded-full',
          tone === 'ok' ? 'bg-ok' : tone === 'danger' ? 'bg-danger' : 'bg-primary'
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbar, key-value, pagination                                             */
/* -------------------------------------------------------------------------- */

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'grid gap-4 border-b border-border px-5 py-4 sm:grid-cols-2 xl:grid-cols-4',
        className
      )}
    >
      {children}
    </div>
  );
}

export function ToolbarFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3',
        className
      )}
    >
      {children}
    </div>
  );
}

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'ok' | 'danger';
  emphasis?: boolean;
}

export function KeyValue({
  items,
  layout = 'rows',
  className
}: {
  items: KeyValueItem[];
  layout?: 'rows' | 'grid';
  className?: string;
}) {
  if (layout === 'grid') {
    return (
      <dl
        className={clsx(
          'grid grid-cols-2 gap-x-4 gap-y-4 rounded-field bg-subtle px-4 py-4',
          className
        )}
      >
        {items.map((item, index) => (
          <div key={index} className="min-w-0">
            <dt className="text-[13px] text-textSecondary">{item.label}</dt>
            <dd
              className={clsx(
                'mt-0.5 truncate text-base font-semibold text-textMain',
                item.tone === 'ok' && 'text-ok',
                item.tone === 'danger' && 'text-danger'
              )}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl className={clsx('divide-y divide-border overflow-hidden rounded-field bg-surface', className)}>
      {items.map((item, index) => (
        <div
          key={index}
          className={clsx(
            'flex items-baseline justify-between gap-4 px-5 py-3',
            item.emphasis && 'bg-subtle'
          )}
        >
          <dt className="text-[15px] text-textSecondary">
            {item.label}
            {item.hint ? (
              <span className="ml-1.5 text-[13px] text-textMuted">{item.hint}</span>
            ) : null}
          </dt>
          <dd
            className={clsx(
              'tnum shrink-0 text-[15px] font-semibold text-textMain',
              item.tone === 'ok' && 'text-ok',
              item.tone === 'danger' && 'text-danger'
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Pagination({
  page,
  pageCount,
  start,
  end,
  total,
  unit = 'data',
  onPageChange
}: {
  page: number;
  pageCount: number;
  start: number;
  end: number;
  total: number;
  unit?: string;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-textSecondary">
        Menampilkan <span className="tnum font-semibold text-textMain">{start}–{end}</span> dari{' '}
        <span className="tnum font-semibold text-textMain">{total}</span> {unit}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          ariaLabel="Halaman sebelumnya"
          icon={<ChevronRight aria-hidden className="h-4 w-4 rotate-180" />}
        >
          Sebelumnya
        </Button>
        <span className="tnum min-w-[92px] text-center text-sm text-textSecondary">
          Hal. {page} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          ariaLabel="Halaman berikutnya"
          iconAfter={<ChevronRight aria-hidden className="h-4 w-4" />}
        >
          Berikutnya
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shell primitives                                                           */
/* -------------------------------------------------------------------------- */

function useDismissable<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  return ref;
}

export interface SidebarNavSubItem {
  id: string;
  label: string;
  href: string;
}

export interface SidebarNavItemModel {
  id: string;
  label: string;
  href: string;
  icon: ReactNode;
  submenu?: SidebarNavSubItem[];
}

export interface SidebarNavGroupModel {
  id: string;
  label: string;
  items: SidebarNavItemModel[];
}

export function isNavItemActive(
  pathname: string,
  item: SidebarNavItemModel
): boolean {
  const hrefs = [item.href, ...(item.submenu?.map((child) => child.href) ?? [])];
  return hrefs.some((href) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
  );
}

export function SidebarNavItem({
  item,
  active,
  collapsed,
  onNavigate
}: {
  item: SidebarNavItemModel;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useDismissable<HTMLDivElement>(open, () => setOpen(false));

  const hasSubmenu = Boolean(item.submenu?.length) && !collapsed;

  return (
    <div ref={containerRef} className="relative">
      {hasSubmenu ? (
        <>
          <button
            type="button"
            title={collapsed ? item.label : undefined}
            aria-expanded={open}
            aria-label={collapsed ? item.label : undefined}
            onClick={() => setOpen((previous) => !previous)}
            className={clsx(
              'flex min-h-12 w-full items-center gap-2.5 rounded-sm px-3 text-[15px] font-medium transition-colors',
              collapsed ? 'justify-center px-0' : '',
              active ? 'bg-border/70 font-semibold text-textMain' : 'text-textSecondary hover:bg-border/60 hover:text-textMain'
            )}
          >
            <span aria-hidden className="shrink-0">
              {item.icon}
            </span>
            {collapsed ? null : (
              <>
                <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                <ChevronDown
                  aria-hidden
                  className={clsx('h-4 w-4 shrink-0 transition-transform', open ? 'rotate-180' : '')}
                />
              </>
            )}
          </button>
          {open && !collapsed ? (
            <ul className="ml-5 mt-1 flex flex-col gap-1 border-l border-border pl-3">
              {item.submenu?.map((child) => (
                <li key={child.id}>
                  <Link
                    href={child.href}
                    onClick={onNavigate}
                    className="flex min-h-11 items-center rounded-sm px-2.5 text-[14px] text-textSecondary transition-colors hover:bg-border/60 hover:text-textMain"
                  >
                    {child.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <Link
          href={item.href}
          onClick={onNavigate}
          title={collapsed ? item.label : undefined}
          aria-label={collapsed ? item.label : undefined}
          aria-current={active ? 'page' : undefined}
          className={clsx(
            'flex min-h-12 items-center gap-2.5 rounded-sm px-3 text-[15px] font-medium transition-colors',
            collapsed ? 'justify-center px-0' : '',
            active
              ? 'bg-border/70 font-semibold text-textMain'
              : 'text-textSecondary hover:bg-border/60 hover:text-textMain'
          )}
        >
          <span aria-hidden className="shrink-0">
            {item.icon}
          </span>
          {collapsed ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
        </Link>
      )}
    </div>
  );
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'grid h-[26px] w-[26px] shrink-0 grid-cols-2 gap-[2px] rounded-sm bg-primary p-[5px]',
        className
      )}
    >
      <span className="rounded-full bg-white" />
      <span className="rounded-full bg-white" />
      <span className="rounded-full bg-white" />
      <span className="rounded-full bg-white" />
    </span>
  );
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  groups,
  pathname,
  brandLabel,
  workspace,
  footer,
  onNavigate,
  className
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  groups: SidebarNavGroupModel[];
  pathname: string;
  brandLabel: string;
  workspace: ReactNode;
  footer: ReactNode;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <aside
      className={clsx(
        'flex h-full flex-col justify-between border-r border-border bg-sidebar transition-[width] duration-200',
        collapsed ? 'w-[76px]' : 'w-[250px]',
        className
      )}
    >
      <div className="overflow-y-auto px-4 pb-4 pt-5">
        <div
          className={clsx(
            'flex items-center gap-2.5 px-1.5',
            collapsed ? 'flex-col justify-center gap-2 px-0' : ''
          )}
        >
          <BrandMark />
          {collapsed ? null : (
            <span className="flex-1 text-[17px] font-bold tracking-[-0.01em] text-textMain">
              {brandLabel}
            </span>
          )}
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? 'Perlebar sidebar' : 'Ciutkan sidebar'}
            aria-label={collapsed ? 'Perlebar sidebar' : 'Ciutkan sidebar'}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-sm text-textMuted transition-colors hover:bg-border/60 hover:text-textMain"
          >
            <LayoutPanelLeft aria-hidden className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="mt-5">{workspace}</div>

        <nav aria-label="Navigasi utama" className="mt-6 flex flex-col gap-6">
          {groups.map((group) => (
            <div key={group.id}>
              <p className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-textMuted">
                {collapsed ? '' : group.label}
              </p>
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <SidebarNavItem
                      item={item}
                      collapsed={collapsed}
                      active={isNavItemActive(pathname, item)}
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="border-t border-border px-4 pb-14 pt-4">{footer}</div>
    </aside>
  );
}

export interface WorkspaceOption {
  id: string;
  label: string;
  hint: string;
}

export function WorkspaceSelector({
  value,
  options,
  onChange,
  collapsed = false
}: {
  value: string;
  options: WorkspaceOption[];
  onChange: (id: string) => void;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  const current = options.find((option) => option.id === value) ?? options[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-label={`Wilayah kerja: ${current.label}`}
        title={collapsed ? current.label : undefined}
        className={clsx(
          'flex min-h-12 w-full items-center gap-2.5 rounded-field border border-border bg-surface px-3 text-left shadow-soft transition-colors hover:border-textMuted/40',
          collapsed ? 'justify-center px-0' : ''
        )}
      >
        <span
          aria-hidden
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-textMain text-[11px] font-bold text-white"
        >
          {collapsed ? <MapPin className="h-3.5 w-3.5" /> : 'P'}
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold text-textMain">
                {current.label}
              </span>
              <span className="block truncate text-[11.5px] text-textMuted">{current.hint}</span>
            </span>
            <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-textMuted" />
          </>
        )}
      </button>
      {open ? (
        <ul className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-field border border-border bg-surface py-1 shadow-soft">
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className={clsx(
                  'flex min-h-11 w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-subtle',
                  option.id === value ? 'bg-primary/5' : ''
                )}
              >
                <span className="text-[14px] font-semibold text-textMain">{option.label}</span>
                <span className="text-[12px] text-textSecondary">{option.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Avatar({
  name,
  tone = 'primary',
  size = 'md',
  className
}: {
  name: string;
  tone?: 'primary' | 'soft' | 'ok' | 'danger' | 'dark';
  size?: 'sm' | 'md';
  className?: string;
}) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  const toneClass =
    tone === 'ok'
      ? 'bg-ok/15 text-ok'
      : tone === 'danger'
        ? 'bg-danger/15 text-danger'
        : tone === 'dark'
          ? 'bg-textMain text-white'
          : tone === 'soft'
            ? 'bg-primary-soft/50 text-textMain'
            : 'bg-primary/15 text-primary';

  return (
    <span
      title={name}
      aria-hidden
      className={clsx(
        'grid shrink-0 place-items-center rounded-full font-bold',
        size === 'sm' ? 'h-7 w-7 text-[11px]' : 'h-[30px] w-[30px] text-[11px]',
        toneClass,
        className
      )}
    >
      {initials}
    </span>
  );
}

export function AvatarStack({
  people,
  max = 3
}: {
  people: Array<{ name: string; tone?: 'primary' | 'soft' | 'ok' | 'danger' | 'dark' }>;
  max?: number;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;

  return (
    <div className="flex items-center">
      {shown.map((person, index) => (
        <Avatar
          key={person.name}
          name={person.name}
          tone={person.tone}
          className={clsx('border-2 border-page', index === 0 ? 'ml-0' : '-ml-2')}
        />
      ))}
      {rest > 0 ? (
        <span
          className="-ml-2 grid h-[30px] w-[30px] place-items-center rounded-full border-2 border-page bg-primary/10 text-[11px] font-bold text-primary"
        >
          +{rest}
        </span>
      ) : null}
    </div>
  );
}

export function TitleBlock({
  avatar,
  title,
  subtitle,
  className
}: {
  avatar?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}) {
  return (
    <span className={clsx('flex min-w-0 items-center gap-3', className)}>
      {avatar}
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold text-textMain">{title}</span>
        {subtitle ? (
          <span className="block truncate text-[13px] text-textSecondary">{subtitle}</span>
        ) : null}
      </span>
    </span>
  );
}

export interface NotificationItem {
  id: string;
  title: string;
  description: string;
  href: string;
}

/**
 * Bel notifikasi. Kalau tidak ada item, tombolnya nonaktif dengan penjelasan —
 * lebih baik lonceng mati daripada lonceng yang tidak melakukan apa pun.
 */
export function NotificationButton({
  items,
  emptyLabel = 'Tidak ada item yang perlu ditangani'
}: {
  items: NotificationItem[];
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  const count = items.length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        disabled={count === 0}
        aria-expanded={open}
        aria-label={
          count > 0
            ? `Notifikasi: ${count} item perlu ditangani`
            : 'Tidak ada notifikasi baru'
        }
        title={
          count > 0
            ? `${count} item perlu ditangani`
            : 'Tidak ada notifikasi baru'
        }
        className={clsx(
          'relative grid h-12 w-12 place-items-center rounded-full border border-border bg-surface text-textSecondary transition-colors',
          count > 0 ? 'hover:bg-subtle hover:text-textMain' : 'cursor-not-allowed opacity-60'
        )}
      >
        <Bell aria-hidden className="h-[18px] w-[18px]" />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full border-2 border-page bg-danger px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        ) : null}
      </button>

      {open && count > 0 ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[320px] overflow-hidden rounded-card border border-border bg-surface shadow-soft">
          <div className="border-b border-border px-4 py-3">
            <p className="text-[14px] font-semibold text-textMain">Perlu ditangani</p>
            <p className="mt-0.5 text-[12.5px] text-textSecondary">
              {count} item menunggu keputusan operator.
            </p>
          </div>
          <ul className="max-h-[320px] overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-subtle"
                >
                  <span className="block text-[14px] font-semibold text-textMain">
                    {item.title}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-textSecondary">
                    {item.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function GlobalSearch({
  value,
  onChange,
  onSubmit,
  inputRef,
  placeholder = 'Cari booking, vendor, atau kode',
  hint = '⌘K'
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex min-h-12 items-center gap-2 rounded-field border border-border bg-surface px-3"
    >
      <Search aria-hidden className="h-4 w-4 shrink-0 text-textMuted" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[14px] text-textMain outline-none placeholder:text-textMuted"
      />
      <kbd className="hidden rounded-sm border border-border bg-subtle px-1.5 py-0.5 text-[11px] font-semibold text-textSecondary sm:inline-block">
        {hint}
      </kbd>
    </form>
  );
}

export function UserProfile({
  name,
  role,
  onLogout,
  menuLabel = 'Menu profil'
}: {
  name: string;
  role: string;
  onLogout: () => void;
  menuLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-label={menuLabel}
        title={menuLabel}
        className="flex min-h-12 items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 transition-colors hover:bg-subtle"
      >
        <Avatar name={name} tone="dark" />
        <span className="hidden text-left leading-tight lg:block">
          <span className="block text-[13px] font-semibold text-textMain">{name}</span>
          <span className="block text-[11px] text-textMuted">{role}</span>
        </span>
        <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-textMuted" />
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-60 overflow-hidden rounded-field border border-border bg-surface shadow-soft">
          <div className="border-b border-border px-4 py-3">
            <p className="text-[14px] font-semibold text-textMain">{name}</p>
            <p className="text-[12px] text-textSecondary">{role}</p>
          </div>
          <div className="p-1.5">
            <Link
              href="/audit"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center gap-2 rounded-sm px-2.5 text-[14px] text-textSecondary transition-colors hover:bg-subtle hover:text-textMain"
            >
              Riwayat audit
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="flex min-h-11 w-full items-center gap-2 rounded-sm px-2.5 text-left text-[14px] text-textSecondary transition-colors hover:bg-subtle hover:text-textMain"
            >
              <LogOut aria-hidden className="h-4 w-4" />
              Keluar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Topbar({
  title,
  leading,
  trailing,
  className
}: {
  title: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={clsx(
        'flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-7',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <h1 className="truncate text-[20px] font-bold tracking-[-0.01em] text-textMain">{title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-3">{trailing}</div>
    </header>
  );
}
