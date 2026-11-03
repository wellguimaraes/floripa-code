import { useEffect, useState, useSyncExternalStore } from "react";

import {
  completeConfirmDialogClose,
  readConfirmDialogState,
  registerConfirmDialogHost,
  respondToConfirmDialog,
  subscribeConfirmDialog,
} from "../confirmDialog";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Popover, PopoverClose, PopoverPopup, PopoverTitle } from "./ui/popover";

type ConfirmationCopy = {
  readonly title: string;
  readonly description: string | null;
};

function resolveConfirmDialogCopy(message: string): ConfirmationCopy {
  const normalizedMessage = message.trim();
  const lines = normalizedMessage.split("\n");
  const questionLineIndex = lines.findIndex((line) => line.trim().endsWith("?"));

  if (questionLineIndex >= 0) {
    const title = lines[questionLineIndex]!.trim();
    const description = lines
      .filter((_, index) => index !== questionLineIndex)
      .join("\n")
      .trim();
    return { title, description: description || null };
  }

  const questionMarkIndex = normalizedMessage.indexOf("?");
  if (questionMarkIndex >= 0) {
    return {
      title: normalizedMessage.slice(0, questionMarkIndex + 1).trim(),
      description: normalizedMessage.slice(questionMarkIndex + 1).trim() || null,
    };
  }

  return {
    title: "Confirm action",
    description: normalizedMessage || "This action requires your confirmation.",
  };
}

export function ConfirmDialogHost() {
  const state = useSyncExternalStore(
    subscribeConfirmDialog,
    readConfirmDialogState,
    readConfirmDialogState,
  );

  useEffect(() => registerConfirmDialogHost(), []);

  const copy = resolveConfirmDialogCopy(state.status === "idle" ? "" : state.message);
  const confirmVariant = state.status === "idle" ? "default" : state.variant;
  const anchor = state.status === "idle" ? null : state.anchor;
  const rememberLabel = state.status === "idle" ? null : state.rememberLabel;
  const [remember, setRemember] = useState(false);
  const onCancel = () => respondToConfirmDialog(false);
  const onConfirm = () => respondToConfirmDialog(true, remember);
  const onClosed = () => {
    setRemember(false);
    completeConfirmDialogClose();
  };
  const rememberCheckbox = rememberLabel ? (
    <label className="flex items-center gap-2 text-muted-foreground text-sm">
      <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked)} />
      {rememberLabel}
    </label>
  ) : null;

  if (anchor) {
    return (
      <Popover
        open={state.status === "confirming"}
        onOpenChange={(open) => {
          if (!open) onCancel();
        }}
        onOpenChangeComplete={(open) => {
          if (!open) onClosed();
        }}
      >
        <PopoverPopup anchor={anchor} side="bottom" align="start" width="sm">
          <PopoverTitle>{copy.title}</PopoverTitle>
          {copy.description ? (
            <p className="mt-2 whitespace-pre-line text-muted-foreground text-sm">
              {copy.description}
            </p>
          ) : null}
          {rememberCheckbox ? <div className="mt-3">{rememberCheckbox}</div> : null}
          <div className="mt-4 flex justify-end gap-2">
            <PopoverClose render={<Button variant="outline" size="sm" />}>Cancel</PopoverClose>
            <Button variant={confirmVariant} size="sm" onClick={onConfirm}>
              Confirm
            </Button>
          </div>
        </PopoverPopup>
      </Popover>
    );
  }

  return (
    <AlertDialog
      open={state.status === "confirming"}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) onClosed();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          {copy.description ? (
            <AlertDialogDescription className="whitespace-pre-line">
              {copy.description}
            </AlertDialogDescription>
          ) : null}
          {rememberCheckbox}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button variant={confirmVariant} onClick={onConfirm}>
            Confirm
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
