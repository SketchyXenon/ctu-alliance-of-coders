"use client";

import * as React from "react";
import { Bot, Eye, EyeOff, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";

interface ChatbotConfigStatus {
  enabled: boolean;
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  updatedAt: string | null;
}

const EMPTY: ChatbotConfigStatus = {
  enabled: false,
  baseUrl: "",
  model: "",
  maxTokens: 512,
  temperature: 0.3,
  hasApiKey: false,
  apiKeyPreview: null,
  updatedAt: null,
};

export function ChatbotSettings() {
  const [cfg, setCfg] = React.useState<ChatbotConfigStatus>(EMPTY);
  const [apiKey, setApiKey] = React.useState("");
  const [showKey, setShowKey] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await api.get<{ config: ChatbotConfigStatus }>(
        "/api/chat/config",
      );
      if (cancelled) return;
      if (error || !data) {
        setLoading(false);
        return;
      }
      setCfg(data.config);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    const payload: Record<string, unknown> = {
      enabled: cfg.enabled,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature,
      apiKey: apiKey.trim() || undefined,
    };
    const { data, error } = await api.put<{ config: ChatbotConfigStatus }>(
      "/api/chat/config",
      payload,
    );
    setSaving(false);
    if (error || !data) {
      toast.error("Failed to save", {
        description: error?.message ?? "Please try again.",
      });
      return;
    }
    setCfg(data.config);
    setApiKey("");
    toast.success("AI assistant settings saved");
  }

  if (loading) {
    return (
      <Card className="border-border/60">
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading AI assistant settings...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 font-display">
              <Bot
                className="size-5 text-gold-600 dark:text-gold-400"
                aria-hidden="true"
              />
              AI Assistant
            </CardTitle>
            <CardDescription>
              A content-grounded chatbot that answers only about this website.
              Connects to any OpenAI-compatible provider.
            </CardDescription>
          </div>
          <Badge
            variant={cfg.enabled ? "default" : "secondary"}
            className={
              cfg.enabled
                ? "border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300"
                : ""
            }
          >
            {cfg.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Enable toggle */}
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-3">
          <div className="space-y-0.5">
            <Label htmlFor="chatbot-enabled" className="text-sm font-medium">
              Enable assistant
            </Label>
            <p className="text-xs text-muted-foreground">
              Shows the chat button on the public site. Requires an API key.
            </p>
          </div>
          <Switch
            id="chatbot-enabled"
            checked={cfg.enabled}
            onCheckedChange={(v) => setCfg((c) => ({ ...c, enabled: v }))}
            aria-label="Enable the AI assistant"
          />
        </div>

        {/* Provider config */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="chatbot-baseurl" className="text-sm">
              API base URL
            </Label>
            <Input
              id="chatbot-baseurl"
              value={cfg.baseUrl}
              onChange={(e) =>
                setCfg((c) => ({ ...c, baseUrl: e.target.value }))
              }
              placeholder="https://api.groq.com/openai/v1"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              OpenAI-compatible endpoint. Examples: OpenRouter, Groq, Together,
              local Ollama.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="chatbot-model" className="text-sm">
              Model
            </Label>
            <Input
              id="chatbot-model"
              value={cfg.model}
              onChange={(e) => setCfg((c) => ({ ...c, model: e.target.value }))}
              placeholder="llama-3.1-8b-instant"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="chatbot-key" className="text-sm">
              API key
            </Label>
            <div className="relative">
              <Input
                id="chatbot-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  cfg.hasApiKey
                    ? `Keep current (${cfg.apiKeyPreview})`
                    : "Paste your provider API key"
                }
                autoComplete="off"
                spellCheck={false}
                className="pr-9"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 size-7"
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? "Hide API key" : "Show API key"}
                tabIndex={-1}
              >
                {showKey ? (
                  <EyeOff className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Stored server-side only. Leave blank to keep the current key.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="chatbot-maxtokens" className="text-sm">
              Max tokens
            </Label>
            <Input
              id="chatbot-maxtokens"
              type="number"
              min={100}
              max={2048}
              value={cfg.maxTokens}
              onChange={(e) =>
                setCfg((c) => ({
                  ...c,
                  maxTokens: Number(e.target.value) || 512,
                }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="chatbot-temp" className="text-sm">
              Temperature
            </Label>
            <Input
              id="chatbot-temp"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={cfg.temperature}
              onChange={(e) =>
                setCfg((c) => ({
                  ...c,
                  temperature: Number(e.target.value) || 0.3,
                }))
              }
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-4">
          <Button
            onClick={() => void save()}
            disabled={saving}
            className="gap-1.5"
          >
            <Save className="size-4" aria-hidden="true" />
            {saving ? "Saving..." : "Save settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
