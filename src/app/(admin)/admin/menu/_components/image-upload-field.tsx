"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  /** Name of the hidden input that carries the stored file name. */
  name?: string;
  label?: string;
  initialPath: string | null;
  /** Thumbnail URL for `initialPath` (computed on the server). */
  initialPreviewUrl: string | null;
  error?: string;
};

const ERRORS: Record<number, string> = {
  401: "Tu sesión expiró. Volvé a ingresar.",
  403: "No tenés permisos para subir imágenes.",
  413: "La imagen es demasiado grande.",
  415: "Formato no soportado. Usá JPG, PNG o WebP.",
  422: "No se pudo leer la imagen. Probá con otro archivo.",
};

type Uploaded = { path: string; thumbUrl?: string };

function upload(file: File, onProgress: (pct: number) => void): Promise<Uploaded> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Error de red. Revisá tu conexión e intentá de nuevo."));
    xhr.onload = () => {
      if (xhr.status === 201) {
        try {
          const body = JSON.parse(xhr.responseText) as Uploaded;
          if (typeof body.path === "string") return resolve(body);
        } catch {
          // fall through to the generic error
        }
      }
      reject(new Error(ERRORS[xhr.status] ?? "No se pudo subir la imagen. Intentá de nuevo."));
    };
    const body = new FormData();
    body.set("file", file);
    xhr.send(body);
  });
}

export function ImageUploadField({ name = "imagePath", label = "Imagen", initialPath, initialPreviewUrl, error }: Props) {
  const [path, setPath] = useState<string | null>(initialPath);
  const [preview, setPreview] = useState<string | null>(initialPreviewUrl);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  function setLocalPreview(file: File | null) {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = file ? URL.createObjectURL(file) : null;
    setPreview(objectUrl.current);
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    const before = preview; // always a server URL (or null): local previews only live during an upload
    setUploadError(null);
    setLocalPreview(file);
    setProgress(0);
    try {
      const uploaded = await upload(file, setProgress);
      setPath(uploaded.path);
      setLocalPreview(null);
      setPreview(uploaded.thumbUrl ?? before);
    } catch (e) {
      // Keep whatever was there before; drop the failed local preview.
      setLocalPreview(null);
      setPreview(before);
      setUploadError(e instanceof Error ? e.message : "No se pudo subir la imagen.");
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  }

  function remove() {
    setLocalPreview(null);
    setPath(null);
    setPreview(null);
    setUploadError(null);
  }

  const uploading = progress !== null;
  const shownError = uploadError ?? error;
  return (
    <fieldset className="flex flex-col gap-2" aria-busy={uploading}>
      <legend className="text-sm font-medium">{label}</legend>
      <input type="hidden" name={name} value={path ?? ""} />
      <div className="flex flex-wrap items-center gap-4">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Vista previa de la imagen" className="size-28 rounded-xl border border-line object-cover" />
        ) : (
          <span className="flex size-28 items-center justify-center rounded-xl border border-dashed border-line text-sm text-ink-muted">
            Sin imagen
          </span>
        )}
        <div className="flex flex-col items-start gap-2">
          <input
            ref={input}
            id={`${name}-file`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(e) => void onPick(e.target.files?.[0])}
            aria-label={`${label}: elegir archivo`}
            className="max-w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:font-semibold file:text-brand-700"
          />
          {uploading ? (
            <div className="flex items-center gap-2 text-sm text-ink-muted" role="status">
              <progress max={100} value={progress ?? 0} className="h-2 w-40" aria-label="Progreso de la subida" />
              Subiendo… {progress}%
            </div>
          ) : null}
          {path && !uploading ? (
            <Button variant="danger" size="sm" onClick={remove}>
              Quitar imagen
            </Button>
          ) : null}
        </div>
      </div>
      {shownError ? (
        <p role="alert" className="text-sm font-medium text-state-error">
          {shownError}
        </p>
      ) : null}
    </fieldset>
  );
}
