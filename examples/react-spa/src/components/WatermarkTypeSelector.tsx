/**
 * WatermarkTypeSelector
 *
 * Two-option card selector for the watermark style to apply.
 * Mirrors the ProtectionModeSelector pattern from KC-striker-gcp.
 *
 * The `watermark_type` value label is rendered in accent mono font to give
 * developers a clear reference to the API field name/value they are sending.
 */

import { Camera, Sparkles, Check } from "lucide-react";
import type { WatermarkType } from "../api/keepchill";

interface WatermarkTypeSelectorProps {
  value: WatermarkType;
  onChange: (value: WatermarkType) => void;
  disabled?: boolean;
}

interface Option {
  type: WatermarkType;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const OPTIONS: Option[] = [
  {
    type: "photographer",
    label: "Photographer",
    description: "Corner watermark optimised for photography portfolios and stock imagery.",
    Icon: Camera,
  },
  {
    type: "creator",
    label: "Content Creator",
    description: "Compact tag-style watermark suited for social media and branded content.",
    Icon: Sparkles,
  },
];

export function WatermarkTypeSelector({
  value,
  onChange,
  disabled = false,
}: WatermarkTypeSelectorProps) {
  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-foreground">Watermark Style</label>

      <div className="grid grid-cols-2 gap-3">
        {OPTIONS.map(({ type, label, description, Icon }) => {
          const selected = value === type;

          return (
            <button
              key={type}
              type="button"
              disabled={disabled}
              onClick={() => onChange(type)}
              className={`
                relative rounded-xl border p-4 text-left transition-all duration-200
                focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50
                ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
                ${
                  selected
                    ? "border-accent/60 bg-accent/5 shadow-glow-sm"
                    : "border-border bg-card hover:border-border/80 hover:bg-muted/60"
                }
              `}
            >
              {/* Selected checkmark */}
              {selected && (
                <span className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent">
                  <Check className="h-3 w-3 text-accent-foreground" />
                </span>
              )}

              {/* Icon */}
              <Icon
                className={`mb-3 h-5 w-5 ${selected ? "text-accent" : "text-muted-foreground"}`}
              />

              {/* Label */}
              <p className={`text-sm font-semibold ${selected ? "text-foreground" : "text-muted-foreground"}`}>
                {label}
              </p>

              {/* Description */}
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {description}
              </p>

              {/* API value label — developer reference */}
              <p className="mt-3 font-mono text-[10px] text-accent/70">
                watermark_type: &quot;{type}&quot;
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
