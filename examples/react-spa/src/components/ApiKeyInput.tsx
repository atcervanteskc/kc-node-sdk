/**
 * ApiKeyInput
 *
 * Renders the API key field with show/hide toggle and a security notice.
 *
 * ⚠️  SECURITY — This component stores the API key in React state (in-memory
 * only). It is never written to localStorage, sessionStorage, or any
 * persistent store. The key is only transmitted to POST /v1/auth/token.
 *
 * In a production application serving external users, the token exchange must
 * happen on your backend — never expose the API key to the browser.
 */

import { useCallback, useState } from "react";
import { Eye, EyeOff, Key, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

interface ApiKeyInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Tri-state: undefined = untested, true = authenticated, false = rejected */
  isValid?: boolean;
}

export function ApiKeyInput({ value, onChange, isValid }: ApiKeyInputProps) {
  const [visible, setVisible] = useState(false);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value.trim()),
    [onChange],
  );

  return (
    <div className="space-y-4">
      {/* Label row */}
      <div className="flex items-center gap-2">
        <Key className="h-4 w-4 text-accent" />
        <label htmlFor="api-key" className="text-sm font-medium text-foreground">
          API Key
        </label>

        {/* Auth status indicator */}
        {isValid === true && (
          <span className="ml-auto flex items-center gap-1 text-xs text-success font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Authenticated
          </span>
        )}
        {isValid === false && (
          <span className="ml-auto flex items-center gap-1 text-xs text-destructive font-medium">
            <XCircle className="h-3.5 w-3.5" />
            Authentication failed
          </span>
        )}
      </div>

      {/* Input */}
      <div className="relative">
        <input
          id="api-key"
          type={visible ? "text" : "password"}
          value={value}
          onChange={handleChange}
          placeholder="sk_live_…"
          spellCheck={false}
          autoComplete="off"
          className="
            w-full rounded-lg border border-input bg-muted px-4 py-3 pr-11
            font-mono text-sm text-foreground placeholder:text-muted-foreground
            focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50
            transition-colors
          "
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide API key" : "Show API key"}
          tabIndex={-1}
          className="
            absolute right-3 top-1/2 -translate-y-1/2
            text-muted-foreground hover:text-foreground transition-colors
          "
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {/* ⚠️ Security notice — do not strip this from production forks */}
      <div className="flex gap-3 rounded-lg border border-warning/20 bg-warning/5 p-3.5">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-px" />
        <p className="text-xs text-warning/90 leading-relaxed">
          <strong className="font-semibold">Development / demo only.</strong>{" "}
          This example calls the KeepChill API directly from the browser using
          your API key. In a production application, move the token exchange to
          a backend server — the API key must never be exposed to end-users.
        </p>
      </div>
    </div>
  );
}
