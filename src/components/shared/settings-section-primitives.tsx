"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

export function LinearSettingsSection({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hasHeader = title || description || actions;

  return (
    <section className="flex flex-col gap-4">
      {hasHeader ? (
        <div className="flex items-start justify-between gap-4 px-0 max-[520px]:flex-col max-[520px]:items-stretch">
          <div className="min-w-0">
            {title ? (
              <h3 className="text-[15px] font-medium leading-[23px] text-foreground">
                {title}
              </h3>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-[13px] leading-[22px] text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function LinearSettingsCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[60px] items-center justify-between gap-3 px-4 py-4 max-[520px]:items-start">
      <div className="min-w-0 flex-1 flex flex-col gap-1">
        <p className="text-sm font-medium leading-5 text-foreground">
          {title}
        </p>
        {description ? (
          <p className="text-[13px] leading-[18px] text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-end">{children}</div>
    </div>
  );
}

export function NativeSettingsSection({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <LinearSettingsSection
      title={title}
      description={description}
      actions={actions}
    >
      <LinearSettingsCard>{children}</LinearSettingsCard>
    </LinearSettingsSection>
  );
}

export function NativeSettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2.5 px-4 py-3.5 min-[520px]:min-h-[60px] min-[520px]:grid-cols-[minmax(0,1fr)_18rem] min-[520px]:items-center">
      <div className="min-w-0">
        <p className="text-sm font-medium leading-5 text-foreground">
          {title}
        </p>
        {description ? (
          <p className="mt-[3px] text-[13px] leading-[18px] text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 justify-start min-[520px]:justify-end">
        {children}
      </div>
    </div>
  );
}
