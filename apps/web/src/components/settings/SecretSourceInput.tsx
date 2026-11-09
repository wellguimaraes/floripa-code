import {
  isSecretReferenceForKind,
  SecretReference,
  type EnvironmentId,
  type SecretProviderConfig,
  type SecretProviderId,
  type SecretProviderKind,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { KeyRoundIcon, TypeIcon } from "lucide-react";
import { useState, type ComponentType, type ReactNode } from "react";

import { isSecretsFeatureEnabled } from "../../env";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { OnePasswordIcon } from "../Icons";
import { DraftInput, type DraftInputProps } from "../ui/draft-input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { classifySecretProvider } from "./SecretProviderDialog.logic";

export interface SecretSource {
  readonly id: SecretProviderId;
  readonly kind: SecretProviderKind;
  readonly label: string;
}

const NO_SECRET_SOURCES: ReadonlyArray<SecretSource> = [];
const STORED_VALUE = "__stored__";
const decodeSecretReference = Schema.decodeUnknownOption(SecretReference);

/** What a provider kind's references look like, for the field's hint and its rejection message. */
const REFERENCE_HINTS: Readonly<
  Record<string, { readonly placeholder: string; readonly invalid: string }>
> = {
  one_password: {
    placeholder: "op://vault/item/field",
    invalid: "Use a 1Password reference like op://vault/item/field.",
  },
};

/** Secret providers a setting can point at; empty when the environment cannot read references. */
export function useSecretSources(environmentId: EnvironmentId): ReadonlyArray<SecretSource> {
  const providers = useEnvironmentSettings(environmentId, (settings) => settings.secretProviders);
  const supported = useAtomValue(
    serverEnvironment.configValueAtom(environmentId),
  )?.secretReferences;
  if (!isSecretsFeatureEnabled || supported !== true) return NO_SECRET_SOURCES;
  return (Object.entries(providers) as Array<[SecretProviderId, SecretProviderConfig]>)
    .filter(([, config]) => classifySecretProvider(config).kind !== "unsupported")
    .map(([id, config]) => ({ id, kind: config.kind, label: config.label }));
}

/** The reference `text` names in `provider`, or `null` when the provider cannot read that syntax. */
export function parseSecretReference(
  sources: ReadonlyArray<SecretSource>,
  provider: SecretProviderId,
  text: string,
): SecretReference | null {
  const source = sources.find((candidate) => candidate.id === provider);
  const decoded = decodeSecretReference({ provider, reference: text.trim() });
  if (source === undefined || Option.isNone(decoded)) return null;
  return isSecretReferenceForKind(source.kind, decoded.value.reference) ? decoded.value : null;
}

export function secretReferenceHint(sources: ReadonlyArray<SecretSource>, provider: string | null) {
  const kind = sources.find((source) => source.id === provider)?.kind;
  return kind === undefined ? undefined : REFERENCE_HINTS[kind];
}

function SourceLabel(props: {
  readonly icon: ComponentType<{ readonly className?: string }>;
  readonly label: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <props.icon className="size-3.5 shrink-0" />
      <span className="truncate">{props.label}</span>
    </span>
  );
}

/** Picks Value (`null`) or one of `sources`; a `value` no longer among them stays listed. */
export function SecretSourceSelect(props: {
  readonly value: SecretProviderId | null;
  readonly sources: ReadonlyArray<Pick<SecretSource, "id" | "label">>;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onValueChange: (provider: SecretProviderId | null) => void;
}) {
  const { value, sources } = props;
  const known = value === null || sources.some((source) => source.id === value);
  const title =
    value === null ? "Value" : (sources.find((source) => source.id === value)?.label ?? value);
  const Icon = value === null ? TypeIcon : known ? OnePasswordIcon : KeyRoundIcon;
  return (
    <Select
      value={value ?? STORED_VALUE}
      onValueChange={(next) =>
        props.onValueChange(
          next === STORED_VALUE || next === null ? null : (next as SecretProviderId),
        )
      }
      {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
    >
      <SelectTrigger
        size="sm"
        className="w-auto min-w-0 shrink-0"
        aria-label={`${props.label} source`}
        title={title}
      >
        <SelectValue>
          <Icon className="size-3.5 shrink-0" />
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="start" alignItemWithTrigger={false}>
        <SelectItem value={STORED_VALUE}>
          <SourceLabel icon={TypeIcon} label="Value" />
        </SelectItem>
        {sources.map((source) => (
          <SelectItem key={source.id} value={source.id}>
            <SourceLabel icon={OnePasswordIcon} label={source.label} />
          </SelectItem>
        ))}
        {known ? null : (
          <SelectItem value={value}>
            <SourceLabel icon={KeyRoundIcon} label={value} />
          </SelectItem>
        )}
      </SelectPopup>
    </Select>
  );
}

type SecretSourceInputProps = Omit<DraftInputProps, "value" | "onCommit"> & {
  readonly value: string | SecretReference;
  readonly sources: ReadonlyArray<SecretSource>;
  /** A literal committed from the Value field. */
  readonly onLiteralCommit: (value: string) => void;
  /** A reference committed from a secret provider's field, or `undefined` once it is cleared. */
  readonly onSecretChange: (secret: SecretReference | undefined) => void;
};

/** A secret entered here, or read from a secret provider when one is configured. */
export function SecretSourceInput({
  value,
  sources,
  onLiteralCommit,
  onSecretChange,
  className,
  ...rest
}: SecretSourceInputProps) {
  // A provider picked here applies once a reference for it is committed.
  const [pendingProvider, setPendingProvider] = useState<SecretProviderId | null>(null);
  const [rejectedReference, setRejectedReference] = useState<string | null>(null);
  const secret = typeof value === "string" ? undefined : value;
  const provider = pendingProvider ?? secret?.provider ?? null;
  const reference = secret !== undefined && secret.provider === provider ? secret.reference : "";
  const label = rest["aria-label"] ?? "Secret";
  const hint = secretReferenceHint(sources, provider);
  const select =
    sources.length === 0 && provider === null ? null : (
      <SecretSourceSelect
        value={provider}
        sources={sources}
        label={label}
        onValueChange={(next) => {
          setRejectedReference(null);
          if (next === null) {
            setPendingProvider(null);
            if (secret !== undefined) onSecretChange(undefined);
            return;
          }
          setPendingProvider(next === secret?.provider ? null : next);
        }}
      />
    );

  const field =
    provider === null ? (
      <DraftInput
        {...rest}
        {...(className === undefined ? {} : { className })}
        value={typeof value === "string" ? value : ""}
        onCommit={onLiteralCommit}
      />
    ) : (
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <DraftInput
          size="sm"
          font="mono"
          value={rejectedReference ?? reference}
          onCommit={(next) => {
            if (next.trim().length === 0) {
              setRejectedReference(null);
              if (pendingProvider === null && secret !== undefined) onSecretChange(undefined);
              return;
            }
            const parsed = parseSecretReference(sources, provider, next);
            if (parsed === null) {
              setRejectedReference(next);
              return;
            }
            setRejectedReference(null);
            setPendingProvider(null);
            onSecretChange(parsed);
          }}
          autoComplete="off"
          placeholder={hint?.placeholder}
          spellCheck={false}
          aria-label={`${label} reference`}
          aria-invalid={rejectedReference !== null}
        />
        {rejectedReference !== null ? (
          <p className="text-2xs text-destructive">
            {hint?.invalid ?? "Enter a valid secret reference."}
          </p>
        ) : null}
      </div>
    );

  if (select === null) return field;
  return (
    <div className="flex min-w-0 flex-1 items-start gap-1.5">
      {select}
      {field}
    </div>
  );
}

function ResolvedSecretSources(props: {
  readonly environmentId: EnvironmentId;
  readonly children: (sources: ReadonlyArray<SecretSource>) => ReactNode;
}) {
  return props.children(useSecretSources(props.environmentId));
}

/** Hands `children` the secret providers of `environmentId`, or none when it has no environment. */
export function WithSecretSources(props: {
  readonly environmentId: EnvironmentId | undefined;
  readonly children: (sources: ReadonlyArray<SecretSource>) => ReactNode;
}) {
  return props.environmentId === undefined ? (
    props.children(NO_SECRET_SOURCES)
  ) : (
    <ResolvedSecretSources environmentId={props.environmentId}>
      {props.children}
    </ResolvedSecretSources>
  );
}
