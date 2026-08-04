"use client";

import * as React from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ImageUploadFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (url: string) => void;
  bucket: "officer" | "announcement";
  placeholder?: string;
  className?: string;
}

export function ImageUploadField({
  id,
  label,
  value,
  onChange,
  bucket,
  placeholder = "https://example.com/image.jpg",
  className,
}: ImageUploadFieldProps) {
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [previewError, setPreviewError] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("bucket", bucket);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed");
        return;
      }
      onChange(data.url);
      setPreviewError(false);
    } catch {
      setError("Network error during upload");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id} className="text-sm font-medium">
        {label}{" "}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1"
        />
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          aria-label="Upload image file"
          title="Upload image (JPEG, PNG, WebP - max 8MB)"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="h-4 w-4" />
          )}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange("")}
            aria-label="Clear image"
            title="Clear image"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {value && !previewError && (
        <div className="relative h-24 w-full overflow-hidden rounded-md border">
          <img
            src={value}
            alt="Preview"
            className="h-full w-full object-cover"
            onError={() => setPreviewError(true)}
          />
        </div>
      )}
      {value && previewError && (
        <div className="flex h-24 w-full items-center justify-center rounded-md border border-destructive/40 bg-destructive/5 px-4 text-center">
          <p className="text-xs text-destructive">
            Preview failed to load. The URL may be invalid or the image is not
            publicly accessible.
          </p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Paste a URL or upload (auto-compressed to WebP).
      </p>
    </div>
  );
}
