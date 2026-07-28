import { useState, type InputHTMLAttributes } from "react";
import type { z } from "zod";
import { validate } from "@/lib/validation";

type Props = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  schema?: z.ZodType<unknown>;
  /** Applied on every keystroke (e.g. uppercase plate). */
  format?: (v: string) => string;
  /** Applied on blur (e.g. strip non-digits). */
  formatOnBlur?: (v: string) => string;
  hint?: string;
  error?: string | null;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">;

/** Text input with inline validation error shown in red below the field. */
export function ValidatedField({
  label,
  value,
  onChange,
  schema,
  format,
  formatOnBlur,
  hint,
  error,
  ...inputProps
}: Props) {
  const [touched, setTouched] = useState(false);
  const localError = schema && (touched || value) ? validate(schema, value) : null;
  const shown = error ?? (touched ? localError : null);

  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <input
        {...inputProps}
        value={value}
        onChange={(e) => onChange(format ? format(e.target.value) : e.target.value)}
        onBlur={() => {
          setTouched(true);
          if (formatOnBlur) onChange(formatOnBlur(value));
        }}
        aria-invalid={!!shown}
        className={`mt-1 w-full rounded-xl border bg-background px-4 py-3 text-base outline-none focus:ring-2 ${
          shown
            ? "border-destructive focus:border-destructive focus:ring-destructive/30"
            : "border-input focus:border-primary focus:ring-primary/30"
        }`}
      />
      {shown ? (
        <span className="mt-1 block text-xs font-medium text-destructive">{shown}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}
